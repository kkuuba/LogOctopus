#!/usr/bin/env python
"""
One-time (or as-needed) backfill: index every existing snapshot parquet
file under data/ into the SQLite snapshot index.

Run this once after deploying the index (to catch up on your existing
~20k snapshots) from the project root:

    python -m scripts.reindex_snapshots

It's safe to re-run any time - e.g. if you ever delete data/snapshot_index.db
by mistake, or bulk-copy snapshot files in from a backup outside the normal
create/delete code paths. New snapshots created or deleted through the app
after this point keep the index up to date automatically and don't need
re-indexing.
"""

import sys
import time

from backend.utils import snapshot_index


def main() -> int:
    start = time.monotonic()
    print(f"Indexing snapshots from data/ into {snapshot_index.DB_PATH} ...")

    indexed = snapshot_index.rebuild("data")
    total   = snapshot_index.count_all()
    elapsed = time.monotonic() - start

    print(f"Indexed {indexed} snapshot(s) in {elapsed:.1f}s.")
    print(f"Index now contains {total} snapshot(s) total.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
