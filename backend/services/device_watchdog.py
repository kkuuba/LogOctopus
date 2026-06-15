from fabric import Connection
from concurrent.futures import ThreadPoolExecutor
from backend.models.log_snapshot import LogSnapshot
import pandas as pd
from paramiko_expect import SSHClientInteraction
from datetime import datetime
from dateutil import parser
import re
import io
import uuid
import time
import threading
from paramiko import RSAKey
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

        # SSH channels keyed by log_name; guarded by a per-channel lock
        self.ssh_channels: dict[str, Connection] = {}
        self._channel_lock = threading.Lock()

        # Log data stored as lists of dicts; converted to DataFrames on demand
        self.collected_data: dict[str, list[dict]] = {}

        # Errors collected as a plain list to avoid repeated pd.concat overhead
        self._error_list: list[dict] = []

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

        # Persistent thread pool sized to the number of log sources
        self._executor = ThreadPoolExecutor(
            max_workers=len(device_config["log_file_configs"])
        )

    # ------------------------------------------------------------------
    # SSH / command execution
    # ------------------------------------------------------------------

    def _get_or_create_channel(self, ssh_channel_id: str) -> Connection:
        """Return an existing SSH channel or create one, thread-safely."""
        if ssh_channel_id in self.ssh_channels:
            return self.ssh_channels[ssh_channel_id]
        with self._channel_lock:
            # Double-checked locking
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
        """Append an error entry cheaply (list-based, no pd.concat)."""
        self._error_list.append({"time": datetime.now(), "error_info": error_info})

    @property
    def errors(self) -> pd.DataFrame:
        """Return errors as a DataFrame (built lazily on access)."""
        return pd.DataFrame(self._error_list) if self._error_list else pd.DataFrame({"time": [], "error_info": []})

    # ------------------------------------------------------------------
    # Log collector lifecycle
    # ------------------------------------------------------------------

    def initialize_log_collectors(self) -> None:
        """Initialize log collectors for all defined log file configs."""
        for log_config in self.device_config["log_file_configs"]:
            self.execute_cmd(
                log_config.get("log_activation_cmd"),
                log_config["log_name"],
                log_config.get("custom_shell_prompt"),
            )
            self.collected_data[log_config["log_name"]] = []

    def teardown_log_collectors(self) -> None:
        """Teardown log collectors for all defined log file configs."""
        for log_config in self.device_config["log_file_configs"]:
            self.execute_cmd(
                log_config.get("log_deactivation_cmd"),
                log_config["log_name"],
                log_config.get("custom_shell_prompt"),
            )

    # ------------------------------------------------------------------
    # Log collection
    # ------------------------------------------------------------------

    def get_log_file_content(self, log_config: dict) -> None:
        """
        Fetch and parse log content, appending only genuinely new entries.

        Uses a pre-compiled regex and tracks the last-seen timestamp per log
        to avoid scanning the full history for duplicates on every poll.

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

        existing: list[dict] = self.collected_data[log_name]

        # Track the latest timestamp we already have so we can skip old lines
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
        """Signal the collection thread to stop and wait for it to finish."""
        self.collection_stop_event.set()
        self.collection_ongoing = False
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
        for log_name, entries in self.collected_data.items():
            filtered = [e for e in entries if pd.Timestamp(e["time"]) >= cutoff]
            self.collected_data[log_name] = sorted(filtered, key=lambda e: e["time"])

    def _entries_to_dataframe(self, log_name: str) -> pd.DataFrame:
        """Convert the internal list-of-dicts for a log into a DataFrame."""
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
            log_content = self._entries_to_dataframe(log_name)
            self.log_snapshots.append(
                LogSnapshot(
                    self.device_config_id,
                    self.device_config["device_name"],
                    log_name,
                    session_id,
                    session_scenario,
                    data_unit,
                    log_type,
                    log_content,
                )
            )

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
        """Update connection_status based on the first SSH channel."""
        first_log_name = self.device_config["log_file_configs"][0]["log_name"]
        channel = self.ssh_channels.get(first_log_name)
        self.connection_status = bool(channel and channel.is_connected)

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

        Returns:
            Configured Fabric Connection object.
        """
        return Connection(
            host=self.device_config["ip_address"],
            user=self.device_config["user"],
            port=self.device_config.get("port", 22),
            connect_kwargs=self._build_connect_kwargs(self.device_config),
            gateway=self._build_gateway(self.device_config.get("gateway")),
        )

    @staticmethod
    def _build_connect_kwargs(config: dict) -> dict:
        """
        Build Fabric connect_kwargs from a config dict.

        Args:
            config: Source configuration dict.

        Returns:
            Dict suitable for Fabric's connect_kwargs parameter.
        """
        connect_kwargs: dict = {}

        if "ssh_key_path" in config:
            connect_kwargs["key_filename"] = config["ssh_key_path"]
        elif "ssh_key_string" in config:
            private_key = RSAKey.from_private_key(
                io.StringIO(config["ssh_key_string"]),
                password=config.get("ssh_key_passphrase"),
            )
            connect_kwargs["pkey"] = private_key

        if "password" in config:
            connect_kwargs["password"] = config["password"]

        if "ssh_key_passphrase" in config and "ssh_key_path" in config:
            connect_kwargs["passphrase"] = config["ssh_key_passphrase"]

        return connect_kwargs

    @classmethod
    def _build_gateway(cls, gateway_config: dict | None) -> Connection | None:
        """
        Recursively build a gateway Connection from config.

        Args:
            gateway_config: Gateway configuration dict, or None.

        Returns:
            Fabric Connection for the gateway, or None.
        """
        if not gateway_config:
            return None
        return Connection(
            host=gateway_config["ip_address"],
            user=gateway_config["user"],
            port=gateway_config.get("port", 22),
            connect_kwargs=cls._build_connect_kwargs(gateway_config),
            gateway=cls._build_gateway(gateway_config.get("gateway")),
        )


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
            sleep(2)

        # --- Auto-collection: arm ---
        if current_device_config["auto_collection_enabled"] and not device_watchdog.collection_ongoing:
            auto_collection_timer = time.time()
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

        # --- Persist errors ---
        errors_file_path = f"data/{device_watchdog.device_config_id}/errors.feather"
        device_watchdog.errors.to_feather(errors_file_path)

        sleep(5)
