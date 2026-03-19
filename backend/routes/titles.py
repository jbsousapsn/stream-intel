# backend/routes/titles.py
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from hashlib import md5
import requests as _requests
from flask import Blueprint, g, jsonify, make_response, request
from backend.auth import require_auth
from backend.database import get_db

bp = Blueprint("titles", __name__, url_prefix="/api")


# ── /api/geoip ────────────────────────────────────────────────────────────────


@bp.route("/geoip")
def geoip():
    """Return the ISO country code for the requesting IP.  No auth needed."""
    # Respect reverse-proxy headers (Railway, nginx, etc.)
    ip = (
        request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or request.headers.get("X-Real-IP", "").strip()
        or request.remote_addr
        or ""
    )
    # Skip IP lookup for loopback / private addresses (local dev)
    _private = (
        "127.",
        "::1",
        "10.",
        "192.168.",
        "172.16.",
        "172.17.",
        "172.18.",
        "172.19.",
        "172.20.",
        "172.21.",
        "172.22.",
        "172.23.",
        "172.24.",
        "172.25.",
        "172.26.",
        "172.27.",
        "172.28.",
        "172.29.",
        "172.30.",
        "172.31.",
    )
    is_private = any(ip.startswith(p) for p in _private)
    if not is_private:
        try:
            r = _requests.get(
                f"https://ipapi.co/{ip}/country/",
                headers={"User-Agent": "StreamIntelApp/1.0"},
                timeout=3,
            )
            code = r.text.strip().upper()
            if len(code) == 2 and code.isalpha():
                return jsonify({"country": code})
        except Exception:
            pass
    # For private/local IPs: do NOT fall back to Accept-Language — browser language
    # is not the same as the user's country (an English browser in Portugal gives en-GB).
    # Return empty so the frontend uses its localStorage preference or DB first-entry.
    return jsonify({"country": ""})


# ── /api/regions ──────────────────────────────────────────────────────────────


@bp.route("/regions")
@require_auth
def get_regions():
    """Return all distinct region codes present in the titles table."""
    db = get_db()
    rows = db.execute("SELECT DISTINCT region FROM titles ORDER BY region").fetchall()
    return jsonify({"regions": [r[0] for r in rows]})


