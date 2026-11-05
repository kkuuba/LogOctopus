"""
Snapshot & PCAP retention for LogOctopus.

Lifecycle of every snapshot parquet file (``data/<device>/<id>_<ts>.parquet``)
and every raw capture (``data/<device>/<session>.pcap``):

    ACTIVE ──(older than compress_after_days)──▶ ARCHIVED ──(older than delete_after_days)──▶ DELETED
    X.parquet                                     X.parquet.zip

* Age is always measured from the file's *creation* time.  The zip keeps the
  original mtime, so zipping never "resets the clock" for the delete step.
* Archived files are restored **on demand** (``restore_file`` /
  ``start_restore_job``).  Restoring writes the file back next to its zip and
  keeps the zip: the zip stays the source of truth and the restored copy is
  only a cache that the sweeper drops again after ``RESTORED_TTL_S`` of no
  access.  That keeps the age clock intact and stops a freshly viewed old log
  from being re-zipped a minute later.
* The snapshot index rows are NOT touched when zipping (the index describes
  the snapshot, not the storage).  They are removed only on delete.

Nothing here knows about Flask or the snapshot index - the app passes in a
``forget_snapshot`` callback - which keeps the module unit-testable.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import tempfile
import threading
import time
import uuid
import zipfile
from contextlib import contextmanager
from dataclasses import dataclass, asdict
from typing import Callable, Iterator, Optional

try:  # POSIX only; used to keep several server workers from sweeping at once
    import fcntl
except ImportError:  # pragma: no cover - Windows
    fcntl = None

log = logging.getLogger(__name__)

ZIP_SUFFIX = ".zip"
SNAPSHOT_EXT = ".parquet"
PCAP_EXT = ".pcap"

DAY_S = 86_400
CHUNK = 1024 * 1024                  # copy granularity (also = progress granularity)
RESTORED_TTL_S = 60 * 60             # drop a restored copy after 1 h without access
STALE_TMP_S = DAY_S                  # leftover *.tmp / *.restoring older than this are removed
MAX_DAYS = 3650
_OWN_TMP = re.compile(r"\.[0-9a-f]{8}\.(tmp|restoring)$")   # temp names created by this module only
SKIP_DIRS = {"dissectors"}           # data/ sub-directories that hold no device data


# ═════════════════════════════════════════════════════════════════════════════
# Policy
# ═════════════════════════════════════════════════════════════════════════════

@dataclass
class RetentionPolicy:
    """User-configurable retention settings (persisted under ``retention`` in settings.json).

    Attributes:
        enabled: Master switch.  Nothing is zipped or deleted while False.
        compress_after_days: Zip files older than this many days. ``0`` = never zip.
        delete_after_days: Delete files older than this many days (total age,
            counted from creation, *not* from when they were zipped). ``0`` = never delete.
        include_pcap: Apply the same policy to raw ``.pcap`` files.
    """
    enabled: bool = False
    compress_after_days: int = 7
    delete_after_days: int = 90
    include_pcap: bool = True

    @classmethod
    def from_dict(cls, data: Optional[dict]) -> "RetentionPolicy":
        data = data or {}
        d = cls()

        def as_int(key: str, default: int) -> int:
            try:
                return int(data.get(key, default))
            except (TypeError, ValueError):
                return default

        return cls(
            enabled=bool(data.get("enabled", d.enabled)),
            compress_after_days=as_int("compress_after_days", d.compress_after_days),
            delete_after_days=as_int("delete_after_days", d.delete_after_days),
            include_pcap=bool(data.get("include_pcap", d.include_pcap)),
        )

    def validate(self) -> Optional[str]:
        """Return a human-readable error, or None when the policy is valid."""
        for name, val in (("compress_after_days", self.compress_after_days),
                          ("delete_after_days", self.delete_after_days)):
            if not 0 <= val <= MAX_DAYS:
                return f"{name} must be between 0 and {MAX_DAYS}"
        if self.compress_after_days and self.delete_after_days \
                and self.delete_after_days <= self.compress_after_days:
            return "delete_after_days must be greater than compress_after_days"
        return None

    def to_dict(self) -> dict:
        return asdict(self)


# ═════════════════════════════════════════════════════════════════════════════
# Low-level file helpers
# ═════════════════════════════════════════════════════════════════════════════

# Striped locks: bounded memory, and two operations on the same path always
# map to the same lock.
_LOCKS = [threading.Lock() for _ in range(64)]


def _lock_for(path: str) -> threading.Lock:
    return _LOCKS[int(hashlib.md5(os.path.abspath(path).encode()).hexdigest(), 16) % len(_LOCKS)]


@contextmanager
def _try_lock(path: str) -> Iterator[bool]:
    """Non-blocking acquire - the sweeper skips a file that is being restored."""
    lock = _lock_for(path)
    got = lock.acquire(blocking=False)
    try:
        yield got
    finally:
        if got:
            lock.release()


def zip_path(path: str) -> str:
    return path + ZIP_SUFFIX


def is_archived(path: str) -> bool:
    """True when only the zipped copy exists (i.e. the file must be restored before use)."""
    return not os.path.exists(path) and os.path.exists(zip_path(path))


def _touch(path: str) -> None:
    try:
        os.utime(path, None)
    except OSError:
        pass


def _remove_quiet(path: str) -> None:
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


def archived_size(path: str) -> int:
    """Uncompressed size of the file inside ``path``'s zip (0 when unreadable)."""
    try:
        with zipfile.ZipFile(zip_path(path)) as zf:
            return zf.getinfo(os.path.basename(path)).file_size
    except (OSError, KeyError, zipfile.BadZipFile):
        return 0


