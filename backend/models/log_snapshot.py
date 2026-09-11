import os
import glob
import logging
from datetime import datetime
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import hashlib

# Keys we persist into the parquet file's key/value metadata so that listing
# and filtering never have to read/decompress the actual row data.
_META_KEYS = (
    "log_name", "session_id", "session_scenario", "data_unit", "log_type",
    "device_name", "log_description", "start_time", "finish_time",
    "logs_collection_duration", "size_in_bytes",
)


class LogSnapshotMeta:
    """
    Lightweight, data-free representation of a LogSnapshot.

    Holds exactly the fields needed to render a row in the snapshots list
    (id, names, timestamps, duration, size) without ever touching the
    parquet file's row data. Building one of these only reads the file
    footer, so it's cheap even for large or numerous snapshots.

    Use `load_full()` to upgrade a given instance into a full `LogSnapshot`
    (with `collected_data` populated) only when the actual log content is
    needed (e.g. the /content, /packets, /pcap endpoints).
    """

    __slots__ = (
        "device_id", "device_name", "log_name", "log_description", "id",
        "session_id", "session_scenario", "data_unit", "log_type",
        "start_time", "finish_time", "logs_collection_duration",
        "size_in_bytes", "data_file_name",
    )

    def __init__(self, device_id, device_name, log_name, log_description,
                 session_id, session_scenario, data_unit, log_type,
                 start_time, finish_time, logs_collection_duration,
                 size_in_bytes, data_file_name):
        self.device_id = device_id
        self.device_name = device_name
        self.log_name = log_name
        self.log_description = log_description
        self.id = hashlib.md5(f"{device_id}_{log_name}_{session_id}".encode()).hexdigest()[:16]
        self.session_id = session_id
        self.session_scenario = session_scenario
        self.data_unit = data_unit
        self.log_type = log_type
        self.start_time = start_time
        self.finish_time = finish_time
        self.logs_collection_duration = logs_collection_duration
        self.size_in_bytes = size_in_bytes
        self.data_file_name = data_file_name

    @classmethod
    def from_parquet_footer(cls, device_id, data_file_name):
        """
        Build a LogSnapshotMeta by reading only the parquet file's footer
        (schema + key/value metadata), without reading any row data.

        Returns None if the file is missing the metadata keys this class
        needs (e.g. it was written before this optimization was added) so
        the caller can fall back to a full load.

        Args:
            device_id (str): Owning device config ID.
            data_file_name (str): Path to the source parquet file.

        Returns:
            LogSnapshotMeta | None
        """
        parquet_file = pq.ParquetFile(data_file_name)  # reads footer only
        raw_meta = parquet_file.schema_arrow.metadata
        if not raw_meta:
            return None

        meta = {k.decode(): v.decode() for k, v in raw_meta.items()}
        if not all(key in meta for key in _META_KEYS):
            return None  # older file written without the extra fields

        try:
            return cls(
                device_id=device_id,
                device_name=meta["device_name"],
                log_name=meta["log_name"],
                log_description=meta["log_description"],
                session_id=meta["session_id"],
                session_scenario=meta["session_scenario"],
                data_unit=meta["data_unit"],
                log_type=meta["log_type"],
                start_time=pd.to_datetime(meta["start_time"]),
                finish_time=pd.to_datetime(meta["finish_time"]),
                logs_collection_duration=float(meta["logs_collection_duration"]),
                size_in_bytes=int(meta["size_in_bytes"]),
                data_file_name=data_file_name,
            )
        except (KeyError, ValueError):
            return None

    def load_full(self):
        """
        Load the full LogSnapshot (with collected_data populated) for this
        metadata entry. Only call this when the actual log content is
        needed.

        Returns:
            LogSnapshot
        """
        pyarrow_table = pq.read_table(self.data_file_name)
        return LogSnapshot(
            self.device_id, self.device_name, self.log_name,
            self.log_description, self.session_id, self.session_scenario,
            self.data_unit, self.log_type, pyarrow_table.to_pandas(),
            loaded_from_file=True, data_file_name=self.data_file_name,
        )


class LogSnapshot:
    """
    A class to perform basic operations on collected logs.
    """
    def __init__(self, device_id, device_name, log_name, log_description, session_id, session_scenario, data_unit, log_type, collected_data, loaded_from_file=False, data_file_name=None):
        self.device_id = device_id
        self.device_name = device_name
        self.log_name = log_name
        self.log_description = log_description
        self.id = hashlib.md5(f"{device_id}_{log_name}_{session_id}".encode()).hexdigest()[:16]
        self.collected_data = collected_data
        self.creation_time =datetime.now()
        self.session_id = session_id
        self.session_scenario = session_scenario
        self.data_unit = data_unit
        self.log_type = log_type
        self.start_time, self.finish_time = self.get_start_and_finish_timestamps()
        self.logs_collection_duration = self.calcaute_logs_collection_duration()
        self.size_in_bytes = self.get_size_of_collected_data_in_bytes()
        if not loaded_from_file:
            self.data_file_name = self.create_parquet_data_file()
        else:
            # The caller (LogSnapshotsLoader, LogSnapshotMeta.load_full)
            # already knows the path this was read from - store it so the
            # instance can always answer "where do I live on disk", not
            # just freshly-created ones.
            self.data_file_name = data_file_name

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
    
    def remove_log_snapshot(self):
        """
        Remove log snapshot parquet data file.
        """
        for log_snapshot_parquet_file in glob.glob(f"data/{self.device_id}/{self.id}_*.parquet"):
            if os.path.exists(log_snapshot_parquet_file):
                os.remove(log_snapshot_parquet_file)
                logging.info("Log snapshot data file -> '%s' was successfuly deleted", log_snapshot_parquet_file)
            else:
                logging.error("Log snapshot data file -> '%s' not exists ", log_snapshot_parquet_file)

    def create_parquet_data_file(self):
        """
        Save all data into file in 'parqet' format with all collected logs.

        Persists the already-computed listing metadata (timestamps,
        duration, size) alongside the descriptive fields so that later
        listing/filtering can read them straight from the parquet footer
        without loading any row data (see LogSnapshotMeta).

        Returns:
            str: Data file path for LogSnapshot in 'parqet' format.
        """
        metadata = {
            "log_name": self.log_name,
            "session_id": self.session_id,
            "session_scenario": self.session_scenario,
            "data_unit": self.data_unit,
            "log_type": self.log_type,
            "device_name": self.device_name,
            "log_description": self.log_description,
            "start_time": str(self.start_time),
            "finish_time": str(self.finish_time),
            "logs_collection_duration": str(self.logs_collection_duration),
            "size_in_bytes": str(int(self.size_in_bytes)),
        }
        collected_data_table = pa.Table.from_pandas(self.collected_data)
        existing_metadata = collected_data_table.schema.metadata or {}
        new_metadata = {
            **existing_metadata,
            **{k.encode(): v.encode() for k, v in metadata.items()}
        }
        collected_data_table_with_metadata = collected_data_table.replace_schema_metadata(new_metadata)

        data_file_path = f"data/{self.device_id}/{self.id}_{self.creation_time.strftime('%Y%m%d_%H%M%S')}.parquet"
        pq.write_table(collected_data_table_with_metadata, data_file_path)

        return data_file_path