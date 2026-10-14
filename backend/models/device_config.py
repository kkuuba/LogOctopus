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

    # Keys that represent live/runtime watchdog state rather than editable
    # device configuration. Exposed as a class attribute (not just an
    # instance default) so callers such as the API layer can read the
    # current values of these keys without having to construct a
    # DeviceConfig instance first.
    WATCHDOG_DATA_DEFAULTS = {
        "logs_collection": False,
        "current_session_id": "no_active_session",
        "session_scenario": "no_active_session",
        "connected": False,
        "logs_available": False,
        "watchdog_process_pid": 0,
        "auto_collection_enabled": False,
        "auto_collection_interval": 0
    }

    def __init__(self, file_content_str, existing_device_config_id=None, existing_watchdog_data=None):
        """
        Args:
            file_content_str (str): Config file content, base-64-encoded.
            existing_device_config_id (str, optional): When editing an
                already-existing device, pass its current device_config_id
                here so the ID is preserved instead of being re-derived
                from the (edited) content. Device IDs double as the data
                directory name and are referenced from log-snapshot
                metadata, so they must stay stable across edits.
            existing_watchdog_data (dict, optional): When editing an
                already-existing device, pass its current runtime/watchdog
                state here so it survives the edit instead of being reset
                to fresh defaults (which would wipe out things like the
                live connection status or an in-progress session).
        """
        self.watchdog_data = dict(existing_watchdog_data) if existing_watchdog_data is not None else dict(self.WATCHDOG_DATA_DEFAULTS)
        self._existing_device_config_id = existing_device_config_id
        self.device_config_id = self.save_config_file(file_content_str)
        self.device_config_path = f"/tmp/{self.device_config_id}.json"
        self.device_config = None

    def save_config_file(self, file_content_str):
        """
        Save JSON config file to '/tmp/' directory under the device config ID:
        either a pre-existing ID passed in for an edit, or a freshly
        generated one derived from the config content for a new device.

        Args:
            file_content_str (str): Config file in raw str format.

        Returns:
            str: Unique device config ID.       
        """
        decoded = base64.b64decode(file_content_str)
        if self._existing_device_config_id:
            device_config_id = self._existing_device_config_id
        else:
            device_config_id = self.get_device_config_id(json.loads(decoded))
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
            config_data.update(self.watchdog_data)
            with open(self.device_config_path, 'w', encoding='utf-8') as config_file:
                json.dump(config_data, config_file, indent=2)
            target_device_directory = f"data/{self.device_config_id}"
            target_config_path = f"{target_device_directory}/{self.device_config_path.split('/')[-1]}"
            os.makedirs(target_device_directory, exist_ok=True)
            if os.path.exists(target_config_path):
                # Editing an existing device: same ID, same directory, same
                # filename — replace the old config file in place.
                os.remove(target_config_path)
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
        """
        Update runtime parmater in target device config.

        Args:
            key (str): Runtime paramter key.
            value (str): Runtime paramter value.   
        """
        config_path = self.device_config_path
        with open(config_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        data[key] = value
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def get_device_config_id(self, device_config):
        """
        Generate unique device config ID based on config content.

        Args:
            device_config (dict): Full device config in dict format.

        Returns:
            str: Unique device config ID.       
        """
        for not_const_key in list(self.WATCHDOG_DATA_DEFAULTS.keys()):
            if not_const_key in device_config.keys():
                device_config.pop(not_const_key)
        return hashlib.sha256(json.dumps(device_config, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()[:12]
