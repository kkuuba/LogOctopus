from fabric import Connection
from invoke import Context
import pandas as pd
from datetime import datetime
from dateutil import parser
import re
import threading

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
        self.local_device = device_config["local_device"]
        self.device_name = device_config["device_name"]
        if self.local_device:
            self.ssh_connection = Context()
        else:
            self.ssh_connection = Connection(
                host=device_config["ip_address"],
                user=device_config["user"],
                port=device_config["port"],
                connect_kwargs={"password": device_config["password"]})
        self.collected_data = {}
        self.errors = pd.DataFrame({"time": [], "error_info": []})
        self.collection_ongoing = False
        self.thread = None
        self.collection_stop_event = None

    def execute_cmd(self, cmd):
        """
        Execute command via SSH on target device with failure handling.

        Args:
            cmd (str): Target cmd string.

        Returns:
            str: Full cmd output if execution was successful.
        """
        try:
            root_requried = True if "sudo " in cmd else False
            if self.local_device:
                if root_requried:
                    cmd_result = self.ssh_connection.sudo(cmd, password=self.device_config["password"], hide=True, pty=True, timeout=10)
                else:
                    cmd_result = self.ssh_connection.local(cmd, hide=True, pty=True, timeout=10)
            else:
                if root_requried:
                    cmd_result = self.ssh_connection.sudo(cmd, password=self.device_config["password"], hide=True, pty=True, timeout=10)
                else:
                    cmd_result = self.ssh_connection.run(cmd, hide=True, pty=True, timeout=10)
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
            self.execute_cmd(log_config["log_activation_cmd"])
            self.collected_data[log_config["log_name"]] = pd.DataFrame({"time": [], "content": []})

    def get_log_file_content(self, log_config):
        """
        Extract log content to dictionary with timestamps and logs entries. All data processing is 
        executed based on data in provided log configuration.

        Args:
            log_config (dict): Log collector configuration data.

        Returns:
            dict: All extracted log entries with timestamps.
        """
        log_content = {"time": [], "content": []}
        raw_log_content = self.execute_cmd(log_config["log_file_cmd"])
        if raw_log_content is None:
            return log_content
        for entry_line in self.execute_cmd(log_config["log_file_cmd"]).split("\n"):
            entry_line_match = re.search(log_config["data_extraction_regex"], entry_line)
            if entry_line_match:
                log_content["time"].append(parser.parse(entry_line_match.group("TIME")))
                log_content["content"].append(entry_line_match.group("ENTRY"))

        return log_content

    def get_all_log_files_content(self):
        """
        Extract all logs based on logs configs and save them to target pandas dataframes.
        """
        for log_config in self.device_config["log_file_configs"]:
            new_log_content = pd.DataFrame(self.get_log_file_content(log_config))
            current_log_content = self.collected_data[log_config["log_name"]]
            if current_log_content.empty:
                self.collected_data[log_config["log_name"]] = new_log_content
            elif not new_log_content.empty:
                self.collected_data[log_config["log_name"]] = pd.concat([current_log_content, new_log_content], ignore_index=True).drop_duplicates(subset=["time", "content"], keep="last")

    def start_logs_collection(self):
        """
        Start logs collection background thread.
        """
        self.collection_ongoing = True
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
