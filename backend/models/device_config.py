import os
import shutil
import json
import hashlib
import base64
import logging

class DeviceConfig:
    """
    A class used to store and manage device configuration.
    """
    def __init__(self, file_content_str):
        self.device_config_id = self.save_config_file(file_content_str)
        self.device_config_path = f"/tmp/{self.device_config_id}.json"
        self.device_config = None

    def save_config_file(self, file_content_str):
        decoded = base64.b64decode(file_content_str)
        device_config_id = hashlib.sha256(json.loads(decoded)["device_name"].encode()).hexdigest()[:12]
        with open(f"/tmp/{device_config_id}.json", "wb") as f:
            f.write(decoded)

        return device_config_id

    def validate_device_config(self):
        """
        Validated JSON structure of provided configuration file and copy file to target desticnation directory.
        """
        try:
            with open(self.device_config_path, encoding='utf-8', errors='ignore') as config_file:
                config_data = json.load(config_file)

            target_device_directory = f"data/{config_data['device_name']}"
            target_config_path = f"{target_device_directory}/{self.device_config_path.split('/')[-1]}"
            if not os.path.exists(target_device_directory):
                os.mkdir(target_device_directory)
            shutil.move(self.device_config_path, target_config_path)
            self.device_config_path = target_config_path

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
                config_file_content = json.load(config_file)
                config_file.close()
            self.device_config = config_file_content

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
