import base64
from pathlib import Path
from backend.models.device import Device
from backend.models.device_config import DeviceConfig

class DeviceConfigLoader():

    def __init__(self, configs_dir_path):
        self.configs_dir_path = configs_dir_path

    def load_device_from_config(self, config_path):
        """
        Create Device object based on source device config file.

        Args:
            config_path (str): Path to source device config file.

        Returns:
            (Device): Instance of Device object.
        """
        with open(config_path, "rb") as config_file:
            config_content = base64.b64encode(config_file.read())
            config_file.close()
        if config_content:
            device_config = DeviceConfig(config_content)
            device_config.device_config_path = config_path
            return Device(device_config_instance=device_config)
        else:
            return None

    def load_all_devices(self):
        """
        Get all source device config files from target directory and create a list of Device objects.

        Returns:
            (list): List of Device objects.
        """
        devices_list = []
        config_paths = list(Path(self.configs_dir_path).rglob("*.json"))
        for config_path in config_paths:
            device = self.load_device_from_config(config_path)
            if device:
                devices_list.append(device)

        return devices_list