@bp.route("/titles")
@require_auth
def get_titles():
    db = get_db()
    args = request.args
    uid = g.current_user["user_id"]

    # Build WHERE clause dynamically
    conditions, params = [], []
    region_filter = None
    if args.get("platform") and args["platform"] != "all":
        conditions.append("t.platform=?")
        params.append(args["platform"])
    if args.get("region") and args["region"] != "all":
        region_filter = args["region"].upper()
        conditions.append("t.region=?")
        params.append(region_filter)
    if args.get("type") and args["type"] in ("movie", "tv"):
        conditions.append("t.content_type=?")
        params.append(args["type"])
    if args.get("trending") == "1":
        conditions.append("t.is_trending=1")
    if args.get("search"):
        conditions.append("t.title LIKE ?")
        params.append(f"%{args['search']}%")
    if args.get("genre"):
        genres = [g.strip() for g in args["genre"].split(",") if g.strip()]
        if len(genres) == 1:
            conditions.append("t.genre LIKE ?")
            params.append(f"%{genres[0]}%")
        elif len(genres) > 1:
            genre_or = " OR ".join(["t.genre LIKE ?" for _ in genres])
            conditions.append(f"({genre_or})")
            params.extend([f"%{g}%" for g in genres])

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    RANK_SORT = (
        "CASE WHEN COALESCE(MIN(NULLIF(t.ranking_position,0)),0)=0 "
        "THEN 9999 ELSE MIN(NULLIF(t.ranking_position,0)) END ASC, "
        "MAX(t.imdb_score) DESC"
    )
    sort_map = {
        "rank": RANK_SORT,
        "imdb": "MAX(t.imdb_score) DESC",
        "rt": "MAX(t.tomatometer) DESC",
        "year": "MAX(t.release_year) DESC",
        "title": "t.title ASC",
    }
    order = sort_map.get(args.get("sort", "rank"), sort_map["rank"])
    limit = min(int(args.get("limit", 100)), 50000)
    offset = int(args.get("offset", 0))

    LIB_JOIN = "LEFT JOIN library l ON l.user_id=? AND l.platform=t.platform AND l.title=t.title"

    # ── Unique mode: one card per title+content_type, all platforms aggregated ─
    unique_mode = args.get("unique") == "1"
    if unique_mode:
        UCOLS = """
               COALESCE(ul.platform, tp.prim) AS platform,
               t.title, t.content_type,
               MAX(t.imdb_score)      AS imdb_score,
               MAX(t.imdb_votes)      AS imdb_votes,
               MAX(t.tomatometer)     AS tomatometer,
               MAX(t.tmdb_score)      AS tmdb_score,
               MAX(t.runtime_mins)    AS runtime_mins,
               MAX(t.end_year)        AS end_year,
               MAX(t.is_ongoing)      AS is_ongoing,
               MAX(t.num_seasons)     AS num_seasons,
               MAX(t.synopsis)        AS synopsis,
               MAX(t.release_year)    AS release_year,
               MAX(t.genre)           AS genre,
               MAX(t.maturity_rating) AS maturity_rating,
               MAX(t.source_url)      AS source_url,
               MAX(t.is_trending)     AS is_trending,
               GROUP_CONCAT(DISTINCT t.platform) AS platforms,
               GROUP_CONCAT(DISTINCT t.region)   AS regions,
               (SELECT GROUP_CONCAT(DISTINCT t2.platform || '|' || t2.region)
                FROM titles t2
                WHERE t2.title=t.title AND t2.content_type=t.content_type
               ) AS platform_regions_raw,
               (SELECT GROUP_CONCAT(pu.p || '|' || pu.u)
                FROM (
                    SELECT platform AS p, MAX(source_url) AS u
                    FROM titles
                    WHERE title=t.title AND content_type=t.content_type
                    GROUP BY platform
                ) pu WHERE pu.u IS NOT NULL
               ) AS platform_urls_raw,
               COALESCE(ul.is_fav,  0)            AS is_fav,
               COALESCE(ul.status, 'not-started') AS status,
               ul.notes"""
        best_rank_region_clause = "AND region=?" if region_filter else ""
        best_rank_params = [region_filter] if region_filter else []
        rows = db.execute(
            f"""WITH tp AS (
                    SELECT title, content_type, MIN(platform) AS prim
                    FROM titles GROUP BY title, content_type
                ),
                ul AS (
                    -- Best library row per title for this user, across any platform.
                    -- Priority: finished > watching > watchlist > not-started.
                    -- This ensures getEntry() on the frontend matches regardless of
                    -- which platform the user originally added the title on.
                    SELECT platform, title,
                           is_fav, status, notes,
                           ROW_NUMBER() OVER (
                               PARTITION BY title
                               ORDER BY CASE status
                                   WHEN 'finished'  THEN 4
                                   WHEN 'watching'  THEN 3
                                   WHEN 'watchlist' THEN 2
                                   WHEN 'not-started' THEN 1
                                   ELSE 0 END DESC,
                               is_fav DESC
                           ) AS rn
                    FROM library WHERE user_id=?
                ),
                best_rank AS (
                    SELECT title, content_type, ranking_position,
                           ROW_NUMBER() OVER (
                               PARTITION BY title, content_type
                               ORDER BY ranking_position ASC
                           ) AS rn
                    FROM titles WHERE ranking_position > 0 {best_rank_region_clause}
                )
                SELECT {UCOLS},
                       COALESCE(br.ranking_position, 0) AS ranking_position,
                       NULL AS ranking_region
                FROM titles t
                JOIN tp ON tp.title=t.title AND tp.content_type=t.content_type
                LEFT JOIN (
                    SELECT title, content_type, ranking_position
                    FROM best_rank WHERE rn=1
                ) br ON br.title=t.title AND br.content_type=t.content_type
                LEFT JOIN ul ON ul.title=t.title AND ul.rn=1
                {where}
                GROUP BY t.title, t.content_type
                ORDER BY {order}
                LIMIT ? OFFSET ?""",
            best_rank_params + [uid] + params + [limit, offset],
        ).fetchall()

        result = []
        for row in rows:
            d = dict(row)
            d["is_trending"] = bool(d["is_trending"])
            d["is_fav"] = bool(d["is_fav"])
            result.append(d)

        fetched = len(result)
        if fetched < limit:
            total = fetched + offset
        else:
            total = db.execute(
                f"SELECT COUNT(*) FROM (SELECT 1 FROM titles t {where} GROUP BY t.title, t.content_type)",
                params,
            ).fetchone()[0]

        region_count = len(
            {
                r.strip()
                for d in result
                for r in (d.get("regions") or "").split(",")
                if r.strip()
            }
        )
        return jsonify({"titles": result, "total": total, "region_count": region_count})

    # Shared SELECT columns for region / full-catalog paths
    COLS = """
               t.platform, t.title, t.content_type,
               MAX(t.imdb_score)     AS imdb_score,
               MAX(t.imdb_votes)     AS imdb_votes,
               MAX(t.tomatometer)    AS tomatometer,
               MAX(t.tmdb_score)     AS tmdb_score,
               MAX(t.runtime_mins)   AS runtime_mins,
               MAX(t.end_year)       AS end_year,
               MAX(t.is_ongoing)     AS is_ongoing,
               MAX(t.num_seasons)    AS num_seasons,
               MAX(t.synopsis)       AS synopsis,
               MAX(t.release_year)   AS release_year,
               MAX(t.genre)          AS genre,
               MAX(t.maturity_rating) AS maturity_rating,
               MAX(t.source_url)     AS source_url,
               MAX(t.is_trending)    AS is_trending,
               COALESCE(l.is_fav,  0)            AS is_fav,
               COALESCE(l.status, 'not-started') AS status,
               l.notes"""

    if region_filter:
        # ── Fast path: single region ──────────────────────────────────────────
        # No GROUP_CONCAT, no CTE — ranking is naturally that region's value.
        rows = db.execute(
            f"""SELECT {COLS},
                       t.region AS regions,
                       COALESCE(MIN(NULLIF(t.ranking_position,0)),0) AS ranking_position,
                       CASE WHEN MIN(NULLIF(t.ranking_position,0)) IS NOT NULL
                            THEN ? ELSE NULL END AS ranking_region
                FROM titles t
                {LIB_JOIN}
                {where}
                GROUP BY t.platform, t.title
                ORDER BY {order}
                LIMIT ? OFFSET ?""",
            [region_filter, uid] + params + [limit, offset],
        ).fetchall()
    else:
        # ── Full catalog: CTE replaces 9k correlated subqueries ──────────────
        # ROW_NUMBER picks the one region with the best (lowest) rank per title.
        rows = db.execute(
            f"""WITH best_rank AS (
                    SELECT platform, title,
                           ranking_position,
                           region AS ranking_region,
                           ROW_NUMBER() OVER (
                               PARTITION BY platform, title
                               ORDER BY ranking_position ASC
                           ) AS rn
                    FROM titles WHERE ranking_position > 0
                )
                SELECT {COLS},
                       GROUP_CONCAT(DISTINCT t.region) AS regions,
                       COALESCE(br.ranking_position, 0) AS ranking_position,
                       br.ranking_region
                FROM titles t
                LEFT JOIN (
                    SELECT platform, title, ranking_position, ranking_region
                    FROM best_rank WHERE rn=1
                ) br ON br.platform=t.platform AND br.title=t.title
                {LIB_JOIN}
                {where}
                GROUP BY t.platform, t.title
                ORDER BY {order}
                LIMIT ? OFFSET ?""",
            [uid] + params + [limit, offset],
        ).fetchall()

    result = []
    for row in rows:
        d = dict(row)
        d["is_trending"] = bool(d["is_trending"])
        d["is_fav"] = bool(d["is_fav"])
        result.append(d)

    # Avoid a COUNT(*) round-trip when we clearly have the full set
    fetched = len(result)
    if fetched < limit:
        total = fetched + offset
    else:
        total = db.execute(
            f"SELECT COUNT(*) FROM (SELECT 1 FROM titles t {where} GROUP BY t.platform, t.title)",
            params,
        ).fetchone()[0]

    # region_count: derive from result rows instead of an extra query
    region_count = len(
        {
            r.strip()
            for d in result
            for r in (d.get("regions") or "").split(",")
            if r.strip()
        }
    )

    return jsonify({"titles": result, "total": total, "region_count": region_count})


