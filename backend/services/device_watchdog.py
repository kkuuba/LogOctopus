from fabric import Connection
from concurrent.futures import ThreadPoolExecutor
from backend.models.log_snapshot import LogSnapshot
from backend.utils.fabric_connection import build_fabric_connection
from backend.utils.ssh_network_capture import SshNetworkCapture
from backend.utils.pcap_decoder import PcapDecoder
import pandas as pd
from paramiko_expect import SSHClientInteraction
from datetime import datetime
from dateutil import parser
import re
import uuid
import time
import threading
import os
from time import sleep
import argparse
import json


class DeviceWatchdog:
    """
    A class used to collect logs for a target device using a defined configuration.
    """

    # Maximum rows kept per log before old entries are trimmed (memory guard)
    MAX_LOG_ROWS = 50_000

    def __init__(self, device_config, device_config_id):
        """
        Initializes a DeviceWatchdog instance.

        Args:
            device_config (dict): Connection and logging configuration for the target device.
            device_config_id (str): Unique identifier for this device config.
        """
        self.device_config = device_config
        self.device_config_id = device_config_id

        # Per-device directory for anything persisted to disk (pcap capture,
        # errors.feather, etc.) so file paths never depend on the process's
        # current working directory.
        self.device_data_dir = os.path.join("data", str(device_config_id))
        os.makedirs(self.device_data_dir, exist_ok=True)

        # SSH channels keyed by log_name; guarded by a single lock that covers
        # both the channels dict and all per-log collected_data lists.
        self.ssh_channels: dict[str, Connection] = {}
        self._channel_lock = threading.Lock()

        # Log data stored as lists of dicts; converted to DataFrames on demand.
        # Each log_name has its own dedicated lock so concurrent pollers don't
        # block one another while still protecting individual list mutations.
        self.collected_data: dict[str, list[dict]] = {}
        self._data_locks: dict[str, threading.Lock] = {}

        # Errors collected as a plain list to avoid repeated pd.concat overhead.
        # Protected by _error_lock.
        self._error_list: list[dict] = []
        self._error_lock = threading.Lock()

        self.collection_ongoing = False
        self.thread: threading.Thread | None = None
        self.collection_stop_event: threading.Event | None = None
        self.cutoff_time: pd.Timestamp | None = None
        self.log_snapshots: list[LogSnapshot] = []
        self.connection_status = False
        self.log_access = False

        # Pre-build lookup structures from config for O(1) access
        self._log_config_map: dict[str, dict] = {
            lc["log_name"]: lc for lc in device_config["log_file_configs"]
        }
        # Pre-compile per-log regexes once
        self._log_regex_map: dict[str, re.Pattern] = {
            lc["log_name"]: re.compile(lc["data_extraction_regex"])
            for lc in device_config["log_file_configs"]
        }

        # Persistent thread pool sized to the number of log sources.
        # shutdown(wait=True) is called in close() / teardown_log_collectors().
        self._executor = ThreadPoolExecutor(
            max_workers=len(device_config["log_file_configs"])
        )
        self.network_capture = None
        self.packets_capture_file: str | None = None

    # ------------------------------------------------------------------
    # SSH / command execution
    # ------------------------------------------------------------------

    def _get_or_create_channel(self, ssh_channel_id: str) -> Connection:
        """Return an existing SSH channel or create one, thread-safely.

        The entire lookup-and-create is performed inside the lock to eliminate
        the race condition that arose from the previous pattern of checking
        outside the lock and only locking on creation (TOCTOU).
        """
        # FIX: always enter the lock; eliminates the TOCTOU race where two
        # threads both passed the early-return check and each opened a new
        # connection for the same channel id.
        with self._channel_lock:
            if ssh_channel_id not in self.ssh_channels:
                conn = self.create_device_connection()
                conn.open()
                self.ssh_channels[ssh_channel_id] = conn
            return self.ssh_channels[ssh_channel_id]

    def execute_cmd(self, cmd: str | None, ssh_channel_id: str, custom_shell_prompt: str | None = None) -> str | None:
        """
        Execute a command via SSH on the target device.

        Args:
            cmd: Command string to run.
            ssh_channel_id: SSH channel identifier (usually log_name).
            custom_shell_prompt: Shell prompt to expect when using a custom shell.

        Returns:
            Full command stdout on success, or None on failure.
        """
        if cmd is None:
            return None
        try:
            channel = self._get_or_create_channel(ssh_channel_id)

            if custom_shell_prompt:
                interact = SSHClientInteraction(channel.client, timeout=20, display=False)
                interact.expect(custom_shell_prompt)
                cmd_output = ""
                for single_cmd in cmd.split(";"):
                    interact.send(single_cmd)
                    interact.expect(custom_shell_prompt)
                    cmd_output += interact.current_output_clean
                return cmd_output

            root_required = "sudo " in cmd
            runner = channel.sudo if root_required else channel.run
            kwargs = dict(hide=True, timeout=10)
            if root_required:
                kwargs["password"] = self.device_config["password"]

            cmd_result = runner(cmd, **kwargs)
            if cmd_result.ok:
                return cmd_result.stdout

            self._record_error(f"cmd '{cmd}' failed with -> {cmd_result.stderr.strip()}")

        except Exception as exc:
            self._record_error(f"cmd '{cmd}' failed with -> {exc}")

        return None

    def _record_error(self, error_info: str) -> None:
        """Append an error entry thread-safely (list-based, no pd.concat)."""
        # FIX: protect _error_list with its own lock — _record_error is called
        # from worker threads running concurrently in the executor.
        with self._error_lock:
            self._error_list.append({"time": datetime.now(), "error_info": error_info})

    @property
    def errors(self) -> pd.DataFrame:
        """Return errors as a DataFrame (built lazily on access, thread-safe snapshot)."""
        with self._error_lock:
            snapshot = list(self._error_list)
        return pd.DataFrame(snapshot) if snapshot else pd.DataFrame({"time": [], "error_info": []})

    # ------------------------------------------------------------------
    # Log collector lifecycle
    # ------------------------------------------------------------------

    def initialize_log_collectors(self) -> None:
        """Initialize log collectors for all defined log file configs."""
        for log_config in self.device_config["log_file_configs"]:
            log_name = log_config["log_name"]
            self.execute_cmd(
                log_config.get("log_activation_cmd"),
                log_name,
                log_config.get("custom_shell_prompt"),
            )
            # FIX: initialise per-log data lock alongside the data list so
            # concurrent get_log_file_content calls always have a lock to
            # acquire before touching the list.
            self.collected_data[log_name] = []
            self._data_locks[log_name] = threading.Lock()
        if self.device_config.get("packets_capture_config", None):
            packets_capture_channel = self._get_or_create_channel("packet_capture")
            packets_capture_interface = self.device_config["packets_capture_config"]["interface"]
            # Store under the per-device data directory rather than a bare
            # relative filename, so the capture doesn't depend on CWD and
            # doesn't collide across devices.
            packets_capture_file = os.path.join(self.device_data_dir, "capture.pcap")
            self.packets_capture_file = packets_capture_file
            self.network_capture = SshNetworkCapture(connection=packets_capture_channel, interface=packets_capture_interface, local_file=packets_capture_file)
            self.network_capture.start()

    def teardown_log_collectors(self) -> None:
        """Teardown log collectors and close all open SSH channels.

        Sends any configured deactivation command on each channel before
        closing it, then clears the channel registry so that future calls to
        _get_or_create_channel open fresh connections.
        """
        for log_config in self.device_config["log_file_configs"]:
            self.execute_cmd(
                log_config.get("log_deactivation_cmd"),
                log_config["log_name"],
                log_config.get("custom_shell_prompt"),
            )
        if self.device_config.get("packets_capture_config", None):
            self.network_capture.stop()
        # FIX: close every open SSH connection and clear the dict so channels
        # don't accumulate across start/stop cycles.
        with self._channel_lock:
            for conn in self.ssh_channels.values():
                try:
                    conn.close()
                except Exception:
                    pass
            self.ssh_channels.clear()

    def close(self) -> None:
        """Shut down the thread-pool executor.

        Call this when the DeviceWatchdog is no longer needed (e.g. when
        a device is removed) to release the underlying worker threads.

        FIX: the executor was previously never shut down, leaving threads
        running until interpreter exit when a watchdog was replaced.
        """
        self._executor.shutdown(wait=False)

    # ------------------------------------------------------------------
    # Log collection
    # ------------------------------------------------------------------

    def get_log_file_content(self, log_config: dict) -> None:
        """
        Fetch and parse log content, appending only genuinely new entries.

        Uses a pre-compiled regex and tracks the last-seen timestamp per log
        to avoid scanning the full history for duplicates on every poll.
        Each log's list is protected by its own lock so concurrent pollers
        do not race on reads or appends.

        Args:
            log_config: Log collector configuration dict.
        """
        log_name = log_config["log_name"]
        pattern = self._log_regex_map[log_name]

        raw = self.execute_cmd(
            log_config["log_file_cmd"],
            log_name,
            log_config.get("custom_shell_prompt"),
        )
        if not raw:
            return

        # FIX: acquire the per-log data lock before reading or writing the
        # list.  Using per-log locks (rather than a single global lock) means
        # concurrent pollers for different logs still run in parallel.
        lock = self._data_locks.get(log_name)
        if lock is None:
            # Guard against execute_cmd being called before initialize_log_collectors.
            return

        with lock:
            existing: list[dict] = self.collected_data[log_name]

            # Track the latest timestamp we already have so we can skip old lines.
            last_ts: datetime | None = existing[-1]["time"] if existing else None

            new_entries: list[dict] = []
            for line in raw.splitlines():
                m = pattern.search(line)
                if not m:
                    continue
                ts = parser.parse(m.group("TIME"))
                if last_ts is None or ts > last_ts:
                    new_entries.append({"time": ts, "content": m.group("ENTRY")})

            if new_entries:
                existing.extend(new_entries)
                # Memory guard: trim to the most recent MAX_LOG_ROWS rows
                if len(existing) > self.MAX_LOG_ROWS:
                    self.collected_data[log_name] = existing[-self.MAX_LOG_ROWS:]

    def get_all_log_files_content(self) -> None:
        """Fetch all logs concurrently using the persistent thread pool."""
        list(self._executor.map(self.get_log_file_content, self.device_config["log_file_configs"]))

    # ------------------------------------------------------------------
    # Collection loop
    # ------------------------------------------------------------------

    def start_logs_collection(self) -> None:
        """Start the background log-collection thread."""
        self.collection_ongoing = True
        self.collection_stop_event = threading.Event()
        self.cutoff_time = pd.Timestamp.now()
        self.thread = threading.Thread(
            target=self.logs_collection_loop,
            args=(self.device_config["collection_interval"],),
            daemon=True,
        )
        self.thread.start()

    def stop_logs_collection(self) -> None:
        """Signal the collection thread to stop and wait for it to finish.

        Safe to call even if collection was never started (no-op in that case).
        FIX: previously crashed with AttributeError when called before
        start_logs_collection because collection_stop_event and thread were None.
        """
        # FIX: guard against stop being called before start.
        if not self.collection_ongoing or self.collection_stop_event is None:
            return
        self.collection_stop_event.set()
        self.collection_ongoing = False
        if self.thread is not None:
            self.thread.join()
        self.remove_all_outdated_entries()
        self.teardown_log_collectors()

    def logs_collection_loop(self, interval: int) -> None:
        """
        Background loop: collect logs, wait for the interval, repeat.

        Checks the stop event *before* each collection so a stop request is
        honoured without waiting for the next network round-trip.

        Args:
            interval: Seconds between log fetches.
        """
        while not self.collection_stop_event.is_set():
            self.get_all_log_files_content()
            # Wait for interval or until stop is requested
            self.collection_stop_event.wait(timeout=interval)

    # ------------------------------------------------------------------
    # Post-collection processing
    # ------------------------------------------------------------------

    def remove_all_outdated_entries(self) -> None:
        """Drop log entries older than the collection start time and sort by time."""
        cutoff = self.cutoff_time
        for log_name, lock in self._data_locks.items():
            with lock:
                entries = self.collected_data.get(log_name, [])
                filtered = [e for e in entries if e["time"] >= cutoff.to_pydatetime()]
                self.collected_data[log_name] = sorted(filtered, key=lambda e: e["time"])

    def _entries_to_dataframe(self, log_name: str) -> pd.DataFrame:
        """Convert the internal list-of-dicts for a log into a DataFrame."""
        lock = self._data_locks.get(log_name)
        if lock is not None:
            with lock:
                entries = list(self.collected_data.get(log_name, []))
        else:
            entries = self.collected_data.get(log_name, [])
        return pd.DataFrame(entries) if entries else pd.DataFrame({"time": [], "content": []})

    def save_log_snapshots(self, session_id: str, session_scenario: str) -> None:
        """
        Persist collected logs as LogSnapshot objects.

        Args:
            session_id: Unique logs collection session ID.
            session_scenario: Scenario ID for this session.
        """
        for log_name, entries in self.collected_data.items():
            if not entries:
                continue
            log_config = self._log_config_map[log_name]          # O(1) lookup
            log_type = log_config.get("log_type", "")
            data_unit = log_config.get("data_unit", "")
            log_description = log_config.get("log_description", "")
            log_content = self._entries_to_dataframe(log_name)
            self.log_snapshots.append(
                LogSnapshot(
                    self.device_config_id,
                    self.device_config["device_name"],
                    log_name,
                    log_description,
                    session_id,
                    session_scenario,
                    data_unit,
                    log_type,
                    log_content,
                )
            )

        # Only build a pcap LogSnapshot when a capture was actually collected:
        # packets_capture_config being set just means the feature is enabled,
        # it doesn't guarantee network_capture ever wrote a non-empty file
        # (e.g. capture never started, or the session produced zero packets).
        if (
            self.packets_capture_file
            and os.path.exists(self.packets_capture_file)
            and os.path.getsize(self.packets_capture_file) > 0
        ):
            try:
                decoder = PcapDecoder(self.packets_capture_file)
                self.log_snapshots.append(
                    decoder.to_log_snapshot(
                        self.device_config_id,
                        self.device_config["device_name"],
                        session_id,
                        session_scenario,
                    )
                )
            except FileNotFoundError as exc:
                self._record_error(f"pcap decode failed -> {exc}")

    def get_target_log_param_based_on_log_name(self, log_name: str, log_param: str) -> str:
        """
        Get a log config parameter by log name in O(1) via the pre-built map.

        Args:
            log_name: Log name to look up.
            log_param: Config key to retrieve.

        Returns:
            Parameter value, or empty string if not found.
        """
        return self._log_config_map.get(log_name, {}).get(log_param, "")

    # ------------------------------------------------------------------
    # Status checks
    # ------------------------------------------------------------------

    def get_connection_status(self) -> None:
        """Update connection_status based on all SSH channels.

        FIX: previously only checked the first channel, which could report
        'connected' even when other channels were dead.  Now reports True only
        if *all* open channels are still connected.  Falls back to False when
        no channels exist yet.
        """
        with self._channel_lock:
            channels = dict(self.ssh_channels)

        if not channels:
            self.connection_status = False
            return

        self.connection_status = all(
            bool(ch and ch.is_connected) for ch in channels.values()
        )

    def test_log_files_access(self) -> None:
        """Check whether the first configured log file is accessible via SSH."""
        log_file_config = self.device_config["log_file_configs"][0]
        result = self.execute_cmd(
            log_file_config["log_file_cmd"],
            log_file_config["log_name"],
            log_file_config.get("custom_shell_prompt"),
        )
        self.log_access = bool(result)

    # ------------------------------------------------------------------
    # Connection factories
    # ------------------------------------------------------------------

    def create_device_connection(self) -> Connection:
        """
        Create a Fabric SSH Connection from the device config.

        Uses the shared connection builder (backend.utils.fabric_connection),
        the same one used by the config builder's Test Connection / Exec
        Command endpoints in app.py. This guarantees that any connection
        which passed "Test Connection" in the UI — including the SSH key
        type detection (RSA / Ed25519 / ECDSA / DSS) and passphrase
        handling — behaves identically here. Accepts either the nested
        ``gateway: {...}`` shape (as saved by the config builder) or a flat
        ``gateways: [...]`` list.

        Returns:
            Configured Fabric Connection object.
        """
        return build_fabric_connection(self.device_config)



