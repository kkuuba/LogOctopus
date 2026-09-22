import os
import shutil
import time
import subprocess
import pandas as pd
from backend.utils.log_snapshots_loader import LogSnapshotsLoader
from backend.utils import snapshot_index

class Device:
    """
    A class used to perform all operation on remote or local device.
    """
    def __init__(self, device_config_instance):
        self.device_config = device_config_instance.get_device_config()
        self.device_config_id = device_config_instance.device_config_id
        self.device_config_instance = device_config_instance
        self.connection_status = self.device_config["connected"]
        self.log_access = self.device_config["logs_available"]
        self.device_name = self.device_config["device_name"]
        self.collection_ongoing = self.device_config["logs_collection"]
        self.watchdog_process_pid = self.device_config["watchdog_process_pid"]
        self.auto_collection_enabled = self.device_config["auto_collection_enabled"]
        self.auto_collection_interval = self.device_config["auto_collection_interval"]
        # Lazily-loaded metadata (device_name, log_name, timestamps,
        # duration, size, etc.) - NOT full row data. See the `log_snapshots`
        # property below for why this is no longer populated eagerly here.
        self._log_snapshots = None
        self.errors = pd.DataFrame({"time": [], "error_info": []})
        if  self.watchdog_process_pid == 0 or not self.is_process_active():
            watchdog_process = subprocess.Popen(["python", "-m", "backend.services.device_watchdog", self.device_config_instance.device_config_path])
            self.device_config_instance.update_runtime_parameter("watchdog_process_pid", watchdog_process.pid)

    @property
    def log_snapshots(self):
        """
        Metadata (not full row data) for every log snapshot belonging to
        this device, read from the parquet footers on first access and
        cached on the instance afterwards.

        This is loaded lazily rather than in __init__ because
        get_current_devices() - and therefore this constructor - runs on
        nearly every API request, but only GET /api/snapshots (via
        LogSnapshotsHelper.get_log_snapshots_list/get_filtered_log_snapshots_list)
        actually needs it; every other endpoint (device list, connection
        tests, etc.) was previously paying the cost of scanning every
        snapshot file for every device on every single request. Note that
        GET /api/snapshots itself now reads straight from
        backend.utils.snapshot_index instead of going through this
        property at all (see app.py::list_snapshots) - this remains here
        for any other caller that still wants a live, per-device metadata
        list built straight from the parquet footers.

        Returns:
            list[LogSnapshotMeta]
        """
        if self._log_snapshots is None:
            self._log_snapshots = LogSnapshotsLoader(
                os.path.join("data", self.device_config_id)
            ).load_all_log_snapshot_metas()
        return self._log_snapshots

    def get_device_error_log(self):
        """
        Get list of all error log entries for target device.

        Returns:
            list: List of all error log entries for target device.
        """
        self.errors = pd.read_parquet(f"data/{self.device_config_id}/errors.feather")

    def start_logs_collection(self, session_id, session_scenario):
        """
        Start logs collection thread on target device.

        Args:
            session_id (str): Unique logs collection session ID.
            session_scenario (str): Scenario ID for logs collection session.
        """
        self.device_config_instance.update_runtime_parameter("current_session_id", session_id)
        self.device_config_instance.update_runtime_parameter("session_scenario", session_scenario)
        self.device_config_instance.update_runtime_parameter("logs_collection", True)

    def stop_logs_collection(self):
        """
        Stop logs collection thread on target device.
        """
        self.device_config_instance.update_runtime_parameter("logs_collection", False)

    def remove_device_data(self):
        """
        Remove all data files conected with this target device.
        """
        device_directory_path = f"data/{self.device_config_id}"
        shutil.rmtree(device_directory_path)
        # Drop this device's rows from the listing index so its deleted
        # snapshots stop appearing in GET /api/snapshots.
        snapshot_index.remove_for_device(self.device_config_id)

    def is_process_active(self):
        """
        Validate if watchdog process is active.

        Returns:
            bool: True if watchog process is active in system, otherwise return False.
        """
        try:
            os.kill(self.watchdog_process_pid, 0)
            return True
        except ProcessLookupError:
            return False  # Process doesn't exist

    def wait_for_log_collection_teardown(self, timeout=30):
        """
        Wait for log collection session to be finished correctly.

        Args:
            timeout (int): Max timeout for log session teardown to be finished.
        """
        start_time = time.time()
        while start_time - time.time() < timeout:
            device_config = self.device_config_instance.get_device_config()
            if device_config["current_session_id"] == "no_active_session":
                break
            time.sleep(1)
