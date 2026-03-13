# backend/routes/friends.py
import json
import threading
from flask import Blueprint, g, jsonify, request
from backend.auth import require_auth
from backend.database import get_db

bp = Blueprint("friends", __name__, url_prefix="/api")

NOTIF_PAGE_SIZE = 10


# ── helpers ──────────────────────────────────────────────────────────────────


def _me():
    return g.current_user["user_id"]


def _friendship_row(db, uid, other_id):
    """Return the friendship row between two users (either direction), or None."""
    return db.execute(
        """SELECT * FROM friendships
           WHERE (requester_id=? AND addressee_id=?)
              OR (requester_id=? AND addressee_id=?)""",
        (uid, other_id, other_id, uid),
    ).fetchone()


def _are_friends(db, uid, other_id):
    row = _friendship_row(db, uid, other_id)
    return row is not None and row["status"] == "accepted"


def _user_display(row):
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"] or row["username"],
        "profile_pic": row["profile_pic"],
    }


def _notif_dict(row):
    try:
        payload = json.loads(row["payload"])
    except Exception:
        payload = {}
    return {
        "id": row["id"],
        "type": row["type"],
        "actor_id": row["actor_id"],
        "actor_name": row["actor_name"],
        "actor_username": row["actor_username"],
        "actor_pic": row["actor_pic"],
        "payload": payload,
        "is_read": bool(row["is_read"]),
        "created_at": row["created_at"],
    }


# ── friends list ─────────────────────────────────────────────────────────────


@bp.route("/friends", methods=["GET"])
@require_auth
def list_friends():
    db = get_db()
    uid = _me()
    rows = db.execute(
        """SELECT u.id, u.username, u.display_name, u.profile_pic
           FROM friendships f
           JOIN users u ON u.id = CASE
               WHEN f.requester_id = ? THEN f.addressee_id
               ELSE f.requester_id
           END
           WHERE (f.requester_id=? OR f.addressee_id=?) AND f.status='accepted'
           ORDER BY u.username COLLATE NOCASE""",
        (uid, uid, uid),
    ).fetchall()
    return jsonify({"friends": [_user_display(r) for r in rows]})


# ── user search ───────────────────────────────────────────────────────────────


@bp.route("/friends/search", methods=["GET"])
@require_auth
def search_users():
    db = get_db()
    uid = _me()
    q = (request.args.get("q") or "").strip()
    if len(q) < 2:
        return jsonify({"users": []})

    # Single JOIN instead of N+1 _friendship_row calls per result
    rows = db.execute(
        """SELECT u.id, u.username, u.display_name, u.profile_pic,
                  f.status AS fs_status, f.requester_id AS fs_requester
           FROM users u
           LEFT JOIN friendships f ON (
               (f.requester_id = ? AND f.addressee_id = u.id) OR
               (f.addressee_id = ? AND f.requester_id = u.id)
           )
           WHERE u.username LIKE ? COLLATE NOCASE AND u.id != ?
           LIMIT 20""",
        (uid, uid, f"%{q}%", uid),
    ).fetchall()

    result = []
    for r in rows:
        fs_status = r["fs_status"]
        if fs_status is None:
            status = None
        elif fs_status == "accepted":
            status = "friends"
        elif r["fs_requester"] == uid:
            status = "request_sent"
        else:
            status = "request_received"
        result.append({**_user_display(r), "friendship_status": status})
    return jsonify({"users": result})


# ── send friend request ───────────────────────────────────────────────────────


