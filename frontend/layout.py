from dash import html, dcc
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
    html.H4("Log Snapshots"),
    dbc.Button("📊 View Selected Logs", id="view-selected", color="primary"),
    html.Div(id="log-snapshots-container"),

    log_modal_view,
    device_modal_view
], fluid=True)
