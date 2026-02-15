import json
from dash import html, dcc, dash_table
import dash_bootstrap_components as dbc


log_modal_view = dbc.Modal(
    [
        dbc.ModalHeader(dbc.ModalTitle("Logs content")),
        dbc.ModalBody(
            html.Div(
                id="modal-body",
                style={
                    "height": "100%",
                    "overflow": "hidden"
                }
            ),
            style={
                "height": "100%",
                "overflow": "hidden"
            }
        ),
        dbc.ModalFooter([
            dbc.Button("⬇ Download CSV", id="download-logs", color="secondary"),
            dcc.Download(id="download-component"),
            dbc.Button("Close", id="close-modal")
        ])
    ],
    id="logs-modal",
    is_open=False,
    fullscreen=True,
    scrollable=False
)

# Device details modal
device_modal_view = dbc.Modal(
    [
        dbc.ModalHeader(dbc.ModalTitle("Device Details")),
        dbc.ModalBody(id="device-modal-body"),
        dbc.ModalFooter(dbc.Button("Close", id="close-device-modal"))
    ],
    id="device-modal",
    is_open=False
)

layout_view = dbc.Container([
    dcc.Store(id="collection-store", data=0),
    dcc.Interval(
        id="device-refresh-interval",
        interval=5000,   # 5 seconds
        n_intervals=0
    ),
    dcc.Interval(
        id="startup-trigger",
        interval=1,   # 1 ms
        n_intervals=0,
        max_intervals=1
    ),
    dbc.Row(
        [
            dbc.Col(
                html.Img(
                    src="/assets/icon.png",  # your minimalist line-art octopus icon
                    height="60px",  # zoomed
                    style={
                        "margin-right": "12px",
                        "display": "inline-block",
                        "transform": "translateY(3px)"  # vertical alignment
                    }
                ),
                width="auto",
                style={"display": "flex", "align-items": "center"}
            ),

            # App title and subtitle
            dbc.Col(
                html.Div([
                    html.H2(
                        "LogOctopus",
                        className="m-0",
                        style={"color": "#1a1a1a", "font-weight": "bold"}  # match dark lines of icon
                    ),
                    html.Small(
                        "Collect & Analyze Logs Efficiently",
                        className="text-secondary"  # muted gray
                    )
                ]),
                style={"display": "flex", "flex-direction": "column", "justify-content": "center"}
            )
        ],
        align="center",
        className="my-3",
        style={
            "background-color": "#ffffff",  # white to match icon background
            "padding": "12px 20px",
            "border-radius": "10px",
            "box-shadow": "0 2px 8px rgba(0,0,0,0.08)"  # subtle shadow
        }
    ),
    dbc.Row([
        dbc.Col(
            dcc.Upload(
                id="upload-json",
                children=dbc.Button("➕ Add New Device", color="primary"),
                multiple=False
            ),
            width="auto"
        ),
        dbc.Col(dbc.Button("▶ Start Logs collection", id="start-all", color="success"), width="auto"),
        dbc.Col(dbc.Button("⏹ Stop Logs collection", id="stop-all", color="danger"), width="auto"),
        dbc.Col(dbc.Button("🗑 Remove Selected", id="remove-selected", color="secondary"), width="auto"),
    ]),

    html.Hr(),
    html.Div(id="devices-container", style={"display": "flex", "flex-wrap": "wrap"}),
    dbc.Alert(
        "Incorrect config file",
        id="config-alert",
        color="danger",
        is_open=False,
        dismissable=True,
    ),
    html.Hr(),
    dbc.Row([
        dbc.Col(dbc.Button("📋 Show Logs", id="view-selected", color="primary"), width="auto"),
        dbc.Col(dbc.Input(id="search-param", type="text", placeholder="Paramter"), width="auto"),
        dbc.Col(html.Span("=", style={"fontWeight": "bold", "fontSize": "20px", "textAlign": "center"}), width="auto"),
        dbc.Col(dbc.Input(id="search-value", type="text", placeholder="Value"), width="auto"),
        dbc.Col(dbc.Button("🔍 Filter", id="filter-btn", n_clicks=0), width="auto"),
    ]),
    html.Hr(),
    html.Div(id="log-snapshots-container"),

    log_modal_view,
    device_modal_view
], fluid=True)


def generate_logs_snapshots_table(log_snapshots_list):
    """
    Generate dbc.Dash table based on info in logs snapshot objects list.

    Args:
        log_snapshots_list (list): List which contains all logs snapshot objects.
    
    Returns:
        (dbc.Table): HTML table based on dbc dash component with all collected logs snapshots.
    """
    table_rows = []
    i = 0
    for log_snapshot in log_snapshots_list:
        table_rows.append(html.Tr([
            html.Td(dcc.Checklist(options=[{"label": "", "value": i}], id={"type": "log-check", "index": i})),
            html.Td(log_snapshot.device_name),
            html.Td(log_snapshot.log_name),
            html.Td(str(log_snapshot.start_time)),
            html.Td(str(log_snapshot.finish_time)),
            html.Td(f"{log_snapshot.logs_collection_duration} s"),
            html.Td(f"{int(log_snapshot.size_in_bytes)/1000} kB"),
            html.Td(log_snapshot.session_id),
            html.Td(dbc.Button("View Logs", id={"type": "view-log-btn", "index": i}, size="sm"))
        ]))
        i = i + 1

    if not table_rows:
        return html.P("No log snapshots yet.")

    return dbc.Table(
        [
            html.Thead(html.Tr([
                html.Th("✔"),
                html.Th("Device"),
                html.Th("Log name"),
                html.Th("Started"),
                html.Th("Finished"),
                html.Th("Duration"),
                html.Th("Size"),
                html.Th("Session ID"),
                html.Th("Action")
            ])),
            html.Tbody(table_rows)
        ],
        bordered=True,
        hover=True
    )