@bp.route("/friends/request", methods=["POST"])
@require_auth
def send_request():
    db = get_db()
    uid = _me()
    data = request.get_json(silent=True) or {}
    other_id = data.get("user_id")
    if not other_id or other_id == uid:
        return jsonify({"error": "Invalid user"}), 400

    target = db.execute(
        "SELECT id, username, display_name FROM users WHERE id=?", (other_id,)
    ).fetchone()
    if not target:
        return jsonify({"error": "User not found"}), 404

    existing = _friendship_row(db, uid, other_id)
    if existing:
        if existing["status"] == "accepted":
            return jsonify({"error": "Already friends"}), 409
        if existing["requester_id"] == uid:
            return jsonify({"error": "Request already sent"}), 409
        # They already sent us a request — auto-accept
        db.execute(
            "UPDATE friendships SET status='accepted' WHERE id=?", (existing["id"],)
        )
        me_row = db.execute(
            "SELECT username, display_name FROM users WHERE id=?", (uid,)
        ).fetchone()
        _create_notification(
            db,
            other_id,
            uid,
            "friend_accepted",
            {
                "username": me_row["display_name"] or me_row["username"],
            },
        )
        db.commit()
        return jsonify({"ok": True, "status": "accepted"})

    db.execute(
        "INSERT INTO friendships (requester_id, addressee_id) VALUES (?,?)",
        (uid, other_id),
    )
    # Notify the addressee
    me_row = db.execute(
        "SELECT username, display_name FROM users WHERE id=?", (uid,)
    ).fetchone()
    _create_notification(
        db,
        other_id,
        uid,
        "friend_request",
        {
            "username": me_row["display_name"] or me_row["username"],
        },
    )
    db.commit()
    return jsonify({"ok": True, "status": "request_sent"})


# ── accept / reject ───────────────────────────────────────────────────────────


@bp.route("/friends/accept", methods=["POST"])
@require_auth
def accept_request():
    db = get_db()
    uid = _me()
    data = request.get_json(silent=True) or {}
    other_id = data.get("user_id")
    fs = db.execute(
        "SELECT * FROM friendships WHERE requester_id=? AND addressee_id=? AND status='pending'",
        (other_id, uid),
    ).fetchone()
    if not fs:
        return jsonify({"error": "No pending request"}), 404
    db.execute("UPDATE friendships SET status='accepted' WHERE id=?", (fs["id"],))
    me_row = db.execute(
        "SELECT username, display_name FROM users WHERE id=?", (uid,)
    ).fetchone()
    _create_notification(
        db,
        other_id,
        uid,
        "friend_accepted",
        {
            "username": me_row["display_name"] or me_row["username"],
        },
    )
    db.commit()
    return jsonify({"ok": True})


@bp.route("/friends/reject", methods=["POST"])
@require_auth
def reject_request():
    db = get_db()
    uid = _me()
    data = request.get_json(silent=True) or {}
    other_id = data.get("user_id")
    db.execute(
        "DELETE FROM friendships WHERE requester_id=? AND addressee_id=? AND status='pending'",
        (other_id, uid),
    )
    db.commit()
    return jsonify({"ok": True})


@bp.route("/friends/remove", methods=["POST"])
@require_auth
def remove_friend():
    db = get_db()
    uid = _me()
    data = request.get_json(silent=True) or {}
    other_id = data.get("user_id")
    db.execute(
        """DELETE FROM friendships
           WHERE (requester_id=? AND addressee_id=?)
              OR (requester_id=? AND addressee_id=?)""",
        (uid, other_id, other_id, uid),
    )
    db.commit()
    return jsonify({"ok": True})


# ── pending incoming requests ─────────────────────────────────────────────────


@bp.route("/friends/requests", methods=["GET"])
@require_auth
def pending_requests():
    db = get_db()
    uid = _me()
    rows = db.execute(
        """SELECT u.id, u.username, u.display_name, u.profile_pic, f.created_at
           FROM friendships f
           JOIN users u ON u.id = f.requester_id
           WHERE f.addressee_id=? AND f.status='pending'
           ORDER BY f.created_at DESC""",
        (uid,),
    ).fetchall()
    return jsonify(
        {
            "requests": [
                {**_user_display(r), "created_at": r["created_at"]} for r in rows
            ]
        }
    )


# ── pending outgoing (sent) requests ──────────────────────────────────────────


@bp.route("/friends/requests/sent", methods=["GET"])
@require_auth
def sent_requests():
    db = get_db()
    uid = _me()
    rows = db.execute(
        """SELECT u.id, u.username, u.display_name, u.profile_pic, f.created_at
           FROM friendships f
           JOIN users u ON u.id = f.addressee_id
           WHERE f.requester_id=? AND f.status='pending'
           ORDER BY f.created_at DESC""",
        (uid,),
    ).fetchall()
    return jsonify(
        {
            "requests": [
                {**_user_display(r), "created_at": r["created_at"]} for r in rows
            ]
        }
    )


@bp.route("/friends/request/<int:user_id>", methods=["DELETE"])
@require_auth
def cancel_friend_request(user_id):
    db = get_db()
    uid = _me()
    db.execute(
        "DELETE FROM friendships WHERE requester_id=? AND addressee_id=? AND status='pending'",
        (uid, user_id),
    )
    db.commit()
    return jsonify({"ok": True})


