# backend/routes/auth.py
import sqlite3
import os
import time
import json as _json
import httpx
from urllib.parse import urlencode
from flask import Blueprint, g, jsonify, request, make_response
from werkzeug.security import check_password_hash, generate_password_hash
from backend.auth import (
    make_token,
    require_auth,
    verify_token,
    _extract_token,
    _cache_invalidate,
)
from backend.database import get_db
from backend.config import settings

bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@bp.route("/ping", methods=["GET"])
def ping():
    """Simple health-check — open http://localhost:5000/api/auth/ping to confirm Flask is reachable."""
    return jsonify({"ok": True, "ts": time.time()})


@bp.route("/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()

    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400
    if len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters"}), 400
    if len(username) > 30:
        return jsonify({"error": "Username must be 30 characters or fewer"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    db = get_db()
    try:
        db.execute(
            "INSERT INTO users (username, password_hash, auth_type) VALUES (?,?,?)",
            (username, generate_password_hash(password), "password"),
        )
        db.commit()
        uid = db.execute(
            "SELECT id FROM users WHERE username=?", (username,)
        ).fetchone()["id"]
        token = make_token(uid)
        resp = jsonify({"ok": True, "username": username})
        resp.set_cookie(
            "si_token", token, max_age=settings.TOKEN_TTL, httponly=True, samesite="Lax"
        )
        return resp, 201
    except sqlite3.IntegrityError:
        return jsonify({"error": "Username already taken"}), 409


@bp.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()

    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400

    db = get_db()
    user = db.execute(
        "SELECT * FROM users WHERE username=? COLLATE NOCASE", (username,)
    ).fetchone()
    if (
        not user
        or not user["password_hash"]
        or not check_password_hash(user["password_hash"], password)
    ):
        return jsonify({"error": "Invalid username or password"}), 401

    db.execute("UPDATE users SET last_login=datetime('now') WHERE id=?", (user["id"],))
    db.commit()
    token = make_token(user["id"])
    resp = jsonify({"ok": True, "username": user["username"]})
    resp.set_cookie(
        "si_token", token, max_age=settings.TOKEN_TTL, httponly=True, samesite="Lax"
    )
    return resp


def _redirect_uri() -> str:
    """Build the OAuth callback URI.
    Priority:
      1. GOOGLE_REDIRECT_URI env var — explicit override, always wins.
      2. Derive from request.host — use https for anything that isn't localhost.
         This works correctly behind nginx/caddy reverse proxy without needing
         any host-specific env vars.
    """
    explicit = os.environ.get("GOOGLE_REDIRECT_URI")
    if explicit:
        return explicit
    try:
        host = (
            request.host
        )  # e.g. "api.yourdomain.com" or "localhost:5000"
        is_local = host.startswith("localhost") or host.startswith("127.")
        scheme = "http" if is_local else "https"
        return f"{scheme}://{host}/api/auth/google-callback"
    except RuntimeError:
        return settings.GOOGLE_REDIRECT_URI


@bp.route("/debug-redirect", methods=["GET"])
def debug_redirect():
    """Temporary: shows exactly what redirect_uri will be sent to Google and why."""
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    return jsonify(
        {
            "redirect_uri": _redirect_uri(),
            "GOOGLE_REDIRECT_URI": os.environ.get("GOOGLE_REDIRECT_URI"),
            "GOOGLE_CLIENT_ID_prefix": client_id[:30] + "..."
            if len(client_id) > 30
            else client_id,
            "PUBLIC_DOMAIN": os.environ.get("PUBLIC_DOMAIN"),
            "SERVER_NAME": os.environ.get("SERVER_NAME"),
            "request_url_root": request.url_root,
        }
    )


@bp.route("/migration-token", methods=["GET"])
@require_auth
def migration_token():
    """Generate a short-lived token for the migration script.
    Open this URL while logged in, copy the token, paste into the script.
    """
    import secrets as _secrets
    from datetime import datetime, timedelta

    uid = g.current_user["user_id"]
    token = _secrets.token_urlsafe(32)
    expires = (datetime.utcnow() + timedelta(hours=1)).isoformat()
    db = get_db()
    db.execute(
        "INSERT INTO tokens (user_id, token, expires_at) VALUES (?,?,?)",
        (uid, token, expires),
    )
    db.commit()
    return jsonify({"migration_token": token, "expires_in": "1 hour"})


@bp.route("/google-init", methods=["GET"])
def google_init():
    """Initiate Google OAuth flow."""
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        return jsonify({"error": "Google OAuth not configured"}), 400

    # Build Google OAuth URL
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": _redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
    }
    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
    return jsonify({"auth_url": auth_url})


@bp.route("/google-callback", methods=["GET"])
def google_callback():
    """Step 1 of OAuth: receive the code from Google and return an HTML page
    IMMEDIATELY (no outbound calls).  The page JS then POSTs the code to
    /api/auth/google-exchange which does the actual token exchange.

    This two-step design avoids ERR_FAILED: Chrome navigates to this URL and
    always gets a fast 200 response; the blocking httpx calls happen later
    inside a normal same-origin fetch, not inside the browser navigation."""
    error = request.args.get("error")
    code = request.args.get("code")

    if error or not code:
        msg = error or "No authorization code received"
        html = (
            "<!doctype html><html><head><meta charset='utf-8'><title>Login Failed</title>"
            "<style>body{font-family:sans-serif;display:flex;align-items:center;"
            "justify-content:center;height:100vh;margin:0;background:#0f1117;color:#fff}"
            "</style></head><body>"
            f"<p>Login failed: {msg}. <a href='/' style='color:#7c6af7'>Go back</a></p>"
            "</body></html>"
        )
        resp = make_response(html, 400)
        resp.headers["Content-Type"] = "text/html; charset=utf-8"
        return resp

    # json.dumps produces a valid JSON/JS string literal with correct escaping
    # for all characters (slashes, backslashes, quotes).  _html.escape is for
    # HTML attribute context only and is wrong here.
    safe_code_js = _json.dumps(code)  # e.g. '"4/0Afr..."'
    page = (
        "<!doctype html><html><head><meta charset='utf-8'><title>Signing in…</title>"
        "<style>body{font-family:sans-serif;display:flex;flex-direction:column;"
        "align-items:center;justify-content:center;height:100vh;margin:0;"
        "background:#0f1117;color:#fff;gap:12px}"
        "</style></head><body>"
        "<p id='msg'>Signing in with Google…</p>"
        "<script>\n"
        "(async () => {\n"
        "  try {\n"
        f"    const r = await fetch('/api/auth/google-exchange', {{\n"
        "      method: 'POST', credentials: 'include',\n"
        "      headers: {'Content-Type': 'application/json'},\n"
        f"      body: JSON.stringify({{code: {safe_code_js}}})\n"
        "    });\n"
        # Read as text first so a non-JSON body (Railway 502, Flask 500 HTML page)
        # never causes an opaque JSON SyntaxError — we surface a real message instead.
        "    const text = await r.text();\n"
        "    let d;\n"
        "    try { d = JSON.parse(text); } catch { d = {error: r.ok ? 'Unexpected server response' : ('HTTP ' + r.status)}; }\n"
        "    if (d.ok) { window.location.replace('/'); }\n"
        "    else { document.getElementById('msg').textContent = 'Login failed: ' + (d.error || 'Unknown error'); }\n"
        "  } catch (e) {\n"
        "    document.getElementById('msg').textContent = 'Sign-in failed: ' + e.message;\n"
        "  }\n"
        "})();\n"
        "</script></body></html>"
    )
    resp = make_response(page, 200)
    resp.headers["Content-Type"] = "text/html; charset=utf-8"
    return resp


@bp.route("/google-exchange", methods=["POST"])
def google_exchange():
    """Step 2 of OAuth: exchange the authorization code for a session token."""
    t0 = time.time()
    print(f"[OAUTH] google-exchange HIT  remote={request.remote_addr}", flush=True)
    data = request.get_json(silent=True) or {}
    code = (data.get("code") or "").strip()
    if not code:
        print("[OAUTH] google-exchange: no code in body", flush=True)
        return jsonify({"error": "No authorization code"}), 400

    try:
        print(
            f"[OAUTH] exchanging code with Google  redirect_uri={_redirect_uri()}",
            flush=True,
        )
        token_response = httpx.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": _redirect_uri(),
                "grant_type": "authorization_code",
            },
            timeout=15,
        )
        print(
            f"[OAUTH] token response status={token_response.status_code}  elapsed={time.time() - t0:.3f}s",
            flush=True,
        )
        token_response.raise_for_status()
        tokens = token_response.json()
        access_token = tokens.get("access_token")

        print("[OAUTH] fetching userinfo", flush=True)
        user_info_response = httpx.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=15,
        )
        print(
            f"[OAUTH] userinfo status={user_info_response.status_code}  elapsed={time.time() - t0:.3f}s",
            flush=True,
        )
        user_info_response.raise_for_status()
        user_info = user_info_response.json()

        google_id = user_info.get("id")
        email = user_info.get("email")
        name = user_info.get("name", email.split("@")[0] if email else "User")

        db = get_db()
        user = db.execute(
            "SELECT * FROM users WHERE google_id=?", (google_id,)
        ).fetchone()

        if user:
            db.execute(
                "UPDATE users SET last_login=datetime('now') WHERE id=?", (user["id"],)
            )
            db.commit()
            user_id = user["id"]
        else:
            existing = (
                db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
                if email
                else None
            )

            if existing:
                if not existing["google_id"]:
                    db.execute(
                        "UPDATE users SET google_id=?, auth_type='google', last_login=datetime('now') WHERE id=?",
                        (google_id, existing["id"]),
                    )
                    db.commit()
                    user_id = existing["id"]
                else:
                    return jsonify(
                        {"error": "Email already in use by another Google account"}
                    ), 409
            else:
                base = name or (email.split("@")[0] if email else "user")
                username_candidate = base
                suffix = 1
                while True:
                    if not db.execute(
                        "SELECT id FROM users WHERE username=? COLLATE NOCASE",
                        (username_candidate,),
                    ).fetchone():
                        break
                    username_candidate = f"{base}{suffix}"
                    suffix += 1
                try:
                    db.execute(
                        "INSERT INTO users (google_id, email, username, auth_type, setup_required) VALUES (?,?,?,?,1)",
                        (google_id, email, username_candidate, "google"),
                    )
                    db.commit()
                    user_id = db.execute(
                        "SELECT id FROM users WHERE google_id=?", (google_id,)
                    ).fetchone()["id"]
                except sqlite3.IntegrityError as exc:
                    err_str = str(exc).lower()
                    print(f"[AUTH] signup integrity error: {err_str}")
                    if "email" in err_str:
                        msg = "Email already in use"
                    elif "username" in err_str:
                        msg = "Username already taken"
                    elif "google_id" in err_str:
                        msg = "Google account already registered"
                    else:
                        msg = f"Account creation failed ({err_str})"
                    return jsonify({"error": msg}), 409

        token = make_token(user_id)
        resp = jsonify({"ok": True})
        resp.set_cookie(
            "si_token",
            token,
            max_age=settings.TOKEN_TTL,
            httponly=True,
            samesite="Lax",
        )
        return resp
    except Exception as e:
        print(f"[AUTH] google-exchange error: {e}")
        return jsonify({"error": f"OAuth failed: {str(e)}"}), 400


