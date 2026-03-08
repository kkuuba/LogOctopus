import os
import shutil
from backend.models.log_snapshot import LogSnapshot
from backend.services.device_watchdog import DeviceWatchdog
from backend.utils.log_snapshots_loader import LogSnapshotsLoader

class Device:
    """
    A class used to perform all operation on remote or local device.
    """
    def __init__(self, device_config_instance):
        self.device_config = device_config_instance.get_device_config()
        self.device_config_id = device_config_instance.device_config_id
        self.device_config_instance = device_config_instance
        self.device_name = self.device_config["device_name"]
        self.device_watchdog = DeviceWatchdog(self.device_config)
        self.connection_status = False
        self.log_access = False
        self.log_snapshots = LogSnapshotsLoader(os.path.join("data", self.device_name)).load_all_log_snapshots()
        self.current_session_id = None

    def get_device_connection_status(self):
        """
        Get status of connection to target device.
        """
        self.connection_status = self.device_watchdog.ssh_connection.is_connected

    def test_log_files_access(self):
        """
        Validate if first 3 log files defined in configuration can be accessed via SSH. If any of first 3 log files cannot be accessed
        method return False.
        """
        for log_file_config in self.device_config["log_file_configs"][0:3]:
            current_log_content = self.device_watchdog.execute_cmd(log_file_config["log_file_cmd"])
            if current_log_content:
                continue
            else:
                self.log_access = False

        self.log_access = True

    def get_device_error_log(self):
        """
        Get list of all error log entries for target device.
        
        Returns:
            list: List of all error log entries for target device.
        """
        return self.device_watchdog.errors.to_dict("records")

    def start_logs_collection(self, session_id):
        """
        Start logs collection thread on target device.

        Args:
            session_id (str): Unique logs collection session ID.
        """
        if not self.device_watchdog.collection_ongoing:
            self.current_session_id = session_id
            self.device_watchdog.initialize_log_collectors()
            self.device_watchdog.start_logs_collection()

    def stop_logs_collection(self):
        """
        Stop logs collection thread on target device.
        """
        self.device_watchdog.stop_logs_collection()

    def save_log_snapshots(self):
        """
        Save all logs collected by device watchdog and save it in LogSnapshot object with all info about collected data.
        Data will be save info file and added to logsnapshots list.
        """
        for log_name, log_content in self.device_watchdog.collected_data.items():
            log_type = self.get_target_log_type_based_on_log_name(log_name)
            if not log_content.empty:
                self.log_snapshots.append(LogSnapshot(self.device_name, log_name, self.current_session_id, log_type, log_content))

    def get_target_log_type_based_on_log_name(self, log_name):
        """
        Get log type based on provided log name.

        Args:
            log_name (str): Log name for log type extraction from device config.

        Returns:
            str: Target log type (text|chart), default value is 'text'.
        """
        for log_config in self.device_config["log_file_configs"]:
            if log_name == log_config["log_name"]:
                return log_config["log_type"]
        
        return "text"

    def remove_device_data(self):
        """
        Remove all data files conected with this target device.
        """
        device_directory_path = f"data/{self.device_name}"
        shutil.rmtree(device_directory_path)
