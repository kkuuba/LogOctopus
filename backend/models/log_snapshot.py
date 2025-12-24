from datetime import datetime
import pandas as pd

class LogSnapshot:
    """
    A class to perform basic operations on collected logs.
    """
    def __init__(self, collected_data):
        self.collected_data = collected_data
        self.creation_time = datetime.now()
        self.logs_collection_duration = self.calcaute_logs_collection_duration()
        self.size_in_bytes = self.get_size_of_collected_data_in_bytes()

    def calcaute_logs_collection_duration(self):
        """
        Calculate logs collection interval in seconds for all defined log configs based on first and last entry.
        
        Returns:
            dict: Log collection duration for all defined logs.
        """
        log_collection_duration = {}
        for log_name in self.collected_data:
            if self.collected_data[log_name].empty:
                log_collection_duration[log_name] = 0
            else:
                first_entry = pd.to_datetime(self.collected_data[log_name]["time"].iloc[0])
                last_entry  = pd.to_datetime(self.collected_data[log_name]["time"].iloc[-1])
                log_collection_duration[log_name] = (last_entry - first_entry).seconds

        return log_collection_duration
    
    def get_size_of_collected_data_in_bytes(self):
        """
        Get size of all collected data in bytes.
        
        Returns:
            int: Size of all collected data in bytes.
        """
        size_in_bytes = 0
        for log_name in self.collected_data:
            size_in_bytes = size_in_bytes + self.collected_data[log_name].memory_usage(deep=True).sum()

        return size_in_bytes

    def create_parquet_data_file(self, device_name):
        """
        Save all data into file in 'parqet' format with all collected logs.
        
        Args:
            device_name (str): Name of target device where logs were collected.

        Returns:
            list: List of all generated parquet data files.
        """
        data_file_names = []
        for log_name in self.collected_data:
            data_file_name = f"{device_name}_{log_name}_log_{self.creation_time.strftime('%Y%m%d_%H%M%S')}.parquet"
            self.collected_data[log_name].to_parquet(data_file_name, engine="pyarrow", index=False)
            data_file_names.append(data_file_name)

        return data_file_names