# ── /api/titles/stats ─────────────────────────────────────────────────────────


@bp.route("/titles/stats")
@require_auth
def title_stats():
    db = get_db()
    uid = g.current_user["user_id"]
    # Single query for totals + lists — eliminates 2 extra round-trips
    meta = db.execute(
        """SELECT COUNT(*) AS total,
                  GROUP_CONCAT(DISTINCT platform ORDER BY platform) AS platforms,
                  GROUP_CONCAT(DISTINCT region   ORDER BY region)   AS regions
           FROM titles"""
    ).fetchone()
    total = meta["total"] or 0
    platforms = [p for p in (meta["platforms"] or "").split(",") if p]
    regions = [r for r in (meta["regions"] or "").split(",") if r]
    stats = db.execute(
        """SELECT SUM(is_fav) as favourites,
                  SUM(status='watching') as watching,
                  SUM(status='finished') as finished
           FROM library WHERE user_id=?""",
        (uid,),
    ).fetchone()
    return jsonify(
        {
            "total": total,
            "platforms": platforms,
            "regions": regions,
            "favourites": int(stats["favourites"] or 0),
            "watching": int(stats["watching"] or 0),
            "finished": int(stats["finished"] or 0),
        }
    )


# ── /api/posters/cache ────────────────────────────────────────────────────────


