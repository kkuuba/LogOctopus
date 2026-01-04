from backend.models.log_snapshot import LogSnapshot
from backend.services.device_watchdog import DeviceWatchdog

class Device:
    """
    A class used to perform all operation on remote or local device.
    """
    def __init__(self, device_config_instance):
        self.device_config = device_config_instance.get_device_config()
        self.device_name = self.device_config["device_name"]
        self.device_watchdog = DeviceWatchdog(self.device_config)
        self.log_snapshots = []

    def get_device_connection_status(self):
        """
        Get status of connection to target device.

        Returns:
            bool: Current status of device connection.
        """
        if self.device_config["local_device"]:
            return True
        return self.device_watchdog.ssh_connection.is_connected()

    def test_log_files_access(self):
        """
        Validate if log files defined in configuration can be accessed via SSH. If any log file can be accessed
        method return False.

        Returns:
            bool: True if all log files can be accessed, otherwise returns False.
        """
        for log_file_config in self.device_config["log_file_configs"]:
            current_log_content = self.device_watchdog.ssh_connection.execute_cmd(log_file_config["log_file_cmd"])
            if current_log_content:
                continue
            else:
                return False

        return True

    def get_device_error_log(self):
        """
        Get list of all error log entries for target device.
        
        Returns:
            list: List of all error log entries for target device.
        """
        return self.device_watchdog.errors.to_dict("records")

    def start_logs_collection(self):
        """
        Start logs collection thread on target device.
        """
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
            self.log_snapshots.append(LogSnapshot(log_name, log_content))
