import json
import random
from dash import html, dcc, dash_table
import dash_bootstrap_components as dbc
import dash_daq as daq
import plotly.express as px
import plotly.io as pio
import plotly.graph_objects as go
import pandas as pd


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
            html.Span("Raw mode", style={"marginRight": "10px"}, className="fw-bold me-2"),
            daq.ToggleSwitch(id='color-mode-switch', value=False),
            html.Span("Color mode", style={"marginLeft": "10px"}, className="fw-bold me-2"),
            dbc.Button("Download", id="download-logs", color="secondary"),
            dcc.Download(id="download-component"),
            dbc.Button("Close", id="close-modal"),
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
    is_open=False,
    size="xl",
)

# Session details modal
session_modal_view = dbc.Modal(
    [
        dbc.ModalHeader(
            dbc.ModalTitle(
                "Logs collection session details",
                className="w-100 text-center"
            )
        ),
        dbc.ModalBody(
            id="session-modal-body",
            className="d-flex flex-column align-items-center"
        ),
    ],
    id="session-modal",
    is_open=False,
    size="md",
)

rest_api_modal = dbc.Modal(
    [
        dbc.ModalHeader(
            dbc.ModalTitle("Logs Collection REST API"),

        ),
        dbc.ModalBody([
            dbc.Card(
                dbc.CardBody([
                    html.Div([
                        dbc.Badge("POST", color="green", className="me-2"),
                        html.H5("/api/start-logs-collection", className="d-inline")
                    ], className="mb-3"),

                    html.P("Starts log collection on selected devices.", className="mb-2"),
                    html.Small("Request body:", className="text-muted"),
                    html.Pre(
                        '''{"selected_devices": ["device_1","device_2"]}''',
                        className="bg-light p-2 border rounded"
                    ),
                    html.Small("Response:", className="text-muted mt-2"),
                    html.Pre(
                        '''{"status": "logs collection started", "session_id": "8cd7112719ac" }''',
                        className="bg-light p-2 border rounded"
                    ),
                    dcc.Clipboard(
                        content="Hello clipboard",
                        children=dbc.Button("📋 Example Python code", size="sm", color="secondary")
                    )
                ]),
                className="w-100 mb-4 shadow-sm"
            ),
            dbc.Card(
                dbc.CardBody([
                    html.Div([
                        dbc.Badge("POST", color="green", className="me-2"),
                        html.H5("/api/stop-logs-collection", className="d-inline")
                    ], className="mb-3"),
                    html.P("Stops log collection and saves collected logs.", className="mb-2"),
                    html.Small("Request body:", className="text-muted"),
                    html.Pre(
                        '''{ "selected_devices": ["device_1"], "session_id": "8cd7112719ac" }''',
                        className="bg-light p-2 border rounded"
                    ),
                    html.Small("Response:", className="text-muted mt-2"),
                    html.Pre(
                        '''{ "status": "logs collection stopped", "text_logs_url": "...", "chart_logs_url": "..." }''',
                        className="bg-light p-2 border rounded"
                    ),
                    dcc.Clipboard(
                        content="Hello clipboard",
                        children=dbc.Button("📋 Example Python code", size="sm", color="secondary")
                    )
                ]),
                className="w-100 mb-3 shadow-sm"
            )

        ]),
        dbc.ModalFooter(
            dbc.Button("Close", id="close-api-modal", color="secondary")
        )
    ],
    id="api-modal",
    is_open=False,
    size="xl",
)

