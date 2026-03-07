# backend/routes/admin.py
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from flask import Blueprint, Response, g, jsonify, request, stream_with_context
from backend.auth import require_auth
from backend.database import get_db
from backend.config import settings
from flask import send_file


bp = Blueprint("admin", __name__, url_prefix="/api")


def _require_admin():
    """Returns (user_row, error_response). error_response is None if user is admin."""
    db = get_db()
    uid = g.current_user["user_id"]
    row = db.execute("SELECT is_admin FROM users WHERE id=?", (uid,)).fetchone()
    if not row or not row["is_admin"]:
        return None, (jsonify({"error": "Admin access required"}), 403)
    return row, None


@bp.route("/admin/users")
@require_auth
def admin_users():
    _, err = _require_admin()
    if err:
        return err
    db = get_db()
    rows = db.execute(
        "SELECT id, username, email, auth_type, is_admin, created_at, last_login FROM users ORDER BY id"
    ).fetchall()
    return jsonify({"users": [dict(r) for r in rows]})


@bp.route("/runs")
@require_auth
def list_runs():
    db = get_db()
    rows = db.execute(
        """SELECT id, started_at, finished_at, mode, regions, title_count, status
           FROM scrape_runs ORDER BY id DESC LIMIT 50"""
    ).fetchall()
    return jsonify({"runs": [dict(r) for r in rows]})


@bp.route("/run/<mode>/<regions>")
@require_auth
def run_scraper(mode: str, regions: str):
    """
    Triggers the scraper as a subprocess and streams its stdout back to the
    browser as Server-Sent Events (SSE), so the UI can show live log output.

    URL examples:
        GET /api/run/trending/US
        GET /api/run/catalog/US,GB,PT
        GET /api/run/all/ALL
    """
    # Run the scraper by absolute file path so it works regardless of how Flask
    # was launched (VS Code debugger, gunicorn, etc.)
    _runner_path = str(Path(__file__).parent.parent / "scraper" / "runner.py")
    cmd = [
        sys.executable,
        _runner_path,
        "--mode",
        mode,
        "--db",
        str(settings.DB_PATH),
    ]
    if regions.upper() != "ALL":
        cmd += ["--regions"] + regions.upper().split(",")
    min_votes = request.args.get("min_votes", "").strip()
    if min_votes.isdigit():
        cmd += ["--min-votes", min_votes]
    if request.args.get("multi_sort", "").strip() in ("1", "true"):
        cmd += ["--multi-sort"]
    proxy_url = request.args.get("proxy_url", "").strip()
    if not proxy_url:
        # Fall back to env var already in clean_env (SCRAPER_PROXY_URL)
        proxy_url = clean_env.get("SCRAPER_PROXY_URL", "")
    if proxy_url:
        cmd += ["--proxy-url", proxy_url]

    def generate():
        # Create a scrape_run record before launching the process
        with sqlite3.connect(str(settings.DB_PATH)) as conn:
            cur = conn.execute(
                "INSERT INTO scrape_runs (mode, regions, status) VALUES (?,?,?)",
                (mode, json.dumps(regions.split(",")), "running"),
            )
            run_id = cur.lastrowid
            conn.commit()

        yield f"data: Starting — mode={mode} regions={regions}\n\n"

        try:
            # Strip proxy env vars so the scraper talks directly to JustWatch
            clean_env = os.environ.copy()
            for v in [
                "HTTP_PROXY",
                "HTTPS_PROXY",
                "http_proxy",
                "https_proxy",
                "ALL_PROXY",
                "all_proxy",
                "NO_PROXY",
                "no_proxy",
            ]:
                clean_env.pop(v, None)
            clean_env["SI_RUN_ID"] = str(run_id)
            # Ensure the project root is on PYTHONPATH so `from backend.scraper...` imports resolve
            existing_pp = clean_env.get("PYTHONPATH", "")
            base_str = str(settings.BASE_DIR)
            clean_env["PYTHONPATH"] = (
                f"{base_str}{os.pathsep}{existing_pp}" if existing_pp else base_str
            )

            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                env=clean_env,
                cwd=str(settings.BASE_DIR),
            )
            for line in proc.stdout:
                line = line.rstrip()
                if line:
                    yield f"data: {line}\n\n"
            proc.wait()

            # Update the run record with final status and title count
            with sqlite3.connect(str(settings.DB_PATH)) as conn:
                conn.row_factory = sqlite3.Row
                count = conn.execute(
                    "SELECT COUNT(*) as n FROM titles WHERE run_id=?", (run_id,)
                ).fetchone()["n"]
                conn.execute(
                    "UPDATE scrape_runs SET finished_at=datetime('now'), title_count=?, status=? WHERE id=?",
                    (count, "done" if proc.returncode == 0 else "error", run_id),
                )
                conn.commit()

            yield "data: __DONE__\n\n"

        except Exception as e:
            with sqlite3.connect(str(settings.DB_PATH)) as conn:
                conn.execute(
                    "UPDATE scrape_runs SET status='error', finished_at=datetime('now') WHERE id=?",
                    (run_id,),
                )
                conn.commit()
            yield f"data: ERROR: {e}\n\n"
            yield "data: __DONE__\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@bp.route("/enrich")