@bp.route("/google-mobile", methods=["POST"])
def google_mobile():
    """Exchange a server_auth_code from the native Android/iOS Google Sign-In SDK
    for a StreamIntel session token.  Returns the token as JSON (not a cookie)
    because mobile clients store it in AsyncStorage.
    """
    t0 = time.time()
    data = request.get_json(silent=True) or {}
    server_auth_code = (data.get("server_auth_code") or "").strip()
    if not server_auth_code:
        return jsonify({"error": "No server_auth_code provided"}), 400
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        return jsonify({"error": "Google OAuth not configured"}), 500

    try:
        # Mobile server auth codes require redirect_uri="" (empty string)
        token_response = httpx.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": server_auth_code,
                "client_id": os.environ.get(
                    "GOOGLE_MOBILE_CLIENT_ID", settings.GOOGLE_CLIENT_ID
                ),
                "client_secret": os.environ.get(
                    "GOOGLE_MOBILE_CLIENT_SECRET", settings.GOOGLE_CLIENT_SECRET
                ),
                "redirect_uri": "",
                "grant_type": "authorization_code",
            },
            timeout=15,
        )
        token_response.raise_for_status()
        tokens = token_response.json()
        access_token = tokens.get("access_token")

        user_info_response = httpx.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=15,
        )
        user_info_response.raise_for_status()
        user_info = user_info_response.json()

        google_id = user_info.get("id")
        email = user_info.get("email")
        name = user_info.get("name", email.split("@")[0] if email else "User")

        db = get_db()
        user = db.execute(
            "SELECT * FROM users WHERE google_id=?", (google_id,)
        ).fetchone()

        if user:
            db.execute(
                "UPDATE users SET last_login=datetime('now') WHERE id=?", (user["id"],)
            )
            db.commit()
            user_id = user["id"]
            setup_required = bool(user["setup_required"])
            username = user["username"]
        else:
            existing = (
                db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
                if email
                else None
            )
            if existing:
                if not existing["google_id"]:
                    db.execute(
                        "UPDATE users SET google_id=?, auth_type='google', last_login=datetime('now') WHERE id=?",
                        (google_id, existing["id"]),
                    )
                    db.commit()
                    user_id = existing["id"]
                    setup_required = bool(existing["setup_required"])
                    username = existing["username"]
                else:
                    return jsonify(
                        {"error": "Email already in use by another Google account"}
                    ), 409
            else:
                base = name or (email.split("@")[0] if email else "user")
                username_candidate = base
                suffix = 1
                while True:
                    if not db.execute(
                        "SELECT id FROM users WHERE username=? COLLATE NOCASE",
                        (username_candidate,),
                    ).fetchone():
                        break
                    username_candidate = f"{base}{suffix}"
                    suffix += 1
                try:
                    db.execute(
                        "INSERT INTO users (google_id, email, username, auth_type, setup_required) VALUES (?,?,?,?,1)",
                        (google_id, email, username_candidate, "google"),
                    )
                    db.commit()
                    user_id = db.execute(
                        "SELECT id FROM users WHERE google_id=?", (google_id,)
                    ).fetchone()["id"]
                    setup_required = True
                    username = username_candidate
                except sqlite3.IntegrityError as exc:
                    err_str = str(exc).lower()
                    if "email" in err_str:
                        return jsonify({"error": "Email already in use"}), 409
                    elif "username" in err_str:
                        return jsonify({"error": "Username already taken"}), 409
                    else:
                        return jsonify(
                            {"error": f"Account creation failed ({err_str})"}
                        ), 409

        token = make_token(user_id)
        print(
            f"[OAUTH-MOBILE] success user_id={user_id} elapsed={time.time() - t0:.3f}s",
            flush=True,
        )
        return jsonify(
            {
                "ok": True,
                "token": token,
                "setup_required": setup_required,
                "username": username,
            }
        )

    except Exception as e:
        print(f"[OAUTH-MOBILE] error: {e}", flush=True)
        return jsonify({"error": f"OAuth failed: {str(e)}"}), 400