# ---------------------------------------------------------------------------
# Config file helpers
# ---------------------------------------------------------------------------

def get_current_device_config(path_to_config_file: str) -> dict:
    """
    Load the device JSON configuration file.

    Args:
        path_to_config_file: Path to the JSON config file.

    Returns:
        Parsed configuration dict.
    """
    with open(path_to_config_file, "r", encoding="utf-8") as f:
        return json.load(f)


def update_device_config_parameters(path_to_config_file: str, updates: dict) -> None:
    """
    Apply multiple key/value updates to the device config file in a single
    read–write cycle (reduces disk I/O compared to one write per parameter).

    Args:
        path_to_config_file: Path to the JSON config file.
        updates: Dict of {key: value} pairs to apply.
    """
    with open(path_to_config_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    data.update(updates)
    with open(path_to_config_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


# Keep the single-key variant for backward compatibility
def update_device_config_parameter(path_to_config_file: str, key: str, value) -> None:
    update_device_config_parameters(path_to_config_file, {key: value})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    arg_parser = argparse.ArgumentParser(description="Device watchdog")
    arg_parser.add_argument("device_config_file_path", help="Path to target device config file")
    args = arg_parser.parse_args()

    init_device_config = get_current_device_config(args.device_config_file_path)
    device_watchdog = DeviceWatchdog(init_device_config, args.device_config_file_path.split("/")[1])

    auto_collection_timer = 0.0
    # FIX: track whether auto-collection has already been armed in the current
    # idle window so the timer is only reset on the transition from idle → armed,
    # not on every loop iteration while collection is ongoing.
    auto_collection_armed = False

    # FIX: track the errors list length so the feather file is only written
    # when new errors have been appended, avoiding constant disk I/O.
    last_errors_len = 0

    while True:
        current_device_config = get_current_device_config(args.device_config_file_path)

        # --- Start collection when requested ---
        if current_device_config["logs_collection"] and not device_watchdog.collection_ongoing:
            device_watchdog.initialize_log_collectors()
            device_watchdog.start_logs_collection()

        # --- Stop collection when requested ---
        if not current_device_config["logs_collection"] and device_watchdog.collection_ongoing:
            device_watchdog.stop_logs_collection()
            device_watchdog.save_log_snapshots(
                current_device_config["current_session_id"],
                current_device_config["session_scenario"],
            )
            update_device_config_parameters(
                args.device_config_file_path,
                {"current_session_id": "no_active_session"},
            )
            # Reset arm flag so auto-collection can trigger a fresh cycle
            # after the configured interval has elapsed from the last arm time.
            auto_collection_armed = False
            sleep(2)

        # --- Auto-collection: arm (only once per idle window) ---
        # FIX: previously reset auto_collection_timer on every loop iteration
        # while auto_collection_enabled was True and collection_ongoing was
        # False — meaning the disarm condition (timer elapsed) was never met
        # and collection restarted immediately after stopping.
        if (
            current_device_config["auto_collection_enabled"]
            and not device_watchdog.collection_ongoing
            and not auto_collection_armed
        ):
            auto_collection_timer = time.time()
            auto_collection_armed = True
            update_device_config_parameters(
                args.device_config_file_path,
                {
                    "logs_collection": True,
                    "current_session_id": f"auto_{uuid.uuid1().hex[:12]}",
                },
            )

        # --- Auto-collection: disarm after interval ---
        if (
            current_device_config["auto_collection_enabled"]
            and auto_collection_armed
            and time.time() - auto_collection_timer
            > current_device_config["auto_collection_interval"] * 3600
        ):
            update_device_config_parameters(
                args.device_config_file_path,
                {"logs_collection": False},
            )

        # --- Status probe & single-write config update ---
        device_watchdog.test_log_files_access()
        device_watchdog.get_connection_status()

        update_device_config_parameters(
            args.device_config_file_path,
            {
                "connected": device_watchdog.connection_status,
                "logs_available": device_watchdog.log_access,
            },
        )

        # --- Persist errors only when the list has grown ---
        # FIX: previously wrote the feather file unconditionally every 5 s,
        # causing constant disk I/O even when no new errors occurred.
        current_errors_len = len(device_watchdog._error_list)
        if current_errors_len != last_errors_len:
            errors_file_path = os.path.join(device_watchdog.device_data_dir, "errors.feather")
            device_watchdog.errors.to_feather(errors_file_path)
            last_errors_len = current_errors_len

        sleep(5)
