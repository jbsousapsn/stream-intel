# backend/database.py
import sqlite3
from flask import g
from backend.config import settings

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    UNIQUE COLLATE NOCASE,
    password_hash TEXT,
    email         TEXT    UNIQUE,
    google_id     TEXT    UNIQUE,
    auth_type     TEXT    NOT NULL DEFAULT 'password',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login    TEXT,
    home_country  TEXT,
    is_admin      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT    NOT NULL UNIQUE,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT    NOT NULL,
    revoked    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scrape_runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    finished_at  TEXT,
    mode         TEXT    NOT NULL,
    regions      TEXT    NOT NULL,
    title_count  INTEGER DEFAULT 0,
    status       TEXT    NOT NULL DEFAULT 'running'
);

CREATE TABLE IF NOT EXISTS titles (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           INTEGER REFERENCES scrape_runs(id) ON DELETE SET NULL,
    scraped_at       TEXT    NOT NULL,
    platform         TEXT    NOT NULL,
    region           TEXT    NOT NULL,
    title            TEXT    NOT NULL,
    content_type     TEXT,
    genre            TEXT,
    release_year     TEXT,
    ranking_position INTEGER DEFAULT 0,
    synopsis         TEXT,
    maturity_rating  TEXT,
    is_trending      INTEGER DEFAULT 0,
    source_url       TEXT,
    imdb_score       REAL    DEFAULT 0,
    imdb_votes       INTEGER DEFAULT 0,
    tomatometer      INTEGER DEFAULT 0,
    tmdb_score       REAL    DEFAULT 0,
    runtime_mins     INTEGER DEFAULT 0,
    UNIQUE(platform, region, title) ON CONFLICT REPLACE
);

CREATE INDEX IF NOT EXISTS idx_titles_platform ON titles(platform);
CREATE INDEX IF NOT EXISTS idx_titles_region   ON titles(region);
CREATE INDEX IF NOT EXISTS idx_titles_trending ON titles(is_trending);
CREATE INDEX IF NOT EXISTS idx_titles_imdb     ON titles(imdb_score);
CREATE INDEX IF NOT EXISTS idx_titles_filter   ON titles(platform, region, content_type, is_trending);
CREATE INDEX IF NOT EXISTS idx_titles_rank        ON titles(ranking_position, imdb_score DESC);
CREATE INDEX IF NOT EXISTS idx_titles_pt          ON titles(platform, title);
CREATE INDEX IF NOT EXISTS idx_titles_rank_region ON titles(platform, title, ranking_position, region);

CREATE TABLE IF NOT EXISTS library (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform   TEXT    NOT NULL,
    title      TEXT    NOT NULL,
    is_fav     INTEGER NOT NULL DEFAULT 0,
    status     TEXT    NOT NULL DEFAULT 'not-started',
    notes      TEXT,
    user_rating INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, platform, title) ON CONFLICT REPLACE
);

CREATE INDEX IF NOT EXISTS idx_library_user         ON library(user_id);
CREATE INDEX IF NOT EXISTS idx_library_user_plat_title ON library(user_id, platform, title);

CREATE TABLE IF NOT EXISTS watched_seasons (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform     TEXT    NOT NULL,
    title        TEXT    NOT NULL,
    season_num   INTEGER NOT NULL DEFAULT 0,
    ep_mask      INTEGER NOT NULL DEFAULT 0,
    runtime_mins INTEGER NOT NULL DEFAULT 0,
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, platform, title, season_num)
);

CREATE INDEX IF NOT EXISTS idx_ws_user ON watched_seasons(user_id);
CREATE INDEX IF NOT EXISTS idx_ws_show ON watched_seasons(user_id, platform, title);

CREATE TABLE IF NOT EXISTS poster_cache (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    cache_key    TEXT    NOT NULL UNIQUE,
    poster_url   TEXT,
    backdrop_url TEXT,
    fetched_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at   TEXT    NOT NULL DEFAULT (datetime('now', '+90 days'))
);

