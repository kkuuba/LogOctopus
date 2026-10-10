import logging
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import pyarrow.parquet as pq

from backend.models.log_snapshot import LogSnapshot, LogSnapshotMeta

# Footer reads are cheap I/O, so a modest thread pool is enough to get a big
# win on directories with many snapshot files without adding process
# management complexity. Tune if you have very high snapshot counts.
_MAX_WORKERS = 16


class LogSnapshotsLoader():

    def __init__(self, log_snapshots_dir_path):
        self.device_config_id = log_snapshots_dir_path.split("/")[-1]
        self.log_snapshots_dir_path = log_snapshots_dir_path

    def load_log_snapshots_from_file(self, log_snapshot_path):
        """
        Create a full LogSnapshot object (with collected_data populated)
        based on source file in parquet format.

        This reads and decompresses the entire file. Prefer
        `load_log_snapshot_metas` for listing/filtering, and only call this
        (or `LogSnapshotMeta.load_full`) when the actual log content is
        needed, e.g. serving a single snapshot's content/packets/pcap.

        Args:
            log_snapshot_path (str): Path to source log snapshot parquet file.

        Returns:
            (LogSnapshot): Instance of LogSnapshot object.
        """
        pyarrow_table = pq.read_table(log_snapshot_path)
        raw_meta = pyarrow_table.schema.metadata
        log_metadata = {
            k.decode(): v.decode()
            for k, v in raw_meta.items()
        }
        return LogSnapshot(self.device_config_id, 
                           log_metadata["device_name"],
                           log_metadata["log_name"],
                           log_metadata["log_description"],
                           log_metadata["session_id"],
                           log_metadata["session_scenario"],
                           log_metadata["data_unit"],
                           log_metadata["log_type"],
                           pyarrow_table.to_pandas(),
                           True,
                           data_file_name=str(log_snapshot_path))

    def load_all_log_snapshots(self):
        """
        Get all source log snapshot file from target directory and create a
        list of LogSnapshot objects.

        Kept for callers that genuinely need every snapshot's full data at
        once. For listing/filtering (the common, hot path), use
        `load_log_snapshot_metas` instead - it's dramatically cheaper.

        Returns:
            (list): List of LogSnapshot objects.
        """
        log_snapshots_paths = list(Path(self.log_snapshots_dir_path).glob("*.parquet"))
        with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
            return list(pool.map(self.load_log_snapshots_from_file, log_snapshots_paths))

    def load_log_snapshot_meta(self, log_snapshot_path):
        """
        Build a LogSnapshotMeta for one file, reading only the parquet
        footer. Falls back to a full load (and thus the full metadata) if
        the file predates the persisted listing-metadata fields.

        Args:
            log_snapshot_path (str | Path): Path to source parquet file.

        Returns:
            LogSnapshotMeta
        """
        meta = LogSnapshotMeta.from_parquet_footer(self.device_config_id, str(log_snapshot_path))
        if meta is not None:
            return meta

        logging.info(
            "Log snapshot '%s' missing fast-path metadata, falling back to a full read",
            log_snapshot_path,
        )
        full = self.load_log_snapshots_from_file(log_snapshot_path)
        return LogSnapshotMeta(
            device_id=full.device_id,
            device_name=full.device_name,
            log_name=full.log_name,
            log_description=full.log_description,
            session_id=full.session_id,
            session_scenario=full.session_scenario,
            data_unit=full.data_unit,
            log_type=full.log_type,
            start_time=full.start_time,
            finish_time=full.finish_time,
            logs_collection_duration=full.logs_collection_duration,
            size_in_bytes=full.size_in_bytes,
            data_file_name=full.data_file_name,
        )

    def load_all_log_snapshot_metas(self):
        """
        Get lightweight LogSnapshotMeta objects for every snapshot file in
        the target directory, without loading any row data. This is the
        fast path: use it for listing and filtering.

        Reads run in parallel across files since each one is a small,
        independent I/O operation (footer read).

        Returns:
            (list): List of LogSnapshotMeta objects.
        """
        log_snapshots_paths = list(Path(self.log_snapshots_dir_path).glob("*.parquet"))
        with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
            return list(pool.map(self.load_log_snapshot_meta, log_snapshots_paths))