# backend/app.py
import logging
import json
import os
import sqlite3
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from flask import Flask, send_from_directory, jsonify
from werkzeug.middleware.proxy_fix import ProxyFix
from backend.config import settings
from backend.database import init_db, close_db
from backend.routes import all_blueprints


def _suppress_root_post_logs() -> None:
    """Monkey-patch WSGIRequestHandler.log_request to silently drop
    POST / access-log entries.  This is more reliable than a logging
    Filter because it intercepts at the source, before Werkzeug's dev
    server has a chance to reconfigure the werkzeug logger or its handlers."""
    try:
        from werkzeug.serving import WSGIRequestHandler

        _original = WSGIRequestHandler.log_request

        def _patched(self, code="-", size="-"):
            if (
                getattr(self, "command", None) == "POST"
                and getattr(self, "path", None) == "/"
            ):
                return  # silently drop POST / noise
            _original(self, code, size)

        WSGIRequestHandler.log_request = _patched
    except Exception:
        pass  # not in dev-server context (e.g. gunicorn) — nothing to patch


_suppress_root_post_logs()


def _auto_scrape_loop(interval_days: int) -> None:
    """
    Background daemon thread — keeps the catalog fresh automatically.

    On first startup it waits 90 seconds so the web server is fully up, then
    checks whether the most recent successful scrape is older than
    ``interval_days``.  If it is (or there has never been a scrape), it runs
    the scraper using the same mode + regions as the last run, or falls back
    to ``all / ALL`` when no previous run exists.

    After each check it sleeps for ``interval_days`` and repeats.

    Control knobs (env vars):
      AUTO_SCRAPE_INTERVAL_DAYS  — how many days between runs (0 = disabled)
    """
    interval_secs = interval_days * 86_400
    runner_path = str(Path(__file__).parent / "scraper" / "runner.py")

    def _last_run_info():
        """Return (last_started_at_str, mode, regions_list) or None."""
        try:
            con = sqlite3.connect(str(settings.DB_PATH))
            con.row_factory = sqlite3.Row
            row = con.execute(
                "SELECT started_at, mode, regions FROM scrape_runs "
                "WHERE status='done' ORDER BY id DESC LIMIT 1"
            ).fetchone()
            con.close()
            if row:
                return row["started_at"], row["mode"], json.loads(row["regions"])
        except Exception:
            pass
        return None

    def _run_scrape(mode, regions_list):
        print(
            f"[AUTO-SCRAPE] starting scrape mode={mode} regions={regions_list}",
            flush=True,
        )
        # Record the run in scrape_runs so _last_run_info() can track completion.
        run_id = None
        final_status = "error"
        try:
            with sqlite3.connect(str(settings.DB_PATH)) as _con:
                cur = _con.execute(
                    "INSERT INTO scrape_runs (mode, regions, status) VALUES (?,?,?)",
                    (mode, json.dumps(regions_list), "running"),
                )
                run_id = cur.lastrowid
                _con.commit()
        except Exception as exc:
            print(f"[AUTO-SCRAPE] failed to create run record: {exc}", flush=True)
        cmd = [
            sys.executable,
            runner_path,
            "--mode",
            mode,
            "--db",
            str(settings.DB_PATH),
        ]
        # regions list may be ["ALL"] — the runner expands that itself
        if regions_list and regions_list != ["ALL"]:
            cmd += ["--regions"] + regions_list
        env = os.environ.copy()
        base_str = str(Path(__file__).parent.parent)
        existing_pp = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = (
            f"{base_str}{os.pathsep}{existing_pp}" if existing_pp else base_str
        )
        if run_id is not None:
            env["SI_RUN_ID"] = str(run_id)
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                cwd=base_str,
                env=env,
            )
            if result.returncode == 0:
                print("[AUTO-SCRAPE] scrape finished successfully", flush=True)
                final_status = "done"
            else:
                print(
                    f"[AUTO-SCRAPE] scrape exited with code {result.returncode}",
                    flush=True,
                )
                if result.stderr:
                    print(f"[AUTO-SCRAPE] stderr: {result.stderr[-2000:]}", flush=True)
        except Exception as exc:
            print(f"[AUTO-SCRAPE] error running scraper: {exc}", flush=True)
        # Update the run record with final status and title count.
        if run_id is not None:
            try:
                with sqlite3.connect(str(settings.DB_PATH)) as _con:
                    _con.row_factory = sqlite3.Row
                    n = _con.execute(
                        "SELECT COUNT(*) AS n FROM titles WHERE run_id=?", (run_id,)
                    ).fetchone()["n"]
                    _con.execute(
                        "UPDATE scrape_runs SET finished_at=datetime('now'), "
                        "title_count=?, status=? WHERE id=?",
                        (n, final_status, run_id),
                    )
                    _con.commit()
                print(
                    f"[AUTO-SCRAPE] run record updated: status={final_status}, titles={n}",
                    flush=True,
                )
            except Exception as exc:
                print(f"[AUTO-SCRAPE] failed to update run record: {exc}", flush=True)

    # Use a shorter startup delay when the DB has no titles yet (fresh volume).
    try:
        with sqlite3.connect(str(settings.DB_PATH)) as _chk:
            _has_titles = _chk.execute("SELECT COUNT(*) FROM titles").fetchone()[0] > 0
    except Exception:
        _has_titles = False
    startup_wait = 90 if _has_titles else 10
    print(
        f"[AUTO-SCRAPE] startup wait: {startup_wait}s (titles present: {_has_titles})",
        flush=True,
    )
    time.sleep(startup_wait)

    while True:
        try:
            info = _last_run_info()
            if info is None:
                # No successful scrape yet — use trending for a fast initial fill.
                # A full catalog scrape (all/ALL) takes hours; trending takes minutes.
                print(
                    "[AUTO-SCRAPE] no previous run found, running initial trending scrape",
                    flush=True,
                )
                _run_scrape("trending", ["ALL"])
            else:
                last_dt_str, mode, regions_list = info
                try:
                    last_dt = datetime.fromisoformat(last_dt_str)
                except ValueError:
                    last_dt = datetime.utcnow()
                age_secs = (datetime.utcnow() - last_dt).total_seconds()
                if age_secs >= interval_secs:
                    print(
                        f"[AUTO-SCRAPE] catalog is {age_secs / 86400:.1f}d old "
                        f"(threshold {interval_days}d), re-scraping…",
                        flush=True,
                    )
                    _run_scrape(mode, regions_list)
                else:
                    remaining = interval_secs - age_secs
                    print(
                        f"[AUTO-SCRAPE] catalog is fresh "
                        f"({age_secs / 86400:.1f}d old), next check in "
                        f"{remaining / 3600:.1f}h",
                        flush=True,
                    )
                    time.sleep(remaining)
                    continue
        except Exception as exc:
            print(f"[AUTO-SCRAPE] unexpected error: {exc}", flush=True)

        # Sleep until the next scheduled check
        time.sleep(interval_secs)