layout_view = dbc.Container([
    dcc.Location(id="url", refresh=False),
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
            ),
            dbc.Col(
                dbc.Button(
                    html.Span("REST API", style={"font-size": "20px"}),
                    id="open-api-modal",
                    color="primary"
                ),
                width="auto",
                style={"display": "flex", "justify-content": "flex-end", "align-items": "center"}
            ),
            # dbc.Col(
            #     dbc.Button(
            #         html.Span("🛠️", style={"font-size": "20px"}),
            #         id="open-settings-modal",
            #         color="primary"
            #     ),
            #     width="auto",
            #     style={"display": "flex", "justify-content": "flex-end", "align-items": "center"}
            # )
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
    dbc.Row(
        [
            dbc.Col(dbc.Button("📋 Show Logs", id="view-selected", color="primary"), width="auto"),
            dbc.Col(html.Span("Text", className="fw-bold"), width="auto"),
            dbc.Col(daq.ToggleSwitch(id="log-type-chart", value=False), width="auto"),
            dbc.Col(html.Span("Chart", className="fw-bold"), width="auto"),
            dbc.Col(dbc.Input(id="search-param", type="text", placeholder="Parameter"), width="auto"),
            dbc.Col(html.Span("=", style={"fontWeight": "bold", "fontSize": "20px"}), width="auto"),
            dbc.Col(dbc.Input(id="search-value", type="text", placeholder="Value"), width="auto"),
            dbc.Col(dbc.Button("🔍 Filter", id="filter-btn", n_clicks=0), width="auto"),
        ],
        align="center",
        className="g-2 flex-nowrap",
    ),
    html.Hr(),
    html.Div(id="log-snapshots-container"),

    log_modal_view,
    device_modal_view,
    dcc.Loading(
        id="loading-snapshots",
        type="circle",
        children=session_modal_view),
    # session_modal_view,
    rest_api_modal
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
                html.Small(f"Logs Collection: {'🟢' if device_instance.collection_ongoing else '🟡'}", id={"type": "status-collection", "index": device_id}),
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
        html.P(f"Connection: {'✅' if target_device.connection_status else '❌'}"),
        html.P(f"Logs Access: {'✅' if target_device.log_access else '❌'}"),
        html.P(f"Logs Collection: {'🟢' if target_device.collection_ongoing else '🟡'}"),
        html.Hr(),
        html.H4(f"Recent error logs for device watchdog"),
        html.Hr(),
        dash_table.DataTable(
            id="device-dataframe-table",
            columns=[{"name": i, "id": i} for i in target_device.errors.columns],
            data=target_device.errors.to_dict("records"),
            style_table={"overflowX": "auto"},  # horizontal scroll if wide
            style_cell={"textAlign": "left", "padding": "5px"},
            style_header={
                "backgroundColor": "rgb(230, 230, 230)",
                "fontWeight": "bold"
            },
            page_size=10,  # optional paging
        ),
        html.Hr(),
        html.H4(f"Current JSON configuration"),
        html.Hr(),
        html.Pre(json.dumps(target_device.device_config, indent=2))
    ])

    return body

def generate_log_content_modal(log_content_df, color_mode):
    """
    Generate log content modal with all logs timestamps and entries.

    Args:
        log_content_df (pandas.df): Device class object which contains all info about target device.
        color_mode (bool): Defines if log content table should be colored according to 'log_name' column.

    Returns:
        (dash_table.DataTable): Dash table with full log content.
    """
    if log_content_df.empty:

        return None
    else:
        unique_values = log_content_df["log_name"].unique()
        style_rules = []
        for value in unique_values:
            color = "#{:06x}".format(random.randint(0, 0xFFFFFF))
            style_rules.append({
                "if": {"filter_query": f'{{log_name}} = "{value}"'},
                "backgroundColor": color,
                "color": "white"
            })
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
                style_data={"userSelect": "text"},
                style_data_conditional=style_rules if color_mode else []
                )

        return log_table

def generate_chart_content_modal(log_snapshots_list):
    """
    Generate chart content modal with all chart data.

    Args:
        log_snapshots_list (list): List of all logs snapshots which will be used for modal generation.

    Returns:
        (html.Div): HTML div with list of dcc Graphs with all chart data.
    """
    return html.Div(
            [
                html.Div(
                    dcc.Graph(
                        figure=create_chart_for_data_frame(
                            log_snapshot.collected_data,
                            log_snapshot.log_name
                        ),
                        config={"displayModeBar": False},
                    ),
                    style={
                        "backgroundColor": "white",
                        "padding": "15px",
                        "borderRadius": "12px",
                        "boxShadow": "0 4px 12px rgba(0,0,0,0.06)",
                    },
                )
                for log_snapshot in log_snapshots_list
            ],
            style={
                "display": "flex",
                "flexDirection": "column",
                "gap": "30px",
                "padding": "20px",
                "height": "80vh",        # fixed height (viewport based)
                "overflowY": "auto",     # enable vertical scroll
            }
        )

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
        connection_statuses.append(f"Connection: {'✅' if device.connection_status else '❌'}")
        log_access_statuses.append(f"Logs Access: {'✅' if device.log_access else '❌'}")
        logs_collection_statuses.append(f"Logs Collection: {'🟢' if device.collection_ongoing else '🟡'}")
    
    return connection_statuses, log_access_statuses, logs_collection_statuses

