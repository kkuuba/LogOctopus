import os
from pathlib import Path
from backend.models.log_snapshot import LogSnapshot
import pandas as pd

class LogSnapshotsLoader():

    def __init__(self, log_snapshots_dir_path):
        self.device_name = log_snapshots_dir_path.split("/")[-1]
        self.log_snapshots_dir_path = log_snapshots_dir_path

    def load_log_snapshots_from_file(self, log_snapshot_path):
        filename = os.path.basename(log_snapshot_path)
        log_name = filename.split("_log_")[0]
        log_content = pd.read_parquet(log_snapshot_path)
        if log_content.empty:
           return None
        else:
            return LogSnapshot(self.device_name, log_name, log_content, True)

    def load_all_log_snapshots(self):
        log_snapshots_list = []
        log_snapshots_paths = list(Path(self.log_snapshots_dir_path).glob("*.parquet"))
        for log_snapshot_path in log_snapshots_paths:
            log_snapshot = self.load_log_snapshots_from_file(log_snapshot_path)
            if log_snapshot:
                log_snapshots_list.append(log_snapshot)

        return log_snapshots_list
