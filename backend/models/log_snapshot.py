from datetime import datetime
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import hashlib

class LogSnapshot:
    """
    A class to perform basic operations on collected logs.
    """
    def __init__(self, device_name, log_name, session_id, session_scenario, log_type, collected_data, loaded_from_file=False):
        self.device_name = device_name
        self.log_name = log_name
        self.id = hashlib.md5(f"{log_name}_{session_id}".encode()).hexdigest()[:16]
        self.collected_data = collected_data
        self.creation_time =datetime.now()
        self.session_id = session_id
        self.session_scenario = session_scenario
        self.log_type = log_type
        self.start_time, self.finish_time = self.get_start_and_finish_timestamps()
        self.logs_collection_duration = self.calcaute_logs_collection_duration()
        self.size_in_bytes = self.get_size_of_collected_data_in_bytes()
        if not loaded_from_file:
            self.data_file_name = self.create_parquet_data_file(device_name)

    def calcaute_logs_collection_duration(self):
        """
        Calculate logs collection interval in seconds for all defined log configs based on first and last entry.
        
        Returns:
            dict: Log collection duration for all defined logs.
        """
        if self.collected_data.empty:
            log_collection_duration = 0
        else:
            first_entry = pd.to_datetime(self.collected_data["time"].iloc[0])
            last_entry  = pd.to_datetime(self.collected_data["time"].iloc[-1])
            log_collection_duration = (last_entry - first_entry).total_seconds()

        return log_collection_duration
    
    def get_start_and_finish_timestamps(self):
        """
        Get start and finish log collection timestamps based on info first and last entry in collected data.
        
        Returns:
            (datatime, datatime): Start and finish logs collection timestamps.
        """
        first_entry = pd.to_datetime(self.collected_data["time"].iloc[0])
        last_entry  = pd.to_datetime(self.collected_data["time"].iloc[-1])

        return first_entry, last_entry

    def get_size_of_collected_data_in_bytes(self):
        """
        Get size of all collected data in bytes.
        
        Returns:
            int: Size of all collected data in bytes.
        """
        size_in_bytes = 0
        size_in_bytes = size_in_bytes + self.collected_data.memory_usage(deep=True).sum()

        return size_in_bytes

    def create_parquet_data_file(self, device_name):
        """
        Save all data into file in 'parqet' format with all collected logs.
        
        Args:
            device_name (str): Name of target device where logs were collected.

        Returns:
            str: Data file path for LogSnapshot in 'parqet' format.
        """
        metadata = {
            "log_name": self.log_name,
            "session_id": self.session_id,
            "session_scenario": self.session_scenario,
            "log_type": self.log_type,
        }
        collected_data_table = pa.Table.from_pandas(self.collected_data)
        existing_metadata = collected_data_table.schema.metadata or {}
        new_metadata = {
            **existing_metadata,
            **{k.encode(): v.encode() for k, v in metadata.items()}
        }
        collected_data_table_with_metadata = collected_data_table.replace_schema_metadata(new_metadata)

        data_file_path = f"data/{device_name}/{self.id}_{self.creation_time.strftime('%Y%m%d_%H%M%S')}.parquet"
        pq.write_table(collected_data_table_with_metadata, data_file_path)

        return data_file_path