def create_chart_for_data_frame(data_frame, chart_title):
    """
    Create plotly chart based on data frame data and provided title.

    Args:
        data_frame (pandas.df): Raw data frame with collected log data.
        chart_title (str): Target title for plotly chart.

    Returns:
        (px.line): Plotly chart based on data frame data and provided title.
    """
    # Try numeric conversion without immediately overwriting original data
    numeric_content = pd.to_numeric(data_frame["content"], errors="coerce")

    # Determine if column is numeric (at least one valid number)
    is_numeric = numeric_content.notna().sum() > 0

    if is_numeric:
        # ---------- NUMERIC → LINE CHART ----------
        data_frame = data_frame.copy()
        data_frame["content"] = numeric_content

        fig = px.line(
            data_frame,
            x="time",
            y="content",
            title=chart_title,
        )

        fig.update_traces(
            mode="lines",
            line=dict(width=2.5),
            hovertemplate="Value: <b>%{y}</b><extra></extra>",
        )

        fig.update_layout(
            xaxis=dict(
                title="Time",
                showgrid=True,
                gridcolor="rgba(0,0,0,0.05)",
                zeroline=False,
            ),
            yaxis=dict(
                title="Value",
                showgrid=True,
                gridcolor="rgba(0,0,0,0.05)",
                zeroline=False,
            ),
        )

    else:
        # ---------- STRING / CATEGORICAL → SCATTER ----------
        data_frame = data_frame.copy()
        data_frame["content"] = data_frame["content"].astype(str)

        fig = px.scatter(
            data_frame,
            x="time",
            y="content",
            title=chart_title,
        )

        fig.update_traces(
            mode="markers",
            marker=dict(size=9),
            hovertemplate="<b>%{x}</b><br>Value: %{y}<extra></extra>",
        )

        fig.update_layout(
            xaxis=dict(
                title="Time",
                showgrid=True,
                gridcolor="rgba(0,0,0,0.05)",
                zeroline=False,
            ),
            yaxis=dict(
                title="Category",
                showgrid=False,
                zeroline=False,
                type="category",  # Important for string handling
            ),
        )

    # ---------- COMMON LAYOUT ----------
    fig.update_layout(
        height=360,
        template="plotly_white",
        title=dict(
            x=0.02,
            xanchor="left",
            font=dict(size=18),
        ),
        plot_bgcolor="white",
        paper_bgcolor="white",
        margin=dict(l=40, r=20, t=60, b=40),
        hovermode="x unified",
        showlegend=False,
    )

    return fig


def create_session_info_content_modal(text_logs_url, chart_logs_url):
    """
    Create session info modal content based on provided data.

    Args:
        text_logs_url (str): URL with target session text logs.
        chart_logs_url (str): URL with target session chart logs.

    Returns:
        (html.Div): HTLM with two buttons by which user can see logs collected for target session.
    """
    return html.Div(
        [
            dbc.Button(
                "Show collected text logs",
                href=text_logs_url,
                target="_blank",
                color="secondary",
            ),
            dbc.Button(
                "Show collected chart logs",
                href=chart_logs_url,
                target="_blank",
                color="secondary",
            ),
        ],
        className="d-flex justify-content-center gap-2 mt-2"
    )

def export_charts_div_to_html(div_dict, file_path):
    """
    Generated HTML file with all charts based on serialzied dict with chart data.

    Args:
        div_dict (dict): Serialized HTML.div with all charts data.
        file_path (str): Target path for HTML file.
    """
    html_parts = []

    for inner_div in div_dict["props"]["children"]:

        graph = inner_div["props"]["children"]

        if graph["type"] == "Graph":
            fig_dict = graph["props"]["figure"]
            fig = go.Figure(fig_dict)

            html_parts.append(
                pio.to_html(fig, full_html=False, include_plotlyjs="cdn")
            )

    with open(file_path, "w", encoding="utf-8") as f:
        f.write("<html><head><meta charset='utf-8'></head><body>")

        for part in html_parts:
            f.write(f"""
            <div style="
                background:white;
                padding:15px;
                border-radius:12px;
                box-shadow:0 4px 12px rgba(0,0,0,0.06);
                margin-bottom:30px;">
                {part}
            </div>
            """)

        f.write("</body></html>")