# Rate-limit poster-cache cleanup: one DELETE per hour instead of per-request
_poster_cache_cleaned_at: float = 0.0


@bp.route("/posters/cache", methods=["GET"])
@require_auth
def get_poster_cache():
    global _poster_cache_cleaned_at
    db = get_db()
    # Purge expired entries at most once per hour — avoids a write on every page load
    now = time.time()
    if now - _poster_cache_cleaned_at > 3600:
        db.execute(
            "DELETE FROM poster_cache WHERE expires_at IS NOT NULL AND expires_at < datetime('now')"
        )
        db.commit()
        _poster_cache_cleaned_at = now

    # Cheap ETag: row count + latest fetched_at — skip full fetch if nothing changed
    meta = db.execute(
        "SELECT COUNT(*) AS n, MAX(fetched_at) AS last FROM poster_cache"
    ).fetchone()
    etag = md5(f"{meta['n']}:{meta['last']}".encode()).hexdigest()[:16]
    if request.headers.get("If-None-Match") == etag:
        return make_response("", 304)

    rows = db.execute(
        "SELECT cache_key, poster_url, backdrop_url FROM poster_cache"
    ).fetchall()
    resp = jsonify(
        {
            "cache": {
                r["cache_key"]: {
                    "poster": r["poster_url"],
                    "backdrop": r["backdrop_url"],
                }
                for r in rows
            }
        }
    )
    resp.headers["ETag"] = etag
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@bp.route("/posters/cache", methods=["POST"])
@require_auth
def save_poster_cache():
    data = request.get_json(silent=True) or []
    if not isinstance(data, list):
        return jsonify({"error": "Expected array"}), 400
    db = get_db()
    db.executemany(
        """INSERT INTO poster_cache (cache_key, poster_url, backdrop_url)
           VALUES (?,?,?) ON CONFLICT(cache_key) DO NOTHING""",
        [
            (r.get("cache_key"), r.get("poster_url"), r.get("backdrop_url"))
            for r in data
            if r.get("cache_key")
        ],
    )
    db.commit()
    return jsonify({"ok": True, "saved": len(data)})


# ── /api/tmdb/* — server-side TMDB proxy ─────────────────────────────────────
# Keeps the API key off the client and centralises rate-limit handling.

TMDB_KEY = os.getenv("TMDB_API_KEY")
TMDB_BASE = "https://api.themoviedb.org/3"
OMDB_KEY = os.getenv("OMDB_API_KEY")
_tmdb_session = _requests.Session()


def _tmdb(path: str, **params) -> dict:
    params.setdefault("api_key", TMDB_KEY)
    params.setdefault("language", "en-US")
    try:
        r = _tmdb_session.get(f"{TMDB_BASE}{path}", params=params, timeout=8)
        r.raise_for_status()
        return r.json()
    except Exception:
        return {}


# ── /api/upcoming ─────────────────────────────────────────────────────────────

ONGOING_STATUSES = {"Returning Series", "In Production", "Planned", "Pilot"}