def compress_file(path: str) -> tuple[int, int]:
    """Zip ``path`` next to itself and remove the original.

    Safe against crashes: the zip is written to a temp name, verified, given the
    original's mtime and atomically renamed *before* the original is removed.

    Returns:
        (original_bytes, zip_bytes)
    """
    zpath = zip_path(path)
    tmp = f"{zpath}.{uuid.uuid4().hex[:8]}.tmp"
    st = os.stat(path)
    try:
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
            zf.write(path, arcname=os.path.basename(path))
        with zipfile.ZipFile(tmp) as zf:
            bad = zf.testzip()
            if bad is not None:
                raise OSError(f"zip verification failed on {bad}")
        os.utime(tmp, (st.st_atime, st.st_mtime))   # keep the original age
        os.replace(tmp, zpath)
    except BaseException:
        _remove_quiet(tmp)
        raise
    os.remove(path)
    return st.st_size, os.path.getsize(zpath)


def restore_file(path: str, progress: Optional[Callable[[int], None]] = None) -> bool:
    """Make ``path`` exist again by extracting it from its zip.

    The zip is kept (see module docstring).  Extraction is chunked so callers
    can report progress, and atomic (temp file + rename).

    Args:
        path: The *unzipped* path (``…/x.parquet``).
        progress: Called with the number of bytes written for every chunk.

    Returns:
        True if data was extracted, False if the file was already available.

    Raises:
        FileNotFoundError: neither the file nor its zip exists.
    """
    with _lock_for(path):
        if os.path.exists(path):
            _touch(path)
            return False
        zpath = zip_path(path)
        if not os.path.exists(zpath):
            raise FileNotFoundError(path)

        tmp = f"{path}.{uuid.uuid4().hex[:8]}.restoring"
        try:
            with zipfile.ZipFile(zpath) as zf:
                info = zf.getinfo(os.path.basename(path))   # by name only: no path traversal
                with zf.open(info) as src, open(tmp, "wb") as dst:
                    while True:
                        chunk = src.read(CHUNK)
                        if not chunk:
                            break
                        dst.write(chunk)
                        if progress:
                            progress(len(chunk))
            os.replace(tmp, path)
        except BaseException:
            _remove_quiet(tmp)
            raise
        return True


def ensure_available(path: str) -> None:
    """Blocking safety net for code paths that need the real file right now.

    Restores from the zip when necessary and refreshes the restored copy's
    "last used" time so the sweeper keeps it around.
    """
    if os.path.exists(path):
        _touch(path)
        return
    restore_file(path)


def remove_with_archive(path: str) -> None:
    """Delete a file and/or its zip (used by manual snapshot removal)."""
    _remove_quiet(path)
    _remove_quiet(zip_path(path))


