# backend/routes/profile.py
import json
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
from flask import Blueprint, g, jsonify, request
from backend.auth import require_auth
from backend.database import get_db
from backend.routes.titles import _tmdb

bp = Blueprint("profile", __name__, url_prefix="/api/profile")

FALLBACK_MOVIE_MINS = 105
FALLBACK_EPISODE_MINS = 42


def _fmt_time(total_minutes: int) -> dict:
    h = total_minutes // 60
    m = total_minutes % 60
    days = h // 24
    hrs = h % 24
    months = days // 30
    rem_days = days % 30
    if months >= 1:
        label = f"{months}mo {rem_days}d {hrs}h"
    elif days >= 1:
        label = f"{days}d {hrs}h {m}m"
    elif h > 0:
        label = f"{h}h {m}m"
    else:
        label = f"{m}m"
    return {"total_minutes": total_minutes, "hours": h, "minutes": m, "label": label}


def _compute_stats(db, uid: int) -> dict:
    """Compute all watch-time stats for a user from scratch. Returns a plain dict."""
    lib_rows = db.execute(
        """SELECT l.platform, l.title, l.status, l.is_fav,
                  t.content_type, t.genre, t.runtime_mins
           FROM library l
           LEFT JOIN (
               SELECT platform, title, content_type, genre, runtime_mins
               FROM titles GROUP BY platform, title
           ) t ON t.platform = l.platform AND t.title = l.title
           WHERE l.user_id = ?""",
        (uid,),
    ).fetchall()

    total_lib = len(lib_rows)
    favs_count = 0
    genre_freq: dict = {}
    tv_runtime_map: dict = {}
    movie_mins = 0

    # Per-title best status (finished beats watching beats watchlist)
    # This deduplicates shows that exist on multiple platforms in the library.
    STATUS_PRIO = {"finished": 3, "watching": 2, "watchlist": 1, "not-started": 0}
    movie_best: dict = {}  # title_lower -> (best_status, runtime_mins, genre, is_fav)
    tv_best: dict = {}  # title_lower -> (best_status, genre, is_fav)

    for r in lib_rows:
        ct = (r["content_type"] or "").lower()
        status = r["status"] or "not-started"
        title_lower = r["title"].strip().lower()
        if r["is_fav"]:
            favs_count += 1
        if ct == "movie":
            prev_status, prev_rt, prev_genre, prev_fav = movie_best.get(
                title_lower, ("not-started", None, None, False)
            )
            if STATUS_PRIO.get(status, 0) >= STATUS_PRIO.get(prev_status, 0):
                movie_best[title_lower] = (
                    status,
                    r["runtime_mins"],
                    r["genre"],
                    bool(r["is_fav"]),
                )
            else:
                # Keep best status but merge is_fav
                movie_best[title_lower] = (
                    prev_status,
                    prev_rt,
                    prev_genre or r["genre"],
                    prev_fav or bool(r["is_fav"]),
                )
        elif ct == "tv":
            prev_status, prev_genre, prev_fav = tv_best.get(
                title_lower, ("not-started", None, False)
            )
            if STATUS_PRIO.get(status, 0) >= STATUS_PRIO.get(prev_status, 0):
                tv_best[title_lower] = (status, r["genre"], bool(r["is_fav"]))
            else:
                tv_best[title_lower] = (
                    prev_status,
                    prev_genre or r["genre"],
                    prev_fav or bool(r["is_fav"]),
                )
            tv_runtime_map[title_lower] = r["runtime_mins"] or FALLBACK_EPISODE_MINS

    # Count genres once per deduplicated title
    for title_lower, (s, rt, genre, is_fav) in movie_best.items():
        in_library = is_fav or s in ("watchlist", "watching", "finished")
        if in_library and genre and genre != "Unknown":
            for g_name in genre.split(","):
                g_name = g_name.strip()
                if g_name:
                    genre_freq[g_name] = genre_freq.get(g_name, 0) + 1
    for title_lower, (s, genre, is_fav) in tv_best.items():
        in_library = is_fav or s in ("watchlist", "watching", "finished")
        if in_library and genre and genre != "Unknown":
            for g_name in genre.split(","):
                g_name = g_name.strip()
                if g_name:
                    genre_freq[g_name] = genre_freq.get(g_name, 0) + 1

    movies_in_library = sum(
        1 for s, _, _g, _f in movie_best.values() if s != "not-started"
    )
    movies_finished = 0
    movies_watching = 0
    for title_lower, (s, rt, _g, _f) in movie_best.items():
        if s == "finished":
            movies_finished += 1
            movie_mins += rt or FALLBACK_MOVIE_MINS
        elif s == "watching":
            movies_watching += 1

    tv_finished = sum(1 for s, _g, _f in tv_best.values() if s == "finished")
    tv_watching = sum(1 for s, _g, _f in tv_best.values() if s == "watching")
    movies_watchlist = sum(
        1 for s, _, _g, _f in movie_best.values() if s == "watchlist"
    )
    tv_watchlist = sum(1 for s, _g, _f in tv_best.values() if s == "watchlist")

    season_rows = db.execute(
        "SELECT title, ep_mask, runtime_mins FROM watched_seasons WHERE user_id=?",
        (uid,),
    ).fetchall()

    show_ep: dict = {}
    for r in season_rows:
        key = r["title"].lower()
        if key not in show_ep:
            show_ep[key] = {"ep_count": 0, "runtime": 0}
        show_ep[key]["ep_count"] += bin(r["ep_mask"]).count("1")
        show_ep[key]["runtime"] += r["runtime_mins"] or 0

    ep_total = 0
    tv_mins = 0
    for title_key, d in show_ep.items():
        ep_total += d["ep_count"]
        if d["runtime"] > 0:
            tv_mins += d["runtime"]
        else:
            tv_mins += d["ep_count"] * tv_runtime_map.get(
                title_key, FALLBACK_EPISODE_MINS
            )

    top_genres = sorted(genre_freq.items(), key=lambda x: x[1], reverse=True)[:6]

    return {
        "total_in_library": total_lib,
        "favourites": favs_count,
        "movies_finished": movies_finished,
        "movies_watching": movies_watching,
        "movies_in_library": movies_in_library,
        "tv_finished": tv_finished,
        "tv_watching": tv_watching,
        "episodes_watched": ep_total,
        "movie_mins": movie_mins,
        "tv_mins": tv_mins,
        "top_genres": [{"genre": g, "count": c} for g, c in top_genres],
        "watchlist_count": movies_watchlist + tv_watchlist,
        "watching_count": movies_watching + tv_watching,
        "finished_count": movies_finished + tv_finished,
    }


