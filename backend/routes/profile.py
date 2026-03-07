# backend/routes/profile.py
import json
import base64
from flask import Blueprint, g, jsonify, request
from backend.auth import require_auth
from backend.database import get_db

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

    movies_finished = movies_watching = movies_in_library = 0
    tv_finished = tv_watching = 0
    total_lib = len(lib_rows)
    favs_count = 0
    genre_freq: dict = {}
    tv_runtime_map: dict = {}
    movie_mins = 0

    finished_movies_list = []
    for r in lib_rows:
        ct = (r["content_type"] or "").lower()
        status = r["status"] or "not-started"
        if r["is_fav"]:
            favs_count += 1
        # Count genres for items the user has engaged with
        if (
            status in ("finished", "watching")
            and r["genre"]
            and r["genre"] != "Unknown"
        ):
            for g_name in r["genre"].split(","):
                g_name = g_name.strip()
                if g_name:
                    genre_freq[g_name] = genre_freq.get(g_name, 0) + 1
        if ct == "movie":
            movies_in_library += 1
            if status == "finished":
                finished_movies_list.append(r)
                movies_finished += 1
                movie_mins += r["runtime_mins"] or FALLBACK_MOVIE_MINS
            elif status == "watching":
                movies_watching += 1
        elif ct == "tv":
            if status == "finished":
                tv_finished += 1
            elif status == "watching":
                tv_watching += 1
            tv_runtime_map[r["title"].lower()] = (
                r["runtime_mins"] or FALLBACK_EPISODE_MINS
            )

    movies_finished = len(finished_movies_list)

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
        "SELECT username, email, auth_type, created_at, profile_pic, display_name, home_country, library_public, pic_position_y FROM users WHERE id=?",
        (uid,),
    ).fetchone()

    # ── Stats: always compute live from library to ensure accuracy ──────────
    s = _compute_stats(db, uid)
    cache_stats(db, uid)  # keep cache fresh for other consumers
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