# ── share action with friends ─────────────────────────────────────────────────

# ── FCM (Firebase Cloud Messaging) ──────────────────────────────────

_fcm_app = None
_fcm_lock = threading.Lock()


def _get_fcm_app():
    """Lazily initialise the Firebase Admin app (singleton)."""
    global _fcm_app
    if _fcm_app is not None:
        return _fcm_app
    with _fcm_lock:
        if _fcm_app is not None:
            return _fcm_app
        import json as _json
        import sys

        try:
            import firebase_admin
            from firebase_admin import credentials
            from backend.config import settings

            sa_json = settings.FIREBASE_SERVICE_ACCOUNT_JSON
            if not sa_json:
                return None
            sa_dict = _json.loads(sa_json)
            cred = credentials.Certificate(sa_dict)
            _fcm_app = firebase_admin.initialize_app(cred)
        except Exception as exc:
            print(f"[FCM] init error: {exc}", file=sys.stderr)
            _fcm_app = None
    return _fcm_app


def _send_fcm_async(user_id: int, title: str, body: str):
    """Fire-and-forget: send FCM push to all device tokens of user_id."""

    def _run():
        import sys
        import sqlite3

        try:
            app = _get_fcm_app()
            if app is None:
                return
            from firebase_admin import messaging
            from backend.config import settings

            conn = sqlite3.connect(str(settings.DB_PATH))
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT token FROM device_tokens WHERE user_id=?", (user_id,)
            ).fetchall()
            conn.close()
            for row in rows:
                try:
                    messaging.send(
                        messaging.Message(
                            notification=messaging.Notification(title=title, body=body),
                            token=row["token"],
                        )
                    )
                    print(f"[FCM] sent to user {user_id}", file=sys.stderr)
                except Exception as exc:
                    print(
                        f"[FCM] send error for user {user_id}: {exc}", file=sys.stderr
                    )
                    # Remove stale / invalid tokens
                    err_str = str(exc)
                    if any(
                        k in err_str
                        for k in (
                            "registration-token-not-registered",
                            "invalid-argument",
                            "InvalidArgument",
                            "UNREGISTERED",
                        )
                    ):
                        conn2 = sqlite3.connect(str(settings.DB_PATH))
                        conn2.execute(
                            "DELETE FROM device_tokens WHERE token=?", (row["token"],)
                        )
                        conn2.commit()
                        conn2.close()
        except Exception as exc:
            print(f"[FCM] unexpected error: {exc}", file=sys.stderr)

    threading.Thread(target=_run, daemon=True).start()


# ── Web Push ────────────────────────────────────────────────────────


def _send_push_async(user_id: int, payload: dict):
    """Fire-and-forget: send Web Push to all subscriptions of user_id."""

    def _run():
        import sys
        import sqlite3
        import json as _json

        try:
            from backend.config import settings
            from pywebpush import webpush, WebPushException
            from py_vapid import Vapid01

            if not settings.VAPID_PRIVATE_PEM:
                print(
                    "[push] VAPID_PRIVATE_PEM not set — skipping push", file=sys.stderr
                )
                return

            vapid_obj = Vapid01.from_pem(settings.VAPID_PRIVATE_PEM.encode("utf-8"))

            db_path = str(settings.DB_PATH)
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=?",
                (user_id,),
            ).fetchall()
            conn.close()

            if not rows:
                print(f"[push] no subscriptions for user {user_id}", file=sys.stderr)
                return

            for row in rows:
                try:
                    webpush(
                        subscription_info={
                            "endpoint": row["endpoint"],
                            "keys": {"p256dh": row["p256dh"], "auth": row["auth"]},
                        },
                        data=_json.dumps(payload),
                        vapid_private_key=vapid_obj,
                        vapid_claims={"sub": f"mailto:{settings.VAPID_CLAIMS_EMAIL}"},
                    )
                    print(f"[push] sent to user {user_id}", file=sys.stderr)
                except WebPushException as ex:
                    status = ex.response.status_code if ex.response else None
                    print(
                        f"[push] WebPushException status={status}: {ex}",
                        file=sys.stderr,
                    )
                    # 401/403/404/410 = subscription stale or key mismatch — delete it
                    if status in (401, 403, 404, 410):
                        conn2 = sqlite3.connect(db_path)
                        conn2.execute(
                            "DELETE FROM push_subscriptions WHERE endpoint=?",
                            (row["endpoint"],),
                        )
                        conn2.commit()
                        conn2.close()
        except Exception as exc:
            print(f"[push] unexpected error: {exc}", file=sys.stderr)

    threading.Thread(target=_run, daemon=True).start()