CREATE INDEX IF NOT EXISTS idx_poster_cache_expires ON poster_cache(expires_at);

CREATE TABLE IF NOT EXISTS tmdb_show_cache (
    title_key    TEXT NOT NULL PRIMARY KEY,
    tmdb_id      INTEGER,
    is_ongoing   INTEGER NOT NULL DEFAULT 0,
    end_year     TEXT,
    next_ep_json TEXT,
    season_num   INTEGER,
    season_json  TEXT,
    poster_thumb TEXT,
    cast_json    TEXT,
    show_overview TEXT,
    fetched_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at   TEXT    NOT NULL DEFAULT (datetime('now', '+6 hours'))
);

CREATE TABLE IF NOT EXISTS platform_logos (
    platform_key TEXT NOT NULL PRIMARY KEY,
    logo_url     TEXT NOT NULL,
    fetched_at   TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at   TEXT NOT NULL DEFAULT (datetime('now', '+30 days'))
);

CREATE TABLE IF NOT EXISTS user_stats (
    user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    movie_mins       INTEGER NOT NULL DEFAULT 0,
    tv_mins          INTEGER NOT NULL DEFAULT 0,
    movies_finished  INTEGER NOT NULL DEFAULT 0,
    movies_watching  INTEGER NOT NULL DEFAULT 0,
    movies_in_library INTEGER NOT NULL DEFAULT 0,
    tv_finished      INTEGER NOT NULL DEFAULT 0,
    tv_watching      INTEGER NOT NULL DEFAULT 0,
    episodes_watched INTEGER NOT NULL DEFAULT 0,
    favourites       INTEGER NOT NULL DEFAULT 0,
    top_genres       TEXT    NOT NULL DEFAULT '[]',
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- requester sends to addressee; status: 'pending' | 'accepted'
CREATE TABLE IF NOT EXISTS friendships (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       TEXT    NOT NULL DEFAULT 'pending',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(requester_id, addressee_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id, status);

CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    type       TEXT    NOT NULL,
    payload    TEXT    NOT NULL DEFAULT '{}',
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user    ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint    TEXT    NOT NULL UNIQUE,
    p256dh      TEXT    NOT NULL,
    auth        TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS tmdb_ratings (
    tmdb_id     INTEGER PRIMARY KEY,
    imdb_id     TEXT,
    imdb_score  REAL    DEFAULT 0,
    imdb_votes  INTEGER DEFAULT 0,
    tomatometer INTEGER,
    fetched_at  TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS device_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT    NOT NULL UNIQUE,
    platform   TEXT    NOT NULL DEFAULT 'android',
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);
"""


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(
            str(settings.DB_PATH),
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys=ON")
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA synchronous=NORMAL")  # safe with WAL; ~3x faster writes
        g.db.execute("PRAGMA cache_size=-32000")  # ~32 MB page cache per connection
        g.db.execute("PRAGMA temp_store=MEMORY")
        g.db.execute("PRAGMA mmap_size=268435456")  # 256 MB memory-mapped I/O
    return g.db


def close_db(exc=None):
    db = g.pop("db", None)
    if db:
        db.execute("PRAGMA optimize")  # refresh query-planner statistics cheaply
        db.close()


def _apply_migrations(conn: sqlite3.Connection):
    """Run lightweight schema migrations on an existing database."""
    cur = conn.cursor()

    # gather column info
    cur.execute("PRAGMA table_info(users)")
    info = cur.fetchall()
    cols = [row[1] for row in info]
    notnull = {row[1]: row[3] for row in info}  # name -> notnull flag

    # if password_hash or username still NOT NULL, rebuild table to drop the constraint
    if notnull.get("password_hash") == 1 or notnull.get("username") == 1:
        print("[DB] Rebuilding users table to relax NOT NULL constraints")
        conn.execute("PRAGMA foreign_keys=OFF")
        conn.execute(
            """
            CREATE TABLE users_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE COLLATE NOCASE,
                password_hash TEXT,
                email TEXT UNIQUE,
                google_id TEXT UNIQUE,
                auth_type TEXT NOT NULL DEFAULT 'password',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                last_login TEXT
            );
            """
        )
        conn.execute(
            """
            INSERT INTO users_new (id, username, password_hash, email, google_id, auth_type, created_at, last_login)
            SELECT id, username, password_hash, email, google_id, auth_type, created_at, last_login FROM users;
            """
        )
        conn.execute("DROP TABLE users")
        conn.execute("ALTER TABLE users_new RENAME TO users")
        conn.execute("PRAGMA foreign_keys=ON")
        # recreate indexes after rebuild
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)"
        )
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)"
        )
        # update the local vars to reflect new schema
        cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]

    # check for google_id column in users table
    if "google_id" not in cols:
        print("[DB] Adding google_id,email,auth_type columns to users table")
        # sqlite doesn't support UNIQUE in ALTER TABLE, so add plain columns then create indexes
        conn.execute("ALTER TABLE users ADD COLUMN google_id TEXT")
        conn.execute("ALTER TABLE users ADD COLUMN email TEXT")
        conn.execute(
            "ALTER TABLE users ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'password'"
        )
        # add unique indexes to simulate UNIQUE constraints
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)"
        )
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)"
        )
    # Add profile columns to users if missing
    if "profile_pic" not in cols:
        print("[DB] Adding profile_pic column to users")
        conn.execute("ALTER TABLE users ADD COLUMN profile_pic TEXT")
    if "display_name" not in cols:
        print("[DB] Adding display_name column to users")
        conn.execute("ALTER TABLE users ADD COLUMN display_name TEXT")
    if "home_country" not in cols:
        print("[DB] Adding home_country column to users")
        conn.execute("ALTER TABLE users ADD COLUMN home_country TEXT")

    if "is_admin" not in cols:
        print("[DB] Adding is_admin column to users")
        conn.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
        # Grant admin to the first registered user if no admin exists yet
        conn.execute(
            """UPDATE users SET is_admin=1 WHERE id=(
                SELECT MIN(id) FROM users
            ) AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin=1)"""
        )
        print("[DB] Granted admin to first user")

    if "library_public" not in cols:
        print("[DB] Adding library_public column to users")
        conn.execute(
            "ALTER TABLE users ADD COLUMN library_public INTEGER NOT NULL DEFAULT 0"
        )

    if "pic_position_y" not in cols:
        print("[DB] Adding pic_position_y column to users")
        conn.execute("ALTER TABLE users ADD COLUMN pic_position_y INTEGER DEFAULT 50")
    if "pic_position_x" not in cols:
        print("[DB] Adding pic_position_x column to users")
        conn.execute("ALTER TABLE users ADD COLUMN pic_position_x REAL DEFAULT 0.5")
    if "pic_scale" not in cols:
        print("[DB] Adding pic_scale column to users")
        conn.execute("ALTER TABLE users ADD COLUMN pic_scale REAL DEFAULT 1.0")

    if "setup_required" not in cols:
        print("[DB] Adding setup_required column to users")
        conn.execute(
            "ALTER TABLE users ADD COLUMN setup_required INTEGER NOT NULL DEFAULT 0"
        )

    # Add runtime_mins / end_year to titles if missing
    title_cols = [r[1] for r in conn.execute("PRAGMA table_info(titles)").fetchall()]
    if "runtime_mins" not in title_cols:
        print("[DB] Adding runtime_mins column to titles")
        conn.execute("ALTER TABLE titles ADD COLUMN runtime_mins INTEGER DEFAULT 0")
    if "end_year" not in title_cols:
        print("[DB] Adding end_year column to titles")
        conn.execute("ALTER TABLE titles ADD COLUMN end_year TEXT DEFAULT NULL")
    if "is_ongoing" not in title_cols:
        print("[DB] Adding is_ongoing column to titles")
        conn.execute("ALTER TABLE titles ADD COLUMN is_ongoing INTEGER DEFAULT NULL")
    if "num_seasons" not in title_cols:
        print("[DB] Adding num_seasons column to titles")
        conn.execute("ALTER TABLE titles ADD COLUMN num_seasons INTEGER DEFAULT NULL")

    # Add user_rating to library if missing
    lib_cols = [r[1] for r in conn.execute("PRAGMA table_info(library)").fetchall()]
    if "user_rating" not in lib_cols:
        print("[DB] Adding user_rating column to library")
        conn.execute("ALTER TABLE library ADD COLUMN user_rating INTEGER DEFAULT 0")

    # ── watched_seasons: create if missing, migrate from watched_items if needed ──
    tables = [
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    ]

    if "watched_seasons" not in tables:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS watched_seasons (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                platform     TEXT    NOT NULL,
                title        TEXT    NOT NULL,
                season_num   INTEGER NOT NULL DEFAULT 0,
                ep_mask      INTEGER NOT NULL DEFAULT 0,
                runtime_mins INTEGER NOT NULL DEFAULT 0,
                updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
                UNIQUE(user_id, platform, title, season_num)
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_ws_user ON watched_seasons(user_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_ws_show ON watched_seasons(user_id, platform, title)"
        )
        print("[DB] Created watched_seasons table")

    if "watched_items" in tables:
        print("[DB] Migrating watched_items → watched_seasons (bitmask)…")
        wi_cols = {
            r[1] for r in conn.execute("PRAGMA table_info(watched_items)").fetchall()
        }
        runtime_expr = "COALESCE(runtime_mins, 0)" if "runtime_mins" in wi_cols else "0"
        rows = conn.execute(
            f"""SELECT user_id, platform, title, season_num, episode_num,
                      {runtime_expr} AS runtime_mins
               FROM watched_items
               WHERE item_type = 'episode'
               ORDER BY user_id, platform, title, season_num"""
        ).fetchall()
        season_data: dict = {}
        for r in rows:
            key = (r[0], r[1], r[2], r[3])
            if key not in season_data:
                season_data[key] = {"mask": 0, "runtime": 0}
            ep = r[4]
            if 1 <= ep <= 62:
                season_data[key]["mask"] |= 1 << (ep - 1)
            season_data[key]["runtime"] += r[5]
        for (uid, plat, title, snum), d in season_data.items():
            conn.execute(
                """INSERT OR REPLACE INTO watched_seasons
                       (user_id, platform, title, season_num, ep_mask, runtime_mins)
                   VALUES (?,?,?,?,?,?)""",
                (uid, plat, title, snum, d["mask"], d["runtime"]),
            )
        conn.execute("DROP TABLE watched_items")
        print(f"[DB] Migrated {len(season_data)} season rows, dropped watched_items")

    # Add user_stats table if missing
    if "tmdb_show_cache" not in tables:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tmdb_show_cache (
                title_key    TEXT NOT NULL PRIMARY KEY,
                tmdb_id      INTEGER,
                is_ongoing   INTEGER NOT NULL DEFAULT 0,
                end_year     TEXT,
                next_ep_json TEXT,
                season_num   INTEGER,
                season_json  TEXT,
                poster_thumb TEXT,
                cast_json    TEXT,
                fetched_at   TEXT NOT NULL DEFAULT (datetime('now')),
                expires_at   TEXT NOT NULL DEFAULT (datetime('now', '+6 hours'))
            )
        """)
        print("[DB] Created tmdb_show_cache table")

    # Add cast_json to tmdb_show_cache if missing
    show_cache_cols = {
        r[1] for r in conn.execute("PRAGMA table_info(tmdb_show_cache)").fetchall()
    }
    if "cast_json" not in show_cache_cols:
        conn.execute("ALTER TABLE tmdb_show_cache ADD COLUMN cast_json TEXT")
        print("[DB] Added cast_json column to tmdb_show_cache")
    if "show_overview" not in show_cache_cols:
        conn.execute("ALTER TABLE tmdb_show_cache ADD COLUMN show_overview TEXT")
        print("[DB] Added show_overview column to tmdb_show_cache")

    if "platform_logos" not in tables:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS platform_logos (
                platform_key TEXT NOT NULL PRIMARY KEY,
                logo_url     TEXT NOT NULL,
                fetched_at   TEXT NOT NULL DEFAULT (datetime('now')),
                expires_at   TEXT NOT NULL DEFAULT (datetime('now', '+30 days'))
            )
        """)
        print("[DB] Created platform_logos table")

    if "user_stats" not in tables:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_stats (
                user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                movie_mins       INTEGER NOT NULL DEFAULT 0,
                tv_mins          INTEGER NOT NULL DEFAULT 0,
                movies_finished  INTEGER NOT NULL DEFAULT 0,
                movies_watching  INTEGER NOT NULL DEFAULT 0,
                movies_in_library INTEGER NOT NULL DEFAULT 0,
                tv_finished      INTEGER NOT NULL DEFAULT 0,
                tv_watching      INTEGER NOT NULL DEFAULT 0,
                episodes_watched INTEGER NOT NULL DEFAULT 0,
                favourites       INTEGER NOT NULL DEFAULT 0,
                top_genres       TEXT    NOT NULL DEFAULT '[]',
                updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
            )
        """)
        print("[DB] Created user_stats table")

    if "friendships" not in tables:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS friendships (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                status       TEXT    NOT NULL DEFAULT 'pending',
                created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
                UNIQUE(requester_id, addressee_id)
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id, status)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id, status)"
        )

    if "push_subscriptions" not in tables:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                endpoint   TEXT    NOT NULL UNIQUE,
                p256dh     TEXT    NOT NULL,
                auth       TEXT    NOT NULL,
                created_at TEXT    NOT NULL DEFAULT (datetime('now'))
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id)"
        )
        print("[DB] Created push_subscriptions table")
        print("[DB] Created friendships table")

    if "notifications" not in tables:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
                type       TEXT    NOT NULL,
                payload    TEXT    NOT NULL DEFAULT '{}',
                is_read    INTEGER NOT NULL DEFAULT 0,
                created_at TEXT    NOT NULL DEFAULT (datetime('now'))
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_notif_user    ON notifications(user_id, is_read)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(user_id, created_at DESC)"
        )
        print("[DB] Created notifications table")

    if "tmdb_ratings" not in tables:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tmdb_ratings (
                tmdb_id     INTEGER PRIMARY KEY,
                imdb_id     TEXT,
                imdb_score  REAL    DEFAULT 0,
                imdb_votes  INTEGER DEFAULT 0,
                tomatometer INTEGER,
                fetched_at  TEXT    DEFAULT (datetime('now'))
            )
        """)
        print("[DB] Created tmdb_ratings table")

    if "device_tokens" not in tables:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS device_tokens (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token      TEXT    NOT NULL UNIQUE,
                platform   TEXT    NOT NULL DEFAULT 'android',
                created_at TEXT    NOT NULL DEFAULT (datetime('now'))
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id)"
        )
        print("[DB] Created device_tokens table")

    # Add performance indexes
    idx_names = [
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index'"
        ).fetchall()
    ]

    # Covering index for library status/fav queries (stats, watchlist, etc.)
    if "idx_library_status" not in idx_names:
        print("[DB] Adding index: idx_library_status")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_library_status "
            "ON library(user_id, status, is_fav)"
        )

    # Index for token lookups (auth on every request)
    if "idx_tokens_user" not in idx_names:
        print("[DB] Adding index: idx_tokens_user")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id)")

    # poster_cache.expires_at column (legacy databases may not have it)
    pc_cols = {r[1] for r in conn.execute("PRAGMA table_info(poster_cache)").fetchall()}
    if "expires_at" not in pc_cols:
        print("[DB] Adding expires_at column to poster_cache")
        conn.execute("ALTER TABLE poster_cache ADD COLUMN expires_at TEXT DEFAULT NULL")
        conn.execute(
            "UPDATE poster_cache SET expires_at = datetime('now', '+90 days') "
            "WHERE expires_at IS NULL"
        )

    if "idx_titles_pt" not in idx_names:
        print("[DB] Adding compound index: idx_titles_pt")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_titles_pt ON titles(platform, title)"
        )
    if "idx_titles_rank_region" not in idx_names:
        print("[DB] Adding compound index: idx_titles_rank_region")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_titles_rank_region "
            "ON titles(platform, title, ranking_position, region)"
        )

    # Fix legacy rows where catalog-mode scrapes left is_trending=0
    # even though ranking_position > 0 (they ARE on the streaming charts).
    fixed = conn.execute(
        "UPDATE titles SET is_trending=1 WHERE ranking_position > 0 AND is_trending=0"
    ).rowcount
    if fixed:
        print(f"[DB] Back-filled is_trending=1 for {fixed} ranked titles.")

    conn.commit()


def _nuke_stale_wal():
    """Delete WAL/SHM sidecar files that belong to a now-gone or replaced DB."""
    for suffix in ("-wal", "-shm"):
        sidecar = settings.DB_PATH.parent / (settings.DB_PATH.name + suffix)
        if sidecar.exists():
            try:
                sidecar.unlink()
                print(f"[DB] Removed stale sidecar: {sidecar.name}", flush=True)
            except Exception as exc:
                print(f"[DB] Could not remove {sidecar.name}: {exc}", flush=True)


def init_db():
    # create new database or migrate existing one
    if not settings.DB_PATH.exists():
        _nuke_stale_wal()
        with sqlite3.connect(str(settings.DB_PATH)) as conn:
            conn.executescript(SCHEMA)
        print(f"[DB] Initialised at {settings.DB_PATH}")
        # Also apply migrations so fresh DBs get all columns, same as upgraded ones
        with sqlite3.connect(str(settings.DB_PATH)) as conn:
            _apply_migrations(conn)
    else:
        # open connection and apply any migrations
        try:
            with sqlite3.connect(str(settings.DB_PATH)) as conn:
                _apply_migrations(conn)
            print(f"[DB] Migration check complete for {settings.DB_PATH}")
        except sqlite3.DatabaseError as exc:
            # The DB file is corrupted (e.g. stale WAL from a different DB was
            # applied on volume).  Rename it for forensics, nuke the sidecars,
            # and start fresh so the app can at least boot.  The clean DB can
            # then be re-uploaded via /api/upload-db.
            from datetime import datetime as _dt

            ts = _dt.now().strftime("%Y%m%d_%H%M%S")
            bak = settings.DB_PATH.with_name(f"{settings.DB_PATH.stem}_corrupt_{ts}.db")
            try:
                settings.DB_PATH.rename(bak)
                print(
                    f"[DB] Malformed DB renamed to {bak.name} — original error: {exc}",
                    flush=True,
                )
            except Exception as rename_exc:
                print(f"[DB] Could not rename malformed DB: {rename_exc}", flush=True)
                settings.DB_PATH.unlink(missing_ok=True)
            _nuke_stale_wal()
            # Recreate a fresh empty DB so the app can start
            with sqlite3.connect(str(settings.DB_PATH)) as conn:
                conn.executescript(SCHEMA)
            with sqlite3.connect(str(settings.DB_PATH)) as conn:
                _apply_migrations(conn)
            print(
                "[DB] Fresh DB created after corruption recovery. Re-upload your data via /api/upload-db.",
                flush=True,
            )


def ensure_schema(conn: sqlite3.Connection):
    """Ensure the database schema exists on the given connection.

    This is a lightweight helper used by background tools (scraper/enricher)
    which open their own sqlite connections rather than using the Flask
    `get_db()` helper. If the core tables are missing, we execute the full
    SCHEMA script and then run migrations to bring the database up-to-date.
    """
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='titles'")
    if not cur.fetchone():
        # No titles table → assume DB is uninitialised; create full schema
        conn.executescript(SCHEMA)
        conn.commit()
    # Run migrations to ensure any missing columns/indexes are added
    _apply_migrations(conn)
