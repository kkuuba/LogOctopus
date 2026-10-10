import pandas as pd

class LogSnapshotsHelper:
    """
    A class to perform basic operations on device confiu.
    """

    @staticmethod
    def get_log_content_for_selected_snapshots(selected_log_snapshots):
        """
        Extracts log content from selected log snapshots and generate time aligned data frame.

        Callers must pass fully-loaded LogSnapshot objects (with
        collected_data populated) - not LogSnapshotMeta. If you obtained
        snapshots via get_log_snapshots_list/get_filtered_log_snapshots_list
        backed by metadata-only objects, call `.load_full()` on the ones
        you actually need content for before passing them here.

        Returns:
            (pd.DataFrame): Data frame with full log content for all selected log snapshots.
        """
        frames = []
        for log_snapshot in selected_log_snapshots:
            if log_snapshot.collected_data.empty:
                continue
            # assign() returns a new frame with the extra columns appended
            # rather than mutating/copying via insert() twice, and - unlike
            # concatenating inside the loop below - keeps this an O(n) pass
            # over the selected snapshots instead of O(n^2).
            frames.append(log_snapshot.collected_data.assign(
                device=log_snapshot.device_name,
                log_name=log_snapshot.log_name,
            ))

        if not frames:
            return pd.DataFrame(columns=["time", "content", "device", "log_name"])

        final_data_frame = frames[0] if len(frames) == 1 else pd.concat(frames, ignore_index=True)
        final_data_frame = final_data_frame.sort_values(by="time", ascending=True)
        final_data_frame["time"] = final_data_frame["time"].dt.strftime("%Y-%m-%d %H:%M:%S")

        return final_data_frame

    @staticmethod
    def get_log_snapshots_list(device_list, log_type_chart):
        """
        Extract list of all logs snapshots from provided devices.

        Works against either full LogSnapshot objects or lightweight
        LogSnapshotMeta objects - both expose log_type/device_name/etc.,
        so this doesn't care which one device.log_snapshots holds.

        Args:
            device_list (list): Current list of active devices.
            log_type_chart (bool): Define if only chart log snapshots should be extracted.

        Returns:
            (list): List of all log snapshots for provded devices.
        """
        log_snapshots_list = []
        target_log_type = "chart" if log_type_chart else "text"
        for device in device_list:
            for log_snapshot in device.log_snapshots:
                    if target_log_type == log_snapshot.log_type:
                        log_snapshots_list.append(log_snapshot)

        return log_snapshots_list

    @staticmethod
    def get_filtered_log_snapshots_list(device_list, search_paramter, search_value, log_type_chart):
        """
        Extract list of all logs snapshots filtered by provided paramter and value from provided devices.

        Args:
            device_list (list): Current list of active devices.
            search_paramter (str): Target paramter to filter.
            search_value (str): Target value of search paramter to filter.
            log_type_chart (bool): Define if only chart log snapshots should be filtered.

        Returns:
            (list): Filtered list of all log snapshots for provded devices.
        """
        filterable_log_snapshots_list = []
        target_log_type = "chart" if log_type_chart else "text"
        for device in device_list:
            for log_snapshot in device.log_snapshots:
                if target_log_type == log_snapshot.log_type:
                    log_snapshot_list_info = {
                        "Device": log_snapshot.device_name,
                        "Log Name": log_snapshot.log_name,
                        "Started": str(log_snapshot.start_time),
                        "Finished": str(log_snapshot.finish_time),
                        "Duration": f"{log_snapshot.logs_collection_duration} s",
                        "Size": f"{int(log_snapshot.size_in_bytes)/1000} kB",
                        "Session ID": log_snapshot.session_id,
                        "Scenario": log_snapshot.session_scenario,
                        "object_instance": log_snapshot
                    }
                    filterable_log_snapshots_list.append(log_snapshot_list_info)

        filtered_log_snapshots_list = []
        for log_snapshot_info in filterable_log_snapshots_list:
            if search_value in log_snapshot_info[search_paramter]:
                filtered_log_snapshots_list.append(log_snapshot_info["object_instance"])

        return filtered_log_snapshots_list