def cache_stats(db, uid: int) -> None:
    """Recompute stats and persist them to user_stats. Call after any library write."""
    s = _compute_stats(db, uid)
    db.execute(
        """INSERT INTO user_stats
               (user_id, movie_mins, tv_mins,
                movies_finished, movies_watching, movies_in_library,
                tv_finished, tv_watching, episodes_watched,
                favourites, top_genres, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
           ON CONFLICT(user_id) DO UPDATE SET
               movie_mins        = excluded.movie_mins,
               tv_mins           = excluded.tv_mins,
               movies_finished   = excluded.movies_finished,
               movies_watching   = excluded.movies_watching,
               movies_in_library = excluded.movies_in_library,
               tv_finished       = excluded.tv_finished,
               tv_watching       = excluded.tv_watching,
               episodes_watched  = excluded.episodes_watched,
               favourites        = excluded.favourites,
               top_genres        = excluded.top_genres,
               updated_at        = datetime('now')""",
        (
            uid,
            s["movie_mins"],
            s["tv_mins"],
            s["movies_finished"],
            s["movies_watching"],
            s["movies_in_library"],
            s["tv_finished"],
            s["tv_watching"],
            s["episodes_watched"],
            s["favourites"],
            json.dumps(s["top_genres"]),
        ),
    )
    db.commit()


