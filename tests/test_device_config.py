import os
import shutil
from backend.models.device_config import DeviceConfig
from tests.conftest import remote_device_config_path,local_device_config_path,local_incorrect_device_config_path

def test_success_device_config_validation():
    remote_device_config = DeviceConfig(open(remote_device_config_path, "rb").read())
    local_device_config = DeviceConfig(open(local_device_config_path, "rb").read())
    assert True == remote_device_config.validate_device_config()
    assert True == local_device_config.validate_device_config()

def test_failure_device_config_validation():
    local_device_config = DeviceConfig(open(local_incorrect_device_config_path, "rb").read())
    assert False == local_device_config.validate_device_config()

def test_get_device_config():
    remote_device_config = DeviceConfig(open(remote_device_config_path, "rb").read())
    local_device_config = DeviceConfig(open(local_device_config_path, "rb").read())
    assert type(remote_device_config.get_device_config()) == dict
    assert type(local_device_config.get_device_config()) == dict
    assert len(remote_device_config.get_device_config()) > 0
    assert len(local_device_config.get_device_config()) > 0

def test_remove_device_config():
    new_local_device_config_pathg = local_device_config_path.replace(".json", "_new.json")
    shutil.copy(local_device_config_path, new_local_device_config_pathg)
    remote_device_config = DeviceConfig(open(new_local_device_config_pathg, "rb").read())
    assert os.path.exists(new_local_device_config_pathg) == True
    remote_device_config.remove_device_config()
    assert os.path.exists(new_local_device_config_pathg) == False