def _fetch_show(title_key: str, title: str, release_year) -> dict | None:
    """Fetch TMDB data for one show. Returns cache row dict or None."""
    qs = {"query": title, "language": "en-US"}
    if release_year:
        qs["year"] = str(release_year)
    sr = _tmdb("/search/tv", **qs)
    tmdb_id = (sr.get("results") or [{}])[0].get("id")
    if not tmdb_id:
        return None
    det = _tmdb(f"/tv/{tmdb_id}")
    if not det:
        return None
    ongoing = det.get("status", "") in ONGOING_STATUSES
    end_year = None
    if not ongoing and det.get("last_air_date"):
        end_year = det["last_air_date"][:4]
    next_ep = det.get("next_episode_to_air")
    poster = det.get("poster_path")
    poster_thumb = f"https://image.tmdb.org/t/p/w92{poster}" if poster else None

    # Only fetch season data when needed
    season_num = None
    season_json = None
    if ongoing and next_ep and next_ep.get("air_date"):
        season_num = next_ep["season_number"]
        sd = _tmdb(f"/tv/{tmdb_id}/season/{season_num}")
        season_json = json.dumps(sd) if sd else None

    # Top cast for the show (main cast, not per-episode guest stars)
    credits = _tmdb(f"/tv/{tmdb_id}/credits")
    cast_list = [
        {
            "name": m.get("name"),
            "character": m.get("character"),
            "profile_path": m.get("profile_path"),
            "order": m.get("order", 999),
        }
        for m in (credits.get("cast") or [])[:10]
    ]
    cast_json = json.dumps(cast_list) if cast_list else None
    show_overview = det.get("overview") or None

    return {
        "title_key": title_key,
        "tmdb_id": tmdb_id,
        "is_ongoing": int(ongoing),
        "end_year": end_year,
        "next_ep_json": json.dumps(next_ep) if next_ep else None,
        "season_num": season_num,
        "season_json": season_json,
        "poster_thumb": poster_thumb,
        "cast_json": cast_json,
        "show_overview": show_overview,
    }


@bp.route("/upcoming")
@require_auth
def upcoming_episodes():
    db = get_db()
    uid = g.current_user["user_id"]

    # 1. Get all tracked TV shows for this user (INNER JOIN filters out movies)
    rows = db.execute(
        """SELECT DISTINCT l.title, MAX(t.release_year) AS release_year
           FROM library l
           JOIN titles t ON t.title = l.title AND t.content_type = 'tv'
           WHERE l.user_id = ?
             AND (l.is_fav = 1 OR l.status IN ('watching','finished'))
           GROUP BY l.title""",
        (uid,),
    ).fetchall()

    if not rows:
        return jsonify({"episodes": [], "show_data": {}})

    force = request.args.get("force") == "1"

    # 2. Check cache — split into fresh vs stale
    title_keys = [r["title"] for r in rows]
    placeholders = ",".join("?" * len(title_keys))

    if force:
        db.execute(
            f"DELETE FROM tmdb_show_cache WHERE title_key IN ({placeholders})",
            title_keys,
        )
        db.commit()
        cached = {}
    else:
        cached = {
            r["title_key"]: dict(r)
            for r in db.execute(
                f"""SELECT * FROM tmdb_show_cache
                   WHERE title_key IN ({placeholders})
                     AND expires_at > datetime('now')""",
                title_keys,
            ).fetchall()
        }

    stale = [r for r in rows if r["title"] not in cached]

    # 3. Fetch stale shows in parallel (up to 10 threads)
    if stale:

        def _job(row):
            return _fetch_show(row["title"], row["title"], row["release_year"])

        with ThreadPoolExecutor(max_workers=10) as pool:
            futures = {pool.submit(_job, r): r for r in stale}
            for fut in as_completed(futures):
                result = fut.result()
                if result:
                    db.execute(
                        """INSERT OR REPLACE INTO tmdb_show_cache
                               (title_key, tmdb_id, is_ongoing, end_year,
                                next_ep_json, season_num, season_json, poster_thumb,
                                cast_json, show_overview,
                                fetched_at, expires_at)
                           VALUES (:title_key, :tmdb_id, :is_ongoing, :end_year,
                                   :next_ep_json, :season_num, :season_json, :poster_thumb,
                                   :cast_json, :show_overview,
                                   datetime('now'), datetime('now','+6 hours'))""",
                        result,
                    )
                    cached[result["title_key"]] = result
        db.commit()

    # 4. Build upcoming episodes list from cached data
    from datetime import date, timezone

    today = date.today()
    episodes = []
    show_data = {}

    for title_key, c in cached.items():
        if not c.get("is_ongoing"):
            continue
        season_raw = c.get("season_json")
        if not season_raw:
            continue
        try:
            season = json.loads(season_raw)
        except Exception:
            continue

        for ep in season.get("episodes", []):
            air_date_str = ep.get("air_date")
            if not air_date_str:
                continue
            try:
                air = date.fromisoformat(air_date_str)
            except ValueError:
                continue
            diff = (air - today).days
            if diff < 0:
                continue
            episodes.append(
                {
                    "title_key": title_key,
                    "air_date": air_date_str,
                    "diff_days": diff,
                    "season_number": ep.get("season_number"),
                    "episode_number": ep.get("episode_number"),
                    "name": ep.get("name"),
                    "still_path": ep.get("still_path"),
                    "overview": ep.get("overview"),
                    "runtime": ep.get("runtime"),
                    "vote_average": ep.get("vote_average"),
                    "vote_count": ep.get("vote_count"),
                    "guest_stars": [
                        {
                            "name": g.get("name"),
                            "character": g.get("character"),
                            "profile_path": g.get("profile_path"),
                        }
                        for g in (ep.get("guest_stars") or [])[:8]
                    ],
                    "crew": [
                        {"name": cm.get("name"), "job": cm.get("job")}
                        for cm in (ep.get("crew") or [])
                        if cm.get("job") in ("Director", "Writer", "Story", "Teleplay")
                    ][:6],
                }
            )

        if title_key not in show_data:
            cast_raw = c.get("cast_json")
            cast = json.loads(cast_raw) if cast_raw else []
            show_data[title_key] = {
                "tmdb_id": c.get("tmdb_id"),
                "poster_thumb": c.get("poster_thumb"),
                "end_year": c.get("end_year"),
                "is_ongoing": bool(c.get("is_ongoing")),
                "cast": cast,
                "show_overview": c.get("show_overview") or "",
            }

    # Deduplicate and sort
    seen = set()
    deduped = []
    for ep in sorted(episodes, key=lambda e: e["air_date"]):
        k = f"{ep['title_key']}::S{ep['season_number']}E{ep['episode_number']}"
        if k not in seen:
            seen.add(k)
            deduped.append(ep)

    return jsonify({"episodes": deduped, "show_data": show_data})


