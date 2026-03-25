"""
scrape_and_push.py — Run the scraper locally then push only the titles to the server.

Usage:
    python scrape_and_push.py                        # scrape 6 key regions (fast, ~60-90 min)
    python scrape_and_push.py --all-regions          # scrape all 30 regions (~6 hrs)
    python scrape_and_push.py --mode trending        # trending only
    python scrape_and_push.py --regions US GB PT     # specific regions
    python scrape_and_push.py --push-only            # skip scrape, just push existing local DB

The local scrape writes to stream_intel_local.db (kept separate from your dev DB).
After the scrape, the file is posted to /api/push-titles on the server, which merges
the titles into production WITHOUT touching any user data (watchlists, etc.).
"""

import argparse
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

BASE = os.getenv("SERVER_URL", "https://stream-intel.up.railway.app")
SECRET = os.getenv("MIGRATION_SECRET", "boaspessoal213")
LOCAL_DB = Path(__file__).parent / "stream_intel_local.db"

# Curated short list: covers major English, Portuguese, and European libraries.
# Cuts runtime from ~6 hours (30 regions) to ~60-90 minutes.
# Use --all-regions to run the full 30-region set.
FAST_REGIONS = ["US", "GB", "PT", "BR", "DE", "FR"]


def run_scrape(mode: str, regions: list[str]) -> None:
    # runner.py calls load_dotenv() at import time, which would restore
    # SCRAPER_PROXY_URL from .env even if we popped it.  Set it to "" first
    # (load_dotenv won't override an already-set var), then patch the module
    # attribute directly to be sure.
    os.environ["SCRAPER_PROXY_URL"] = ""

    import backend.scraper.runner as _runner

    _runner.PROXY_URL = None  # force no proxy — use local residential IP

    print(
        f"\n[local] Scraping mode={mode} regions={regions or 'ALL'} (no proxy — local IP)"
    )
    target_regions = regions if regions else _runner.DEFAULT_REGIONS
    _runner.run_scrape(mode=mode, regions=target_regions, db_path=LOCAL_DB)
    print(f"\n[local] Done. Results in {LOCAL_DB}")


def push_db() -> None:
    if not LOCAL_DB.exists():
        print(
            f"[push] ERROR: {LOCAL_DB} not found — run a scrape first.", file=sys.stderr
        )
        sys.exit(1)

    size_mb = LOCAL_DB.stat().st_size / 1_048_576
    print(f"\n[push] Uploading {LOCAL_DB.name} ({size_mb:.1f} MB) to {BASE} …")

    with open(LOCAL_DB, "rb") as fh:
        resp = requests.post(
            f"{BASE}/api/push-titles",
            files={"db": fh},
            headers={"X-Migration-Secret": SECRET},
            timeout=300,
        )

    if resp.ok:
        data = resp.json()
        print(f"[push] ✓ {data['titles_merged']:,} titles merged into production DB.")
    else:
        print(f"[push] FAILED  {resp.status_code}: {resp.text}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Scrape locally and push titles to Railway"
    )
    parser.add_argument("--mode", choices=["trending", "catalog", "all"], default="all")
    parser.add_argument(
        "--regions", nargs="+", default=None, help="ISO codes (overrides default list)"
    )
    parser.add_argument(
        "--all-regions",
        action="store_true",
        help="Scrape all 30 regions instead of the default 6 (~6 hrs)",
    )
    parser.add_argument(
        "--push-only", action="store_true", help="Skip scrape, just push existing DB"
    )
    args = parser.parse_args()

    if not args.push_only:
        if args.regions:
            regions = args.regions
        elif args.all_regions:
            regions = []  # run_scrape will use DEFAULT_REGIONS (all 30)
        else:
            regions = FAST_REGIONS
        run_scrape(args.mode, regions)

    push_db()