@bp.route("/push/vapid-public-key", methods=["GET"])
def vapid_public_key():
    from backend.config import settings

    return jsonify({"publicKey": settings.VAPID_PUBLIC_KEY})


@bp.route("/push/subscribe", methods=["POST"])
@require_auth
def push_subscribe():
    db = get_db()
    uid = _me()
    sub = request.get_json(silent=True) or {}
    endpoint = sub.get("endpoint")
    p256dh = (sub.get("keys") or {}).get("p256dh")
    auth = (sub.get("keys") or {}).get("auth")
    if not (endpoint and p256dh and auth):
        return jsonify({"error": "Invalid subscription"}), 400
    db.execute(
        """INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
           VALUES (?,?,?,?)
           ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,
               p256dh=excluded.p256dh, auth=excluded.auth""",
        (uid, endpoint, p256dh, auth),
    )
    db.commit()
    return jsonify({"ok": True})


@bp.route("/push/unsubscribe", methods=["POST"])
@require_auth
def push_unsubscribe():
    db = get_db()
    sub = request.get_json(silent=True) or {}
    endpoint = sub.get("endpoint")
    if endpoint:
        db.execute("DELETE FROM push_subscriptions WHERE endpoint=?", (endpoint,))
        db.commit()
    return jsonify({"ok": True})


@bp.route("/push/device-token", methods=["POST"])
@require_auth
def register_device_token():
    db = get_db()
    uid = _me()
    data = request.get_json(silent=True) or {}
    token = (data.get("token") or "").strip()
    platform = (data.get("platform") or "android").strip().lower()
    if not token:
        return jsonify({"error": "token is required"}), 400
    db.execute(
        """INSERT INTO device_tokens (user_id, token, platform)
           VALUES (?, ?, ?)
           ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id,
               platform=excluded.platform""",
        (uid, token, platform),
    )
    db.commit()
    return jsonify({"ok": True})


@bp.route("/push/device-token", methods=["DELETE"])
@require_auth
def unregister_device_token():
    db = get_db()
    uid = _me()
    data = request.get_json(silent=True) or {}
    token = (data.get("token") or "").strip()
    if token:
        db.execute(
            "DELETE FROM device_tokens WHERE token=? AND user_id=?", (token, uid)
        )
        db.commit()
    return jsonify({"ok": True})


@bp.route("/friends/share", methods=["POST"])
@require_auth
def share_action():
    db = get_db()
    uid = _me()
    data = request.get_json(silent=True) or {}
    friend_ids = data.get("friend_ids") or []
    action = data.get("action") or {}  # {type, title, platform, status, ...}

    if not friend_ids or not action:
        return jsonify({"error": "Missing fields"}), 400

    me_row = db.execute(
        "SELECT username, display_name FROM users WHERE id=?", (uid,)
    ).fetchone()
    actor_name = me_row["display_name"] or me_row["username"]

    sent = 0
    for fid in friend_ids:
        if not _are_friends(db, uid, fid):
            continue
        # Determine notification type — "title_message" for compose-message flow,
        # "shared_action" for automatic status/fav changes.
        ntype = action.get("type", "shared_action")
        if ntype not in ("shared_action", "title_message"):
            ntype = "shared_action"
        _create_notification(
            db,
            fid,
            uid,
            ntype,
            {
                "actor_name": actor_name,
                **{k: v for k, v in action.items() if k != "type"},
            },
        )
        sent += 1

    db.commit()
    return jsonify({"ok": True, "sent": sent})


# ── friend public profile ────────────────────────────────────────────────────


