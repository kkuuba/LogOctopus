from fabric import Connection
from concurrent.futures import ThreadPoolExecutor
from backend.models.log_snapshot import LogSnapshot
import pandas as pd
from datetime import datetime
from dateutil import parser
import re
import uuid
import time
import threading
from time import sleep
import argparse
import json


class DeviceWatchdog:
    """
    A class used to logs collection for target device using defined configuration.
    """
    def __init__(self, device_config):
        """
        Initializes a DeviceWatchdog instance.

        Args:
            device_config (dict): Connection and logging configuraiton for target device.
        """
        self.device_config = device_config
        self.device_name = device_config["device_name"]
        self.ssh_channels = {}
        self.collected_data = {}
        self.errors = pd.DataFrame({"time": [], "error_info": []})
        self.collection_ongoing = False
        self.thread = None
        self.collection_stop_event = None
        self.cutoff_time = None
        self.log_snapshots = []
        self.connection_status = False
        self.log_access = False

    def execute_cmd(self, cmd, ssh_channel_id):
        """
        Execute command via SSH on target device with failure handling.

        Args:
            cmd (str): Target cmd string.
            ssh_channel_id (str): Target SSH channel ID. 

        Returns:
            str: Full cmd output if execution was successful.
        """
        try:
            if ssh_channel_id not in self.ssh_channels.keys():
                self.ssh_channels[ssh_channel_id] = Connection(
                    host=self.device_config["ip_address"],
                    user=self.device_config["user"],
                    port=self.device_config["port"],
                    connect_kwargs={"password": self.device_config["password"]})
            root_requried = True if "sudo " in cmd else False
            if root_requried:
                cmd_result = self.ssh_channels[ssh_channel_id].sudo(cmd, password=self.device_config["password"], hide=True, timeout=10)
            else:
                cmd_result = self.ssh_channels[ssh_channel_id].run(cmd, hide=True, timeout=10)
            if cmd_result.ok:
                return cmd_result.stdout
            error_entry = {"time": [datetime.now()], "error_info": [f"cmd '{cmd}' failed with -> {cmd_result.stderr.strip()}"]}
            self.errors = pd.concat([self.errors, pd.DataFrame(error_entry)], ignore_index=True) if not self.errors.empty else pd.DataFrame(error_entry)
        except Exception as e:
            error_entry = {"time": [datetime.now()], "error_info": [f"cmd '{cmd}' failed with -> {e}"]}
            self.errors = pd.concat([self.errors, pd.DataFrame(error_entry)], ignore_index=True) if not self.errors.empty else pd.DataFrame(error_entry)
        return None

    def initialize_log_collectors(self):
        """
        Initialzie log collectors for all defined log file configs.
        """
        for log_config in self.device_config["log_file_configs"]:
            self.execute_cmd(log_config["log_activation_cmd"], log_config["log_name"])
            self.collected_data[log_config["log_name"]] = pd.DataFrame({"time": [], "content": []})

    def get_log_file_content(self, log_config):
        """
        Extract log content to dictionary with timestamps and logs entries. All data processing is 
        executed based on data in provided log configuration.

        Args:
            log_config (dict): Log collector configuration data.
        """
        log_content = {"time": [], "content": []}
        raw_log_content = self.execute_cmd(log_config["log_file_cmd"], log_config["log_name"])
        if raw_log_content is None:
            return log_content
        for entry_line in raw_log_content.split("\n"):
            entry_line_match = re.search(log_config["data_extraction_regex"], entry_line)
            if entry_line_match:
                log_content["time"].append(parser.parse(entry_line_match.group("TIME")))
                log_content["content"].append(entry_line_match.group("ENTRY"))

        new_log_content = pd.DataFrame(log_content)
        current_log_content = self.collected_data[log_config["log_name"]]
        if current_log_content.empty:
            self.collected_data[log_config["log_name"]] = new_log_content
        elif not new_log_content.empty:
            self.collected_data[log_config["log_name"]] = pd.concat([current_log_content, new_log_content], ignore_index=True).drop_duplicates(subset=["time", "content"], keep="last")

    def get_all_log_files_content(self):
        """
        Extract all logs based on logs configs and save them to target pandas dataframes.
        """
        # start = time.perf_counter()
        with ThreadPoolExecutor() as executor:
            executor.map(self.get_log_file_content, self.device_config["log_file_configs"])
        # end = time.perf_counter()
        # print(f"Execution time: {end - start:.4f} seconds")

    def start_logs_collection(self):
        """
        Start logs collection background thread.
        """
        self.collection_ongoing = True
        self.cutoff_time = pd.Timestamp.now()
        self.thread = threading.Thread(target=self.logs_collection_loop, args=(self.device_config["collection_interval"],))
        self.thread.daemon = True
        self.thread.start()

    def stop_logs_collection(self):
        """
        Stop logs collection background thread.
        """
        self.collection_stop_event.set()
        self.collection_ongoing = False
        self.thread.join()
        self.remove_all_outdated_entries()

    def remove_all_outdated_entries(self):
        """
        Remove all log entries older then start of target log collection.
        """
        for log_config in self.device_config["log_file_configs"]:
            log_name = log_config["log_name"]
            self.collected_data[log_name]['time'] = pd.to_datetime(self.collected_data[log_name]['time'])
            self.collected_data[log_name] = self.collected_data[log_name][self.collected_data[log_name]['time'] >= self.cutoff_time]
            self.collected_data[log_name] = self.collected_data[log_name].sort_values(by="time")

    def logs_collection_loop(self, interval):
        """
        Main background loop for logs collection from target device.

        Args:
            interval (int): Interval between logs extraction from target device.
        """
        self.collection_stop_event = threading.Event()
        while self.collection_ongoing:
            self.collection_stop_event.wait(timeout=interval)
            self.get_all_log_files_content()

    def save_log_snapshots(self, session_id, session_scenario):
        """
        Save all logs collected by device watchdog and save it in LogSnapshot object with all info about collected data.
        Data will be save info file and added to logsnapshots list.

        Args:
            session_id (str): Unique logs collection session ID.
            session_scenario (str): Scenario ID for logs collection session.
        """
        for log_name, log_content in self.collected_data.items():
            log_type = self.get_target_log_type_based_on_log_name(log_name)
            if not log_content.empty:
                self.log_snapshots.append(LogSnapshot(self.device_name, log_name, session_id, session_scenario, log_type, log_content))

    def get_target_log_type_based_on_log_name(self, log_name):
        """
        Get log type based on provided log name.

        Args:
            log_name (str): Log name for log type extraction from device config.

        Returns:
            str: Target log type (text|chart), default value is 'text'.
        """
        for log_config in self.device_config["log_file_configs"]:
            if log_name == log_config["log_name"]:
                return log_config["log_type"]
        
        return "text"

    def get_connection_status(self):
        """
        Get status of connection to target device.
        """
        if len(self.ssh_channels.keys()) > 0:
            self.connection_status = True
        else:
            self.connection_status = False

    def test_log_files_access(self):
        """
        Validate if first 3 log files defined in configuration can be accessed via SSH. If any of first 3 log files cannot be accessed
        method return False.
        """
        for log_file_config in self.device_config["log_file_configs"][:3]:
            current_log_content = self.execute_cmd(log_file_config["log_file_cmd"], log_file_config["log_name"])
            if current_log_content:
                continue
            else:
                self.log_access = False

        self.log_access = True


