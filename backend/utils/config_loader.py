import base64
import os
from backend.models.device import Device
from backend.models.device_config import DeviceConfig

class DeviceConfigLoader():

    def __init__(self, configs_dir_path):
        self.configs_dir_path = configs_dir_path

    def load_device_from_config(self, config_path):
        with open(config_path, encoding='utf-8', errors='ignore') as config_file:
            config_content = base64.b64encode(config_file.read())
            config_file.close()
        if config_content:
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