@bp.route("/friends/<int:uid>/profile", methods=["GET"])
@require_auth
def friend_profile(uid):
    from backend.routes.profile import _fmt_time

    db = get_db()
    me = _me()
    if not _are_friends(db, me, uid):
        return jsonify({"error": "Not friends"}), 403
    user = db.execute(
        "SELECT username, display_name, profile_pic, library_public FROM users WHERE id=?",
        (uid,),
    ).fetchone()
    if not user:
        return jsonify({"error": "User not found"}), 404
    cached = db.execute("SELECT * FROM user_stats WHERE user_id=?", (uid,)).fetchone()
    stats = None
    if cached:
        mm = cached["movie_mins"] or 0
        tm = cached["tv_mins"] or 0
        stats = {
            "movies_finished": cached["movies_finished"],
            "movies_watching": cached["movies_watching"],
            "movies_in_library": cached["movies_in_library"],
            "tv_finished": cached["tv_finished"],
            "tv_watching": cached["tv_watching"],
            "episodes_watched": cached["episodes_watched"],
            "movie_watch_time": _fmt_time(mm),
            "tv_watch_time": _fmt_time(tm),
            "total_watch_time": _fmt_time(mm + tm),
            "top_genres": json.loads(cached["top_genres"] or "[]"),
        }
    return jsonify(
        {
            "id": uid,
            "username": user["username"],
            "display_name": user["display_name"] or user["username"],
            "profile_pic": user["profile_pic"] or "",
            "library_public": bool(user["library_public"]),
            "stats": stats,
        }
    )


@bp.route("/friends/<int:uid>/watched", methods=["GET"])
@require_auth
def friend_watched(uid):
    db = get_db()
    me = _me()
    if not _are_friends(db, me, uid):
        return jsonify({"error": "Not friends"}), 403
    rows = db.execute(
        """SELECT l.platform, l.title,
                  MAX(t.content_type) AS content_type,
                  MAX(t.release_year) AS release_year
           FROM library l
           LEFT JOIN titles t ON t.platform = l.platform AND t.title = l.title
           WHERE l.user_id = ? AND l.status IN ('finished', 'watching')
           GROUP BY l.platform, l.title
           ORDER BY l.updated_at DESC LIMIT 30""",
        (uid,),
    ).fetchall()
    return jsonify({"titles": [dict(r) for r in rows]})


@bp.route("/friends/<int:uid>/library", methods=["GET"])
@require_auth
def friend_library(uid):
    """Return a friend's full library if they have made it public."""
    db = get_db()
    me = _me()
    if not _are_friends(db, me, uid):
        return jsonify({"error": "Not friends"}), 403
    user = db.execute("SELECT library_public FROM users WHERE id=?", (uid,)).fetchone()
    if not user or not user["library_public"]:
        return jsonify({"error": "Library is private"}), 403
    rows = db.execute(
        """SELECT l.platform, l.title, l.is_fav, l.status,
                  MAX(t.content_type) AS content_type,
                  MAX(t.release_year) AS release_year,
                  MAX(t.imdb_score) AS imdb_score,
                  MAX(t.tomatometer) AS tomatometer,
                  l.updated_at
           FROM library l
           LEFT JOIN titles t ON t.platform = l.platform AND t.title = l.title
           WHERE l.user_id=?
           GROUP BY l.platform, l.title
           ORDER BY l.updated_at DESC""",
        (uid,),
    ).fetchall()
    return jsonify({"library": [dict(r) for r in rows]})


# ── notifications ─────────────────────────────────────────────────────────────


def _push_body_for(ntype: str, actor_name: str, payload: dict) -> str:
    """Build a short human-readable push notification body."""
    name = actor_name or "Someone"
    title = payload.get("title", "")
    if ntype == "friend_request":
        return f"{name} sent you a friend request."
    if ntype == "friend_accepted":
        return f"{name} accepted your friend request."
    if ntype == "title_message":
        msg = payload.get("message", "")
        snippet = (msg[:60] + "\u2026") if len(msg) > 60 else msg
        if title:
            return f"{name} about \u201c{title}\u201d: \u201c{snippet}\u201d"
        return f"{name}: \u201c{snippet}\u201d"
    if ntype == "shared_action":
        status = payload.get("status")
        is_fav = payload.get("is_fav")
        status_map = {
            "watchlist": f"{name} added \u201c{title}\u201d to their watchlist.",
            "watching": f"{name} is watching \u201c{title}\u201d.",
            "finished": f"{name} finished watching \u201c{title}\u201d.",
            "not-started": f"{name} removed \u201c{title}\u201d from their library.",
        }
        if status and status in status_map:
            body = status_map[status]
            if is_fav is True:
                body = body.rstrip(".") + " and marked it as favourite."
            if is_fav is False:
                body = body.rstrip(".") + " and removed it from favourites."
            return body
        if is_fav is True:
            return f"{name} favourited \u201c{title}\u201d."
        if is_fav is False:
            return f"{name} unfavourited \u201c{title}\u201d."
    return "You have a new notification."


