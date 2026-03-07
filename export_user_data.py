"""
export_user_data.py
-------------------
Exports only the user-data tables from stream_intel_migrated.db into a compact
standalone stream_intel_users.db that can be safely uploaded to Railway without
the 38 MB catalog data that re-populates itself via auto-scrape.

Run from the project root:
    python export_user_data.py
"""

import shutil
import sqlite3
from pathlib import Path

SRC = Path(__file__).parent / "stream_intel_migrated.db"
OUT = Path(__file__).parent / "stream_intel_users.db"

# These are the tables whose rows we want to keep.
# Everything else (titles, poster_cache, tmdb_show_cache, …) will be empty
# and re-populated by the scraper / normal app usage.
USER_DATA_TABLES = [
    "users",
    "tokens",
    "library",
    "watched_seasons",
    "user_stats",
    "friendships",
    "notifications",
    "push_subscriptions",
]

if not SRC.exists():
    raise SystemExit(f"Source not found: {SRC}")

if OUT.exists():
    OUT.unlink()

# The easiest approach: copy the whole file then DELETE the bulk tables.
print(f"Copying {SRC.name} → {OUT.name} …")
shutil.copy2(SRC, OUT)

with sqlite3.connect(str(OUT)) as con:
    con.execute("PRAGMA journal_mode=DELETE")  # switch off WAL before cleanup

    # Get the full list of tables present
    all_tables = [
        r[0]
        for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    ]

    # Delete bulk data from tables we don't need
    for t in all_tables:
        if t.startswith("sqlite_"):
            continue
        if t not in USER_DATA_TABLES:
            con.execute(f"DELETE FROM [{t}]")
            print(f"  Cleared {t}")

    con.commit()
    con.execute("VACUUM")  # reclaim freed pages → tiny file

size_MB = OUT.stat().st_size / 1_048_576
print(f"\nDone.  {OUT.name} = {size_MB:.2f} MB")
print()
print(
    "Next step: run   python teste123.py   (after updating DB_FILE path to stream_intel_users.db)"
)
