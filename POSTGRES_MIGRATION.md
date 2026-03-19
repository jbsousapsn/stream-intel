# StreamIntel — SQLite → PostgreSQL Migration Guide

This guide migrates StreamIntel's database from SQLite (file-based, single-server) to
PostgreSQL (hosted on Railway, shared between multiple deployments).

---

## Overview of changes required

| Area | What changes |
|---|---|
| `requirements.txt` | Add `psycopg2-binary` |
| `backend/database.py` | Replace `sqlite3` with `psycopg2`, rewrite `get_db()`, `close_db()`, schema, migrations |
| All route files | `?` placeholders → `%s`, `lastrowid` → `RETURNING id`, SQLite-specific functions |
| `backend/config.py` | Add `DATABASE_URL` setting |
| Railway | Add PostgreSQL service, set `DATABASE_URL` in both projects |

---

## Step 1 — Add PostgreSQL to Railway

### In your original Railway project (stream-intel):

1. Open the project dashboard
2. Click **+ New** → **Database** → **Add PostgreSQL**
3. Railway provisions a Postgres instance and injects `DATABASE_URL` automatically into
   every service in the same project. Copy the value — you'll need it for the second project.

The URL looks like:
```
postgresql://postgres:PASSWORD@containers-us-west-999.railway.app:7777/railway
```

### In your second Railway project (stream-intel-pwa):

1. Go to the service → **Variables**
2. Add a variable called `DATABASE_URL` and paste the same URL from above

Both projects now point to the same database.

---

## Step 2 — Add psycopg2 to requirements.txt

Open `requirements.txt` and add:
```
psycopg2-binary==2.9.10
```

`psycopg2-binary` includes compiled C extensions — no separate `libpq` install needed on Railway.

---

## Step 3 — Rewrite `backend/database.py`

Replace the entire file with the PostgreSQL version below. Key differences from SQLite:

