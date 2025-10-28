import json
from time import sleep
from device_watchdog import DeviceWatchdog

with open("config/device_config.json", "r") as file:
    example_config = json.load(file)

device_config = example_config["device_configs"][0]
local_device_config = example_config["device_configs"][1]

def test_normal_log_collection_scenario():
    example_device_wd = DeviceWatchdog(device_config=device_config)
    example_device_wd.initialize_log_collectors()
    example_device_wd.start_logs_collection()
    sleep(30)
    example_device_wd.stop_logs_collection()
    assert len(example_device_wd.collected_data["syslog"]) > 0
    assert len(example_device_wd.errors) == 0

def test_local_log_collection_scenario():
    example_device_wd = DeviceWatchdog(device_config=local_device_config)
    example_device_wd.initialize_log_collectors()
    example_device_wd.start_logs_collection()
    sleep(30)
    example_device_wd.stop_logs_collection()
    assert len(example_device_wd.collected_data["syslog"]) > 0

def test_broken_connection_scenario():
    example_device_wd = DeviceWatchdog(device_config=device_config)
    example_device_wd.ssh_connection.host = "incorrect_ip"
    example_device_wd.initialize_log_collectors()
    example_device_wd.start_logs_collection()
    sleep(30)
    example_device_wd.stop_logs_collection()
    assert len(example_device_wd.errors) > 0
    assert len(example_device_wd.collected_data["syslog"]) == 0

def test_incorrect_config_scenario():
    example_device_wd = DeviceWatchdog(device_config=device_config)
    example_device_wd.device_config["log_file_configs"][0]["log_file_cmd"] = "cat /incorrect_log_path/log.txt"
    example_device_wd.device_config["log_file_configs"][1]["log_file_cmd"] = "cat /incorrect_log_path/log.txt"
    example_device_wd.initialize_log_collectors()
    example_device_wd.start_logs_collection()
    sleep(30)
    example_device_wd.stop_logs_collection()
    assert len(example_device_wd.errors) > 0
    assert len(example_device_wd.collected_data["syslog"]) == 0
    assert len(example_device_wd.collected_data["kernel"]) == 0
