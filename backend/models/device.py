from backend.models.device_config import DeviceConfig
from backend.models.log_snapshot import LogSnapshot
from backend.services.device_watchdog import DeviceWatchdog

class Device:

    def __init__(self, device_config_instance):
        self.device_config = device_config_instance.get_device_config()
        self.device_name = self.device_config["device_name"]
        self.device_watchdog = DeviceWatchdog(self.device_config)
        self.log_snapshots = []

    def get_device_connection_status(self):
        if self.device_config["local_device"]:
            return True
        return self.device_watchdog.ssh_connection.is_connected()

    def test_log_files_access(self):
        for log_file_config in self.device_config["log_file_configs"]:
            current_log_content = self.device_watchdog.ssh_connection.execute_cmd(log_file_config["log_file_cmd"])
            if current_log_content:
                continue
            else:
                return False

    def get_device_error_log(self):
        return self.device_watchdog.errors.to_dict("records")

    def start_logs_collection(self):
        self.device_watchdog.initialize_log_collectors()
        self.device_watchdog.start_logs_collection()

    def stop_logs_collection(self):
        self.device_watchdog.stop_logs_collection()

    def save_log_snapshot(self):
        self.log_snapshots.append(LogSnapshot(self.device_watchdog.collected_data))