# ── /api/platform-logos ───────────────────────────────────────────────────────

# Map our internal platform_key → TMDB watch provider ID
_PLATFORM_PROVIDER_IDS = {
    "netflix": 8,
    "prime_video": 9,
    "disney_plus": 337,
    "apple_tv": 350,
    "hbo_max": 1899,  # Max (formerly HBO Max)
    "hulu": 15,
    "peacock": 386,
    "paramount_plus": 531,
}


@bp.route("/platform-logos")
@require_auth
def platform_logos():
    db = get_db()
    # Check if we have fresh logos for all platforms
    rows = db.execute(
        "SELECT platform_key, logo_url FROM platform_logos WHERE expires_at > datetime('now')"
    ).fetchall()
    cached = {r["platform_key"]: r["logo_url"] for r in rows if r["logo_url"]}

    # Find which platform keys are missing or have no logo URL yet
    missing = [k for k in _PLATFORM_PROVIDER_IDS if k not in cached]

    if missing:
        # Fetch provider lists from both TV and movie endpoints — some providers
        # (e.g. Paramount+) only appear in one of the two US lists on TMDB.
        by_id: dict = {}
        for media_type in ("tv", "movie"):
            provider_data = _tmdb(
                f"/watch/providers/{media_type}", watch_region="US", language="en-US"
            )
            for p in provider_data.get("results") or []:
                pid = p.get("provider_id")
                if pid and pid not in by_id:
                    by_id[pid] = p

        for key, pid in _PLATFORM_PROVIDER_IDS.items():
            if key not in cached:
                prov = by_id.get(pid)
                if prov and prov.get("logo_path"):
                    # Use w45 for crisp small logos
                    url = f"https://image.tmdb.org/t/p/w45{prov['logo_path']}"
                    db.execute(
                        """INSERT OR REPLACE INTO platform_logos (platform_key, logo_url, fetched_at, expires_at)
                           VALUES (?, ?, datetime('now'), datetime('now', '+30 days'))""",
                        (key, url),
                    )
                    cached[key] = url
        db.commit()

    return jsonify(cached)


