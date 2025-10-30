from backend.models.device_config import DeviceConfig
from backend.services.device_watchdog import DeviceWatchdog

class Device:

    def __init__(self, config_file_path):
        self.device_config = DeviceConfig(config_file_path).get_device_config()
        self.device_name = self.device_config["device_name"]
        self.device_watchdog = DeviceWatchdog(self.device_config)

    def test_device_connection(self):
        pass

    def test_log_files_access(self):
        pass

    def get_device_error_log(self):
        pass

    def start_logs_collection(self):
        pass

    def stop_logs_collection(self):
        pass

    def save_logs_snapshot(self):
        pass