@bp.route("/logout", methods=["POST"])
@require_auth
def logout():
    token = _extract_token()
    db = get_db()
    db.execute("UPDATE tokens SET revoked=1 WHERE token=?", (token,))
    db.commit()
    _cache_invalidate(token)
    resp = jsonify({"ok": True})
    resp.delete_cookie("si_token")
    return resp


@bp.route("/me")
def me():
    user = verify_token(_extract_token())
    if not user:
        return jsonify({"authenticated": False})
    db = get_db()
    stats = db.execute(
        """SELECT SUM(is_fav) as favourites,
                  SUM(status='watching') as watching,
                  SUM(status='finished') as finished
           FROM library WHERE user_id=?""",
        (user["user_id"],),
    ).fetchone()
    user_row = db.execute(
        "SELECT home_country, is_admin, setup_required FROM users WHERE id=?",
        (user["user_id"],),
    ).fetchone()
    return jsonify(
        {
            "authenticated": True,
            "username": user["username"],
            "favourites": int(stats["favourites"] or 0),
            "watching": int(stats["watching"] or 0),
            "finished": int(stats["finished"] or 0),
            "home_country": (user_row["home_country"] or "") if user_row else "",
            "is_admin": bool(user_row["is_admin"]) if user_row else False,
            "setup_required": bool(user_row["setup_required"]) if user_row else False,
        }
    )