@bp.route("/tmdb/search")
@require_auth
def tmdb_search():
    title = request.args.get("query", "").strip()
    year = request.args.get("year", "")
    mt = request.args.get("type", "movie")
    if not title:
        return jsonify({"results": []})
    extra = {"year": year} if year else {}

    if mt == "person":
        # Run two parallel searches: original query + spaces-stripped variant.
        # This catches names like "DiCaprio" when the user types "di capr" (with
        # a space), since TMDB tokenises on word boundaries and won't match the
        # compounded form otherwise.
        nospace = title.replace(" ", "")
        queries = list({title, nospace})  # deduplicate if already no spaces
        with ThreadPoolExecutor(max_workers=len(queries)) as ex:
            futures = [ex.submit(_tmdb, "/search/person", query=q) for q in queries]
            merged: dict = {}
            for f in futures:
                for p in (f.result() or {}).get("results", []):
                    if p.get("id") and p.get("id") not in merged:
                        merged[p["id"]] = p
        results = sorted(
            merged.values(), key=lambda p: p.get("popularity", 0), reverse=True
        )
        return jsonify({"results": results[:5]})

    data = _tmdb(f"/search/{mt}", query=title, **extra)
    return jsonify({"results": data.get("results", [])[:5]})


@bp.route("/tmdb/<media_type>/<int:tmdb_id>")
@require_auth
def tmdb_details(media_type: str, tmdb_id: int):
    if media_type not in ("movie", "tv"):
        return jsonify({"error": "invalid media_type"}), 400
    data = _tmdb(f"/{media_type}/{tmdb_id}", append_to_response="external_ids")
    return jsonify(data)


@bp.route("/tmdb/<media_type>/<int:tmdb_id>/credits")
@require_auth
def tmdb_credits(media_type: str, tmdb_id: int):
    if media_type not in ("movie", "tv"):
        return jsonify({"error": "invalid media_type"}), 400
    data = _tmdb(f"/{media_type}/{tmdb_id}/credits")
    return jsonify(data)


@bp.route("/tmdb/tv/<int:tmdb_id>/season/<int:season_num>")
@require_auth
def tmdb_season(tmdb_id: int, season_num: int):
    data = _tmdb(f"/tv/{tmdb_id}/season/{season_num}")
    return jsonify(data)


@bp.route("/tmdb/person/<int:person_id>")
@require_auth
def tmdb_person(person_id: int):
    data = _tmdb(f"/person/{person_id}")
    return jsonify(data)


@bp.route("/tmdb/person/<int:person_id>/combined_credits")
@require_auth
def tmdb_person_credits(person_id: int):
    data = _tmdb(f"/person/{person_id}/combined_credits")
    return jsonify(data)


def _tmdb_multi(path: str, pages: list, **params) -> tuple:
    """Fetch multiple TMDB pages in parallel. Returns (combined_results, tmdb_total_pages)."""
    results_by_page: dict = {}
    tmdb_total = 1

    def fetch(p):
        return _tmdb(path, page=p, **params)

    with ThreadPoolExecutor(max_workers=len(pages)) as ex:
        futs = {ex.submit(fetch, p): p for p in pages}
        for fut in as_completed(futs):
            p = futs[fut]
            data = fut.result()
            results_by_page[p] = data.get("results") or []
            tmdb_total = max(tmdb_total, data.get("total_pages", 1))
    combined = []
    for p in pages:
        combined.extend(results_by_page.get(p, []))
    return combined, tmdb_total


def _shape_person(p: dict) -> dict:
    return {
        "id": p.get("id"),
        "name": p.get("name", ""),
        "profile_path": p.get("profile_path"),
        "known_for_department": p.get("known_for_department", "Acting"),
        "known_for": [
            {
                "title": k.get("title") or k.get("name", ""),
                "media_type": k.get("media_type", ""),
            }
            for k in (p.get("known_for") or [])[:3]
        ],
        "popularity": p.get("popularity", 0),
    }


@bp.route("/people/<category>")
@require_auth
def people_list(category: str):
    """Return trending or popular people from TMDB."""
    page = request.args.get("page", 1, type=int)
    # Fetch 2 TMDB pages per frontend page so ~40 results appear before "Load more"
    BATCH = 2
    tmdb_start = (page - 1) * BATCH + 1
    tmdb_pages = list(range(tmdb_start, tmdb_start + BATCH))
    if category == "trending":
        endpoint = "/trending/person/week"
    elif category == "popular":
        endpoint = "/person/popular"
    else:
        return jsonify({"error": "unknown category"}), 400
    raw, tmdb_total = _tmdb_multi(endpoint, tmdb_pages)
    results = [_shape_person(p) for p in raw if p.get("profile_path") and p.get("name")]
    our_total = (tmdb_total + BATCH - 1) // BATCH
    return jsonify({"results": results, "total_pages": our_total})


