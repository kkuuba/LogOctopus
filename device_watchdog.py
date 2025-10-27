from fabric import Connection
import pandas as pd
from datetime import datetime
from dateutil import parser
import re
import threading

class DeviceWatchdog:
    def __init__(self, device_config):
        self.device_config = device_config
        self.device_name = device_config["device_name"]
        self.ssh_connection = Connection(
            host=device_config["ip_address"],
            user=device_config["user"],
            port=device_config["port"],
            connect_kwargs={"password": device_config["password"]})
        self.collected_data = {}
        self.errors = pd.DataFrame({"time": [], "error_info": []})
        self.collection_ongoing = False
        self.thread = None

    def execute_remote_cmd(self, cmd):
        try:
            self.ssh_connection.open()
            cmd_result = self.ssh_connection.run(cmd)
            if cmd_result.ok:
                return cmd_result.stdout
            error_entry = {"time": datetime.now(), "error_info": f"cmd '{cmd}' failed with -> {cmd_result.stderr.strip()}"}
            self.errors = pd.concat([self.errors, pd.DataFrame(error_entry)], ignore_index=True)
        except Exception as e:
            error_entry = {"time": datetime.now(), "error_info": f"cmd '{cmd}' failed with -> {e}"}
            self.errors = pd.concat([self.errors, pd.DataFrame(error_entry)], ignore_index=True)
        return None

    def initialize_log_collectors(self):
        for log_config in self.device_config["log_file_configs"]:
            self.ssh_connection.run(log_config["log_activation_cmd"])
            self.collected_data[log_config["log_name"]] = pd.DataFrame({"time": [], "content": []})

    def get_log_file_content(self, log_config):
        log_content = {"time": [], "content": []}
        for entry_line in self.execute_remote_cmd(log_config["log_file_cmd"]).split("\n"):
            entry_line_match = re.search(log_config["data_extraction_regex"], entry_line)
            if entry_line_match:
                log_content["time"].append(parser.parse(entry_line_match.group("TIME")))
                log_content["content"].append(entry_line_match.group("ENTRY"))

        return log_content

    def get_all_log_files_content(self):
        for log_config in self.device_config["log_file_configs"]:
            new_log_content = pd.DataFrame(self.get_log_file_content(log_config))
            self.collected_data[log_config["log_name"]] = pd.concat([self.collected_data[log_config["log_name"]], new_log_content], ignore_index=True).drop_duplicates(subset="time", keep="first")

    def start_logs_collection(self):
        self.collection_ongoing = True
        self.thread = threading.Thread(target=self.logs_collection_loop, args=(self.device_config["collection_interval"],))
        self.thread.start()

    def stop_logs_collection(self):
        self.collection_ongoing = False
        self.thread.join()

    def logs_collection_loop(self, interval):
        collection_stop_event = threading.Event()
        while self.collection_ongoing:
            collection_stop_event.wait(timeout=interval)
            self.get_all_log_files_content()
