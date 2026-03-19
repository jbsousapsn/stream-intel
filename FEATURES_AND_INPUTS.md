# StreamIntel App — Features & API Reference

Every feature, the HTTP request to call it, and exactly what parameters to send.

All authenticated endpoints require the `si_token` cookie (set automatically on login) or the `Authorization: Bearer <token>` header (mobile).

---

## Table of Contents
1. [Authentication](#1-authentication)
2. [Profile](#2-profile)
3. [Library](#3-library)
4. [Watched / Episode Tracking](#4-watched--episode-tracking)
5. [Titles & Catalog](#5-titles--catalog)
6. [TMDB Proxy](#6-tmdb-proxy)
7. [Friends & Social](#7-friends--social)
8. [Notifications](#8-notifications)
9. [Web Push](#9-web-push)
10. [Admin & Scraper](#10-admin--scraper)

---

## 1. Authentication

### 1.1 Health Check
- **GET** `/api/auth/ping`
- Auth: none
- Returns: `{"ok": true, "ts": <unix_timestamp>}`

### 1.2 Setup Status (first-run check)
- **GET** `/api/auth/setup-status`
- Auth: none
- Returns: `{"needs_setup": bool}` — `true` when no users exist yet

### 1.3 Register (username/password)
- **POST** `/api/auth/register`
- Auth: none for the very first user; admin cookie required for all subsequent registrations
- Body (JSON):

  | Field | Type | Rules |
  |-------|------|-------|
  | `username` | string | 3–30 characters, must be unique |
  | `password` | string | minimum 6 characters |

- Returns: `{"ok": true, "username": "..."}` + sets `si_token` cookie
- Errors: `400` missing fields / validation, `403` registration closed, `409` username taken

### 1.4 Login (username/password)
- **POST** `/api/auth/login`
- Auth: none
- Body (JSON):

  | Field | Type |
  |-------|------|
  | `username` | string |
  | `password` | string |

- Returns: `{"ok": true, "username": "..."}` + sets `si_token` cookie
- Errors: `400` missing fields, `401` wrong credentials

### 1.5 Logout
- **POST** `/api/auth/logout`
- Auth: required
- Body: none
- Returns: `{"ok": true}`, clears `si_token` cookie

### 1.6 Current User / Auth Check
- **GET** `/api/auth/me`
- Auth: optional (returns `{"authenticated": false}` if not logged in)
- Returns:
  ```json
  {
    "authenticated": true,
    "username": "...",
    "favourites": 0,
    "watching": 0,
    "finished": 0,
    "home_country": "US",
    "is_admin": false,
    "setup_required": false
  }
  ```

### 1.7 Change Password
- **POST** `/api/auth/change-password`
- Auth: required
- Body (JSON):

  | Field | Type | Rules |
  |-------|------|-------|
  | `old_password` | string | current password |
  | `new_password` | string | minimum 6 characters |

- Returns: `{"ok": true}`
- Errors: `400` validation, `401` wrong current password

### 1.8 Google OAuth — Web (initiate)
- **GET** `/api/auth/google-init`
- Auth: none
- Returns: `{"auth_url": "https://accounts.google.com/..."}` — redirect browser to this URL

### 1.9 Google OAuth — Web (callback, automatic)
- **GET** `/api/auth/google-callback?code=<code>`
- Auth: none
- Handled automatically by Google redirect. Returns an HTML page that exchanges the code.

### 1.10 Google OAuth — Web (exchange code)
- **POST** `/api/auth/google-exchange`
- Auth: none
- Body (JSON): `{"code": "<authorization_code>"}`
- Returns: `{"ok": true}` + sets `si_token` cookie
- Errors: `400` no code / OAuth failure, `409` email already in use

### 1.11 Google OAuth — Mobile
- **POST** `/api/auth/google-mobile`
- Auth: none
- Body (JSON): `{"server_auth_code": "<code_from_native_SDK>"}`
- Returns:
  ```json
  {"ok": true, "token": "<bearer_token>", "setup_required": bool, "username": "..."}
  ```
- Use the returned `token` as `Authorization: Bearer <token>` in subsequent requests.

### 1.12 Migration Token (generate one-time token for data migration)
- **GET** `/api/auth/migration-token`
- Auth: required (admin)
- Returns: `{"migration_token": "...", "expires_in": "1 hour"}`

### 1.13 Debug Redirect URI
- **GET** `/api/auth/debug-redirect`
- Auth: none
- Returns the exact redirect URI that will be sent to Google (useful for OAuth debugging)

---

## 2. Profile

### 2.1 Get My Profile
- **GET** `/api/profile`
- Auth: required
- Returns:
  ```json
  {
    "username": "...",
    "display_name": "...",
    "email": "...",
    "auth_type": "password|google",
    "member_since": "YYYY-MM-DD",
    "profile_pic": "<base64 data URI or empty>",
    "home_country": "US",
    "library_public": false,
    "pic_position_y": 50,
    "stats": {
      "total_in_library": 0,
      "favourites": 0,
      "movies_finished": 0,
      "movies_watching": 0,
      "movies_in_library": 0,
      "tv_finished": 0,
      "tv_watching": 0,
      "episodes_watched": 0,
      "movie_watch_time": {"total_minutes": 0, "hours": 0, "minutes": 0, "label": "0m"},
      "tv_watch_time": {...},
      "total_watch_time": {...},
      "top_genres": [{"genre": "Drama", "count": 5}]
    }
  }
  ```

### 2.2 Update My Profile
- **POST** `/api/profile`
- Auth: required
- Body (JSON) — all fields optional, send only what you want to change:

  | Field | Type | Notes |
  |-------|------|-------|
  | `username` | string | 3–30 chars, unique |
  | `display_name` | string | max 60 chars |
  | `profile_pic` | string | base64 `data:image/...` URI, max ~1.5 MB, or `""` to remove |
  | `home_country` | string | 2-letter ISO country code, e.g. `"US"` |
  | `library_public` | bool | `true` allows friends to browse your full library |
  | `pic_position_y` | int | 0–100, vertical crop offset for the profile picture |

- Returns: `{"ok": true}`
- Errors: `400` validation, `409` username taken

### 2.3 Watch-Time Breakdown (per title)
- **GET** `/api/profile/watchtime`
- Auth: required
- Returns all library entries with status other than `not-started`, including per-title watch time in minutes and episode count.

### 2.4 Watch-Time Stats (debug)
- **GET** `/api/profile/watchtime-stats`
- Auth: required
- Returns summary counts (total library rows, active rows, rows by status, watched_seasons rows).

---

## 3. Library

### 3.1 Get My Library
- **GET** `/api/library`
- Auth: required
- Supports ETag / `If-None-Match` caching (returns `304` if unchanged)
- Returns:
  ```json
  {
    "library": [
      {
        "platform": "netflix",
        "title": "Stranger Things",
        "is_fav": 0,
        "status": "watching",
        "notes": "...",
        "user_rating": 4,
        "updated_at": "...",
        "runtime_mins": 0
      }
    ]
  }
  ```

### 3.2 Add / Update a Library Entry (upsert)
- **POST** `/api/library`
- Auth: required
- Body (JSON):

  | Field | Type | Required | Notes |
  |-------|------|----------|-------|
  | `platform` | string | **yes** | e.g. `"netflix"`, `"prime_video"` |
  | `title` | string | **yes** | exact title string |
  | `status` | string | no | `"not-started"` \| `"watching"` \| `"finished"` \| `"watchlist"` (default `"not-started"`) |
  | `is_fav` | bool | no | default `false` |
  | `user_rating` | int | no | 0–5 (default `0`) |
  | `notes` | string | no | free text |

- Returns: `{"ok": true}`
- Errors: `400` missing platform/title or invalid status/rating

### 3.3 Get My Rated Titles
- **GET** `/api/ratings`
- Auth: required
- Query params:

  | Param | Values | Default |
  |-------|--------|---------|
  | `sort` | `"rating"` \| `"title"` \| `"year"` | `"rating"` |

- Returns titles where `user_rating > 0` with TMDB-friendly fields.

### 3.4 Export My Library (JSON)
- **GET** `/api/export-library`
- Auth: required
- Returns `{"library": [...], "watched": [...]}` — use with `/api/import-library`.

### 3.5 Import Library (JSON)
- **POST** `/api/import-library`
- Auth: required
- Body (JSON):
  ```json
  {
    "library": [
      {"platform": "netflix", "title": "...", "is_fav": 0, "status": "watching", "notes": null}
    ],
    "watched": [
      {"platform": "netflix", "title": "...", "season_num": 1, "ep_mask": 255, "runtime_mins": 320}
    ]
  }
  ```
- Returns: `{"library_rows": N, "watched_rows": N}`

---

## 4. Watched / Episode Tracking

### 4.1 Get Watched Episodes
- **GET** `/api/watched`
- Auth: required
- Query params (both optional — omit both to get all watched items):

  | Param | Type | Notes |
  |-------|------|-------|
  | `platform` | string | filter by platform |
  | `title` | string | filter by title (use with `platform`) |

- Returns: `{"watched": [{"item_type": "episode", "season_num": 1, "episode_num": 3, ...}]}`

### 4.2 Mark / Unmark a Single Episode as Watched
- **POST** `/api/watched`
- Auth: required
- Body (JSON):

  | Field | Type | Required | Notes |
  |-------|------|----------|-------|
  | `platform` | string | **yes** | |
  | `title` | string | **yes** | |
  | `item_type` | string | no | `"episode"` (default) |
  | `season_num` | int | no | season number (default `0`) |
  | `episode_num` | int | no | episode number 1–62 |
  | `runtime_mins` | int | no | episode runtime, used for watch-time stats |
  | `watched` | bool | no | `true` = mark watched, `false` = unmark (default `true`) |

- Returns: `{"ok": true}`

### 4.3 Batch Mark / Unmark Episodes as Watched
- **POST** `/api/watched/batch`
- Auth: required
- Body (JSON):

  | Field | Type | Required | Notes |
  |-------|------|----------|-------|
  | `platform` | string | **yes** | |
  | `title` | string | **yes** | |
  | `watched` | bool | no | `true` = mark, `false` = unmark (default `true`) |
  | `seasons` | array | no | if empty + `watched=false`, deletes all watch records for the title |

  Each `seasons` item:
  ```json
  {"season_num": 1, "episodes": [1, 2, 3], "runtime_mins": 120}
  ```
  - `episodes: []` with `watched=false` clears the entire season row.

- Returns: `{"ok": true}`

### 4.4 Backfill Episode Runtimes
- **PATCH** `/api/watched/backfill`
- Auth: required
- Body (JSON):
  ```json
  {
    "updates": [
      {"platform": "netflix", "title": "...", "season_num": 1, "runtime_mins": 350}
    ]
  }
  ```
- Returns: `{"ok": true, "updated": N}`

---

## 5. Titles & Catalog

### 5.1 Detect Country (GeoIP)
- **GET** `/api/geoip`
- Auth: none
- Returns: `{"country": "US"}` — uses the requester's IP; returns `""` for private/local IPs.

### 5.2 Get All Available Regions
- **GET** `/api/regions`
- Auth: required
- Returns: `{"regions": ["US", "GB", "PT", ...]}`

### 5.3 Browse Titles
- **GET** `/api/titles`
- Auth: required
- Query params (all optional):

  | Param | Type | Notes |
  |-------|------|-------|
  | `platform` | string | filter by platform key (e.g. `"netflix"`); `"all"` for no filter |
  | `region` | string | ISO country code; `"all"` for no filter |
  | `type` | string | `"movie"` or `"tv"` |
  | `trending` | `"1"` | only trending titles |
  | `search` | string | partial title match |
  | `sort` | string | `"rank"` (default) \| `"imdb"` \| `"rt"` \| `"year"` \| `"title"` |
  | `limit` | int | max results (default 100, max 50000) |
  | `offset` | int | pagination offset (default 0) |
  | `unique` | `"1"` | deduplicate to one card per `title+content_type`, merging all platforms |

- Returns: `{"titles": [...], "total": N, "region_count": N}`

### 5.4 Title Stats
- **GET** `/api/titles/stats`
- Auth: required
- Returns total title count, list of platforms and regions, and the current user's library summary (favourites, watching, finished).

### 5.5 Save TMDB Runtime to Title
- **PATCH** `/api/titles/runtime`
- Auth: required
- Body (JSON): `{"platform": "...", "title": "...", "runtime_mins": 120}`
- Returns: `{"ok": true}`

### 5.6 Save TMDB End Year to Title
- **PATCH** `/api/titles/end_year`
- Auth: required
- Body (JSON): `{"platform": "...", "title": "...", "end_year": "2023"}`
- Returns: `{"ok": true}`

### 5.7 Save TMDB Ongoing Status to Title
- **PATCH** `/api/titles/is_ongoing`
- Auth: required
- Body (JSON): `{"platform": "...", "title": "...", "is_ongoing": true}`
- Returns: `{"ok": true}`

### 5.8 Upcoming Episodes (for tracked TV shows)
- **GET** `/api/upcoming`
- Auth: required
- Query params:

  | Param | Notes |
  |-------|-------|
  | `force=1` | bypass the 6-hour TMDB cache and re-fetch all shows |

- Returns upcoming episodes for all TV shows in your library with status `watching`, `finished`, or marked as favourite. Data sourced from TMDB.

### 5.9 Platform Logos
- **GET** `/api/platform-logos`
- Auth: required
- Returns a map of `platform_key → logo_url` for supported platforms (logos cached 30 days from TMDB).

### 5.10 Poster Cache — Get
- **GET** `/api/posters/cache`
- Auth: required
- Supports ETag / `If-None-Match` caching.
- Returns: `{"cache": {"<cache_key>": {"poster": "...", "backdrop": "..."}}}`

### 5.11 Poster Cache — Save
- **POST** `/api/posters/cache`
- Auth: required
- Body (JSON array):
  ```json
  [
    {"cache_key": "netflix::Stranger Things", "poster_url": "...", "backdrop_url": "..."}
  ]
  ```
- Returns: `{"ok": true, "saved": N}`

---

## 6. TMDB Proxy

All TMDB proxy endpoints forward requests to The Movie Database API using the server-side `TMDB_API_KEY`. The API key is never exposed to the client.

### 6.1 Search (movie / tv / person)
- **GET** `/api/tmdb/search`
- Auth: required
- Query params:

  | Param | Type | Required | Notes |
  |-------|------|----------|-------|
  | `query` | string | **yes** | search term |
  | `type` | string | no | `"movie"` (default) \| `"tv"` \| `"person"` |
  | `year` | string | no | release year filter |

- Returns top 5 results from TMDB.

### 6.2 Movie / TV Details
- **GET** `/api/tmdb/<media_type>/<tmdb_id>`
- Auth: required
- `media_type`: `"movie"` or `"tv"`
- Returns full TMDB details object including `external_ids`.

### 6.3 Movie / TV Credits
- **GET** `/api/tmdb/<media_type>/<tmdb_id>/credits`
- Auth: required
- `media_type`: `"movie"` or `"tv"`
- Returns cast and crew from TMDB.

### 6.4 TV Season Details
- **GET** `/api/tmdb/tv/<tmdb_id>/season/<season_num>`
- Auth: required
- Returns full season data including episode list, air dates, runtimes, and guest stars.

### 6.5 Person Details
- **GET** `/api/tmdb/person/<person_id>`
- Auth: required
- Returns TMDB person object.

---

## 7. Friends & Social

### 7.1 List Friends
- **GET** `/api/friends`
- Auth: required
- Returns: `{"friends": [{"id": 1, "username": "...", "display_name": "...", "profile_pic": "..."}]}`

### 7.2 Search Users
- **GET** `/api/friends/search?q=<query>`
- Auth: required
- `q` must be at least 2 characters. Returns up to 20 users with their `friendship_status`:
  - `null` — no relationship
  - `"friends"` — already friends
  - `"request_sent"` — you sent a request to them
  - `"request_received"` — they sent you a request

### 7.3 Send Friend Request
- **POST** `/api/friends/request`
- Auth: required
- Body (JSON): `{"user_id": <int>}`
- Returns: `{"ok": true, "status": "request_sent" | "accepted"}` (auto-accepts if they already sent you a request)
- Errors: `400` invalid user, `404` user not found, `409` already friends / request already sent

### 7.4 Accept Friend Request
- **POST** `/api/friends/accept`
- Auth: required
- Body (JSON): `{"user_id": <int>}` (the user who sent you the request)
- Returns: `{"ok": true}`
- Errors: `404` no pending request from that user

### 7.5 Reject Friend Request
- **POST** `/api/friends/reject`
- Auth: required
- Body (JSON): `{"user_id": <int>}`
- Returns: `{"ok": true}`

### 7.6 Cancel Sent Friend Request
- **DELETE** `/api/friends/request/<user_id>`
- Auth: required
- Returns: `{"ok": true}`

### 7.7 Remove Friend
- **POST** `/api/friends/remove`
- Auth: required
- Body (JSON): `{"user_id": <int>}`
- Returns: `{"ok": true}`

### 7.8 View Incoming Pending Requests
- **GET** `/api/friends/requests`
- Auth: required
- Returns list of users who have sent you a friend request (status `pending`).

### 7.9 View Outgoing Sent Requests
- **GET** `/api/friends/requests/sent`
- Auth: required
- Returns list of users you have sent a friend request to (status `pending`).

### 7.10 Friend's Public Profile
- **GET** `/api/friends/<user_id>/profile`
- Auth: required (must be friends with that user)
- Returns username, display name, profile pic, library visibility, and cached stats.

### 7.11 Friend's Recently Watched
- **GET** `/api/friends/<user_id>/watched`
- Auth: required (must be friends)
- Returns up to 30 titles the friend has marked `watching` or `finished`.

### 7.12 Friend's Full Library
- **GET** `/api/friends/<user_id>/library`
- Auth: required (must be friends AND friend's `library_public` must be `true`)
- Returns full library (platform, title, status, is_fav, content_type, release_year, scores).
- Errors: `403` not friends, or library is private.

### 7.13 Share a Title Action with Friends
- **POST** `/api/friends/share`
- Auth: required
- Body (JSON):
  ```json
  {
    "friend_ids": [2, 5],
    "action": {
      "type": "shared_action",
      "title": "Stranger Things",
      "platform": "netflix",
      "status": "finished",
      "is_fav": true
    }
  }
  ```
  - `type` can be `"shared_action"` (automatic status/fav change) or `"title_message"` (compose a message)
  - For `title_message`, add `"message": "You have to watch this!"` to `action`
- Returns: `{"ok": true, "sent": N}` where N is the number of friends successfully notified.

---

## 8. Notifications

### 8.1 Get Notifications
- **GET** `/api/notifications`
- Auth: required
- Query params:

  | Param | Type | Default |
  |-------|------|---------|
  | `offset` | int | 0 |

- Returns 10 notifications per page:
  ```json
  {
    "notifications": [
      {
        "id": 1,
        "type": "friend_request | friend_accepted | shared_action | title_message",
        "actor_id": 2,
        "actor_name": "...",
        "actor_username": "...",
        "actor_pic": "...",
        "payload": {},
        "is_read": false,
        "created_at": "..."
      }
    ],
    "unread": 3,
    "has_more": false,
    "offset": 0
  }
  ```

### 8.2 Mark Notification(s) as Read
- **POST** `/api/notifications/read`
- Auth: required
- Body (JSON):
  - `{"id": <int>}` — mark one notification as read
  - `{}` (empty body) — mark **all** notifications as read
- Returns: `{"ok": true}`

### 8.3 Delete a Notification
- **DELETE** `/api/notifications/<notification_id>`
- Auth: required
- Returns: `{"ok": true}`

### 8.4 Clear All Notifications
- **DELETE** `/api/notifications`
- Auth: required
- Returns: `{"ok": true}`

---

## 9. Web Push

### 9.1 Get VAPID Public Key
- **GET** `/api/push/vapid-public-key`
- Auth: none
- Returns: `{"publicKey": "..."}` — use this in the browser's `PushManager.subscribe()` call.

### 9.2 Subscribe to Push Notifications
- **POST** `/api/push/subscribe`
- Auth: required
- Body (JSON): the `PushSubscription` object from the browser:
  ```json
  {
    "endpoint": "https://...",
    "keys": {"p256dh": "...", "auth": "..."}
  }
  ```
- Returns: `{"ok": true}`

### 9.3 Unsubscribe from Push Notifications
- **POST** `/api/push/unsubscribe`
- Auth: required
- Body (JSON): `{"endpoint": "https://..."}` (the subscription endpoint to remove)
- Returns: `{"ok": true}`

---

## 10. Admin & Scraper

> All admin endpoints require the logged-in user to have `is_admin = true`.

### 10.1 List All Users
- **GET** `/api/admin/users`
- Auth: admin required
- Returns all users with id, username, email, auth_type, is_admin, created_at, last_login.

### 10.2 List Scrape Runs
- **GET** `/api/runs`
- Auth: required
- Returns the 50 most recent scrape runs (id, mode, regions, title_count, status, timestamps).

### 10.3 Run Scraper (live SSE stream)
- **GET** `/api/run/<mode>/<regions>`
- Auth: required
- Path params:

  | Param | Examples |
  |-------|---------|
  | `mode` | `"trending"`, `"catalog"`, `"all"` |
  | `regions` | `"US"`, `"US,GB,PT"`, `"ALL"` |

- Query params (all optional):

  | Param | Notes |
  |-------|-------|
  | `min_votes` | minimum IMDB vote count filter |
  | `multi_sort=1` | enable multi-sort mode in the scraper |
  | `proxy_url` | proxy URL to use for JustWatch requests |

- Returns a `text/event-stream` (SSE) stream of log lines. Final message is `data: __DONE__`.

### 10.4 Start TMDB Enrichment (background)
- **POST** `/api/enrich`
- Auth: admin required
- Body: none
- Returns: `{"started": true}` immediately; enrichment runs in the background.
- Errors: `409` if enrichment is already running.

### 10.5 Poll Enrichment Status
- **GET** `/api/enrich/status`
- Auth: admin required
- Returns:
  ```json
  {"running": false, "done": true, "error": null, "log": ["line 1", "line 2"]}
  ```

### 10.6 Import JSON Files (legacy one-time import)
- **POST** `/api/import-json`
- Auth: required
- Body: none
- Imports `streaming_*.json` files from the `output/` directory into the database.
- Returns: `{"message": "Imported N titles from M files", "imported": N}`

### 10.7 Download Database
- **GET** `/api/download-db`
- Auth: admin required
- Returns the raw SQLite database file as a download (`stream_intel.db`).

### 10.8 Upload / Replace Database
- **POST** `/api/upload-db`
- Auth: admin cookie **or** `X-Migration-Secret: <secret>` header
- Body: `multipart/form-data` with field `db` = SQLite file
- Validates integrity, applies schema migrations, then atomically replaces the live database.
- Returns: `{"ok": true, "users": N, "size_bytes": N}`

### 10.9 Push Titles from Local Scrape
- **POST** `/api/push-titles`
- Auth: admin cookie **or** `X-Migration-Secret: <secret>` header
- Body: `multipart/form-data` with field `db` = local SQLite file containing scraped titles
- Merges only `titles` and `scrape_runs` rows — user data in the production DB is untouched.
- Returns: `{"ok": true, "titles_merged": N}`

---

## Notes

- **Authentication:** Cookie-based (`si_token`) for web; Bearer token for mobile.
- **Status values:** `"not-started"` | `"watching"` | `"finished"` | `"watchlist"`
- **Rating:** integer 0–5 (`0` = unrated)
- **Episode bitmask:** episodes are stored as a 62-bit integer (`ep_mask`) per season row; episode N = bit `N-1`.
- **ETag caching:** `/api/library` and `/api/posters/cache` support `If-None-Match` for conditional GETs.
- Admin features require `is_admin = true` on the user record.

For further technical details see [API_REFERENCE.md](API_REFERENCE.md).

---

---

# React Native App — Implementation Guide

Everything required to replicate every backend feature in a React Native (Expo-managed or bare workflow) app. Each section describes **what the user sees and does** (screen elements, tap targets, input fields, validation feedback) and the API call that results.

---

## RN-0. Foundation

### Base URL & API Client

```js
// lib/api.js
import * as SecureStore from 'expo-secure-store';

export const BASE_URL = __DEV__
  ? 'http://localhost:5000'
  : 'https://your-production-host.up.railway.app';

export async function apiFetch(path, options = {}) {
  const token = await SecureStore.getItemAsync('si_token');
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  return res;
}
```

### Token Storage

The web app uses an `httpOnly` cookie. Mobile clients cannot read cookies, so every login/register endpoint must return the token in the JSON body. Store it with `expo-secure-store` (device keychain/keystore) and send it as `Authorization: Bearer <token>` on every authenticated request.

> **Security note:** Never use plain `AsyncStorage` for the session token in production — it is unencrypted. Use `expo-secure-store`.

### Required Packages

```
expo-secure-store               token storage (keychain/keystore)
expo-image-picker               profile picture selection
expo-image-manipulator          resize images before upload
expo-document-picker            pick .json / .db files from device
expo-file-system                read/write/download files
expo-sharing                    share / save exported files
expo-notifications              push notification registration
expo-localization               country fallback for GeoIP
@react-native-google-signin/google-signin   native Google OAuth
react-native-sse                Server-Sent Events for scraper stream
```

---

## RN-1. Authentication

### 1.1 Register — `RegisterScreen`

**Screen elements:**
- `TextInput` — "Username" (auto-capitalise off, trim whitespace)
- `TextInput` — "Password" (secureTextEntry, min 6 chars)
- `TextInput` — "Confirm Password" (secureTextEntry, must match)
- `Button` — "Create Account"
- `TouchableOpacity` — "Already have an account? Log in" → navigate to `LoginScreen`

**User steps:**
1. Type a username (3–30 characters, no spaces).
2. Type a password (at least 6 characters).
3. Re-type the password to confirm.
4. Tap **Create Account**.
5. If validation passes, the API call is made. On success the user is navigated to the main app (or `UsernameSetupScreen` if `setup_required` comes back true for Google accounts).
6. Inline error text appears below the relevant field on failure (e.g. "Username already taken", "Password too short").

**Validation (client-side, before API call):**
- Username empty → "Username is required"
- Username < 3 chars → "Username must be at least 3 characters"
- Password < 6 chars → "Password must be at least 6 characters"
- Passwords don't match → "Passwords do not match"

**Backend change needed:** `POST /api/auth/register` must return `{"ok": true, "token": "..."}` so the mobile client can store the token.

```js
const res = await apiFetch('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ username, password }),
});
const { ok, token, error } = await res.json();
if (ok && token) {
  await SecureStore.setItemAsync('si_token', token);
  navigate('AppTabs');
} else {
  setError(error);
}
```

---

### 1.2 Login — `LoginScreen`

**Screen elements:**
- `TextInput` — "Username"
- `TextInput` — "Password" (secureTextEntry)
- `Button` — "Log In"
- `TouchableOpacity` — "Sign in with Google" (Google logo + label)
- `TouchableOpacity` — "Don't have an account? Register" → `RegisterScreen`

**User steps:**
1. Type username and password.
2. Tap **Log In**.
3. On success → navigate to `AppTabs` (main bottom-tab navigator).
4. On failure → error banner: "Invalid username or password".

**Backend change needed:** `POST /api/auth/login` must also include `{"token": "..."}` in the JSON response body.

```js
const res = await apiFetch('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username, password }),
});
const { ok, token, error } = await res.json();
if (ok && token) {
  await SecureStore.setItemAsync('si_token', token);
  navigate('AppTabs');
} else {
  setError(error);
}
```

---

### 1.3 Google Sign-In — `LoginScreen` (same screen, distinct button)

**User steps:**
1. Tap **Sign in with Google**.
2. The native Google account picker sheet appears.
3. User selects their Google account and confirms.
4. App exchanges the `serverAuthCode` with the server.
5. On success → navigate to `AppTabs`. If `setup_required` is true → navigate to `UsernameSetupScreen` first.
6. On failure → error banner: "Google sign-in failed: \<reason\>".

```js
import { GoogleSignin } from '@react-native-google-signin/google-signin';

GoogleSignin.configure({
  webClientId: 'YOUR_WEB_CLIENT_ID',
  offlineAccess: true,
});

async function handleGoogleSignIn() {
  try {
    const { serverAuthCode } = await GoogleSignin.signIn();
    const res = await apiFetch('/api/auth/google-mobile', {
      method: 'POST',
      body: JSON.stringify({ server_auth_code: serverAuthCode }),
    });
    const { ok, token, setup_required } = await res.json();
    if (ok) {
      await SecureStore.setItemAsync('si_token', token);
      navigate(setup_required ? 'UsernameSetup' : 'AppTabs');
    }
  } catch (e) {
    setError('Google sign-in failed');
  }
}
```

**Server env vars needed:** `GOOGLE_MOBILE_CLIENT_ID`, `GOOGLE_MOBILE_CLIENT_SECRET`.

---

### 1.4 Username Setup — `UsernameSetupScreen`
*(Only shown after first-time Google sign-in when `setup_required = true`)*

**Screen elements:**
- Explanatory text: "Choose a username to complete your profile."
- `TextInput` — "Username" (3–30 chars)
- `Button` — "Save Username"

**User steps:**
1. Type a username.
2. Tap **Save Username** → calls `POST /api/profile` with `{"username": "..."}`.
3. On success → navigate to `AppTabs`.
4. On error "Username already taken" → show inline error, let user try another.

---

### 1.5 Logout — `ProfileScreen`

**Screen element:** `Button` — "Log Out" (typically at the bottom of the Profile tab, styled in red/destructive).

**User steps:**
1. Tap **Log Out**.
2. Confirmation alert: "Are you sure you want to log out?" with **Cancel** / **Log Out** buttons.
3. On confirm → API call + clear local token → navigate back to `LoginScreen`.

```js
await apiFetch('/api/auth/logout', { method: 'POST' });
await SecureStore.deleteItemAsync('si_token');
navigate('Auth');
```

---

### 1.6 Change Password — `ChangePasswordScreen`

**Screen elements:**
- `TextInput` — "Current Password" (secureTextEntry)
- `TextInput` — "New Password" (secureTextEntry, min 6 chars)
- `TextInput` — "Confirm New Password" (secureTextEntry)
- `Button` — "Update Password"

**User steps:**
1. Enter current password.
2. Enter new password twice.
3. Tap **Update Password**.
4. Success toast: "Password updated." Navigate back.
5. Error cases shown inline: "Current password is incorrect", "New password must be at least 6 characters".

---

## RN-2. Profile

### 2.1 View Profile — `ProfileScreen`

**Screen shows (loaded from `GET /api/profile`):**
- Circular avatar at the top (tap to change — see 2.2). If no avatar, show initials placeholder.
- Display name (large text) + username (muted, below)
- Member since date
- Stats row: Movies finished · TV shows finished · Episodes watched
- Watch time summary (movie mins formatted, TV mins formatted, total)
- Top genres as horizontal chips
- "Edit Profile" button → `EditProfileScreen`
- "Ratings" button → `RatingsScreen`
- "Watch Time Breakdown" button → `WatchTimeScreen`
- "Change Password" button (only visible if `auth_type = "password"`) → `ChangePasswordScreen`
- "Log Out" button

**User steps:**
1. Screen is loaded automatically on tab focus. A loading spinner shows while the API call is in flight.
2. Pull-to-refresh to reload stats.

---

### 2.2 Edit Profile — `EditProfileScreen`

**Screen elements:**
- Large avatar image with a camera-icon overlay button → tap to open image picker
- `TextInput` — "Display Name" (pre-filled, max 60 chars)
- `TextInput` — "Username" (pre-filled, 3–30 chars, shows availability hint)
- `TextInput` — "Country" (2-letter ISO code, e.g. "US"; or a `Picker` component with a country list)
- `Switch` — "Public Library" (toggles whether friends can browse your full library)
- `Button` — "Save Changes"

**User steps for avatar:**
1. Tap the camera overlay on the avatar.
2. A bottom-sheet action sheet appears: **Choose from Library** / **Take Photo** / **Cancel**.
3. The system photo picker opens. User selects a photo.
4. The app resizes it to ≤1.5 MB using `expo-image-manipulator` and converts it to a base64 data URI.
5. The new avatar is previewed immediately (optimistic UI). Tap **Save Changes** to persist.

**User steps for text fields:**
1. Edit any field.
2. Tap **Save Changes** → calls `POST /api/profile` with only the changed fields.
3. Success: navigate back to `ProfileScreen`, which refreshes.
4. Errors shown inline: "Username already taken", "Invalid country code".

```js
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

async function pickAvatar() {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 1,
  });
  if (result.canceled) return;
  const compressed = await ImageManipulator.manipulateAsync(
    result.assets[0].uri,
    [{ resize: { width: 400 } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );
  setProfilePic(`data:image/jpeg;base64,${compressed.base64}`);
}
```

**Required permission:** Android needs `MEDIA_LIBRARY`; iOS needs `NSPhotoLibraryUsageDescription` in `Info.plist`.

---

### 2.3 Watch-Time Breakdown — `WatchTimeScreen`

**Screen shows:**
- Sorted list of titles (all statuses except `not-started`), each row showing title, status badge, content type, and watch time in minutes.
- Sort picker at the top: by watch time / title / year.

**User steps:**
1. Open from the "Watch Time Breakdown" button on ProfileScreen.
2. Scroll the list. Tap a title row → navigate to `TitleDetailScreen`.

---

## RN-3. Library

### 3.1 View Library — `LibraryScreen`

**Screen shows (loaded from `GET /api/library`):**
- Search bar at the top (filters client-side).
- Filter chips below the search bar: **All** / **Watching** / **Finished** / **Watchlist** / **Favourites**.
- Scrollable grid or list of title cards, each showing poster, title, platform, status badge, star rating (if rated), and a heart icon if favourited.

**User steps:**
1. Screen loads on tab focus. ETag caching means subsequent opens are instant if nothing changed.
2. Tap a filter chip to narrow the list.
3. Type in the search bar to filter by title.
4. Tap a title card → navigate to `TitleDetailScreen`.
5. Long-press a title card → contextual action sheet: **Edit Status / Rating** · **Remove from Library** · **Cancel**.
6. Pull-to-refresh to force a reload.

---

### 3.2 Add / Update Library Entry — `TitleDetailScreen` / `LibraryEntrySheet`

**Trigger:** Tapping **+ Add to Library** or **Edit** on a title card.

**Screen elements (bottom sheet or modal):**
- Title name (read-only header)
- `SegmentedControl` or `Picker` — Status: Not Started · Watchlist · Watching · Finished
- Star rating row — 5 tappable stars (0 = unrated, tap same star to deselect)
- `Switch` — Add to Favourites (heart icon)
- `TextInput` (multiline) — Notes (optional)
- `Button` — "Save"
- `Button` (destructive) — "Remove from Library" (only shown if already in library)

**User steps:**
1. Tap desired status segment.
2. Tap a star to set rating (tap the same star again to set to 0).
3. Toggle the favourites switch.
4. Optionally type notes.
5. Tap **Save** → calls `POST /api/library`.
6. Toast: "Library updated." Sheet dismisses.

---

### 3.3 Rated Titles — `RatingsScreen`

**Screen shows:**
- Sort picker: **Rating** (default) · **Title** · **Year**
- List of titles the user has rated (rating > 0), each row showing stars, IMDB score, genre, and year.

**User steps:**
1. Open from ProfileScreen.
2. Change sort order via the picker at the top.
3. Tap a title row → navigate to `TitleDetailScreen`.

---

### 3.4 Export Library — `ProfileScreen` → Settings section

**Screen element:** `Button` — "Export Library"

**User steps:**
1. Tap **Export Library**.
2. Loading indicator while the API call completes.
3. The native share sheet opens with `streamIntelLibrary.json`. User can save to Files, share via AirDrop, email, etc.

```js
const res = await apiFetch('/api/export-library');
const json = await res.text();
const path = FileSystem.documentDirectory + 'streamIntelLibrary.json';
await FileSystem.writeAsStringAsync(path, json);
await Sharing.shareAsync(path, { mimeType: 'application/json' });
```

---

### 3.5 Import Library — `ProfileScreen` → Settings section

**Screen element:** `Button` — "Import Library"

**User steps:**
1. Tap **Import Library**.
2. Confirmation alert: "This will merge the imported library with your existing one. Continue?" → **Cancel** / **Import**.
3. The system document picker opens. User selects a `.json` file previously exported from StreamIntel.
4. Progress indicator while import runs.
5. Toast: "Imported N titles and N watched records."

```js
const picked = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
if (picked.canceled) return;
const content = await FileSystem.readAsStringAsync(picked.assets[0].uri);
const res = await apiFetch('/api/import-library', {
  method: 'POST',
  body: content,
});
const { library_rows, watched_rows } = await res.json();
showToast(`Imported ${library_rows} titles, ${watched_rows} watched records`);
```

---

## RN-4. Watched / Episode Tracking

### 4.1 View & Toggle Episodes — `EpisodesScreen`

**Screen shows (loaded from `GET /api/watched?platform=&title=`):**
- Season accordion list. Each season row shows "Season N — X / Y episodes watched".
- Tap a season to expand it into an episode grid.
- Each episode cell shows the episode number, a checkmark if watched, and a long-press option to see episode name and air date (from TMDB season data via `GET /api/tmdb/tv/<id>/season/<n>`).
- "Mark all watched" button per season.
- "Unwatch all" button per season (shown when all episodes are watched).

**User steps — mark one episode:**
1. Tap the episode cell to toggle it. The cell animates to checked/unchecked state immediately (optimistic UI).
2. Calls `POST /api/watched` with `{platform, title, season_num, episode_num, runtime_mins, watched: true/false}`.
3. Season progress counter updates instantly.

**User steps — mark full season:**
1. Tap **Mark all watched** button on a season row.
2. Confirmation alert: "Mark all episodes of Season N as watched?" → **Cancel** / **Mark All**.
3. Calls `POST /api/watched/batch` with all episode numbers for that season.
4. All episode cells flip to checked; season progress shows 100%.

**User steps — unwatch full title:**
1. On the title detail screen, tap **⋮** (more options) → **Unwatch All Episodes**.
2. Confirmation alert.
3. Calls `POST /api/watched/batch` with `{watched: false, seasons: []}` which deletes all records for the title.

---

## RN-5. Titles & Catalog

### 5.1 Browse / Search Titles — `TitlesListScreen`

**Screen shows:**
- Search bar at the top.
- Filter row (horizontal scroll): Platform chips (Netflix · Prime · Disney+ · …) and a Region picker.
- Sort picker: **Rank** (default) · **IMDB** · **Rotten Tomatoes** · **Year** · **Title**.
- Type toggle: **All** · **Movies** · **TV Shows**.
- Trending toggle switch.
- `FlatList` (2-column grid on phones, 3-column on tablets) of title cards with poster, title, platform logo, IMDB score.

**User steps:**
1. Screen opens on the Catalog tab. First load fetches `GET /api/titles?limit=50&offset=0`.
2. Type in the search bar → filters update as user types (debounced 300 ms).
3. Tap a platform chip to filter by platform. Tap again to deselect.
4. Tap the Region picker → modal list of available regions (from `GET /api/regions`). Selected region is remembered.
5. Tap the sort picker to change sort order.
6. Scroll to the bottom of the list → next page is automatically fetched (`offset += 50`) and appended.
7. Tap a title card → navigate to `TitleDetailScreen`.
8. Pull-to-refresh to reload.

**Country auto-detection on first launch:**
```js
import * as Localization from 'expo-localization';

const res = await apiFetch('/api/geoip');
const { country } = await res.json();
const detected = country || Localization.region || 'US';
await AsyncStorage.setItem('home_country', detected);
```

---

### 5.2 Title Detail — `TitleDetailScreen`

**Screen sections:**
- Hero poster / backdrop image at the top.
- Title, year, content type badge, maturity rating badge.
- Platform availability chips (each platform the title appears on, with its region flag).
- Score row: IMDB score · Rotten Tomatoes · TMDB score.
- Synopsis paragraph (expandable "Read more").
- Library action bar: status picker + star rating + favourite heart toggle (calls `POST /api/library`).
- **For TV shows:** Season/episode section → tap to go to `EpisodesScreen`.
- **For TV shows:** "Upcoming Episodes" mini-card if the show appears in the upcoming list.
- Cast section (horizontal scroll of cast cards — loaded from `GET /api/tmdb/<type>/<id>/credits`).
- "Share with friends" button → `ShareWithFriendsSheet`.

**User steps:**
1. Arrive from any title card in the app.
2. Scroll down to read synopsis.
3. Tap **+ Add to Library** or the status picker if already in library → `LibraryEntrySheet` (§3.2).
4. Tap a star to rate → updates in-library entry.
5. Tap the heart icon to favourite/unfavourite.
6. Tap a cast member's avatar → `PersonDetailScreen` (calls `GET /api/tmdb/person/<id>`).
7. Tap **Share with Friends** → `ShareWithFriendsSheet`.

---

### 5.3 Upcoming Episodes — `UpcomingEpisodesScreen`

**Screen shows (loaded from `GET /api/upcoming`):**
- Grouped by air date. Each row: show poster thumbnail, show name, season/episode number, episode name, days until airdate badge.
- Episodes airing today are highlighted.
- "Refresh" button in the header.

**User steps:**
1. Open from the Upcoming tab.
2. Skeleton placeholder appears while the API call runs (can be slow — up to ~5 s if cache is stale).
3. Tap **Refresh** in the nav header → calls `GET /api/upcoming?force=1` to bypass the 6-hour cache.
4. Tap an episode row → navigate to `TitleDetailScreen` for that show.

---

## RN-6. TMDB Proxy

TMDB data is used throughout the app. There are no user-facing "screens" for these endpoints directly — they power the detail views.

- **`GET /api/tmdb/search`** — drives the title search on `TitlesListScreen` and the friend share title selector.
- **`GET /api/tmdb/<type>/<id>`** — powers `TitleDetailScreen` (scores, overview, `external_ids`).
- **`GET /api/tmdb/<type>/<id>/credits`** — powers the cast list on `TitleDetailScreen`.
- **`GET /api/tmdb/tv/<id>/season/<n>`** — powers `EpisodesScreen` (episode names, air dates, runtimes).
- **`GET /api/tmdb/person/<id>`** — powers `PersonDetailScreen` (bio, known for, profile photo).

---

## RN-7. Friends & Social

### 7.1 Friends List — `FriendsListScreen`

**Screen shows (loaded from `GET /api/friends`):**
- Search icon in the header → `FriendSearchScreen`.
- Bell badge icon in the header showing pending-request count (from `GET /api/friends/requests`).
- List of accepted friends, each row: avatar + display name + username + "View Profile" button.
- Empty state: "You have no friends yet. Search for users to add them."

**User steps:**
1. Open from the Friends tab.
2. Tap a friend row → `FriendProfileScreen`.
3. Long-press a friend row → action sheet: **View Library** · **Remove Friend** · **Cancel**.

---

### 7.2 Search Users — `FriendSearchScreen`

**Screen shows:**
- `TextInput` search bar (auto-focused on open).
- Results list, each row showing username, display name, avatar, and a status button:
  - **+ Add** (no relationship)
  - **Pending** — grey, tap to **Cancel Request**
  - **Respond** — highlighted, tap to see Accept/Reject options
  - **Friends** — green check

**User steps:**
1. Type at least 2 characters → results appear (calls `GET /api/friends/search?q=...` after 300 ms debounce).
2. Tap **+ Add** on a result row → calls `POST /api/friends/request` with `{user_id}`.
   - Button immediately changes to **Pending** (optimistic UI).
3. Tap **Pending** → confirmation alert "Cancel friend request?" → **Cancel** / **Yes** → calls `DELETE /api/friends/request/<user_id>`.
4. Tap **Respond** on a row where you have a pending incoming request → action sheet: **Accept** / **Decline** / **Cancel**.
   - **Accept** → calls `POST /api/friends/accept`. Button changes to "Friends".
   - **Decline** → calls `POST /api/friends/reject`. User removed from list.

---

### 7.3 Friend Requests — `FriendRequestsScreen`

**Access:** Bell icon badge on `FriendsListScreen` header, or a tab badge.

**Screen shows (loaded from `GET /api/friends/requests`):**
- Section "Incoming Requests" — each row: avatar + name + "Accept" button + "Decline" button.
- Section "Sent Requests" (loaded from `GET /api/friends/requests/sent`) — each row with a "Cancel" button.

**User steps:**
1. Tap **Accept** → calls `POST /api/friends/accept`. Row slides out and the friend appears in the friends list.
2. Tap **Decline** → calls `POST /api/friends/reject`. Row slides out.
3. Tap **Cancel** on a sent request → calls `DELETE /api/friends/request/<user_id>`. Row slides out.

---

### 7.4 Friend Profile — `FriendProfileScreen`

**Screen shows (loaded from `GET /api/friends/<id>/profile`):**
- Avatar + display name + username + member since.
- Stats: movies finished, TV shows, episodes, total watch time.
- Top genres chips.
- "View Library" button (only active if `library_public = true`; otherwise greyed with tooltip "Library is private").
- "Recently Watched" horizontal scroll of up to 30 titles (from `GET /api/friends/<id>/watched`).
- "Remove Friend" button (red, at the bottom).

**User steps:**
1. Open from the friends list or from a notification.
2. Tap **View Library** → `FriendLibraryScreen` (calls `GET /api/friends/<id>/library`).
3. Tap a recently-watched title → `TitleDetailScreen`.
4. Tap **Remove Friend** → confirmation alert → calls `POST /api/friends/remove`.

---

### 7.5 Share with Friends — `ShareWithFriendsSheet`

**Trigger:** Tapping **Share with Friends** on `TitleDetailScreen`, or automatically triggered after a user marks a title as Finished/Watching/Favourite.

**Screen elements (modal bottom sheet):**
- Header: "Share \<Title Name\> with..."
- `TextInput` — "Add a message (optional)" (for `title_message` type)
- Selectable friend list (checkboxes) loaded from `GET /api/friends`.
- **Select All** / **Deselect All** buttons.
- `Button` — "Share" (disabled until at least one friend is selected).

**User steps:**
1. Sheet opens with all friends listed.
2. Tap friend avatars/rows to select them (checkmark toggles).
3. Optionally type a message.
4. Tap **Share** → calls `POST /api/friends/share`.
5. Toast: "Shared with N friend(s)." Sheet dismisses.

---

## RN-8. Notifications

### Notifications — `NotificationsScreen`

**Access:** Bell icon in the header (with unread badge count), or a dedicated tab.

**Screen shows (loaded from `GET /api/notifications`):**
- "Mark all as read" button in header (calls `POST /api/notifications/read` with empty body).
- List of notifications, unread ones highlighted with a coloured left border or background.
- Each row: actor avatar + message text (e.g. "Alice accepted your friend request", "Bob finished Stranger Things") + relative time.
- Swipe left on a row → **Delete** button → calls `DELETE /api/notifications/<id>`.

**User steps:**
1. Tap a friend-request notification → navigate to `FriendRequestsScreen`.
2. Tap a shared-action notification → navigate to `TitleDetailScreen` for the shared title.
3. Tap a friend-accepted notification → navigate to the friend's `FriendProfileScreen`.
4. Tap a row to mark it read (calls `POST /api/notifications/read` with `{"id": id}`).
5. Scroll to the bottom → calls `GET /api/notifications?offset=10` to load the next page (infinite scroll, `has_more` flag).
6. Tap the trash icon in the header → confirmation alert "Clear all notifications?" → calls `DELETE /api/notifications`.

---

## RN-9. Push Notifications

The web app uses Web Push / VAPID. React Native uses FCM (Android) and APNs (iOS) via Expo. These are different stacks — the VAPID endpoints are **not used** on mobile. Use Expo Push Notifications instead.

### Setup (app startup, after login)

**User-facing step:** A system permission dialog automatically appears on iOS ("StreamIntel would like to send you notifications — Allow / Don't Allow"). On Android 13+ a runtime permission dialog appears. The user must tap **Allow** for push to work.

```js
import * as Notifications from 'expo-notifications';

async function registerForPush() {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;
  const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync({
    projectId: 'your-expo-project-id',
  });
  await apiFetch('/api/push/subscribe-mobile', {
    method: 'POST',
    body: JSON.stringify({ token: expoPushToken }),
  });
}
```

**Backend change needed:** New endpoint `POST /api/push/subscribe-mobile` stores the Expo push token per user. The internal `_create_notification()` function must also fire the Expo Push API when an Expo token exists for the recipient.

### Handling incoming push (foreground & background)

```js
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Tap handler — deep-link into the correct screen
Notifications.addNotificationResponseReceivedListener((response) => {
  const url = response.notification.request.content.data?.url;
  if (url) Linking.openURL(url);
});
```

---

## RN-10. Admin & Scraper

*Admin screens are only shown when `is_admin = true` (from `GET /api/auth/me`).*

---

### 10.1 User List — `AdminUsersScreen`

**Screen shows (loaded from `GET /api/admin/users`):**
- Search bar (client-side filter by username).
- List of users: username, email, auth type badge, admin badge, last login date.
- Tap a row → `AdminUserDetailScreen` (future expansion for ban/promote actions).

---

### 10.2 Scrape Runs — `AdminRunsScreen`

**Screen shows (loaded from `GET /api/runs`):**
- Table/list of the 50 most recent scrape runs: mode, regions, title count, status badge (running / done / error), started and finished times.
- "Run Scraper" button → `ScraperLaunchSheet`.

---

### 10.3 Launch Scraper — `ScraperLaunchSheet` + `ScraperLogScreen`

**Screen elements (bottom sheet):**
- `SegmentedControl` — Mode: **Trending** · **Catalog** · **All**
- `TextInput` — Regions (comma-separated, e.g. "US,GB,PT", or "ALL")
- `TextInput` — Min votes (optional integer)
- Additional toggles: Multi-sort, Proxy URL
- `Button` — "Start Scraper"

**User steps:**
1. Select mode and enter regions.
2. Tap **Start Scraper** → sheet dismisses, navigates to `ScraperLogScreen`.
3. `ScraperLogScreen` connects an SSE stream to `GET /api/run/<mode>/<regions>` and streams log lines into a scrolling `ScrollView` that auto-scrolls to the bottom.
4. A spinner in the header shows "Running…" until `__DONE__` is received, then changes to "Done ✓" or "Error ✗".
5. Tap the **✕** button in the header to close (the scraper continues on the server).

```js
import EventSource from 'react-native-sse';

const es = new EventSource(`${BASE_URL}/api/run/${mode}/${regions}`, {
  headers: { Authorization: `Bearer ${token}` },
});
es.addEventListener('message', (e) => {
  if (e.data === '__DONE__') { setDone(true); es.close(); return; }
  setLines(prev => [...prev, e.data]);
});
es.addEventListener('error', () => { setError(true); es.close(); });
```

---

### 10.4 TMDB Enrichment — `EnrichmentScreen`

**Screen shows:**
- Status banner: Idle / Running / Done / Error.
- Scrolling log output (polled from `GET /api/enrich/status` every 3 seconds while running).
- `Button` — "Start Enrichment" (disabled while running).

**User steps:**
1. Tap **Start Enrichment** → calls `POST /api/enrich`.
2. Button disables, status changes to "Running…".
3. Log lines appear as polling fetches `/api/enrich/status` every 3 s.
4. When `done: true` → status banner changes to "Done ✓". Button re-enables.
5. If `error` is non-null → status banner shows "Error: \<message\>" in red.

---

### 10.5 Database Management — `DatabaseScreen`

**Screen elements:**
- Section "Download Database"
  - `Button` — "Download stream_intel.db"
- Section "Upload / Replace Database"
  - `Button` — "Pick .db file and upload"
  - Warning text: "⚠ This replaces the entire production database. All user data will be replaced."
- Section "Push Titles from Local Scrape"
  - `Button` — "Pick .db file and push titles"
  - Info text: "Only titles and scrape_runs are merged. User data is untouched."

**User steps — Download:**
1. Tap **Download stream_intel.db**.
2. Progress indicator.
3. System share sheet opens with the `.db` file. User can save to Files or share.

```js
const dest = FileSystem.documentDirectory + 'stream_intel.db';
await FileSystem.downloadAsync(`${BASE_URL}/api/download-db`, dest, {
  headers: { Authorization: `Bearer ${token}` },
});
await Sharing.shareAsync(dest);
```

**User steps — Upload / Replace:**
1. Tap **Pick .db file and upload**.
2. Confirmation alert: "This will replace the entire database. Are you sure?" → **Cancel** / **Replace**.
3. System document picker opens. User selects a `.db` file.
4. Progress indicator while uploading.
5. Toast: "Database replaced. N users." on success. Error banner on failure.

**User steps — Push Titles:**
1. Tap **Pick .db file and push titles**.
2. System document picker opens. User selects the locally-scraped `.db` file.
3. Progress indicator.
4. Toast: "Merged N titles." on success.

```js
const picked = await DocumentPicker.getDocumentAsync({ type: '*/*' });
const file = picked.assets[0];
const formData = new FormData();
formData.append('db', { uri: file.uri, name: file.name, type: 'application/octet-stream' });
const res = await fetch(`${BASE_URL}/api/push-titles`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: formData,
});
```

---

## RN-11. Required Backend Changes Summary

| # | Endpoint | Change needed |
|---|----------|---------------|
| 1 | `POST /api/auth/login` | Return `{"token": "..."}` in the JSON body (mobile cannot read `httpOnly` cookies) |
| 2 | `POST /api/auth/register` | Same — return the token in the JSON body |
| 3 | `POST /api/push/subscribe-mobile` | New endpoint: store Expo push token for `user_id` in `expo_push_tokens` table |
| 4 | `_create_notification()` (server internal) | Also call Expo Push API when an Expo token exists for the recipient user |

All other endpoints (including `/api/auth/google-mobile`) are already compatible with React Native as-is.

---

## RN-12. Navigation Structure

```
Stack.Navigator
├── Auth (unauthenticated)
│   ├── LoginScreen
│   ├── RegisterScreen
│   └── UsernameSetupScreen   ← Google first-login only
└── App (authenticated)                     ← Tab.Navigator
    ├── CatalogTab
    │   ├── TitlesListScreen
    │   ├── TitleDetailScreen
    │   │   ├── LibraryEntrySheet           ← modal
    │   │   ├── EpisodesScreen
    │   │   ├── CastScreen
    │   │   ├── PersonDetailScreen
    │   │   └── ShareWithFriendsSheet       ← modal
    │   └── (search results inline)
    ├── LibraryTab
    │   ├── LibraryScreen
    │   ├── RatingsScreen
    │   └── WatchTimeScreen
    ├── UpcomingTab
    │   └── UpcomingEpisodesScreen
    ├── FriendsTab
    │   ├── FriendsListScreen
    │   ├── FriendSearchScreen
    │   ├── FriendRequestsScreen            ← badge on tab
    │   ├── FriendProfileScreen
    │   └── FriendLibraryScreen
    ├── NotificationsTab                    ← badge on tab
    │   └── NotificationsScreen
    └── ProfileTab
        ├── ProfileScreen
        ├── EditProfileScreen
        ├── ChangePasswordScreen
        └── AdminScreen                     ← is_admin only
            ├── AdminUsersScreen
            ├── AdminRunsScreen
            ├── ScraperLaunchSheet          ← modal
            ├── ScraperLogScreen
            ├── EnrichmentScreen
            └── DatabaseScreen
```

---

## RN-13. Platform-Specific Notes

| Area | Android | iOS |
|------|---------|-----|
| Google Sign-In | `GOOGLE_MOBILE_CLIENT_ID` = Android OAuth credential | `GOOGLE_MOBILE_CLIENT_ID` = iOS OAuth credential (different SHA-1 / bundle ID) |
| Image picker | Requests `READ_MEDIA_IMAGES` (Android 13+) or `READ_EXTERNAL_STORAGE` | `NSPhotoLibraryUsageDescription` in `Info.plist` |
| Push notifications | FCM via Expo; permission auto-granted below Android 13, runtime dialog on 13+ | APNs via Expo; permission dialog required at runtime |
| Document picker | No extra permissions | No extra permissions |
| File download / share | Saves to app's `documentDirectory`; use `Sharing.shareAsync` or `MediaLibrary` to put it in Downloads | `Sharing.shareAsync` opens the system share sheet; user can save to Files |
| Notifications badge | Set via `expo-notifications` `setBadgeCountAsync` | Same API |
