import base64
import os
from backend.models.device import Device
from backend.models.device_config import DeviceConfig

class LogSnapshotsLoader():

    def __init__(self, log_snapshots_dir_path):
        self.log_snapshots_dir_path = log_snapshots_dir_path

    def load_log_snapshots_from_file(self, log_snapshots_path):
        with open(log_snapshots_path, encoding='utf-8', errors='ignore') as log_snapshot_file:
            log_snapshot_content = base64.b64encode(config_file.read())
            log_snapshot_file.close()

        if log_snapshot_content:
            device_config = DeviceConfig(config_content)
            return Device(device_config_instance=device_config)
        else:
            return None

    def load_all_devices(self):
        devices_list = []
        for root, dirs, files in os.walk(self.configs_dir_path):
            for file in files:
                full_path = os.path.join(root, file)
                devices_list.append(self.load_device_from_config(full_path))

        return devices_list
