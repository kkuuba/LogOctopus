from time import sleep
import os
from backend.models.device import Device
from backend.models.device_config import DeviceConfig
from conftest import remote_device_config_path


def test_normal_log_collection_scenario():
    device_config_obj = DeviceConfig(device_config_path=remote_device_config_path)
    example_device = Device(device_config_instance=device_config_obj)
    example_device.start_logs_collection()
    sleep(30)
    example_device.stop_logs_collection()
    example_device.save_log_snapshots()
    assert len(example_device.log_snapshots) > 0
    assert len(example_device.log_snapshots[0].collected_data) > 0
    assert example_device.log_snapshots[-1].logs_collection_duration >= 0
    assert example_device.log_snapshots[-1].size_in_bytes > 0
    example_device.log_snapshots[-1].create_parquet_data_file("example_device")
    file_name = example_device.log_snapshots[-1].data_file_name
    assert os.path.exists(file_name), f"File {file_name} was not created."
