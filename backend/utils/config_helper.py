import pandas as pd

class ConfigurationHelper:

    @staticmethod
    def get_log_content_for_selected_snapshots(selected_log_snapshots):
        """
        Extracts log content from selected log snapshots and generate time aligned data frame.

        Returns:
            (pd.DataFrame): Data frame with full log content for all selected log snapshots.
        """
        final_data_frame = pd.DataFrame(columns=["time", "content", "device"])
        for log_snapshot in selected_log_snapshots:
            selected_log_content = pd.DataFrame(log_snapshot.collected_data)
            selected_log_content.insert(1, "device", log_snapshot.device_name)
            selected_log_content.insert(2, "log_name", log_snapshot.log_name)
            if final_data_frame.empty:
                final_data_frame = selected_log_content
            elif not selected_log_content.empty:
                final_data_frame = pd.concat([final_data_frame, selected_log_content], ignore_index=True)
        final_data_frame = final_data_frame.sort_values(by="time", ascending=True)
        final_data_frame["time"] = final_data_frame["time"].dt.strftime("%Y-%m-%d %H:%M:%S")

        return final_data_frame

    @staticmethod
    def get_log_snapshots_list(device_list, log_type_chart):
        """
        Extract list of all logs snapshots from provided devices.

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
                        "object_instance": log_snapshot
                    }
                    filterable_log_snapshots_list.append(log_snapshot_list_info)

        filtered_log_snapshots_list = []
        for log_snapshot_info in filterable_log_snapshots_list:
            print(search_value)
            print(log_snapshot_info[search_paramter])
            if search_value in log_snapshot_info[search_paramter]:
                filtered_log_snapshots_list.append(log_snapshot_info["object_instance"])

        return filtered_log_snapshots_list
