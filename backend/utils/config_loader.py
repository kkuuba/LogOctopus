import base64
from pathlib import Path
from backend.models.device import Device
from backend.models.device_config import DeviceConfig

class DeviceConfigLoader():

    def __init__(self, configs_dir_path):
        self.configs_dir_path = configs_dir_path

    def load_device_from_config(self, config_path):
        with open(config_path, "rb") as config_file:
            config_content = base64.b64encode(config_file.read())
            config_file.close()
        if config_content:
            device_config = DeviceConfig(config_content)
            return Device(device_config_instance=device_config)
        else:
            return None

    def load_all_devices(self):
        devices_list = []
        config_paths = list(Path(self.configs_dir_path).rglob("*.json"))
        print(config_paths)
        for config_path in config_paths:
            device = self.load_device_from_config(config_path)
            if device:
                devices_list.append(device)

        return devices_list
