import os
import json
import logging

class DeviceConfig:
    """
    A class used to store and manage device configuration.
    """
    def __init__(self, device_config_path):
        self.device_config_path = device_config_path
        self.device_config = None

    def __del__(self):
        self.remove_device_config()

    def validate_device_config(self):
        """
        Validated JSON structure of provided configuration file.
        """
        try:
            with open(self.device_config_path, encoding='utf-8', errors='ignore') as config_file:
                json.load(config_file)
            return True
        except json.JSONDecodeError as e:
            logging.error("Invalid %s JSON file. Parsing error -> %s", self.device_config_path, e)
            return False

    def get_device_config(self):
        """
        Get content of device configuration in dictionary format.
        """
        if self.device_config is None:
            with open(self.device_config_path, encoding='utf-8', errors='ignore') as config_file:
                config_file = json.load(config_file)
                config_file.close()
            self.device_config = config_file

        return self.device_config

    def remove_device_config(self):
        """
        Remove source configuration file for target device.
        """
        if os.path.exists(self.device_config_path):
            os.remove(self.device_config_path)
            logging.info("Configuraiton file -> '%s' was successfuly deleted", self.device_config_path)
        else:
            logging.error("Configuraiton file -> '%s' not exists ", self.device_config_path)
