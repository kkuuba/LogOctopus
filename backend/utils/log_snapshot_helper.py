import pandas as pd

class LogSnapshotsHelper:

    def __init__(self, device_list):
        self.device_list = device_list

    def get_log_content_for_selected_snapshots(self, selected_log_snapshots):
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

        return final_data_frame

    def get_log_snapshots_list(self):
        """
        Extract list of all logs snapshots from provided devices.

        Returns:
            (list): List of all log snapshots for provded devices.
        """
        log_snapshots_list = []
        for device in self.device_list:
            for log_snapshot in device.log_snapshots:
                    log_snapshots_list.append(log_snapshot)

        return log_snapshots_list
