import base64
from time import sleep
from backend.models.device import Device
from backend.models.device_config import DeviceConfig
from conftest import remote_device_config_path, remote_device_incorrect_ip_config_path

# remote_device_config_str_content = base64.b64encode(open(remote_device_config_path, "rb").read())
# local_device_config_str_content = base64.b64encode(open(local_device_config_path, "rb").read())
# local_incorrect_device_config_str_content = base64.b64encode(open(local_incorrect_device_config_path, "rb").read())

def test_normal_log_collection_scenario():
    device_config_obj = DeviceConfig(base64.b64encode(open(remote_device_config_path, "rb").read()))
    example_device = Device(device_config_instance=device_config_obj)
    example_device.start_logs_collection("test")
    sleep(30)
    example_device.stop_logs_collection()
    example_device.save_log_snapshots()
    assert len(example_device.log_snapshots) > 0
    assert len(example_device.log_snapshots[0].collected_data) > 0

def test_abnormal_log_collection_scenario():
    device_config_obj = DeviceConfig(base64.b64encode(open(remote_device_incorrect_ip_config_path, "rb").read()))
    example_device = Device(device_config_instance=device_config_obj)
    example_device.start_logs_collection("test")
    sleep(30)
    example_device.stop_logs_collection()
    example_device.save_log_snapshots()
    assert len(example_device.log_snapshots) > 0
    assert len(example_device.device_watchdog.errors["error_info"]) > 0
    assert len(example_device.log_snapshots[0].collected_data["content"]) == 0