- `?` parameter placeholders → `%s`
- `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL PRIMARY KEY`
- `datetime('now')` → `NOW()`
- `datetime('now', '+6 hours')` → `NOW() + INTERVAL '6 hours'`
- `PRAGMA` statements → removed (PostgreSQL doesn't use them)
- `INSERT OR REPLACE` → `INSERT ... ON CONFLICT ... DO UPDATE`
- `UNIQUE(...) ON CONFLICT REPLACE` → standard `UNIQUE` constraint + explicit upserts
- `row_factory = sqlite3.Row` → rows accessed as tuples or dicts (see note below)
- `lastrowid` → use `RETURNING id` in the INSERT and read `cursor.fetchone()[0]`

**Replace `backend/database.py` with:**

```python
# backend/database.py
import os
import psycopg2
import psycopg2.extras
from flask import g
from backend.config import settings


def get_db() -> psycopg2.extensions.connection:
    if "db" not in g:
        g.db = psycopg2.connect(settings.DATABASE_URL)
        g.db.autocommit = False
    return g.db


def close_db(exc=None):
    db = g.pop("db", None)
    if db:
        if exc:
            db.rollback()
        else:
            db.commit()
        db.close()


def _exec(conn, sql, params=()):
    """Execute a single statement and return the cursor."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(sql, params)
    return cur


def init_db(conn):
    """Create all tables if they don't exist."""
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id            SERIAL PRIMARY KEY,
            username      TEXT    UNIQUE,
            password_hash TEXT,
            email         TEXT    UNIQUE,
            google_id     TEXT    UNIQUE,
            auth_type     TEXT    NOT NULL DEFAULT 'password',
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_login    TIMESTAMPTZ,
            home_country  TEXT,
            is_admin      INTEGER NOT NULL DEFAULT 0,
            profile_pic   TEXT,
            display_name  TEXT,
            library_public INTEGER NOT NULL DEFAULT 0,
            pic_position_y INTEGER DEFAULT 50,
            setup_required INTEGER NOT NULL DEFAULT 0
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS tokens (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token      TEXT    NOT NULL UNIQUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            revoked    INTEGER NOT NULL DEFAULT 0
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS scrape_runs (
            id           SERIAL PRIMARY KEY,
            started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            finished_at  TIMESTAMPTZ,
            mode         TEXT    NOT NULL,
            regions      TEXT    NOT NULL,
            title_count  INTEGER DEFAULT 0,
            status       TEXT    NOT NULL DEFAULT 'running'
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS titles (
            id               SERIAL PRIMARY KEY,
            run_id           INTEGER REFERENCES scrape_runs(id) ON DELETE SET NULL,
            scraped_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
            end_year         TEXT,
            is_ongoing       INTEGER,
            UNIQUE(platform, region, title)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_titles_platform ON titles(platform)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_titles_region   ON titles(region)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_titles_trending ON titles(is_trending)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_titles_imdb     ON titles(imdb_score)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_titles_filter   ON titles(platform, region, content_type, is_trending)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS library (
            id          SERIAL PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            platform    TEXT    NOT NULL,
            title       TEXT    NOT NULL,
            is_fav      INTEGER NOT NULL DEFAULT 0,
            status      TEXT    NOT NULL DEFAULT 'not-started',
            notes       TEXT,
            user_rating INTEGER NOT NULL DEFAULT 0,
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(user_id, platform, title)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_library_user ON library(user_id)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS watched_seasons (
            id           SERIAL PRIMARY KEY,
            user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            platform     TEXT    NOT NULL,
            title        TEXT    NOT NULL,
            season_num   INTEGER NOT NULL DEFAULT 0,
            ep_mask      INTEGER NOT NULL DEFAULT 0,
            runtime_mins INTEGER NOT NULL DEFAULT 0,
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(user_id, platform, title, season_num)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_ws_user ON watched_seasons(user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_ws_show ON watched_seasons(user_id, platform, title)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS poster_cache (
            id           SERIAL PRIMARY KEY,
            cache_key    TEXT    NOT NULL UNIQUE,
            poster_url   TEXT,
            backdrop_url TEXT,
            fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '90 days'
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_poster_cache_expires ON poster_cache(expires_at)")

    cur.execute("""
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
            fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '6 hours'
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS platform_logos (
            platform_key TEXT NOT NULL PRIMARY KEY,
            logo_url     TEXT NOT NULL,
            fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days'
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_stats (
            user_id           INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            movie_mins        INTEGER NOT NULL DEFAULT 0,
            tv_mins           INTEGER NOT NULL DEFAULT 0,
            movies_finished   INTEGER NOT NULL DEFAULT 0,
            movies_watching   INTEGER NOT NULL DEFAULT 0,
            movies_in_library INTEGER NOT NULL DEFAULT 0,
            tv_finished       INTEGER NOT NULL DEFAULT 0,
            tv_watching       INTEGER NOT NULL DEFAULT 0,
            episodes_watched  INTEGER NOT NULL DEFAULT 0,
            favourites        INTEGER NOT NULL DEFAULT 0,
            top_genres        TEXT    NOT NULL DEFAULT '[]',
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS friendships (
            id           SERIAL PRIMARY KEY,
            requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status       TEXT    NOT NULL DEFAULT 'pending',
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(requester_id, addressee_id)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id, status)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id, status)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
            type       TEXT    NOT NULL,
            payload    TEXT    NOT NULL DEFAULT '{}',
            is_read    INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_notif_user    ON notifications(user_id, is_read)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(user_id, created_at DESC)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            endpoint   TEXT    NOT NULL UNIQUE,
            p256dh     TEXT    NOT NULL,
            auth       TEXT    NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id)")

    conn.commit()
    print("[DB] Schema applied.")
```

---

## Step 4 — Add DATABASE_URL to `backend/config.py`

Open `backend/config.py` and add one field to the `Settings` dataclass:

```python
DATABASE_URL: str = field(
    default_factory=lambda: os.getenv("DATABASE_URL", "")
)
```

---

## Step 5 — Fix SQL syntax across all route files

This is the most labour-intensive part. PostgreSQL rejects SQLite-specific syntax.
Go through each file and apply these replacements:

### 5a — Parameter placeholders: `?` → `%s`

Every `db.execute("... WHERE id = ?", (val,))` becomes:
```python
db.execute("... WHERE id = %s", (val,))
```

This affects **every** route file: `auth.py`, `library.py`, `titles.py`, `profile.py`,
`friends.py`, `admin.py`.

### 5b — Getting the inserted row ID

SQLite:
```python
cur = db.execute("INSERT INTO users ... VALUES (?)", (val,))
new_id = cur.lastrowid
```

PostgreSQL — use `RETURNING`:
```python
cur = db.execute("INSERT INTO users ... VALUES (%s) RETURNING id", (val,))
new_id = cur.fetchone()[0]
```

### 5c — Upserts: `INSERT OR REPLACE` → `ON CONFLICT DO UPDATE`

SQLite:
```python
db.execute("INSERT OR REPLACE INTO library (user_id, platform, title, is_fav) VALUES (?,?,?,?)", ...)
```

PostgreSQL:
```python
db.execute("""
    INSERT INTO library (user_id, platform, title, is_fav)
    VALUES (%s, %s, %s, %s)
    ON CONFLICT (user_id, platform, title) DO UPDATE SET
        is_fav = EXCLUDED.is_fav,
        updated_at = NOW()
""", ...)
```

### 5d — Date/time functions

| SQLite | PostgreSQL |
|---|---|
| `datetime('now')` | `NOW()` |
| `datetime('now', '+6 hours')` | `NOW() + INTERVAL '6 hours'` |
| `datetime('now', '+90 days')` | `NOW() + INTERVAL '90 days'` |
| `datetime('now', '+30 days')` | `NOW() + INTERVAL '30 days'` |
| `date('now')` | `CURRENT_DATE` |

### 5e — Row access

With `RealDictCursor` (set in the new `get_db()`), rows are already dict-like — `row['column_name']` continues to work exactly as before with `sqlite3.Row`. No changes needed in most code.

### 5f — `executemany`

Works identically in psycopg2 — no changes needed.

### 5g — Transactions

In the new `database.py`, `autocommit = False`. This means you must commit writes.
Wrap any route that does writes:

```python
db = get_db()
db.execute("INSERT INTO ...", (...))
db.commit()   # add this after writes
```

Or call `db.commit()` once at the end of a request that has multiple writes.
The `close_db` teardown already commits on clean exit, but explicit commits inside
long routes are safer.

---

## Step 6 — Migrate existing SQLite data to PostgreSQL

Do this once from your local machine.

### Install tools

```bash
pip install pgloader   # or: pip install psycopg2-binary sqlalchemy pandas
```

Or use the standalone `pgloader` binary — on Windows, download from
[pgloader releases](https://github.com/dimitri/pgloader/releases).

### Option A — pgloader (recommended, handles type conversion automatically)

Create a file `migrate.load`:
```
LOAD DATABASE
     FROM sqlite:///stream_intel.db
     INTO postgresql://postgres:PASSWORD@containers-us-west-999.railway.app:7777/railway

WITH include drop, create tables, create indexes, reset sequences

SET work_mem to '128MB', maintenance_work_mem to '512MB';
```

Then run:
```bash
pgloader migrate.load
```

pgloader converts types automatically (INTEGER → integer, TEXT → text, etc.) and
migrates all rows in one pass.

### Option B — Manual Python script (no extra install)

```python
import sqlite3, psycopg2, os

src = sqlite3.connect("stream_intel.db")
src.row_factory = sqlite3.Row
dst = psycopg2.connect("postgresql://postgres:PASSWORD@host:port/railway")

TABLES = [
    "users", "tokens", "scrape_runs", "titles", "library",
    "watched_seasons", "poster_cache", "tmdb_show_cache",
    "platform_logos", "user_stats", "friendships",
    "notifications", "push_subscriptions",
]

for table in TABLES:
    rows = src.execute(f"SELECT * FROM {table}").fetchall()
    if not rows:
        print(f"  {table}: empty, skipping")
        continue
    cols = rows[0].keys()
    placeholders = ", ".join(["%s"] * len(cols))
    col_names = ", ".join(cols)
    cur = dst.cursor()
    cur.executemany(
        f"INSERT INTO {table} ({col_names}) VALUES ({placeholders}) ON CONFLICT DO NOTHING",
        [tuple(r) for r in rows]
    )
    print(f"  {table}: {len(rows)} rows migrated")

dst.commit()
dst.close()
src.close()
print("Done.")
```

Run it with:
```bash
python migrate_to_pg.py
```

### Reset sequences after migration

After inserting rows with explicit IDs, PostgreSQL's auto-increment sequences need
resetting or new inserts will conflict. Run this in Railway's Postgres console
(**Data** tab → open query editor):

```sql
SELECT setval('users_id_seq',        (SELECT MAX(id) FROM users));
SELECT setval('tokens_id_seq',       (SELECT MAX(id) FROM tokens));
SELECT setval('scrape_runs_id_seq',  (SELECT MAX(id) FROM scrape_runs));
SELECT setval('titles_id_seq',       (SELECT MAX(id) FROM titles));
SELECT setval('library_id_seq',      (SELECT MAX(id) FROM library));
SELECT setval('watched_seasons_id_seq', (SELECT MAX(id) FROM watched_seasons));
SELECT setval('poster_cache_id_seq', (SELECT MAX(id) FROM poster_cache));
SELECT setval('notifications_id_seq',(SELECT MAX(id) FROM notifications));
SELECT setval('friendships_id_seq',  (SELECT MAX(id) FROM friendships));
SELECT setval('push_subscriptions_id_seq', (SELECT MAX(id) FROM push_subscriptions));
```

---

## Step 7 — Set environment variables on Railway

### Original project (stream-intel):
Railway auto-injects `DATABASE_URL` when you add a PostgreSQL service to the same
project. Verify it appears under **Variables** — it should already be there.

### Second project (stream-intel-pwa):
Manually add:
```
DATABASE_URL = postgresql://postgres:PASSWORD@host:port/railway
```
(Same value as the one Railway generated in the original project.)

---

## Step 8 — Deploy and verify

1. Commit and push all code changes to GitHub
2. Railway redeploys both services automatically
3. Visit both URLs and confirm login, library reads/writes, and scraping all work
4. Check Railway logs for any `psycopg2` errors — typically they are mismatched `%s`
   placeholders or missing `RETURNING id` calls

---

## Common errors and fixes

| Error | Cause | Fix |
|---|---|---|
| `not all arguments converted during string formatting` | A `?` placeholder was left in a query | Replace all `?` with `%s` |
| `AttributeError: 'tuple' object has no attribute 'lastrowid'` | Using `lastrowid` on psycopg2 cursor | Use `RETURNING id` + `fetchone()[0]` |
| `duplicate key value violates unique constraint` | Sequence not reset after migration | Run the `setval` commands in Step 6 |
| `operator does not exist: text = integer` | Type mismatch in query parameter | Cast explicitly: `WHERE id = %s::integer` |
| `SSL connection has been closed unexpectedly` | Railway Postgres idle timeout | Add `?sslmode=require&keepalives=1` to DATABASE_URL |

---

## Summary checklist

- [ ] PostgreSQL service added to Railway original project
- [ ] `DATABASE_URL` copied to second Railway project
- [ ] `psycopg2-binary` added to `requirements.txt`
- [ ] `backend/database.py` rewritten for PostgreSQL
- [ ] `DATABASE_URL` added to `backend/config.py`
- [ ] All `?` placeholders replaced with `%s` across route files
- [ ] All `lastrowid` replaced with `RETURNING id`
- [ ] All `INSERT OR REPLACE` converted to `ON CONFLICT DO UPDATE`
- [ ] All `datetime('now', ...)` converted to `NOW() + INTERVAL '...'`
- [ ] Existing SQLite data migrated (pgloader or Python script)
- [ ] Sequences reset after migration
- [ ] Both Railway projects redeployed and verified working
