#!/usr/bin/env python3
"""
One-time migration: backfill the listing-metadata fields (start_time,
finish_time, logs_collection_duration, size_in_bytes) into existing snapshot
parquet files.

Why this is needed
-------------------
The fast metadata-only listing path (LogSnapshotMeta.from_parquet_footer)
reads these fields straight out of the parquet file's footer, so listing and
filtering never have to load a snapshot's actual row data. Snapshots written
before this change don't have those fields in their footer, so the app falls
back to a full read for each of them - correct, but slow, and it stays slow
forever for files that are never rewritten. This script rewrites every
existing snapshot file once, up front, so production gets the fast path
immediately after deploy instead of "eventually, as files happen to be
touched" (which for a listing-only endpoint may be never).

What it does
------------
For every "*.parquet" file under <data-dir>/<device_id>/:
  1. Reads the file's current footer metadata. If it already has all four
     new fields, it's left untouched (safe to re-run / resume).
  2. Otherwise reads the full table, computes start_time, finish_time,
     logs_collection_duration and size_in_bytes exactly the way LogSnapshot
     does, and writes them into the footer alongside the existing metadata.
  3. Writes the result to a temp file in the same directory and atomically
     renames it over the original. On POSIX filesystems this is safe to run
     against a live server: a reader with the file already open keeps
     reading the old inode's bytes uninterrupted; anyone who opens the path
     after the rename gets the fully-migrated file. Nothing is ever read
     from or written into the original path in a partial state.

This script deliberately does NOT import the Flask app, Device, or
DeviceConfigLoader - only pyarrow/pandas - so running it can't trigger any
watchdog-process side effects.

Usage
-----
    python3 migrate_snapshot_metadata.py                  # migrate ./data
    python3 migrate_snapshot_metadata.py --data-dir /srv/logoctopus/data
    python3 migrate_snapshot_metadata.py --dry-run         # report only
    python3 migrate_snapshot_metadata.py --workers 8       # parallelize
"""
import argparse
import logging
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

REQUIRED_KEYS = {"start_time", "finish_time", "logs_collection_duration", "size_in_bytes"}


class MigrationSkipped(Exception):
    """Raised internally when a file already has all the required fields."""


def _compute_listing_fields(collected_data: pd.DataFrame) -> dict:
    """
    Compute the same start_time/finish_time/duration/size fields that
    LogSnapshot.__init__ computes for a freshly-created snapshot, so a
    migrated file is indistinguishable from one written by the current code.
    """
    if collected_data.empty:
        # Mirrors calcaute_logs_collection_duration's own empty guard.
        # get_start_and_finish_timestamps has no such guard upstream (it
        # would raise on .iloc[0] of an empty series), so an all-empty
        # snapshot is a pre-existing edge case; record it as unknown rather
        # than crash the migration over one odd file.
        start_time = ""
        finish_time = ""
        duration = 0.0
    else:
        start_time = pd.to_datetime(collected_data["time"].iloc[0])
        finish_time = pd.to_datetime(collected_data["time"].iloc[-1])
        duration = (finish_time - start_time).total_seconds()
        start_time, finish_time = str(start_time), str(finish_time)

    size_in_bytes = int(collected_data.memory_usage(deep=True).sum())

    return {
        "start_time": start_time,
        "finish_time": finish_time,
        "logs_collection_duration": str(duration),
        "size_in_bytes": str(size_in_bytes),
    }


def migrate_file(path: Path, dry_run: bool) -> str:
    """
    Migrate a single parquet file in place.

    Returns:
        str: One of "migrated", "skipped" (already had the fields), or
        "would_migrate" (dry-run mode).

    Raises:
        Exception: Any error reading/writing the file, so the caller can
        report it against this specific path without aborting the run.
    """
    table = pq.read_table(path)
    raw_meta = table.schema.metadata or {}
    existing = {k.decode(): v.decode() for k, v in raw_meta.items()}

    if REQUIRED_KEYS.issubset(existing.keys()):
        return "skipped"

    if dry_run:
        return "would_migrate"

    new_fields = _compute_listing_fields(table.to_pandas())
    merged = {**existing, **new_fields}
    new_table = table.replace_schema_metadata({k.encode(): v.encode() for k, v in merged.items()})

    tmp_path = path.with_name(path.name + ".migrating.tmp")
    pq.write_table(new_table, tmp_path)
    os.replace(tmp_path, path)  # atomic on POSIX
    return "migrated"


def find_snapshot_files(data_dir: Path):
    return sorted(data_dir.glob("*/*.parquet"))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", default="data", help="Path to the data directory (default: ./data)")
    parser.add_argument("--dry-run", action="store_true", help="Report what would change without writing anything")
    parser.add_argument("--workers", type=int, default=4, help="Parallel workers (default: 4)")
    parser.add_argument("-v", "--verbose", action="store_true", help="Log every file, not just errors and the summary")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING, format="%(message)s")

    data_dir = Path(args.data_dir)
    if not data_dir.is_dir():
        print(f"error: data dir '{data_dir}' does not exist", file=sys.stderr)
        return 1

    files = find_snapshot_files(data_dir)
    if not files:
        print(f"No .parquet files found under {data_dir}")
        return 0

    verb = "Would migrate" if args.dry_run else "Migrating"
    print(f"{verb} snapshots under {data_dir} ({len(files)} file(s) found, {args.workers} worker(s))...")

    counts = {"migrated": 0, "would_migrate": 0, "skipped": 0, "error": 0}
    errors = []

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        future_to_path = {pool.submit(migrate_file, path, args.dry_run): path for path in files}
        for future in as_completed(future_to_path):
            path = future_to_path[future]
            try:
                result = future.result()
                counts[result] += 1
                logging.info("%s: %s", result, path)
            except Exception as exc:
                counts["error"] += 1
                errors.append((path, exc))
                logging.warning("error: %s (%s)", path, exc)

    print()
    print("Done.")
    if args.dry_run:
        print(f"  {counts['would_migrate']} file(s) would be migrated")
        print(f"  {counts['skipped']} file(s) already migrated")
    else:
        print(f"  {counts['migrated']} file(s) migrated")
        print(f"  {counts['skipped']} file(s) already migrated (untouched)")
    if counts["error"]:
        print(f"  {counts['error']} file(s) FAILED:")
        for path, exc in errors:
            print(f"    {path}: {exc}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())

# python3 migrate_snapshot_metadata.py --data-dir /path/to/data --dry-run   # preview first
# python3 migrate_snapshot_metadata.py --data-dir /path/to/data            # then run for real