def iter_archived(path: str) -> tuple[int, Iterator[bytes]]:
    """Stream the zipped file's content without writing it to disk.

    Returns ``(size, chunk_iterator)``; used for raw pcap downloads.
    """
    zf = zipfile.ZipFile(zip_path(path))
    info = zf.getinfo(os.path.basename(path))

    def gen() -> Iterator[bytes]:
        try:
            with zf.open(info) as f:
                while True:
                    chunk = f.read(CHUNK)
                    if not chunk:
                        return
                    yield chunk
        finally:
            zf.close()

    return info.file_size, gen()


# ═════════════════════════════════════════════════════════════════════════════
# Restore jobs (powers the "decompressing…" progress bar)
# ═════════════════════════════════════════════════════════════════════════════

_JOBS: dict[str, dict] = {}
_JOBS_LOCK = threading.Lock()
_JOB_KEEP_S = 15 * 60


def _public_job(job: dict) -> dict:
    return {k: job[k] for k in ("id", "status", "total_bytes", "done_bytes",
                                "files_total", "files_done", "current", "error")}


def start_restore_job(items: list[tuple[str, str]]) -> dict:
    """Restore several archived files in a background thread.

    Args:
        items: ``[(label, unzipped_path), …]``.  Duplicates and files that are
            already available are ignored.

    Returns:
        Public job dict (poll with :func:`get_restore_job`).  A job with
        nothing to do is returned already ``done``.
    """
    todo, seen = [], set()
    for label, path in items:
        if path in seen:
            continue
        seen.add(path)
        if is_archived(path):
            todo.append((label, path, archived_size(path)))
        elif os.path.exists(path):
            _touch(path)

    job = {
        "id": uuid.uuid4().hex,
        "status": "running" if todo else "done",
        "total_bytes": sum(s for _, _, s in todo),
        "done_bytes": 0,
        "files_total": len(todo),
        "files_done": 0,
        "current": "",
        "error": "",
        "_created": time.time(),
    }
    with _JOBS_LOCK:
        for jid in [j for j, v in _JOBS.items()
                    if v["status"] != "running" and time.time() - v["_created"] > _JOB_KEEP_S]:
            del _JOBS[jid]
        _JOBS[job["id"]] = job

    if todo:
        threading.Thread(target=_run_restore_job, args=(job, todo),
                         name=f"restore-{job['id'][:6]}", daemon=True).start()
    return _public_job(job)


def _run_restore_job(job: dict, todo: list[tuple[str, str, int]]) -> None:
    base = 0
    try:
        for label, path, size in todo:
            job["current"] = label

            def on_chunk(n: int, _base=base) -> None:
                job["done_bytes"] = min(job["total_bytes"], job["done_bytes"] + n)

            restore_file(path, on_chunk)
            # Another request may have restored this file first (no chunks seen
            # here) - snap to the exact expected position either way.
            base += size
            job["done_bytes"] = base
            job["files_done"] += 1
        job["status"] = "done"
    except Exception as exc:  # noqa: BLE001 - surfaced to the UI
        log.exception("restore job failed")
        job["error"] = str(exc) or exc.__class__.__name__
        job["status"] = "error"
    finally:
        job["current"] = ""


def get_restore_job(job_id: str) -> Optional[dict]:
    job = _JOBS.get(job_id)
    return _public_job(job) if job else None


# ═════════════════════════════════════════════════════════════════════════════
# Sweep
# ═════════════════════════════════════════════════════════════════════════════

def _new_report(dry_run: bool) -> dict:
    return {
        "dry_run": dry_run,
        "started_at": time.time(),
        "finished_at": None,
        "compress": {"count": 0, "bytes": 0, "saved": 0},   # bytes = original size
        "delete":   {"count": 0, "bytes": 0},
        "release":  {"count": 0, "bytes": 0},               # restored copies dropped
        "errors": [],
    }


def _device_dirs(data_dir: str) -> Iterator[str]:
    try:
        entries = list(os.scandir(data_dir))
    except FileNotFoundError:
        return
    for e in entries:
        if e.is_dir() and e.name not in SKIP_DIRS and not e.name.startswith("."):
            yield e.path