@bp.route("", methods=["GET"])
@require_auth
def get_profile():
    db = get_db()
    uid = g.current_user["user_id"]

    # ── User row ──────────────────────────────────────────────────────────────
    user = db.execute(
        "SELECT username, email, auth_type, created_at, profile_pic, display_name, home_country, library_public, pic_position_y, pic_position_x, pic_scale FROM users WHERE id=?",
        (uid,),
    ).fetchone()

    # ── Stats: use cached row if fresh (< 5 min), else recompute ───────────
    cached = db.execute(
        "SELECT * FROM user_stats WHERE user_id=? AND updated_at > datetime('now', '-5 minutes')",
        (uid,),
    ).fetchone()
    if cached:
        movie_mins = cached["movie_mins"]
        tv_mins = cached["tv_mins"]
        # Derive watchlist/watching/finished from cached columns
        watchlist_count = cached["movies_in_library"] - cached["movies_finished"] - cached["movies_watching"]
        s = {
            "total_in_library": cached["movies_in_library"] + cached["tv_finished"] + cached["tv_watching"] + cached["movies_finished"] + cached["movies_watching"],
            "favourites": cached["favourites"],
            "movies_finished": cached["movies_finished"],
            "movies_watching": cached["movies_watching"],
            "movies_in_library": cached["movies_in_library"],
            "tv_finished": cached["tv_finished"],
            "tv_watching": cached["tv_watching"],
            "episodes_watched": cached["episodes_watched"],
            "top_genres": json.loads(cached["top_genres"]) if cached["top_genres"] else [],
            "watchlist_count": watchlist_count if watchlist_count > 0 else 0,
            "watching_count": cached["movies_watching"] + cached["tv_watching"],
            "finished_count": cached["movies_finished"] + cached["tv_finished"],
        }
    else:
        s = _compute_stats(db, uid)
        cache_stats(db, uid)
        movie_mins = s["movie_mins"]
        tv_mins = s["tv_mins"]
    stats = {
        "total_in_library": s["total_in_library"],
        "favourites": s["favourites"],
        "movies_finished": s["movies_finished"],
        "movies_watching": s["movies_watching"],
        "movies_in_library": s["movies_in_library"],
        "tv_finished": s["tv_finished"],
        "tv_watching": s["tv_watching"],
        "episodes_watched": s["episodes_watched"],
        "movie_watch_time": _fmt_time(movie_mins),
        "tv_watch_time": _fmt_time(tv_mins),
        "total_watch_time": _fmt_time(movie_mins + tv_mins),
        "top_genres": s["top_genres"],
        "watchlist_count": s["watchlist_count"],
        "watching_count": s["watching_count"],
        "finished_count": s["finished_count"],
    }

    return jsonify(
        {
            "username": user["username"],
            "display_name": user["display_name"] or user["username"],
            "email": user["email"] or "",
            "auth_type": user["auth_type"],
            "member_since": (user["created_at"] or "")[:10],
            "profile_pic": user["profile_pic"] or "",
            "home_country": user["home_country"] or "",
            "library_public": bool(user["library_public"]),
            "stats": stats,
            "pic_position_y": int(user["pic_position_y"])
            if user["pic_position_y"] is not None
            else 50,
            "pic_position_x": float(user["pic_position_x"])
            if user["pic_position_x"] is not None
            else 0.5,
            "pic_scale": float(user["pic_scale"])
            if user["pic_scale"] is not None
            else 1.0,
        }
    )


