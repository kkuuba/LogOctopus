from datetime import datetime
import pandas as pd

class LogSnapshot:
    """
    A class to perform basic operations on collected logs.
    """
    def __init__(self, log_name, collected_data):
        self.log_name = log_name
        self.collected_data = collected_data
        self.creation_time = datetime.now()
        self.logs_collection_duration = self.calcaute_logs_collection_duration()
        self.size_in_bytes = self.get_size_of_collected_data_in_bytes()
        self.data_file_name = None

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
        """
        self.data_file_name = f"{device_name}_{self.log_name}_log_{self.creation_time.strftime('%Y%m%d_%H%M%S')}.parquet"
        self.collected_data.to_parquet(self.data_file_name, engine="pyarrow", index=False)