def _groups(device_dir: str, exts: tuple[str, ...]) -> Iterator[tuple[str, str]]:
    """Yield ``(unzipped_path, kind)`` for each file that is active and/or archived,
    and clean up stale temp files along the way."""
    seen: set[str] = set()
    now = time.time()
    try:
        names = os.listdir(device_dir)
    except OSError:
        return
    for name in names:
        full = os.path.join(device_dir, name)
        if _OWN_TMP.search(name):
            try:
                if now - os.path.getmtime(full) > STALE_TMP_S:
                    os.remove(full)
            except OSError:
                pass
            continue
        for ext in exts:
            if name.endswith(ext):
                base = full
            elif name.endswith(ext + ZIP_SUFFIX):
                base = full[: -len(ZIP_SUFFIX)]
            else:
                continue
            if base not in seen:
                seen.add(base)
                yield base, ("snapshot" if ext == SNAPSHOT_EXT else "pcap")


def run_sweep(
    data_dir: str,
    policy: RetentionPolicy,
    *,
    dry_run: bool = False,
    forget_snapshot: Optional[Callable[[str], None]] = None,
    report: Optional[dict] = None,
    now: Optional[float] = None,
) -> dict:
    """Apply ``policy`` to everything under ``data_dir``.

    ``dry_run=True`` evaluates the policy as if it were enabled and only
    *counts* what would happen - used for the live preview in the settings UI.

    Args:
        forget_snapshot: Called with the parquet path of every deleted
            snapshot so the caller can drop it from the snapshot index.
        report: Optional dict (from :func:`_new_report`) updated in place, so
            another thread can show live progress.
    """
    now = now if now is not None else time.time()
    rep = report if report is not None else _new_report(dry_run)
    exts = (SNAPSHOT_EXT, PCAP_EXT) if policy.include_pcap else (SNAPSHOT_EXT,)
    compress_s = policy.compress_after_days * DAY_S
    delete_s = policy.delete_after_days * DAY_S

    for device_dir in _device_dirs(data_dir):
        for path, kind in _groups(device_dir, exts):
            zpath = zip_path(path)
            with _try_lock(path) as got:
                if not got:                      # being restored right now
                    continue
                try:
                    hot, cold = os.path.exists(path), os.path.exists(zpath)
                    if not hot and not cold:
                        continue

                    if cold:
                        zage = now - os.path.getmtime(zpath)
                        if delete_s and zage >= delete_s:
                            size = os.path.getsize(zpath)
                            if not dry_run:
                                _remove_quiet(path)
                                _remove_quiet(zpath)
                                if kind == "snapshot" and forget_snapshot:
                                    forget_snapshot(path)
                            rep["delete"]["count"] += 1
                            rep["delete"]["bytes"] += size
                        elif hot and now - os.path.getmtime(path) >= RESTORED_TTL_S:
                            size = os.path.getsize(path)
                            if not dry_run:
                                _remove_quiet(path)
                            rep["release"]["count"] += 1
                            rep["release"]["bytes"] += size
                        continue

                    # active only
                    age = now - os.path.getmtime(path)
                    size = os.path.getsize(path)
                    if delete_s and age >= delete_s:
                        if not dry_run:
                            _remove_quiet(path)
                            if kind == "snapshot" and forget_snapshot:
                                forget_snapshot(path)
                        rep["delete"]["count"] += 1
                        rep["delete"]["bytes"] += size
                    elif compress_s and age >= compress_s:
                        if dry_run:
                            rep["compress"]["count"] += 1
                            rep["compress"]["bytes"] += size
                        else:
                            orig, packed = compress_file(path)
                            rep["compress"]["count"] += 1
                            rep["compress"]["bytes"] += orig
                            rep["compress"]["saved"] += max(0, orig - packed)
                except Exception as exc:  # noqa: BLE001 - one bad file must not stop the sweep
                    log.exception("retention: failed on %s", path)
                    if len(rep["errors"]) < 20:
                        rep["errors"].append(f"{os.path.basename(path)}: {exc}")

    rep["finished_at"] = time.time()
    return rep


# ═════════════════════════════════════════════════════════════════════════════
# Storage statistics
# ═════════════════════════════════════════════════════════════════════════════