@bp.route("", methods=["POST"])
@require_auth
def update_profile():
    db = get_db()
    uid = g.current_user["user_id"]
    data = request.get_json(silent=True) or {}

    updates, params = [], []

    if "display_name" in data:
        dn = (data["display_name"] or "").strip()[:60]
        updates.append("display_name=?")
        params.append(dn or None)

    if "profile_pic" in data:
        pic = data["profile_pic"] or ""
        if pic and not pic.startswith("data:") and len(pic) < 2_000_000:
            return jsonify({"error": "Invalid image format"}), 400
        if len(pic) > 2_000_000:
            return jsonify({"error": "Image too large (max ~1.5 MB)"}), 400
        updates.append("profile_pic=?")
        params.append(pic or None)

    if "home_country" in data:
        hc = (data.get("home_country") or "").strip().upper()[:2]
        if hc and not hc.isalpha():
            return jsonify({"error": "Invalid country code"}), 400
        updates.append("home_country=?")
        params.append(hc or None)

    if "library_public" in data:
        updates.append("library_public=?")
        params.append(1 if data["library_public"] else 0)

    if "pic_position_y" in data:
        try:
            pos_y = max(0, min(100, int(data["pic_position_y"])))
        except (TypeError, ValueError):
            pos_y = 50
        updates.append("pic_position_y=?")
        params.append(pos_y)

    if "pic_position_x" in data:
        try:
            pos_x = max(0.0, min(1.0, float(data["pic_position_x"])))
        except (TypeError, ValueError):
            pos_x = 0.5
        updates.append("pic_position_x=?")
        params.append(pos_x)

    if "pic_scale" in data:
        try:
            scale = max(0.1, min(10.0, float(data["pic_scale"])))
        except (TypeError, ValueError):
            scale = 1.0
        updates.append("pic_scale=?")
        params.append(scale)

    if "username" in data:
        new_uname = (data.get("username") or "").strip()
        if len(new_uname) < 3:
            return jsonify({"error": "Username must be at least 3 characters"}), 400
        if len(new_uname) > 30:
            return jsonify({"error": "Username must be 30 characters or fewer"}), 400
        # Skip update if username hasn't changed (case-sensitive)
        current_uname = (
            db.execute("SELECT username FROM users WHERE id=?", (uid,)).fetchone()[
                "username"
            ]
            or ""
        )
        if new_uname.lower() != current_uname.lower():
            taken = db.execute(
                "SELECT id FROM users WHERE username=? COLLATE NOCASE AND id!=?",
                (new_uname, uid),
            ).fetchone()
            if taken:
                return jsonify({"error": "Username already taken"}), 409
            updates.append("username=?")
            params.append(new_uname)
        # Always clear setup_required when username is explicitly submitted
        updates.append("setup_required=?")
        params.append(0)

    if not updates:
        return jsonify({"error": "Nothing to update"}), 400

    params.append(uid)
    db.execute(f"UPDATE users SET {', '.join(updates)} WHERE id=?", params)
    db.commit()
    return jsonify({"ok": True})


@bp.route("/watchtime", methods=["GET"])
@require_auth
def get_watchtime_titles():
    """Return all user library entries (status != not-started) with per-title watch time."""
    db = get_db()
    uid = g.current_user["user_id"]

    # Library entries joined with title metadata
    lib_rows = db.execute(
        """SELECT l.platform, l.title, l.status,
                  t.content_type, t.genre, t.runtime_mins,
                  t.imdb_score, t.release_year
           FROM library l
           LEFT JOIN (
               SELECT platform, title, content_type, genre, runtime_mins,
                      imdb_score, release_year
               FROM titles GROUP BY platform, title
           ) t ON t.platform = l.platform AND t.title = l.title
           WHERE l.user_id = ? AND (l.status != 'not-started' AND l.status IS NOT NULL)
           ORDER BY l.title""",
        (uid,),
    ).fetchall()

    # Per-title TV watch time from watched_seasons
    tv_rows = db.execute(
        """SELECT title, SUM(runtime_mins) as total_runtime, COUNT(*) as ep_count
           FROM watched_seasons WHERE user_id=?
           GROUP BY LOWER(title)""",
        (uid,),
    ).fetchall()
    tv_time_map = {
        r["title"].lower(): {"mins": r["total_runtime"] or 0, "eps": r["ep_count"]}
        for r in tv_rows
    }

    results = []
    for r in lib_rows:
        ct = (r["content_type"] or "movie").lower()
        status = r["status"] or "not-started"
        if ct == "movie":
            mins = (
                (r["runtime_mins"] or FALLBACK_MOVIE_MINS)
                if status == "finished"
                else 0
            )
            eps = 0
        else:
            td = tv_time_map.get((r["title"] or "").lower(), {})
            if td.get("mins"):
                mins = td["mins"]
            else:
                mins = (td.get("eps", 0)) * (r["runtime_mins"] or FALLBACK_EPISODE_MINS)
            eps = td.get("eps", 0)

        results.append(
            {
                "platform": r["platform"],
                "title": r["title"],
                "status": status,
                "content_type": ct,
                "genre": r["genre"] or "",
                "imdb_score": r["imdb_score"] or 0,
                "release_year": r["release_year"] or "",
                "watch_mins": mins,
                "episodes_watched": eps,
            }
        )

        if not results:
            results = []
    return jsonify({"titles": results})