@bp.route("/people/search")
@require_auth
def people_search():
    """Search TMDB for people by name, sorted by popularity."""
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"results": []})
    page = request.args.get("page", 1, type=int)
    # Fetch 3 TMDB pages per frontend page so popular people aren't buried
    BATCH = 3
    tmdb_start = (page - 1) * BATCH + 1
    tmdb_pages = list(range(tmdb_start, tmdb_start + BATCH))
    raw, tmdb_total = _tmdb_multi("/search/person", tmdb_pages, query=q)
    results = [_shape_person(p) for p in raw if p.get("profile_path") and p.get("name")]
    results.sort(key=lambda r: r["popularity"], reverse=True)
    our_total = (tmdb_total + BATCH - 1) // BATCH
    return jsonify({"results": results, "total_pages": our_total})


@bp.route("/tmdb/<media_type>/<int:tmdb_id>/external_ids")
@require_auth
def tmdb_external_ids(media_type: str, tmdb_id: int):
    if media_type not in ("movie", "tv"):
        return jsonify({"error": "invalid media_type"}), 400
    data = _tmdb(f"/{media_type}/{tmdb_id}/external_ids")
    return jsonify(data)


@bp.route("/tmdb/<media_type>/<int:tmdb_id>/ratings")
@require_auth
def tmdb_ratings(media_type: str, tmdb_id: int):
    if media_type not in ("movie", "tv"):
        return jsonify({"error": "invalid media_type"}), 400

    db = get_db()

    # Cache hit
    row = db.execute(
        "SELECT imdb_score, imdb_votes, tomatometer FROM tmdb_ratings WHERE tmdb_id = ?",
        (tmdb_id,),
    ).fetchone()
    if row:
        return jsonify(
            {
                "imdb_score": row["imdb_score"],
                "imdb_votes": row["imdb_votes"],
                "tomatometer": row["tomatometer"],
            }
        )

    # Resolve imdb_id via TMDB external_ids
    ext = _tmdb(f"/{media_type}/{tmdb_id}/external_ids")
    imdb_id = ext.get("imdb_id")
    if not imdb_id:
        return jsonify({"error": "no imdb_id found for this title"}), 404

    if not OMDB_KEY:
        return jsonify({"error": "OMDB_API_KEY not configured"}), 503

    # Fetch OMDB ratings
    try:
        omdb_resp = _tmdb_session.get(
            "https://www.omdbapi.com/",
            params={"i": imdb_id, "apikey": OMDB_KEY, "tomatoes": "true"},
            timeout=8,
        ).json()
    except Exception:
        return jsonify({"error": "OMDB request failed"}), 502

    if omdb_resp.get("Response") == "False":
        return jsonify({"error": omdb_resp.get("Error", "OMDB error")}), 404

    # imdb_score
    try:
        imdb_score = float(omdb_resp.get("imdbRating") or 0)
    except (ValueError, TypeError):
        imdb_score = 0.0

    # imdb_votes
    try:
        imdb_votes = int(
            (omdb_resp.get("imdbVotes") or "0").replace(",", "").strip() or "0"
        )
    except (ValueError, TypeError):
        imdb_votes = 0

    # tomatometer — tomatoMeter field (tomatoes=true) or Ratings array fallback
    tomatometer = None
    raw_tm = omdb_resp.get("tomatoMeter", "")
    if raw_tm and raw_tm not in ("N/A", ""):
        try:
            tomatometer = int(raw_tm)
        except (ValueError, TypeError):
            pass
    if tomatometer is None:
        for rating in omdb_resp.get("Ratings", []):
            if rating.get("Source") == "Rotten Tomatoes":
                val = rating.get("Value", "").rstrip("%")
                try:
                    tomatometer = int(val)
                except (ValueError, TypeError):
                    pass
                break

    db.execute(
        """INSERT OR REPLACE INTO tmdb_ratings
               (tmdb_id, imdb_id, imdb_score, imdb_votes, tomatometer, fetched_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))""",
        (tmdb_id, imdb_id, imdb_score, imdb_votes, tomatometer),
    )
    db.commit()

    return jsonify(
        {
            "imdb_score": imdb_score,
            "imdb_votes": imdb_votes,
            "tomatometer": tomatometer,
        }
    )
