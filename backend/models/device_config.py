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
        Validated JSON structure of provided configuration file and copy file to target destination directory.
        Add runtime paramters to configuraiton file to store current state of device watchdog.
        """
        try:
            with open(self.device_config_path, encoding='utf-8', errors='ignore') as config_file:
                config_data = json.load(config_file)
            watchdog_data = {
                "logs_collection": False,
                "current_session_id": "no_active_session",
                "session_scenario": "no_active_session",
                "connected": False,
                "logs_available": False,
                "watchdog_process_pid": 0,
                "auto_collection_enabled": False,
                "auto_collection_interval": 0
            }
            config_data.update(watchdog_data)
            with open(self.device_config_path, 'w', encoding='utf-8') as config_file:
                json.dump(config_data, config_file, indent=2)
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

    def update_runtime_parameter(self, key, value):
        config_path = self.device_config_path
        with open(config_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        data[key] = value
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