@require_auth
def run_enrich():
    """
    Run TMDB enrichment on the existing DB without re-scraping.
    Streams log output as SSE so the UI can show progress live.
    """
    _script = str(Path(__file__).parent.parent / "scraper" / "enrich_only.py")
    cmd = [sys.executable, _script, "--db", str(settings.DB_PATH)]

    def generate():
        yield "data: Starting TMDB enrichment…\n\n"
        try:
            clean_env = os.environ.copy()
            base_str = str(settings.BASE_DIR)
            existing_pp = clean_env.get("PYTHONPATH", "")
            clean_env["PYTHONPATH"] = (
                f"{base_str}{os.pathsep}{existing_pp}" if existing_pp else base_str
            )

            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                env=clean_env,
                cwd=str(settings.BASE_DIR),
            )
            for line in proc.stdout:
                line = line.rstrip()
                if line:
                    yield f"data: {line}\n\n"
            proc.wait()
        except Exception as e:
            yield f"data: ERROR: {e}\n\n"
        yield "data: __DONE__\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@bp.route("/import-json", methods=["POST"])
@require_auth
def import_json():
    """
    One-time import of legacy JSON files from the output/ directory.
    This was used before the scraper wrote directly to SQLite.
    """
    output_dir = settings.BASE_DIR / "output"
    if not output_dir.exists():
        return jsonify({"message": "No output/ directory found", "imported": 0})

    files = sorted(output_dir.glob("streaming_*.json"), key=lambda f: f.stat().st_mtime)
    db = get_db()
    total = 0

    for f in files:
        try:
            with open(f, encoding="utf-8") as fh:
                data = json.load(fh)
            titles = data.get("titles", [])
            meta = data.get("metadata", {})
            ts = meta.get("scraped_at", datetime.now().isoformat())
            cur = db.execute(
                """INSERT INTO scrape_runs
                   (started_at, finished_at, mode, regions, title_count, status)
                   VALUES (?,?,?,?,?,?)""",
                (
                    ts,
                    ts,
                    meta.get("mode", "unknown"),
                    json.dumps(meta.get("regions", [])),
                    len(titles),
                    "imported",
                ),
            )
            run_id = cur.lastrowid
            rows = [
                (
                    run_id,
                    t.get("scraped_at", ts),
                    t.get("platform", ""),
                    t.get("region", ""),
                    t.get("title", ""),
                    t.get("content_type", ""),
                    t.get("genre", ""),
                    str(t.get("release_year", "") or ""),
                    int(t.get("ranking_position", 0) or 0),
                    t.get("synopsis", ""),
                    t.get("maturity_rating", ""),
                    1 if t.get("is_trending") else 0,
                    t.get("source_url", ""),
                    float(t.get("imdb_score", 0) or 0),
                    int(t.get("imdb_votes", 0) or 0),
                    int(t.get("tomatometer", 0) or 0),
                    float(t.get("tmdb_score", 0) or 0),
                )
                for t in titles
            ]
            db.executemany(
                """INSERT OR REPLACE INTO titles
                   (run_id, scraped_at, platform, region, title, content_type, genre,
                    release_year, ranking_position, synopsis, maturity_rating, is_trending,
                    source_url, imdb_score, imdb_votes, tomatometer, tmdb_score)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                rows,
            )
            db.commit()
            total += len(rows)
        except Exception as e:
            print(f"[IMPORT] {f.name}: {e}")

    return jsonify(
        {
            "message": f"Imported {total} titles from {len(files)} files",
            "imported": total,
        }
    )


# ── Library migration ─────────────────────────────────────────────────────────


@bp.route("/export-library", methods=["GET"])
@require_auth
def export_library():
    """Export the current user's library + watched_items as JSON."""
    uid = g.current_user["user_id"]
    db = get_db()
    library = [
        dict(r)
        for r in db.execute(
            "SELECT platform, title, is_fav, status, notes FROM library WHERE user_id=?",
            (uid,),
        ).fetchall()
    ]
    watched = [
        dict(r)
        for r in db.execute(
            "SELECT platform, title, item_type, season_num, episode_num FROM watched_items WHERE user_id=?",
            (uid,),
        ).fetchall()
    ]
    return jsonify({"library": library, "watched": watched})


@bp.route("/import-library", methods=["POST"])
@require_auth
def import_library():
    """Import library + watched_items for the current user.
    Accepts JSON: {"library": [...], "watched": [...]}
    Existing rows are replaced (UPSERT). Safe to run multiple times.
    """
    uid = g.current_user["user_id"]
    data = request.get_json(silent=True) or {}
    library = data.get("library", [])
    watched = data.get("watched", [])
    db = get_db()

    lib_count = 0
    for row in library:
        try:
            db.execute(
                """INSERT INTO library (user_id, platform, title, is_fav, status, notes)
                   VALUES (?,?,?,?,?,?)
                   ON CONFLICT(user_id, platform, title) DO UPDATE SET
                       is_fav=excluded.is_fav, status=excluded.status,
                       notes=excluded.notes, updated_at=datetime('now')""",
                (
                    uid,
                    row["platform"],
                    row["title"],
                    row.get("is_fav", 0),
                    row.get("status", "not-started"),
                    row.get("notes"),
                ),
            )
            lib_count += 1
        except Exception:
            pass

    wat_count = 0
    for row in watched:
        try:
            db.execute(
                """INSERT INTO watched_items
                       (user_id, platform, title, item_type, season_num, episode_num)
                   VALUES (?,?,?,?,?,?)
                   ON CONFLICT(user_id, platform, title, item_type, season_num, episode_num)
                   DO NOTHING""",
                (
                    uid,
                    row["platform"],
                    row["title"],
                    row.get("item_type", "episode"),
                    row.get("season_num", 0),
                    row.get("episode_num", 0),
                ),
            )
            wat_count += 1
        except Exception:
            pass

    db.commit()
    return jsonify({"library_rows": lib_count, "watched_rows": wat_count})


@bp.route("/download-db")
@require_auth
def download_db():
    _, err = _require_admin()
    if err:
        return err
    return send_file(
        settings.DB_PATH, as_attachment=True, download_name="stream_intel.db"
    )


@bp.route("/upload-db", methods=["POST"])
def upload_db():
    # Allow either an authenticated admin OR a one-time migration secret
    migration_secret = os.environ.get("MIGRATION_SECRET", "")
    provided_secret = request.headers.get("X-Migration-Secret", "")
    if not (migration_secret and provided_secret and migration_secret == provided_secret):
        # Fall back to normal admin auth
        if not g.get("current_user"):
            from backend.auth import verify_token, _extract_token
            user = verify_token(_extract_token())
            if not user:
                return jsonify({"error": "Authentication required"}), 401
            g.current_user = user
        db = get_db()
        uid = g.current_user["user_id"]
        row = db.execute("SELECT is_admin FROM users WHERE id=?", (uid,)).fetchone()
        if not row or not row["is_admin"]:
            return jsonify({"error": "Admin access required"}), 403
    f = request.files.get("db")
    if not f:
        return jsonify({"error": "No file provided"}), 400
    f.save(str(settings.DB_PATH))
    return jsonify({"ok": True})