def get_current_device_config(path_to_config_file):
    """
    Get current content of device JSON configuraiton file.

    Args:
        path_to_config_file (str): Target path to JSON configuration file.

    Returns:
        dict: Currnet content of device config.
    """
    with open(path_to_config_file, "r") as f:
        return json.load(f)


def update_device_config_parameter(path_to_config_file, key, value):
    """
    Update target runtime parameter in device configuration file.

    Args:
        path_to_config_file (str): Target path to JSON configuration file.
        key (str): Target paramater name for update.
        value (str): Target value for paramter to update.
    """  
    with open(path_to_config_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    data[key] = value
    with open(path_to_config_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


if __name__ == '__main__':
    arg_parser = argparse.ArgumentParser(description="Device watchdog")
    arg_parser.add_argument("device_config_file_path", help="Path to target device config file")
    args = arg_parser.parse_args()
    init_device_config = get_current_device_config(args.device_config_file_path)
    device_watchdog = DeviceWatchdog(init_device_config)
    auto_collection_timer = 0
    while True:
        current_device_config = get_current_device_config(args.device_config_file_path)
        if current_device_config["logs_collection"] and not device_watchdog.collection_ongoing:
            device_watchdog.initialize_log_collectors()
            device_watchdog.start_logs_collection()
        if not current_device_config["logs_collection"] and device_watchdog.collection_ongoing:
            device_watchdog.stop_logs_collection()
            device_watchdog.save_log_snapshots(current_device_config["current_session_id"], current_device_config["session_scenario"])
            update_device_config_parameter(args.device_config_file_path, "current_session_id", "no_active_session")
        if current_device_config["auto_collection_enabled"] and not device_watchdog.collection_ongoing:
            auto_collection_timer = time.time()
            update_device_config_parameter(args.device_config_file_path, "logs_collection", True)
            update_device_config_parameter(args.device_config_file_path, "current_session_id", f"auto_{uuid.uuid1().hex[:12]}")
        if current_device_config["auto_collection_enabled"] and time.time() - auto_collection_timer > current_device_config["auto_collection_interval"] * 3600:
            update_device_config_parameter(args.device_config_file_path, "logs_collection", False)
        device_watchdog.get_connection_status()
        device_watchdog.test_log_files_access()
        update_device_config_parameter(args.device_config_file_path, "connected", device_watchdog.connection_status)
        update_device_config_parameter(args.device_config_file_path, "logs_available", device_watchdog.log_access)
        errors_file_path = f"data/{device_watchdog.device_name}/errors.feather"
        device_watchdog.errors.to_feather(errors_file_path)
        sleep(5)
