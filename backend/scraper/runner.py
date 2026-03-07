# backend/scraper/runner.py
"""
Scrape orchestrator — loops over platforms and regions, calls the JustWatch
client, runs enrichment, and writes results to SQLite.

Can be called in two ways:
  1. From the Flask admin route (/api/run/<mode>/<regions>) as a subprocess.
  2. Directly from the command line for manual / scheduled runs.

CLI usage:
    python -m backend.scraper.runner --mode trending
    python -m backend.scraper.runner --mode catalog --regions US GB PT
    python -m backend.scraper.runner --mode all
    python -m backend.scraper.runner --mode trending --db /path/to/stream_intel.db
"""

import argparse
import logging
import os
import random
import sqlite3
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional

import requests
from dotenv import load_dotenv
from tqdm import tqdm

# Load .env immediately — critical when run as subprocess (Flask won't have loaded it)
_root = Path(__file__).parent.parent.parent
load_dotenv(_root / ".env")

from backend.scraper.justwatch import (
    PLATFORMS_ENABLED,
    PLATFORM_KEYWORDS,
    PLATFORM_PACKAGE_IDS,
    SORTABLE_BY,
    fetch_page,
    get_page_info,
    make_session,
    parse_titles,
    get_ua,
    warm_session,
)
from backend.scraper.enricher import enrich_with_imdb, enrich_from_db

# ── Logging ───────────────────────────────────────────────────────────────────

# Write logs to stdout with UTF-8 encoding so the Flask SSE stream can forward
# them to the browser correctly on all platforms.
_handler = logging.StreamHandler(sys.stdout)
try:
    _handler.stream = open(sys.stdout.fileno(), mode="w", encoding="utf-8", buffering=1)
except Exception:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[_handler],
)
log = logging.getLogger("Scraper")

# ── Default config (can be overridden via CLI args) ───────────────────────────

DEFAULT_REGIONS = [
    "US",
    "GB",
    "BR",
    "MX",
    "CA",
    "AU",
    "DE",
    "FR",
    "ES",
    "IT",
    "JP",
    "KR",
    "IN",
    "AR",
    "CO",
    "CL",
    "PL",
    "NL",
    "SE",
    "NO",
    "DK",
    "FI",
    "PT",
    "ZA",
    "SG",
    "TH",
    "ID",
    "PH",
    "TR",
    "SA",
]

MIN_DELAY = 0.8  # seconds between requests
# When True, scrape POPULAR + ALPHABETICAL sort orders per platform/type/region
# to maximise title coverage.  Overridable via --multi-sort CLI flag.
MULTI_SORT = False

# Proxy URL for requests (optional).  Set SCRAPER_PROXY_URL env var to route
# scraper traffic through a residential proxy and bypass IP-level Cloudflare
# blocks.  Supported schemes: http://, https://, socks5://
# Example: SCRAPER_PROXY_URL=http://user:pass@proxy.provider.com:port
PROXY_URL: Optional[str] = os.getenv("SCRAPER_PROXY_URL") or None
MAX_DELAY = 2.5
MIN_IMDB_VOTES = 1_000  # titles with fewer votes are filtered out (0 = disabled)

# ── Database write ────────────────────────────────────────────────────────────