def _create_notification(db, user_id, actor_id, ntype, payload):
    # For shared_action: deduplicate within a 5-minute window so rapid
    # re-renders / double-clicks can't create duplicate notifications.
    if ntype == "shared_action":
        # Pass scalar values directly — avoids json_extract-on-parameter overhead
        existing = db.execute(
            """SELECT id FROM notifications
               WHERE user_id=? AND actor_id=? AND type='shared_action'
               AND json_extract(payload,'$.title')=?
               AND json_extract(payload,'$.status') IS ?
               AND json_extract(payload,'$.is_fav')  IS ?
               AND created_at >= datetime('now','-5 minutes')""",
            (
                user_id,
                actor_id,
                payload.get("title", ""),
                payload.get("status"),
                payload.get("is_fav"),
            ),
        ).fetchone()
        if existing:
            return
    db.execute(
        "INSERT INTO notifications (user_id, actor_id, type, payload) VALUES (?,?,?,?)",
        (user_id, actor_id, ntype, json.dumps(payload)),
    )
    # Cap notifications per user at 100 to prevent unbounded table growth
    db.execute(
        """DELETE FROM notifications WHERE user_id=? AND id NOT IN (
               SELECT id FROM notifications WHERE user_id=?
               ORDER BY created_at DESC LIMIT 100
           )""",
        (user_id, user_id),
    )
    # Fire Web Push — actor_name is already stored in payload (avoids extra SELECT)
    actor_name = payload.get("actor_name") or ""
    body = _push_body_for(ntype, actor_name, payload)
    _send_push_async(user_id, {"title": "StreamIntel", "body": body, "url": "/"})


@bp.route("/notifications", methods=["GET"])
@require_auth
def get_notifications():
    db = get_db()
    uid = _me()
    offset = int(request.args.get("offset", 0))
    limit = NOTIF_PAGE_SIZE + 1  # fetch one extra to determine has_more

    rows = db.execute(
        """SELECT n.id, n.type, n.actor_id, n.payload, n.is_read, n.created_at,
                  COALESCE(u.display_name, u.username) AS actor_name,
                  u.username AS actor_username,
                  u.profile_pic AS actor_pic
           FROM notifications n
           LEFT JOIN users u ON u.id = n.actor_id
           WHERE n.user_id=?
           ORDER BY n.created_at DESC
           LIMIT ? OFFSET ?""",
        (uid, limit, offset),
    ).fetchall()

    has_more = len(rows) > NOTIF_PAGE_SIZE
    rows = rows[:NOTIF_PAGE_SIZE]

    unread = db.execute(
        "SELECT COUNT(*) as n FROM notifications WHERE user_id=? AND is_read=0", (uid,)
    ).fetchone()["n"]

    return jsonify(
        {
            "notifications": [_notif_dict(r) for r in rows],
            "unread": unread,
            "has_more": has_more,
            "offset": offset,
        }
    )


@bp.route("/notifications/read", methods=["POST"])
@require_auth
def mark_read():
    db = get_db()
    uid = _me()
    data = request.get_json(silent=True) or {}
    nid = data.get("id")  # None → mark all
    if nid:
        db.execute(
            "UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?", (nid, uid)
        )
    else:
        db.execute("UPDATE notifications SET is_read=1 WHERE user_id=?", (uid,))
    db.commit()
    return jsonify({"ok": True})


@bp.route("/notifications/<int:nid>", methods=["DELETE"])
@require_auth
def delete_notification(nid):
    db = get_db()
    uid = _me()
    db.execute("DELETE FROM notifications WHERE id=? AND user_id=?", (nid, uid))
    db.commit()
    return jsonify({"ok": True})


@bp.route("/notifications", methods=["DELETE"])
@require_auth
def clear_all_notifications():
    db = get_db()
    uid = _me()
    db.execute("DELETE FROM notifications WHERE user_id=?", (uid,))
    db.commit()
    return jsonify({"ok": True})