@bp.route("/change-password", methods=["POST"])
@require_auth
def change_password():
    data = request.get_json(silent=True) or {}
    old_pw = (data.get("old_password") or "").strip()
    new_pw = (data.get("new_password") or "").strip()
    if not old_pw or not new_pw:
        return jsonify({"error": "Both passwords required"}), 400
    if len(new_pw) < 6:
        return jsonify({"error": "New password must be at least 6 characters"}), 400

    db = get_db()
    user = db.execute(
        "SELECT * FROM users WHERE id=?", (g.current_user["user_id"],)
    ).fetchone()
    if not user["password_hash"] or not check_password_hash(
        user["password_hash"], old_pw
    ):
        return jsonify({"error": "Current password is incorrect"}), 401

    db.execute(
        "UPDATE users SET password_hash=? WHERE id=?",
        (generate_password_hash(new_pw), user["id"]),
    )
    # Revoke all other tokens so old sessions are invalidated
    db.execute(
        "UPDATE tokens SET revoked=1 WHERE user_id=? AND token!=?",
        (user["id"], _extract_token()),
    )
    db.commit()
    return jsonify({"ok": True})


@bp.route("/setup-status")
def setup_status():
    db = get_db()
    count = db.execute("SELECT COUNT(*) as n FROM users").fetchone()["n"]
    return jsonify({"needs_setup": count == 0})