def save_to_db(records: list[dict], run_id: Optional[int], db_path: Path) -> int:
    """
    Filter records by MIN_IMDB_VOTES and bulk-insert into the titles table.
    Returns the number of rows actually saved.
    """
    if not records:
        return 0

    if MIN_IMDB_VOTES > 0:
        before = len(records)

        def _passes_vote_filter(t: dict) -> bool:
            votes = t.get("imdb_votes") or 0
            score = t.get("imdb_score") or 0
            if votes >= MIN_IMDB_VOTES:
                return True
            # JustWatch vote counts are often stale/region-specific.
            # If the title has a valid IMDb score but 0 votes, keep it —
            # the enricher will backfill the real vote count from TMDB.
            if votes == 0 and score > 0:
                return True
            return False

        records = [t for t in records if _passes_vote_filter(t)]
        skipped = before - len(records)
        if skipped:
            log.info(
                f"   Filtered {skipped} titles with < {MIN_IMDB_VOTES:,} IMDb votes."
            )

    if not records:
        return 0

    rows = [
        (
            run_id,
            t["scraped_at"],
            t["platform"],
            t["region"],
            t["title"],
            t["content_type"],
            t["genre"],
            t["release_year"],
            t["ranking_position"],
            t["synopsis"],
            t["maturity_rating"],
            1 if t["is_trending"] else 0,
            t["source_url"],
            t["imdb_score"],
            t["imdb_votes"],
            t["tomatometer"],
            t["tmdb_score"],
            t.get("runtime_mins") or 0,
            t.get("end_year") or None,
            t.get("is_ongoing"),
        )
        for t in records
    ]

    with sqlite3.connect(str(db_path)) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executemany(
            """INSERT OR REPLACE INTO titles
               (run_id, scraped_at, platform, region, title, content_type, genre,
                release_year, ranking_position, synopsis, maturity_rating, is_trending,
                source_url, imdb_score, imdb_votes, tomatometer, tmdb_score,
                runtime_mins, end_year, is_ongoing)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            rows,
        )
        conn.commit()

    log.info(f"   Saved {len(rows)} records to DB.")
    return len(rows)


# ── Per-region scrape ─────────────────────────────────────────────────────────


def scrape_region(
    region: str,
    session: requests.Session,
    mode: str,
) -> list[dict]:
    """
    Scrape all enabled platforms for a single region.
    Returns a flat list of title dicts (not yet written to DB).
    """
    results = []

    for platform_name in PLATFORM_KEYWORDS:
        if not PLATFORMS_ENABLED.get(platform_name):
            continue

        package_ids = PLATFORM_PACKAGE_IDS[platform_name]

        # Query movies and TV separately — JustWatch caps total results per query,
        # so splitting by content type effectively doubles coverage.
        for object_types, type_label in [(["MOVIE"], "movies"), (["SHOW"], "TV")]:
            # When MULTI_SORT is enabled we also query with ALPHABETICAL order so
            # regional long-tail titles missed by POPULAR ranking are captured.
            sort_strategies = SORTABLE_BY if MULTI_SORT else ["POPULAR"]

            # `seen` is shared across sort strategies so duplicates aren't re-saved.
            seen: set = set()

            for sort_by in sort_strategies:
                cursor = None
                page = 0

                label = f"{platform_name}/{type_label}/{sort_by}"
                log.info(f"   Fetching {label} — {region}")

                retry_wait = 15.0  # seconds to wait after a 403 before retrying
                while True:
                    page += 1
                    try:
                        raw = fetch_page(
                            session=session,
                            country=region,
                            language="en",
                            package_ids=package_ids,
                            after=cursor,
                            object_types=object_types,
                            sort_by=sort_by,
                        )

                        if "errors" in raw:
                            log.warning(
                                f"   GraphQL errors ({label}/{region}): {raw['errors']}"
                            )
                            break

                        retry_wait = 5.0  # reset backoff on success
                        titles = parse_titles(raw, platform_name, region, mode, seen)
                        page_info = get_page_info(raw)
                        results.extend(titles)

                        log.info(
                            f"   {label}/{region} page {page}: "
                            f"{len(titles)} new titles (total {len(seen)})"
                        )
                        time.sleep(random.uniform(MIN_DELAY, MAX_DELAY))

                        if not page_info.get("hasNextPage"):
                            break
                        cursor = page_info.get("endCursor")

                    except Exception as e:
                        err_str = str(e)
                        # 403 / 429: back off and retry once before giving up
                        if ("403" in err_str or "429" in err_str) and retry_wait <= 60:
                            log.warning(
                                f"   {label} page {page} ({region}) rate-limited — "
                                f"retrying in {retry_wait:.0f}s"
                            )
                            time.sleep(retry_wait)
                            retry_wait = min(retry_wait * 2, 60)
                            page -= 1  # retry same page
                            continue
                        log.warning(
                            f"   {label} page {page} failed ({region}): "
                            f"{type(e).__name__}: {e}"
                        )
                        break

        platform_count = sum(1 for r in results if r["platform"] == platform_name)
        log.info(f"   -> {platform_name}/{region}: {platform_count} titles total")

    return results


# ── Main orchestrator ─────────────────────────────────────────────────────────


def run_scrape(
    mode: str,
    regions: list[str],
    db_path: Path,
    run_id: Optional[int] = None,
) -> int:
    """
    Main entry point. Called both by the CLI and by the Flask admin route.

    Args:
        mode:    "trending", "catalog", or "all"
                 (all = catalog for every region + trending flags)
        regions: List of ISO country codes to scrape.
        db_path: Path to the SQLite database file.
        run_id:  ID of the scrape_runs row (set by the Flask route before
                 launching this as a subprocess; None for CLI runs).

    Returns:
        Total number of title rows saved.
    """
    log.info("=" * 60)
    log.info(f"  Mode: {mode.upper()} | Regions: {len(regions)} | DB: {db_path}")
    log.info("=" * 60)

    # Each worker thread gets its own requests.Session to avoid sharing state.
    # Without a proxy, parallel requests from a shared IP (e.g. Railway) will
    # quickly trigger JustWatch's rate-limiter.  Default to 1 worker so regions
    # run sequentially; bump to 4 when a residential proxy is configured.
    # 2 parallel workers with proxy: enough speed while keeping the proxy IP's
    # request rate at a level JustWatch tolerates.  Workers are also staggered
    # (12 s each) so they don't all fire their very-first request simultaneously.
    MAX_WORKERS = min(2 if PROXY_URL else 1, len(regions))
    if not PROXY_URL and len(regions) > 1:
        log.warning(
            "No SCRAPER_PROXY_URL set — running sequentially (1 worker) to "
            "avoid JustWatch rate-limits. Set SCRAPER_PROXY_URL for faster scraping."
        )
    total = 0

    _start_lock = threading.Lock()
    _start_index = [0]  # mutable container so the closure can increment it
    WORKER_STAGGER = 12  # seconds between each worker's first request

    def _scrape_one(region: str) -> int:
        with _start_lock:
            idx = _start_index[0]
            _start_index[0] += 1
        if idx > 0 and PROXY_URL:
            stagger = idx * WORKER_STAGGER
            log.info(
                f"   [{region}] Staggering start by {stagger}s to avoid simultaneous proxy hits"
            )
            time.sleep(stagger)
        session = make_session(proxy=PROXY_URL)
        warm_session(session)
        if PROXY_URL:
            log.info(f"   [{region}] Using proxy: {PROXY_URL.split('@')[-1]}")
        try:
            log.info(f"\n--- {region} ---")
            records = scrape_region(region, session, mode)
            records = enrich_with_imdb(records)
            # TMDB enrichment runs once after all regions to avoid rate-limit bursts
            saved = save_to_db(records, run_id, db_path)
            log.info(f"   {region}: {saved} records saved.")
            return saved
        except Exception as e:
            log.warning(f"   {region}: scrape failed — {e}")
            return 0
        finally:
            session.close()

    try:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futures = {pool.submit(_scrape_one, r): r for r in regions}
            for future in tqdm(
                as_completed(futures),
                total=len(futures),
                desc=f"[{mode}]",
                unit="region",
            ):
                region = futures[future]
                try:
                    total += future.result()
                except Exception as e:
                    log.warning(f"   {region}: unexpected error — {e}")

    except KeyboardInterrupt:
        log.warning("Interrupted — partial results already saved to DB.")

    # ── Post-scrape TMDB enrichment ──────────────────────────────────────────
    # Runs once against unique titles in the DB so the same show isn't enriched
    # 30 times (once per region), and so rate limits are properly respected.
    tmdb_key = os.getenv("TMDB_API_KEY")
    if tmdb_key:
        log.info("\n[Enricher] Running post-scrape TMDB enrichment…")
        enrich_from_db(db_path, api_key=tmdb_key)
    else:
        log.warning("[Enricher] Skipped — no API key available.")

    log.info(f"\nFinished. Total: {total} titles across {len(regions)} regions.")
    return total


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="StreamIntel Scraper")
    parser.add_argument(
        "--mode",
        choices=["trending", "catalog", "all"],
        default="trending",
        help="trending = chart rankings only; catalog = full library; all = both",
    )
    parser.add_argument(
        "--regions",
        nargs="+",
        default=None,
        help="ISO country codes to scrape (default: all 30 supported regions)",
    )
    parser.add_argument(
        "--db",
        default=None,
        help="Path to stream_intel.db (default: project root)",
    )
    parser.add_argument(
        "--min-votes",
        type=int,
        default=None,
        help=f"Minimum IMDb vote count to save a title (default: {MIN_IMDB_VOTES:,})",
    )
    parser.add_argument(
        "--multi-sort",
        action="store_true",
        default=False,
        help=(
            "Fetch with POPULAR + ALPHABETICAL sort orders to maximise title "
            "coverage per region. Takes ~2× longer but captures regional "
            "long-tail titles that POPULAR ranking misses."
        ),
    )
    parser.add_argument(
        "--proxy-url",
        default=None,
        help=(
            "HTTP/HTTPS/SOCKS5 proxy URL to route scraper traffic through, e.g. "
            "http://user:pass@host:port or socks5://user:pass@host:port. "
            "Use a residential proxy to bypass Cloudflare IP blocks. "
            "Overrides SCRAPER_PROXY_URL env var."
        ),
    )
    args = parser.parse_args()

    # Resolve paths and override defaults from CLI flags
    _base = Path(__file__).parent.parent.parent  # project root
    db_path = Path(args.db) if args.db else _base / "stream_intel.db"
    regions = [r.upper() for r in args.regions] if args.regions else DEFAULT_REGIONS
    run_id = int(os.environ["SI_RUN_ID"]) if os.environ.get("SI_RUN_ID") else None

    if args.min_votes is not None:
        MIN_IMDB_VOTES = args.min_votes
    if args.multi_sort:
        MULTI_SORT = True
    if args.proxy_url:
        PROXY_URL = args.proxy_url

    run_scrape(mode=args.mode, regions=regions, db_path=db_path, run_id=run_id)
