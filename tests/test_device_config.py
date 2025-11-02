import os
import shutil
import pytest
from backend.models.device_config import DeviceConfig

@pytest.fixture(autouse=True)
def copy_test_configs():
    shutil.copy("real_configs/remote_device.json", "backend/config/remote_device_config.json")
    shutil.copy("real_configs/local_device.json", "backend/config/local_device_config.json")
    shutil.copy("real_configs/nok_local_device.json", "backend/config/nok_local_device.json")

remote_device_config_path = "backend/config/remote_device_config.json"
local_device_config_path = "backend/config/local_device_config.json"
local_device_config_not_json_path = "backend/config/nok_local_device.json"

def test_success_device_config_validation():
    remote_device_config = DeviceConfig(remote_device_config_path)
    local_device_config = DeviceConfig(local_device_config_path)
    assert True == remote_device_config.validate_device_config()
    assert True == local_device_config.validate_device_config()

def test_failure_device_config_validation():
    local_device_config = DeviceConfig(local_device_config_not_json_path)
    assert False == local_device_config.validate_device_config()

def test_get_device_config():
    remote_device_config = DeviceConfig(remote_device_config_path)
    local_device_config = DeviceConfig(local_device_config_path)
    assert type(remote_device_config.get_device_config()) == dict
    assert type(local_device_config.get_device_config()) == dict
    assert len(remote_device_config.get_device_config()) > 0
    assert len(local_device_config.get_device_config()) > 0

def test_remove_device_config():
    new_local_device_config_pathg = local_device_config_path.replace(".json", "_new.json")
    shutil.copy(local_device_config_path, new_local_device_config_pathg)
    remote_device_config = DeviceConfig(new_local_device_config_pathg)
    assert os.path.exists(new_local_device_config_pathg) == True
    remote_device_config.remove_device_config()
    assert os.path.exists(new_local_device_config_pathg) == False