@bp.route("/watchtime-stats", methods=["GET"])
@require_auth
def get_watchtime_stats():
    """Debug: show library/watchtime counts for the current user."""
    db = get_db()
    uid = g.current_user["user_id"]
    total = db.execute(
        "SELECT COUNT(*) FROM library WHERE user_id=?", (uid,)
    ).fetchone()[0]
    active = db.execute(
        "SELECT COUNT(*) FROM library WHERE user_id=? AND status != 'not-started' AND status IS NOT NULL",
        (uid,),
    ).fetchone()[0]
    statuses = [
        dict(r)
        for r in db.execute(
            "SELECT status, COUNT(*) as n FROM library WHERE user_id=? GROUP BY status",
            (uid,),
        ).fetchall()
    ]
    ws = db.execute(
        "SELECT COUNT(*) FROM watched_seasons WHERE user_id=?", (uid,)
    ).fetchone()[0]
    return jsonify(
        {
            "user_id": uid,
            "library_total": total,
            "library_active": active,
            "library_by_status": statuses,
            "watched_seasons_rows": ws,
        }
    )


@bp.route("/top-actors", methods=["GET"])
@require_auth
def get_top_actors():
    """Compute the user's most-watched actors and directors from their library.
    Resolves each title via TMDB search then fetches credits — all in parallel.
    Returns { actors: [...], directors: [...] }.

    Counting rules:
      - finished titles: always count the actor/director.
      - watching (in progress) TV: only count if the actor appeared in a season
        where the user has at least one watched episode (ep_mask > 0).
      - watching movies: always count (partial viewing still counts).
      - watchlist / not-started: never counted.
    """
    db = get_db()
    uid = g.current_user["user_id"]

    # Fetch only actively-watched or finished library entries (not watchlist)
    lib_rows = db.execute(
        """SELECT l.title, l.status, t.content_type, t.genre
           FROM library l
           LEFT JOIN (
               SELECT platform, title, content_type, genre
               FROM titles GROUP BY platform, title
           ) t ON t.platform = l.platform AND t.title = l.title
           WHERE l.user_id = ?
             AND l.status IN ('watching', 'finished')
           ORDER BY l.title""",
        (uid,),
    ).fetchall()

    if not lib_rows:
        return jsonify({"actors": [], "directors": []})

    # Build maps from watched_seasons
    ws_rows = db.execute(
        "SELECT title, season_num, ep_mask, runtime_mins FROM watched_seasons WHERE user_id=? AND ep_mask > 0",
        (uid,),
    ).fetchall()
    watched_seasons_map: dict = {}
    watchtime_map: dict = {}  # title_key → total watched runtime_mins (used for movies)
    watched_ep_count_map: dict = {}  # title_key → total watched episode count (caps TV actor watchtime)
    for ws in ws_rows:
        key = ws["title"].strip().lower()
        watched_seasons_map.setdefault(key, set()).add(ws["season_num"])
        watchtime_map[key] = watchtime_map.get(key, 0) + (ws["runtime_mins"] or 0)
        watched_ep_count_map[key] = watched_ep_count_map.get(key, 0) + bin(
            ws["ep_mask"]
        ).count("1")

    # Deduplicate by (normalised title, content_type)
    seen: set = set()
    unique: list = []
    for r in lib_rows:
        ct = (r["content_type"] or "movie").lower()
        key = (r["title"].strip().lower(), ct)
        if key not in seen:
            seen.add(key)
            raw_genre = r["genre"] or ""
            genres = [
                g.strip()
                for g in raw_genre.split(",")
                if g.strip() and g.strip().lower() != "unknown"
            ]
            tk = r["title"].strip().lower()
            unique.append(
                {
                    "title": r["title"],
                    "media_type": "movie" if ct == "movie" else "tv",
                    "status": r["status"],
                    "genres": genres,
                    "watched_seasons": watched_seasons_map.get(tk, set()),
                    "watchtime_mins": watchtime_map.get(tk, 0),
                    "watched_ep_count": watched_ep_count_map.get(tk, 0),
                }
            )

    # Step 1 – resolve TMDB IDs in parallel
    def _resolve(entry: dict):
        mt = entry["media_type"]
        data = _tmdb(f"/search/{mt}", query=entry["title"])
        results = data.get("results") or []
        if results:
            return {
                "tmdb_id": results[0]["id"],
                "media_type": mt,
                "status": entry["status"],
                "genres": entry["genres"],
                "watched_seasons": entry["watched_seasons"],
                "watchtime_mins": entry["watchtime_mins"],
                "watched_ep_count": entry["watched_ep_count"],
            }
        return None

    resolved: list = []
    with ThreadPoolExecutor(max_workers=20) as ex:
        futs = {ex.submit(_resolve, t): t for t in unique}
        for fut in as_completed(futs):
            try:
                res = fut.result()
                if res:
                    resolved.append(res)
            except Exception:
                pass

    if not resolved:
        return jsonify({"actors": [], "directors": []})

    # Step 2 – fetch credits for every resolved title in parallel.
    # For finished TV / all movies: use aggregate_credits / movie credits.
    # For watching TV: fetch per-season credits only for seasons with watched
    # episodes, then merge cast into a deduplicated list.
    actor_counts: dict = {}
    director_counts: dict = {}

    def _credits(entry: dict):
        tid = entry["tmdb_id"]
        mt = entry["media_type"]

        if mt == "movie":
            data = _tmdb(f"/movie/{tid}/credits")
            # Embed movie runtime so the loop can use it without touching `entry`
            data["_is_movie"] = True
            data["_movie_runtime"] = entry.get("watchtime_mins", 0)
            return data

        # TV — always use aggregate_credits so every actor gets an accurate
        # total_episode_count across all seasons. Also fetch show details for
        # average episode runtime so watchtime = episode_count × avg_runtime.
        agg = _tmdb(f"/tv/{tid}/aggregate_credits")
        try:
            show = _tmdb(f"/tv/{tid}")
        except Exception:
            show = {}
        avg_ep_runtime: int = ((show.get("episode_run_time") or []) + [45])[0]
        status = entry["status"]
        # For "watching" shows, cap actor episode count by the episodes the user
        # has actually watched (so a guest star in season 1 of a 5-season show
        # is only credited if the user watched season 1).
        watched_eps = entry.get("watched_ep_count", 0) if status == "watching" else None
        agg["_is_movie"] = False
        agg["_avg_ep_runtime"] = avg_ep_runtime
        agg["_watched_eps"] = watched_eps  # None → finished, use full episode count
        return agg

    with ThreadPoolExecutor(max_workers=20) as ex:
        futs = {ex.submit(_credits, r): r for r in resolved}
        for fut in as_completed(futs):
            entry = futs[fut]
            entry_genres: list = entry.get("genres") or []
            try:
                credits = fut.result()
            except Exception:
                continue
            is_movie: bool = credits.get("_is_movie", True)
            movie_runtime: int = credits.get("_movie_runtime", 0)
            avg_ep_runtime: int = credits.get("_avg_ep_runtime", 45)
            # None → finished show (use actor's full episode count)
            watched_eps = credits.get("_watched_eps")

            for actor in credits.get("cast") or []:
                pid = actor.get("id")
                if not pid:
                    continue
                if is_movie:
                    actor_watchtime = movie_runtime
                else:
                    # aggregate_credits: total_episode_count = episodes actor appeared in
                    ep_count: int = actor.get("total_episode_count") or 0
                    effective_eps = (
                        ep_count if watched_eps is None else min(ep_count, watched_eps)
                    )
                    actor_watchtime = effective_eps * avg_ep_runtime
                if pid in actor_counts:
                    actor_counts[pid]["count"] += 1
                    actor_counts[pid]["watchtime_mins"] += actor_watchtime
                    actor_counts[pid]["genres"].update(entry_genres)
                    for eg in entry_genres:
                        actor_counts[pid]["genre_counts"][eg] = (
                            actor_counts[pid]["genre_counts"].get(eg, 0) + 1
                        )
                else:
                    actor_counts[pid] = {
                        "name": actor.get("name", ""),
                        "profile_path": actor.get("profile_path"),
                        "count": 1,
                        "watchtime_mins": actor_watchtime,
                        "genres": set(entry_genres),
                        "genre_counts": {eg: 1 for eg in entry_genres},
                    }

            for crew_m in credits.get("crew") or []:
                pid = crew_m.get("id")
                if not pid:
                    continue
                if is_movie:
                    if crew_m.get("job") != "Director":
                        continue
                    crew_watchtime = movie_runtime
                else:
                    # aggregate_credits crew: director roles are in a jobs[] array
                    dir_eps = sum(
                        j.get("episode_count", 0)
                        for j in (crew_m.get("jobs") or [])
                        if j.get("job") == "Director"
                    )
                    if dir_eps == 0:
                        continue
                    effective_eps = (
                        dir_eps if watched_eps is None else min(dir_eps, watched_eps)
                    )
                    crew_watchtime = effective_eps * avg_ep_runtime
                if pid in director_counts:
                    director_counts[pid]["count"] += 1
                    director_counts[pid]["watchtime_mins"] += crew_watchtime
                    director_counts[pid]["genres"].update(entry_genres)
                    for eg in entry_genres:
                        director_counts[pid]["genre_counts"][eg] = (
                            director_counts[pid]["genre_counts"].get(eg, 0) + 1
                        )
                else:
                    director_counts[pid] = {
                        "name": crew_m.get("name", ""),
                        "profile_path": crew_m.get("profile_path"),
                        "count": 1,
                        "watchtime_mins": crew_watchtime,
                        "genres": set(entry_genres),
                        "genre_counts": {eg: 1 for eg in entry_genres},
                    }

    actors = sorted(
        [
            {
                "person_id": pid,
                "name": d["name"],
                "profile_path": d["profile_path"],
                "title_count": d["count"],
                "watchtime_mins": d["watchtime_mins"],
                "genres": sorted(d["genres"]),
                "genre_counts": d["genre_counts"],
            }
            for pid, d in actor_counts.items()
        ],
        key=lambda x: x["title_count"],
        reverse=True,
    )

    directors = sorted(
        [
            {
                "person_id": pid,
                "name": d["name"],
                "profile_path": d["profile_path"],
                "title_count": d["count"],
                "watchtime_mins": d["watchtime_mins"],
                "genres": sorted(d["genres"]),
                "genre_counts": d["genre_counts"],
            }
            for pid, d in director_counts.items()
        ],
        key=lambda x: x["title_count"],
        reverse=True,
    )

    return jsonify({"actors": actors, "directors": directors})
