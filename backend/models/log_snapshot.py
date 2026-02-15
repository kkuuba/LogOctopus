from datetime import datetime
import pandas as pd

class LogSnapshot:
    """
    A class to perform basic operations on collected logs.
    """
    def __init__(self, device_name, log_name, session_id, collected_data, loaded_from_file=False):
        self.device_name = device_name
        self.log_name = log_name
        self.collected_data = collected_data
        self.creation_time =datetime.now()
        self.session_id = session_id
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
            log_collection_duration = (last_entry - first_entry).seconds

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
        data_file_path = f"data/{device_name}/{self.log_name}_#$#_{self.session_id}_#$#_{self.creation_time.strftime('%Y%m%d_%H%M%S')}.parquet"
        self.collected_data.to_parquet(data_file_path, engine="pyarrow", index=False)

        return data_file_path