def create_app() -> Flask:
    app = Flask(__name__, static_folder=str(settings.UI_DIR))
    app.secret_key = settings.SECRET_KEY

    # Trust the X-Forwarded-Proto/Host headers from Railway's proxy so that
    # request.url_root returns https://... instead of http://...
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    # Register teardown
    app.teardown_appcontext(close_db)

    # Register all blueprints
    for bp in all_blueprints:
        app.register_blueprint(bp)

    # Serve the frontend
    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_ui(path):
        from flask import make_response

        target = settings.UI_DIR / path
        if path and target.exists():
            resp = make_response(send_from_directory(str(settings.UI_DIR), path))
            # CSS/JS: revalidate every time so stale assets are never served
            if path.endswith((".css", ".js")):
                resp.headers["Cache-Control"] = "no-cache, must-revalidate"
            return resp
        resp = make_response(send_from_directory(str(settings.UI_DIR), "index.html"))
        # HTML: never cache — always fetch fresh so asset references stay current
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        return resp

    # explicitly handle POSTs to root to avoid Werkzeug logging them as 405s
    @app.route("/", methods=["POST"])
    def reject_root_post():
        from flask import jsonify

        return jsonify({"error": "Method not allowed"}), 405

    # Initialise or migrate the database
    # init_db() will create the file if missing or apply migrations otherwise.
    with app.app_context():
        init_db()

    # Start the background auto-scrape thread (only once, not in reloader child)
    # Disabled when AUTO_SCRAPE_INTERVAL_DAYS=0
    interval_days = int(os.getenv("AUTO_SCRAPE_INTERVAL_DAYS", "7"))
    if interval_days > 0 and os.environ.get("WERKZEUG_RUN_MAIN") != "false":
        t = threading.Thread(
            target=_auto_scrape_loop, args=(interval_days,), daemon=True
        )
        t.start()
        print(
            f"[AUTO-SCRAPE] background thread started (interval={interval_days}d)",
            flush=True,
        )

    @app.route("/api/debug")
    def debug_status():
        """Unauthenticated status endpoint — useful for verifying DB and scrape state."""
        import shutil
        db_path = str(settings.DB_PATH)
        info: dict = {
            "db_path": db_path,
            "db_exists": os.path.exists(db_path),
            "db_size_mb": 0,
            "db_writable": False,
            "disk_free_mb": None,
            "disk_total_mb": None,
            "titles": 0,
            "users": 0,
            "last_scrape": None,
        }
        try:
            parent = str(Path(db_path).parent)
            info["db_writable"] = bool(
                os.access(db_path, os.W_OK)
                if os.path.exists(db_path)
                else os.access(parent, os.W_OK)
            )
            if os.path.exists(db_path):
                info["db_size_mb"] = round(os.path.getsize(db_path) / 1_048_576, 2)
            try:
                usage = shutil.disk_usage(parent)
                info["disk_free_mb"]  = round(usage.free  / 1_048_576, 1)
                info["disk_total_mb"] = round(usage.total / 1_048_576, 1)
            except Exception:
                pass
            with sqlite3.connect(db_path) as _con:
                _con.row_factory = sqlite3.Row
                info["titles"] = _con.execute("SELECT COUNT(*) FROM titles").fetchone()[0]
                info["users"]  = _con.execute("SELECT COUNT(*) FROM users").fetchone()[0]
                row = _con.execute(
                    "SELECT id, started_at, finished_at, mode, status, title_count "
                    "FROM scrape_runs ORDER BY id DESC LIMIT 1"
                ).fetchone()
                if row:
                    info["last_scrape"] = dict(row)
        except Exception as exc:
            info["error"] = str(exc)
        return jsonify(info)

    @app.errorhandler(500)
    def internal_error(e):
        import traceback
        tb = traceback.format_exc()
        print(f"[500] Unhandled exception:\n{tb}", flush=True)
        return jsonify({"error": "Internal server error", "detail": str(e)}), 500

    # global handler for 405 so we can log the offending requests
    @app.errorhandler(405)
    def method_not_allowed(e):
        # ignore noisy POSTs to root that browsers sometimes send
        from flask import request

        path = request.path
        if not (path == "/" and request.method == "POST"):
            # only log API-related 405s at warning level; others as debug
            msg = f"405 on {request.method} {path}"
            if path.startswith("/api"):
                app.logger.warning(msg)
            else:
                app.logger.debug(msg)
        return jsonify({"error": "Method not allowed"}), 405

    return app