def storage_stats(data_dir: str) -> dict:
    """Counts and sizes of active vs archived files (for the settings overview)."""
    def bucket() -> dict:
        return {"active": {"count": 0, "bytes": 0},
                "archived": {"count": 0, "bytes": 0, "original_bytes": 0}}

    out = {"snapshots": bucket(), "pcap": bucket()}
    for device_dir in _device_dirs(data_dir):
        for path, kind in _groups(device_dir, (SNAPSHOT_EXT, PCAP_EXT)):
            b = out["snapshots" if kind == "snapshot" else "pcap"]
            zpath = zip_path(path)
            try:
                if os.path.exists(zpath):          # zip is the source of truth
                    b["archived"]["count"] += 1
                    b["archived"]["bytes"] += os.path.getsize(zpath)
                    b["archived"]["original_bytes"] += archived_size(path)
                elif os.path.exists(path):
                    b["active"]["count"] += 1
                    b["active"]["bytes"] += os.path.getsize(path)
            except OSError:
                continue
    return out


# ═════════════════════════════════════════════════════════════════════════════
# Background scheduler
# ═════════════════════════════════════════════════════════════════════════════

class RetentionScheduler:
    """Runs :func:`run_sweep` periodically and on demand, one sweep at a time."""

    def __init__(self, data_dir: str, get_policy: Callable[[], RetentionPolicy],
                 forget_snapshot: Optional[Callable[[str], None]] = None,
                 interval_s: int = 3600, first_delay_s: int = 60):
        self.data_dir = str(data_dir)
        self.get_policy = get_policy
        self.forget_snapshot = forget_snapshot
        self.interval_s = interval_s
        self.first_delay_s = first_delay_s
        self.last_report: Optional[dict] = None
        self._current: Optional[dict] = None
        self._running = threading.Lock()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._lock_fd = None

    # -- lifecycle ---------------------------------------------------------
    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._loop, name="retention-sweeper", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        if self._stop.wait(self.first_delay_s):
            return
        while True:
            try:
                policy = self.get_policy()
                if policy.enabled:
                    self.sweep(policy)
            except Exception:  # noqa: BLE001
                log.exception("retention sweep crashed")
            if self._stop.wait(self.interval_s):
                return

    # -- sweeping ----------------------------------------------------------
    def _acquire_process_lock(self) -> bool:
        """Cross-process guard so several server workers don't sweep simultaneously."""
        if fcntl is None:
            return True
        name = hashlib.md5(os.path.abspath(self.data_dir).encode()).hexdigest()[:12]
        fd = open(os.path.join(tempfile.gettempdir(), f"logoctopus-retention-{name}.lock"), "w")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            fd.close()
            return False
        self._lock_fd = fd
        return True

    def _release_process_lock(self) -> None:
        if self._lock_fd:
            try:
                fcntl.flock(self._lock_fd, fcntl.LOCK_UN)
            finally:
                self._lock_fd.close()
                self._lock_fd = None

    def sweep(self, policy: RetentionPolicy) -> Optional[dict]:
        """Run one real sweep.  Returns None if another sweep is already running."""
        if not self._running.acquire(blocking=False):
            return None
        try:
            if not self._acquire_process_lock():
                return None
            try:
                self._current = _new_report(False)
                rep = run_sweep(self.data_dir, policy, forget_snapshot=self.forget_snapshot,
                                report=self._current)
                self.last_report = rep
                log.info("retention sweep: zipped %d, deleted %d, released %d, %d errors",
                         rep["compress"]["count"], rep["delete"]["count"],
                         rep["release"]["count"], len(rep["errors"]))
                return rep
            finally:
                self._current = None
                self._release_process_lock()
        finally:
            self._running.release()

    def trigger(self, policy: RetentionPolicy) -> bool:
        """Start a sweep in the background ("Run now").  False if one is already running."""
        if self._running.locked():
            return False
        threading.Thread(target=self.sweep, args=(policy,), name="retention-manual",
                         daemon=True).start()
        return True

    def status(self) -> dict:
        cur = self._current
        return {
            "running": self._running.locked(),
            "progress": dict(cur) if cur else None,
            "last_run": self.last_report,
            "sweep_interval_minutes": max(1, self.interval_s // 60),
            "restored_copy_minutes": RESTORED_TTL_S // 60,
        }
