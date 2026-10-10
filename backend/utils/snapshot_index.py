"""
Persistent SQLite index over log-snapshot listing metadata.

Every snapshot's listing/filtering fields - the same ones LogSnapshotMeta
reads from a parquet footer (device_name, log_name, session_id, log_type,
timestamps, duration, size, ...) - are mirrored into a single small SQLite
file as snapshots are created. Listing, filtering, counting and pagination
then become one indexed SQL query instead of a footer read per file, so
the cost of GET /api/snapshots stops scaling with the total number of
snapshots on disk and instead scales with page_size.

The parquet files remain the source of truth for row data and for the
descriptive fields; this index is a derived, rebuildable cache. If it's
ever deleted or gets out of sync, `rebuild()` regenerates it from the
parquet footers (see scripts/reindex_snapshots.py for a CLI wrapper).

Safe to import and call from multiple processes (the Flask app plus one
watchdog subprocess per device): SQLite is opened in WAL mode with a
generous busy timeout so concurrent writers block briefly instead of
raising "database is locked".
"""

import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path("data") / "snapshot_index.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS snapshots (
    id                          TEXT PRIMARY KEY,
    device_id                   TEXT NOT NULL,
    device_name                 TEXT NOT NULL,
    log_name                    TEXT NOT NULL,
    log_description             TEXT NOT NULL DEFAULT '',
    session_id                  TEXT NOT NULL,
    session_scenario            TEXT NOT NULL DEFAULT '',
    data_unit                   TEXT NOT NULL DEFAULT '',
    log_type                    TEXT NOT NULL,
    start_time                  TEXT NOT NULL,
    finish_time                 TEXT NOT NULL,
    logs_collection_duration    REAL NOT NULL DEFAULT 0,
    size_in_bytes               INTEGER NOT NULL DEFAULT 0,
    data_file_name              TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_snapshots_type_device  ON snapshots(log_type, device_name);
CREATE INDEX IF NOT EXISTS idx_snapshots_type_logname ON snapshots(log_type, log_name);
CREATE INDEX IF NOT EXISTS idx_snapshots_type_session ON snapshots(log_type, session_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_type_start   ON snapshots(log_type, start_time);
CREATE INDEX IF NOT EXISTS idx_snapshots_device_id    ON snapshots(device_id);
"""

# Maps the search_param values the frontend/API already use (see
# LogSnapshotsHelper.get_filtered_log_snapshots_list) to index columns.
_SEARCH_PARAM_COLUMNS = {
    "Device":     "device_name",
    "Log Name":   "log_name",
    "Session ID": "session_id",
}

_local = threading.local()


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=30, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.executescript(_SCHEMA)
    conn.row_factory = sqlite3.Row
    return conn


def _conn() -> sqlite3.Connection:
    """One lazily-created connection per thread - sqlite3 connections
    aren't safe to share across threads, and Flask (plus the ThreadPoolExecutor
    used for backfill) is multi-threaded."""
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = _connect()
        _local.conn = conn
    return conn


def _escape_like(value: str) -> str:
    """Escape LIKE wildcard characters so a substring search matches
    Python's `in` operator semantics instead of treating % / _ as
    wildcards (mirrors the previous `search_value in field` behaviour)."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _row_values(meta) -> tuple:
    return (
        meta.id, meta.device_id, meta.device_name, meta.log_name,
        meta.log_description or "", meta.session_id, meta.session_scenario or "",
        meta.data_unit or "", meta.log_type, str(meta.start_time),
        str(meta.finish_time), float(meta.logs_collection_duration or 0),
        int(meta.size_in_bytes or 0), meta.data_file_name,
    )


_UPSERT_SQL = """
INSERT INTO snapshots (
    id, device_id, device_name, log_name, log_description,
    session_id, session_scenario, data_unit, log_type,
    start_time, finish_time, logs_collection_duration,
    size_in_bytes, data_file_name
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    device_id=excluded.device_id,
    device_name=excluded.device_name,
    log_name=excluded.log_name,
    log_description=excluded.log_description,
    session_id=excluded.session_id,
    session_scenario=excluded.session_scenario,
    data_unit=excluded.data_unit,
    log_type=excluded.log_type,
    start_time=excluded.start_time,
    finish_time=excluded.finish_time,
    logs_collection_duration=excluded.logs_collection_duration,
    size_in_bytes=excluded.size_in_bytes,
    data_file_name=excluded.data_file_name
"""