def generate_all_devices_cards_list(devices_list):
    """
    Generate all devices cards lists.

    Args:
        devices_list (list): List which contains all device objects.
    
    Returns:
        (list): List containg all devices info in HTML cards format.
    """
    cards_list = []
    for device_instance in devices_list:
        device_id = device_instance.device_config_id
        card = html.Div(
            id={"type": "device-card", "index": device_id},
            className="card m-2 p-2",
            style={"width": "260px", "backgroundColor": "lightgray", "position": "relative"},
            children=[
                dcc.Checklist(
                    options=[{"label": "", "value": device_id}],
                    id={"type": "device-select", "index": device_id},
                    style={"position": "absolute", "top": "6px", "left": "6px", "transform": "scale(1.4)"},
                ),
                dbc.Button(
                    "⚙️",
                    id={"type": "device-info-btn", "index": device_id},
                    size="sm",
                    color="light",
                    style={"position": "absolute", "top": "6px", "right": "6px", "fontSize": "10px"}
                ),
                html.H5(device_instance.device_name, className="mt-4"),

                # Pre-populate status
                html.Small(f"Connection: {'✅' if device_instance.connection_status else '❌'}", id={"type": "status-connection", "index": device_id}),
                html.Br(),
                html.Small(f"Logs Access: {'✅' if device_instance.log_access else '❌'}", id={"type": "status-access", "index": device_id}),
                html.Br(),
                html.Small(f"Logs Collection: {'🟢' if device_instance.device_watchdog.collection_ongoing else '🟡'}", id={"type": "status-collection", "index": device_id}),
            ]
        )
        cards_list.append(card)

    return cards_list

def generate_device_info_modal(target_device):
    """
    Generate device info modal.

    Args:
        target_device (Device): Device class object which contains all info about target device.
    
    Returns:
        (html.Div): HTML body with all detailed info about target device.
    """
    body = html.Div([
        html.P(f"Name: {target_device.device_name}"),
        html.P(f"Connection: {target_device.connection_status}"),
        html.P(f"Logs Access: {target_device.log_access}"),
        html.P(f"Logs Collection: {target_device.device_watchdog.collection_ongoing}"),
        html.Hr(),
        html.Pre(json.dumps(target_device.device_config, indent=2))
    ])

    return body

def generate_log_content_modal(log_content_df):
    """
    Generate log content modal with all logs timestamps and entries.

    Args:
        log_content_df (pandas.df): Device class object which contains all info about target device.
    
    Returns:
        (dash_table.DataTable): Dash table with full log content.
    """
    if log_content_df.empty:

        return None
    else:
        log_table = dash_table.DataTable( 
            columns=[{"name": i, "id": i} for i in log_content_df.columns],
            data=log_content_df.to_dict("records"),
            page_action="none", 
            style_table={ "height": "calc(100vh - 120px)", "overflowY": "auto", "overflowX": "auto", "width": "100%", }, 
            # Default style for all columns (small) 
            style_cell={ 
                "textAlign": "left", 
                "whiteSpace": "normal", 
                "overflow": "hidden", 
                "textOverflow": "ellipsis", 
                "minWidth": "50px", 
                "width": "50px", 
                "maxWidth": "100px" }, 
                # Make the last column extremely wide 
                style_cell_conditional=[ 
                    { 
                        "if": {"column_id": log_content_df.columns[-1]}, # last column
                        "minWidth": "1000px", 
                        "width": "1200px", 
                        "maxWidth": "2000px", } ], 
                style_data={"userSelect": "text"}
                )

        return log_table

def get_all_devices_statuses(devices_list):
    """
    Get following statuses: connection, log_access, logs_collection for all devices.

    Args:
        devices_list (list): List which contains all device objects.

    Returns:
        [list, list, list]: Three elements list containg lists for all devices statuses (connection, log_access, logs_collection).
    """
    connection_statuses = []
    log_access_statuses = []
    logs_collection_statuses = []

    for device in devices_list:
        device.test_log_files_access()
        device.get_device_connection_status()
        connection_statuses.append(f"Connection: {'✅' if device.connection_status else '❌'}")
        log_access_statuses.append(f"Logs Access: {'✅' if device.log_access else '❌'}")
        logs_collection_statuses.append(f"Logs Collection: {'🟢' if device.device_watchdog.collection_ongoing else '🟡'}")
    
    return connection_statuses, log_access_statuses, logs_collection_statuses
