# backend/scraper/enricher.py
"""
Post-scrape enrichment helpers.
"""

import logging
import os
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional

import requests

log = logging.getLogger("Scraper.Enricher")

TMDB_BASE = "https://api.themoviedb.org/3"
ONGOING_STATUSES = {"Returning Series", "In Production", "Planned", "Pilot"}


def enrich_with_imdb(titles: list[dict]) -> list[dict]:
    """No-op — JustWatch already provides imdb_score and imdb_votes."""
    return titles


def _tmdb_get(path: str, api_key: str, **params) -> dict:
    params["api_key"] = api_key
    params.setdefault("language", "en-US")
    try:
        r = requests.get(f"{TMDB_BASE}{path}", params=params, timeout=8)
        r.raise_for_status()
        return r.json()
    except Exception:
        return {}


def _enrich_one(t: dict, api_key: str) -> None:
    """Fetch TMDB data for a single title and annotate it in-place."""
    is_tv = t.get("content_type") == "tv"
    media = "tv" if is_tv else "movie"
    # Search with year for precision; fall back without year if no results
    extra = {"year": t["release_year"]} if t.get("release_year") else {}
    sr = _tmdb_get(f"/search/{media}", api_key, query=t["title"], **extra)
    results = sr.get("results", [])
    if not results and extra:
        sr = _tmdb_get(f"/search/{media}", api_key, query=t["title"])
        results = sr.get("results", [])
    if not results:
        return
    tmdb_id = results[0]["id"]
    # Details
    det = _tmdb_get(f"/{media}/{tmdb_id}", api_key)
    if not det:
        return
    if is_tv:
        status = det.get("status", "")
        if status in ONGOING_STATUSES:
            t["is_ongoing"] = 1
        elif status:
            t["is_ongoing"] = 0
            last = det.get("last_air_date") or ""
            if last:
                t["end_year"] = last[:4]
        runtime = (
            (det.get("episode_run_time") or [None])[0]
            or (det.get("last_episode_to_air") or {}).get("runtime")
            or (det.get("next_episode_to_air") or {}).get("runtime")
        )
        num_seasons = det.get("number_of_seasons")
        if num_seasons is not None:
            # Use last_episode_to_air.season_number — this is the most reliable
            # indicator: it's the last season that has at least one aired episode,
            # so future/announced-only seasons are never counted.
            last_aired = (det.get("last_episode_to_air") or {}).get("season_number")
            if last_aired:
                t["num_seasons"] = int(last_aired)
            else:
                # Fallback: count seasons with a past air_date (ignores Season 0)
                from datetime import date
                today = date.today().isoformat()
                aired = [
                    s for s in det.get("seasons", [])
                    if s.get("season_number", 0) > 0
                    and s.get("air_date")
                    and s["air_date"] <= today
                ]
                t["num_seasons"] = len(aired) if aired else int(num_seasons)
    else:
        runtime = det.get("runtime")
    if runtime and not t.get("runtime_mins"):
        t["runtime_mins"] = int(runtime)


def enrich_from_db(db_path: Path, api_key: Optional[str] = None) -> None:
    """
    Post-scrape TMDB enrichment operating directly on the DB.
    """
    api_key = api_key or os.getenv("TMDB_API_KEY")
    if not api_key:
        log.debug("TMDB enrichment skipped — no TMDB_API_KEY set.")
        return

    with sqlite3.connect(str(db_path)) as conn:
        conn.row_factory = sqlite3.Row
        from backend.database import ensure_schema

        ensure_schema(conn)
        rows = conn.execute(
            """SELECT DISTINCT title, content_type, release_year
               FROM titles
               WHERE runtime_mins = 0
                  OR content_type = 'tv'"""
        ).fetchall()

    if not rows:
        log.info("[Enricher] All titles already enriched.")
        return

    titles = [dict(r) for r in rows]
    log.info(f"[Enricher] TMDB enrichment for {len(titles)} unique titles…")

    done = 0
    lock = threading.Lock()

    def _worker(t: dict) -> None:
        nonlocal done
        _enrich_one(t, api_key)
        time.sleep(
            0.1
        )  # 15 workers × 2 reqs / ~0.3 s cycle ≈ 100 req/s, under TMDB's 50 req/s per IP
        with lock:
            done += 1
            if done % 100 == 0:
                log.info(f"[Enricher] {done}/{len(titles)} enriched")

    with ThreadPoolExecutor(max_workers=15) as pool:
        futures = [pool.submit(_worker, t) for t in titles]
        for f in as_completed(futures):
            try:
                f.result()
            except Exception as e:
                log.warning(f"[Enricher] Worker error: {e}")

    log.info(f"[Enricher] {done}/{len(titles)} enriched — writing to DB…")

    with sqlite3.connect(str(db_path)) as conn:
        for t in titles:
            runtime = t.get("runtime_mins") or 0
            end_year = t.get("end_year") or None
            is_ongoing = t.get("is_ongoing")
            num_seasons = t.get("num_seasons")
            if not (runtime or end_year or is_ongoing is not None or num_seasons is not None):
                continue  # TMDB lookup failed or returned nothing, skip
            conn.execute(
                """UPDATE titles SET
                   runtime_mins = CASE WHEN runtime_mins = 0       AND ? > 0         THEN ? ELSE runtime_mins END,
                   end_year     = CASE WHEN end_year IS NULL        AND ? IS NOT NULL  THEN ? ELSE end_year END,
                   is_ongoing   = CASE WHEN is_ongoing IS NULL      AND ? IS NOT NULL  THEN ? ELSE is_ongoing END,
                   num_seasons  = CASE WHEN ? IS NOT NULL  THEN ? ELSE num_seasons END
                   WHERE title = ? AND content_type = ?""",
                (
                    runtime,
                    runtime,
                    end_year,
                    end_year,
                    is_ongoing,
                    is_ongoing,
                    num_seasons,
                    num_seasons,
                    t["title"],
                    t["content_type"],
                ),
            )
        conn.commit()

    log.info("[Enricher] DB enrichment complete.")


def enrich_with_tmdb(
    titles: list[dict],
    api_key: Optional[str] = None,
) -> list[dict]:
    """
    Legacy no-op — enrichment is now done post-scrape via enrich_from_db().
    Kept so existing call sites don't break.
    """
    return titles
