import os
import pytest
import shutil

remote_device_config_path = "backend/config/remote_device_config.json"
local_device_config_path = "backend/config/local_device_config.json"
local_incorrect_device_config_path = "backend/config/local_incorrect_device_config.json"

@pytest.fixture(autouse=True)
def copy_test_configs():
    shutil.copy("tests/test_device_configs/remote_device_config.json", remote_device_config_path)
    shutil.copy("tests/test_device_configs/local_device_config.json", local_device_config_path)
    shutil.copy("tests/test_device_configs/local_incorrect_device_config.json", local_incorrect_device_config_path)
    yield
    os.remove(remote_device_config_path)
    os.remove(local_device_config_path)
    os.remove(local_incorrect_device_config_path)