def upsert(meta) -> None:
    """Insert or refresh the index row for one snapshot.

    `meta` can be a LogSnapshotMeta or a full LogSnapshot - both expose the
    same fields this reads. Called right after a snapshot's parquet file is
    written so the index never has to be caught up by a rebuild.
    """
    conn = _conn()
    conn.execute(_UPSERT_SQL, _row_values(meta))
    conn.commit()


def bulk_upsert(metas) -> int:
    """Insert/refresh many rows in one transaction. Used by the one-time
    backfill (see scripts/reindex_snapshots.py) so indexing 20k existing
    snapshots doesn't cost 20k individual commits/fsyncs.

    Returns the number of rows written.
    """
    rows = [_row_values(m) for m in metas]
    if not rows:
        return 0
    conn = _conn()
    conn.executemany(_UPSERT_SQL, rows)
    conn.commit()
    return len(rows)


def remove(snapshot_id: str) -> None:
    """Drop a single snapshot's row, e.g. right after its parquet file is
    deleted."""
    conn = _conn()
    conn.execute("DELETE FROM snapshots WHERE id = ?", (snapshot_id,))
    conn.commit()


def remove_for_device(device_id: str) -> None:
    """Drop every row belonging to a device, e.g. when the device itself is
    removed and its whole data directory goes with it."""
    conn = _conn()
    conn.execute("DELETE FROM snapshots WHERE device_id = ?", (device_id,))
    conn.commit()


def query(log_type_chart: bool, search_param: str | None = None,
          search_value: str | None = None, page: int = 1, page_size: int = 25):
    """Return (page_rows, total) for the given filter/page straight from
    SQLite - filtering, counting and pagination all happen in SQL, so
    nothing but the requested page is ever pulled into Python.

    page_rows are sqlite3.Row objects (dict-like: row["device_name"], etc).
    Ordered newest-first by start_time.
    """
    target_log_type = "chart" if log_type_chart else "text"
    where  = ["log_type = ?"]
    params: list = [target_log_type]

    column = _SEARCH_PARAM_COLUMNS.get(search_param) if search_param else None
    if column and search_value:
        where.append(f"{column} LIKE ? ESCAPE '\\'")
        params.append(f"%{_escape_like(search_value)}%")

    where_clause = " AND ".join(where)
    conn = _conn()

    total = conn.execute(
        f"SELECT COUNT(*) FROM snapshots WHERE {where_clause}", params
    ).fetchone()[0]

    offset = (page - 1) * page_size
    rows = conn.execute(
        f"""
        SELECT * FROM snapshots
        WHERE {where_clause}
        ORDER BY start_time DESC
        LIMIT ? OFFSET ?
        """,
        [*params, page_size, offset],
    ).fetchall()

    return rows, total


def find_by_id(snapshot_id: str) -> sqlite3.Row | None:
    """O(1) index lookup for a single snapshot's metadata row, used to
    resolve /content, /packets and /pcap requests without a filesystem
    glob."""
    conn = _conn()
    return conn.execute(
        "SELECT * FROM snapshots WHERE id = ?", (snapshot_id,)
    ).fetchone()


def count_all() -> int:
    return _conn().execute("SELECT COUNT(*) FROM snapshots").fetchone()[0]


def rebuild(data_dir: str = "data", max_workers: int = 16) -> int:
    """Walk every parquet file under data_dir and (re)populate the index
    from their footers. Idempotent - safe to run any time (initial
    backfill, recovering from a deleted/corrupted index file, or after
    manually dropping files into the data directory).

    Returns the number of rows indexed.
    """
    # Imported lazily to avoid a hard import-time dependency from this
    # module on backend.models (keeps snapshot_index usable/testable on
    # its own, and avoids any risk of a circular import since
    # backend.models.log_snapshot imports this module).
    from backend.utils.log_snapshots_loader import LogSnapshotsLoader

    paths = list(Path(data_dir).glob("*/*.parquet"))

    def _read_one(path: Path):
        # Reuses LogSnapshotsLoader's existing footer-first-then-full-load
        # fallback, so files predating the persisted listing metadata still
        # get indexed correctly (at the one-time cost of a full read),
        # exactly as the old per-request listing path used to handle them.
        loader = LogSnapshotsLoader(str(path.parent))
        return loader.load_log_snapshot_meta(path)

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        metas = [m for m in pool.map(_read_one, paths) if m is not None]

    return bulk_upsert(metas)
