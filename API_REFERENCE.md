# StreamIntel API Reference

Complete documentation for every HTTP endpoint in the StreamIntel backend.

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Auth Endpoints](#auth-endpoints)
4. [Titles & Catalog](#titles--catalog-endpoints)
5. [Library](#library-endpoints)
6. [Watch History](#watch-history-endpoints)
7. [Ratings](#ratings-endpoints)
8. [Profile](#profile-endpoints)
9. [Friends](#friends-endpoints)
10. [Notifications](#notifications-endpoints)
11. [Push Notifications](#push-notification-endpoints)
12. [TMDB Proxy](#tmdb-proxy-endpoints)
13. [Upcoming Episodes](#upcoming-episodes-endpoint)
14. [Admin & Scraper](#admin--scraper-endpoints)

---

## Overview

| Field | Value |
|---|---|
| **Base URL (Production)** | `https://stream-intel.up.railway.app` |
| **Base URL (Development)** | `http://localhost:5000` |
| **Content-Type** | `application/json` (all request bodies unless noted) |
| **Response format** | JSON |
| **Token TTL** | Configured via `TOKEN_TTL` env var |

All paths below are relative to the base URL.

---

## Authentication

Most endpoints require authentication. Supply credentials using **one** of:

| Method | How to send |
|---|---|
| **Cookie** | `si_token=<token>` (set automatically by login/register) |
| **Bearer header** | `Authorization: Bearer <token>` |
| **Query param** | `?token=<token>` (fallback, less preferred) |

Endpoints marked **🔒 Auth required** return `401 Unauthorized` if no valid token is provided, or `403 Forbidden` if the token is valid but the user lacks the required role.

Endpoints marked **🛡 Admin only** additionally require `users.is_admin = 1` on the authenticated user's account.

---

## Auth Endpoints

Base prefix: `/api/auth`

---

### `GET /api/auth/ping`

Health-check. No authentication required.

**Response `200 OK`**
```json
{
  "ok": true,
  "ts": 1718000000.123
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | Always `true` |
| `ts` | number | Unix timestamp (float) of the server's current time |

---

### `GET /api/auth/setup-status`

Returns whether the application has been set up (i.e., whether any users exist). Useful for showing a first-run setup screen. No authentication required.

**Response `200 OK`**
```json
{
  "needs_setup": false
}
```

| Field | Type | Description |
|---|---|---|
| `needs_setup` | boolean | `true` if no users exist in the database yet |

---

### `POST /api/auth/register`

Register a new user account.

> **Note:** After the very first user is created, this endpoint requires an existing authenticated session. Subsequent registrations are closed to anonymous callers to prevent open sign-ups. This means only an already-logged-in user (typically an admin) can create additional accounts.

**Request body**
```json
{
  "username": "alice",
  "password": "s3cretpass"
}
```

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `username` | string | ✅ | 3–30 characters | Unique, case-insensitive username |
| `password` | string | ✅ | ≥ 6 characters | Plain-text password; hashed server-side |

**Response `201 Created`**

Sets a `si_token` cookie automatically.

```json
{
  "ok": true,
  "username": "alice"
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | Always `true` on success |
| `username` | string | The registered username (normalized/trimmed) |

**Error responses**

| Status | `error` value | Cause |
|---|---|---|
| `400` | `"Username and password required"` | Either field is empty or missing |
| `400` | `"Username must be at least 3 characters"` | Username too short |
| `400` | `"Username must be 30 characters or fewer"` | Username too long |
| `400` | `"Password must be at least 6 characters"` | Password too short |
| `403` | `"Registration is closed — ask an admin to add you."` | Not first user and caller is unauthenticated |
| `409` | `"Username already taken"` | Duplicate username |

---

### `POST /api/auth/login`

Authenticate with username and password.

**Request body**
```json
{
  "username": "alice",
  "password": "s3cretpass"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `username` | string | ✅ | Case-insensitive match |
| `password` | string | ✅ | Plain-text password |

**Response `200 OK`**

Sets a `si_token` cookie automatically (HttpOnly, SameSite=Lax).

```json
{
  "ok": true,
  "username": "alice"
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | Always `true` on success |
| `username` | string | Canonical username from the database |

**Error responses**

| Status | `error` value | Cause |
|---|---|---|
| `400` | `"Username and password required"` | Either field is missing/empty |
| `401` | `"Invalid username or password"` | No matching user or wrong password |

---

### `POST /api/auth/logout`

🔒 Auth required

Revokes the current session token and clears the `si_token` cookie.

**Request body:** none

**Response `200 OK`**
```json
{
  "ok": true
}
```

---

### `GET /api/auth/me`

Returns the authenticated user's session info. Does **not** return `401` on failure — instead returns `authenticated: false`.

**Response `200 OK` — authenticated**
```json
{
  "authenticated": true,
  "username": "alice",
  "favourites": 12,
  "watching": 5,
  "finished": 43,
  "home_country": "US",
  "is_admin": false,
  "setup_required": false
}
```

| Field | Type | Description |
|---|---|---|
| `authenticated` | boolean | `true` |
| `username` | string | User's username |
| `favourites` | integer | Total items marked as favourite |
| `watching` | integer | Items with status `"watching"` |
| `finished` | integer | Items with status `"finished"` |
| `home_country` | string | ISO 3166-1 alpha-2 country code or `""` |
| `is_admin` | boolean | Whether the user has admin privileges |
| `setup_required` | boolean | `true` for new Google OAuth accounts that haven't set a username yet |

**Response `200 OK` — unauthenticated**
```json
{
  "authenticated": false
}
```

---

### `POST /api/auth/change-password`

🔒 Auth required

Change the authenticated user's password. Only available to password-auth accounts.

**Request body**
```json
{
  "old_password": "currentpass",
  "new_password": "newstrongpass"
}
```

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `old_password` | string | ✅ | — | Current password for verification |
| `new_password` | string | ✅ | ≥ 6 characters | The new password |

**Response `200 OK`**
```json
{
  "ok": true
}
```

Revokes all other active sessions for this user (only the current session remains valid).

**Error responses**

| Status | `error` value | Cause |
|---|---|---|
| `400` | `"Both passwords required"` | Either field is missing |
| `400` | `"New password must be at least 6 characters"` | New password too short |
| `401` | `"Current password is incorrect"` | Wrong old password |

---

### `GET /api/auth/google-init`

Initiate the Google OAuth 2.0 authorization flow. No authentication required.

**Response `200 OK`**
```json
{
  "auth_url": "https://accounts.google.com/o/oauth2/v2/auth?client_id=..."
}
```

| Field | Type | Description |
|---|---|---|
| `auth_url` | string | Full Google OAuth authorization URL. Redirect the user to this URL to begin sign-in. |

**Error responses**

| Status | `error` value | Cause |
|---|---|---|
| `400` | `"Google OAuth not configured"` | `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` env vars not set |

---

### `GET /api/auth/google-callback`

OAuth redirect target registered with Google. Google sends the user here after authorization. Returns an **HTML page** that immediately POSTs the authorization code to `/api/auth/google-exchange` via JavaScript. Do not call this endpoint directly.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `code` | string | Authorization code from Google |
| `error` | string | Error string if authorization was denied |

**Response:** HTML page (200 or 400)

---

### `POST /api/auth/google-exchange`

Exchange a Google OAuth authorization code for a StreamIntel session. Called automatically by the HTML page returned by `/api/auth/google-callback`.

**Request body**
```json
{
  "code": "4/0AX4XfWj..."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `code` | string | ✅ | Authorization code from Google OAuth callback |

**Response `200 OK`**

Sets a `si_token` cookie automatically.

```json
{
  "ok": true
}
```

For new Google accounts that have never set a custom username, `setup_required` will be `true` on the next `/api/auth/me` call.

**Error responses**

| Status | `error` value | Cause |
|---|---|---|
| `400` | `"No authorization code"` | `code` field empty or missing |
| `400` | `"OAuth failed: <detail>"` | Token exchange with Google failed |
| `409` | `"Email already in use by another Google account"` | Email collision |

---

### `POST /api/auth/google-mobile`

Exchange a native Google Sign-In `server_auth_code` (from Android/iOS SDK) for a StreamIntel token. Returns the token in the response body (not as a cookie) because mobile clients store it in local storage.

**Request body**
```json
{
  "server_auth_code": "4/0AX4XfWj..."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `server_auth_code` | string | ✅ | Server auth code from the native Google Sign-In SDK |

**Response `200 OK`**
```json
{
  "ok": true,
  "token": "eyJ0eXAiOiJKV1Qi...",
  "setup_required": false,
  "username": "alice"
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | Always `true` on success |
| `token` | string | JWT/session token — store in AsyncStorage and send as `Authorization: Bearer <token>` |
| `setup_required` | boolean | `true` if this is a brand-new account that needs a username configured |
| `username` | string | Auto-generated username (may need updating if `setup_required` is true) |

**Error responses**

| Status | `error` value | Cause |
|---|---|---|
| `400` | `"No server_auth_code provided"` | Missing field |
| `400` | `"OAuth failed: <detail>"` | Token exchange failed |
| `409` | `"Email already in use"` | Email collision |

---

### `GET /api/auth/migration-token`

🔒 Auth required

Generate a short-lived (1-hour) token for use with the DB migration script. The token is stored in the `tokens` table with an expiry.

**Response `200 OK`**
```json
{
  "migration_token": "abc123xyz...",
  "expires_in": "1 hour"
}
```

---

### `GET /api/auth/debug-redirect`

Debug endpoint — shows exactly what `redirect_uri` will be sent to Google and the values of all relevant env vars. Useful for diagnosing OAuth misconfiguration.

**Response `200 OK`**
```json
{
  "redirect_uri": "https://stream-intel.up.railway.app/api/auth/google-callback",
  "GOOGLE_REDIRECT_URI": null,
  "RAILWAY_PUBLIC_DOMAIN": "stream-intel.up.railway.app",
  "RAILWAY_STATIC_URL": null,
  "RAILWAY_ENVIRONMENT": "production",
  "SERVER_NAME": null,
  "request_url_root": "https://stream-intel.up.railway.app/"
}
```

---

## Titles & Catalog Endpoints

Base prefix: `/api`

---

### `GET /api/geoip`

Detect the user's country from their IP address. No authentication required.

Uses reverse-proxy headers (`X-Forwarded-For`, `X-Real-IP`) when present. For private/loopback IPs (local dev), returns an empty string to avoid false positives.

**Response `200 OK`**
```json
{
  "country": "US"
}
```

| Field | Type | Description |
|---|---|---|
| `country` | string | ISO 3166-1 alpha-2 country code (e.g. `"US"`, `"GB"`), or `""` if detection failed or IP is private |

---

### `GET /api/regions`

🔒 Auth required

Return all distinct region codes that exist in the titles table.

**Response `200 OK`**
```json
{
  "regions": ["AU", "CA", "DE", "GB", "US"]
}
```

| Field | Type | Description |
|---|---|---|
| `regions` | string[] | Sorted list of ISO 3166-1 alpha-2 region codes present in the database |

---

### `GET /api/titles`

🔒 Auth required

Fetch the streaming catalog. Supports filtering, sorting, pagination, and a special "unique" mode that de-duplicates titles across platforms.

**Query parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| `platform` | string | — | Filter by platform key (e.g. `netflix`, `prime_video`). `"all"` or omission means all platforms. |
| `region` | string | — | Filter by ISO region code (e.g. `US`, `GB`). `"all"` or omission means all regions. |
| `type` | string | — | Filter by content type: `"movie"` or `"tv"`. Omit for both. |
| `search` | string | — | Full-text search on title (case-insensitive, `LIKE %search%`). |
| `sort` | string | `"rank"` | Sort order. Values: `rank`, `imdb`, `rt`, `year`, `title`. |
| `limit` | integer | `100` | Maximum results to return. Server cap is `50000`. |
| `offset` | integer | `0` | Pagination offset (number of rows to skip). |
| `unique` | string | — | Set to `"1"` to aggregate identical titles across platforms into one card. |
| `trending` | string | — | Set to `"1"` to filter to only trending titles. |

**Sort values**

| Value | Sorts by |
|---|---|
| `rank` | Platform ranking position (ascending), then IMDB score (descending) |
| `imdb` | IMDB score descending |
| `rt` | Rotten Tomatoes tomatometer descending |
| `year` | Release year descending |
| `title` | Title alphabetical ascending |

**Response `200 OK`** — standard mode
```json
{
  "titles": [
    {
      "platform": "netflix",
      "title": "Breaking Bad",
      "content_type": "tv",
      "imdb_score": 9.5,
      "imdb_votes": 2200000,
      "tomatometer": 96,
      "tmdb_score": 8.9,
      "runtime_mins": 47,
      "end_year": "2013",
      "is_ongoing": false,
      "num_seasons": 5,
      "synopsis": "A chemistry teacher turned drug manufacturer...",
      "release_year": "2008",
      "genre": "Drama,Crime,Thriller",
      "maturity_rating": "TV-MA",
      "source_url": "https://www.netflix.com/title/70143836",
      "is_trending": false,
      "regions": "US,GB,CA",
      "ranking_position": 3,
      "ranking_region": "US",
      "is_fav": false,
      "status": "not-started",
      "notes": null
    }
  ],
  "total": 8423,
  "region_count": 12
}
```

**Response `200 OK`** — unique mode (`unique=1` adds extra fields)

```json
{
  "titles": [
    {
      "platform": "netflix",
      "title": "Breaking Bad",
      "content_type": "tv",
      "platforms": "netflix,prime_video",
      "regions": "US,GB",
      "platform_regions_raw": "netflix|US,prime_video|US",
      "platform_urls_raw": "netflix|https://...,prime_video|https://...",
      ...
    }
  ],
  "total": 5210,
  "region_count": 8
}
```

**Title object fields**

| Field | Type | Description |
|---|---|---|
| `platform` | string | Platform key (e.g. `"netflix"`, `"prime_video"`) |
| `title` | string | Title name |
| `content_type` | string | `"movie"` or `"tv"` |
| `imdb_score` | number\|null | IMDB rating (0–10) |
| `imdb_votes` | integer\|null | Number of IMDB votes |
| `tomatometer` | integer\|null | Rotten Tomatoes % score (0–100) |
| `tmdb_score` | number\|null | TMDB rating (0–10) |
| `runtime_mins` | integer\|null | Runtime per episode (TV) or full movie runtime |
| `end_year` | string\|null | Year the show ended (TV only), e.g. `"2013"` |
| `is_ongoing` | boolean\|null | Whether the show is still producing new episodes |
| `num_seasons` | integer\|null | Number of seasons (TV only) |
| `synopsis` | string\|null | Short plot summary |
| `release_year` | string\|null | First release year, e.g. `"2008"` |
| `genre` | string\|null | Comma-separated genres (e.g. `"Drama,Crime"`) |
| `maturity_rating` | string\|null | Content rating (e.g. `"TV-MA"`, `"PG-13"`) |
| `source_url` | string\|null | Direct link to the title on the streaming platform |
| `is_trending` | boolean | Whether this title is currently marked as trending |
| `regions` | string | Comma-separated region codes where this entry is available |
| `ranking_position` | integer | Rank on its platform/region (0 = unranked) |
| `ranking_region` | string\|null | The region used for the ranking position |
| `is_fav` | boolean | Whether the authenticated user has favourited this title |
| `status` | string | User's library status: `"not-started"`, `"watchlist"`, `"watching"`, `"finished"` |
| `notes` | string\|null | User's personal notes |
| `platforms` | string | *(unique mode only)* Comma-separated list of all platforms that have this title |
| `platform_regions_raw` | string | *(unique mode only)* `"platform\|region"` pairs, comma-separated |
| `platform_urls_raw` | string | *(unique mode only)* `"platform\|url"` pairs, comma-separated |

**Top-level response fields**

| Field | Type | Description |
|---|---|---|
| `titles` | array | Array of title objects |
| `total` | integer | Total matching count (for pagination) |
| `region_count` | integer | Number of distinct regions in the result set |

---

### `GET /api/titles/stats`

🔒 Auth required

Returns aggregate stats about the catalog and the user's library counts.

**Response `200 OK`**
```json
{
  "total": 15024,
  "platforms": ["apple_tv", "disney_plus", "netflix", "prime_video"],
  "regions": ["AU", "BR", "CA", "DE", "GB", "US"],
  "favourites": 12,
  "watching": 5,
  "finished": 43
}
```

| Field | Type | Description |
|---|---|---|
| `total` | integer | Total number of title rows in the database |
| `platforms` | string[] | All distinct platform keys in the database |
| `regions` | string[] | All distinct region codes in the database |
| `favourites` | integer | User's total favourited items |
| `watching` | integer | User's items with status `"watching"` |
| `finished` | integer | User's items with status `"finished"` |

---

### `GET /api/platform-logos`

🔒 Auth required

Returns TMDB-sourced logo URLs for each known streaming platform. Results are cached in the database for 30 days.

**Response `200 OK`**
```json
{
  "netflix": "https://image.tmdb.org/t/p/w45/t2yyOv40HZeVlLjYsCsPHnWLk4W.jpg",
  "prime_video": "https://image.tmdb.org/t/p/w45/emthp39XA2YScoYL1p0sdbAH2WA.jpg",
  "disney_plus": "https://image.tmdb.org/t/p/w45/7rwgEs15tFwyR9NPQ5tZMemoBZA.jpg"
}
```

A JSON object where each key is a platform key and each value is a logo image URL (TMDB `w45` thumbnail).

---

### `GET /api/posters/cache`

🔒 Auth required

Returns all cached poster and backdrop URLs. Supports ETag-based caching — send `If-None-Match: <etag>` to avoid re-downloading unchanged data.

**Response `200 OK`**

Response includes `ETag` and `Cache-Control: no-cache` headers.

```json
{
  "cache": {
    "netflix::Breaking Bad": {
      "poster": "https://image.tmdb.org/t/p/...",
      "backdrop": "https://image.tmdb.org/t/p/..."
    }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `cache` | object | Map of `cache_key` → `{poster, backdrop}` |
| `cache.<key>.poster` | string\|null | Poster URL |
| `cache.<key>.backdrop` | string\|null | Backdrop URL |

**Response `304 Not Modified`** — when ETag matches.

---

### `POST /api/posters/cache`

🔒 Auth required

Save new poster/backdrop entries to the server-side cache. Existing entries (same `cache_key`) are silently skipped.

**Request body** — array of poster objects
```json
[
  {
    "cache_key": "netflix::Breaking Bad",
    "poster_url": "https://image.tmdb.org/t/p/w500/...",
    "backdrop_url": "https://image.tmdb.org/t/p/original/..."
  }
]
```

| Field | Type | Required | Description |
|---|---|---|---|
| `cache_key` | string | ✅ | Unique key identifying the title (typically `"platform::Title"`) |
| `poster_url` | string\|null | — | TMDB poster URL |
| `backdrop_url` | string\|null | — | TMDB backdrop URL |

**Response `200 OK`**
```json
{
  "ok": true,
  "saved": 3
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | Always `true` |
| `saved` | integer | Number of entries in the request (not all may have been inserted if duplicates) |

**Error responses**

| Status | `error` value | Cause |
|---|---|---|
| `400` | `"Expected array"` | Request body is not a JSON array |

---

## Library Endpoints

---

### `GET /api/library`

🔒 Auth required

Fetch the authenticated user's full library. Supports ETag-based caching.

**Response `200 OK`**

Response includes `ETag` and `Cache-Control: no-cache` headers.

```json
{
  "library": [
    {
      "platform": "netflix",
      "title": "Breaking Bad",
      "is_fav": true,
      "status": "finished",
      "notes": "Best show ever",
      "user_rating": 5,
      "updated_at": "2024-06-15 14:23:01",
      "runtime_mins": 47
    }
  ]
}
```

**Library entry fields**

| Field | Type | Description |
|---|---|---|
| `platform` | string | Platform key |
| `title` | string | Title name |
| `is_fav` | boolean (0/1) | Whether this is marked as a favourite |
| `status` | string | `"not-started"`, `"watchlist"`, `"watching"`, or `"finished"` |
| `notes` | string\|null | User's personal notes |
| `user_rating` | integer | User's star rating 0–5 (0 = unrated) |
| `updated_at` | string | ISO 8601 datetime when the entry was last modified |
| `runtime_mins` | integer | Episode/movie runtime from the titles table (0 if unknown) |

**Response `304 Not Modified`** — when ETag matches.

---

### `POST /api/library`

🔒 Auth required

Add or update a title in the user's library (upsert). If the entry already exists, all supplied fields are overwritten.

**Request body**
```json
{
  "platform": "netflix",
  "title": "Breaking Bad",
  "is_fav": true,
  "status": "watching",
  "notes": "On season 3",
  "user_rating": 0
}
```

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `platform` | string | ✅ | Non-empty | Platform key |
| `title` | string | ✅ | Non-empty | Title name |
| `is_fav` | boolean | — | — | Mark as favourite (default `false`) |
| `status` | string | — | One of the four valid statuses | Library status (default `"not-started"`) |
| `notes` | string\|null | — | — | Personal notes |
| `user_rating` | integer | — | 0–5 | Star rating (default `0`) |

**Valid `status` values:** `"not-started"`, `"watchlist"`, `"watching"`, `"finished"`

**Response `200 OK`**
```json
{
  "ok": true
}
```

**Error responses**

| Status | `error` value | Cause |
|---|---|---|
| `400` | `"platform and title required"` | Either required field is missing |
| `400` | `"Invalid status"` | `status` not one of the four allowed values |
| `400` | `"user_rating must be 0-5"` | Rating out of range |

---

### `PATCH /api/titles/runtime`

🔒 Auth required

Persist a TMDB-sourced runtime (in minutes) to the titles table for a specific platform+title combination. Only updates rows where `runtime_mins = 0` (never overwrites existing data).

**Request body**
```json
{
  "platform": "netflix",
  "title": "Breaking Bad",
  "runtime_mins": 47
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `platform` | string | ✅ | Platform key |
| `title` | string | ✅ | Title name |
| `runtime_mins` | integer | ✅ | Runtime in minutes (must be > 0) |

**Response `200 OK`**
```json
{ "ok": true }
```

---

### `PATCH /api/titles/end_year`

🔒 Auth required

Persist a TMDB-sourced end year to the titles table. Only updates rows where `end_year` is `NULL` or empty.

**Request body**
```json
{
  "platform": "netflix",
  "title": "Breaking Bad",
  "end_year": "2013"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `platform` | string | ✅ | Platform key |
| `title` | string | ✅ | Title name |
| `end_year` | string | ✅ | Four-digit year string (e.g. `"2013"`) |

**Response `200 OK`**
```json
{ "ok": true }
```

---

### `PATCH /api/titles/is_ongoing`

🔒 Auth required

Persist a TMDB-sourced ongoing status to the titles table. Only updates rows where `is_ongoing` is `NULL`.

**Request body**
```json
{
  "platform": "netflix",
  "title": "Stranger Things",
  "is_ongoing": true
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `platform` | string | ✅ | Platform key |
| `title` | string | ✅ | Title name |
| `is_ongoing` | boolean | ✅ | `true` if the show is still ongoing |

**Response `200 OK`**
```json
{ "ok": true }
```

---

## Watch History Endpoints

---

### `GET /api/watched`

🔒 Auth required

Returns the user's watch history. When `platform` and `title` are both provided, returns the episode-level breakdown for that specific show. Otherwise returns everything ever watched.

**Query parameters**

| Param | Type | Required | Description |
|---|---|---|---|
| `platform` | string | — | Platform key. Must be combined with `title`. |
| `title` | string | — | Title name. Must be combined with `platform`. |

**Response `200 OK` — specific show**
```json
{
  "watched": [
    { "item_type": "episode", "season_num": 1, "episode_num": 1 },
    { "item_type": "episode", "season_num": 1, "episode_num": 2 }
  ]
}
```

**Response `200 OK` — all watched**
```json
{
  "watched": [
    { "platform": "netflix", "title": "Breaking Bad", "item_type": "episode", "season_num": 1, "episode_num": 1 }
  ]
}
```

**Watch entry fields**

| Field | Type | Present when | Description |
|---|---|---|---|
| `platform` | string | All-watched mode | Platform key |
| `title` | string | All-watched mode | Title name |
| `item_type` | string | Always | Always `"episode"` |
| `season_num` | integer | Always | Season number |
| `episode_num` | integer | Always | Episode number within the season |

---

### `POST /api/watched`

🔒 Auth required

Mark a single episode as watched or unwatched.

**Request body**
```json
{
  "platform": "netflix",
  "title": "Breaking Bad",
  "item_type": "episode",
  "season_num": 1,
  "episode_num": 3,
  "runtime_mins": 47,
  "watched": true
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `platform` | string | ✅ | — | Platform key |
| `title` | string | ✅ | — | Title name |
| `item_type` | string | — | `"episode"` | Currently only `"episode"` is used |
| `season_num` | integer | — | `0` | Season number |
| `episode_num` | integer | — | `0` | Episode number (1–62 valid for bitmask) |
| `runtime_mins` | integer | — | `0` | Episode runtime, used to accumulate watch time |
| `watched` | boolean | — | `true` | `true` to mark as watched, `false` to unmark |

**Response `200 OK`**
```json
{ "ok": true }
```

**Error responses**

| Status | `error` value | Cause |
|---|---|---|
| `400` | `"platform and title required"` | Missing required field |

---

### `POST /api/watched/batch`

🔒 Auth required

Batch-update watched state for multiple seasons of a single title in one request. Much more efficient than calling `POST /api/watched` repeatedly.

**Request body**
```json
{
  "platform": "netflix",
  "title": "Breaking Bad",
  "watched": true,
  "seasons": [
    { "season_num": 1, "episodes": [1, 2, 3, 4, 5, 6, 7], "runtime_mins": 329 },
    { "season_num": 2, "episodes": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], "runtime_mins": 611 }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `platform` | string | ✅ | Platform key |
| `title` | string | ✅ | Title name |
| `watched` | boolean | — | `true` to mark episodes as watched, `false` to unmark (default `true`) |
| `seasons` | array | — | Array of season update objects (see below). An empty array when `watched=false` deletes **all** watch records for the title. |
| `seasons[].season_num` | integer | ✅ | Season number |
| `seasons[].episodes` | integer[] | ✅ | Episode numbers to mark (1–62 per season). An empty array when `watched=false` clears the entire season. |
| `seasons[].runtime_mins` | integer | — | Total runtime (minutes) for all episodes in this batch. When `watched=true`, this **sets** the season total. |

**Behaviour details:**
- `watched=true` + episodes: OR-merges episode bits and sets `runtime_mins` to the supplied value.
- `watched=false` + specific episodes: clears those bits and subtracts from `runtime_mins`.
- `watched=false` + empty episodes: deletes the entire season row.
- `watched=false` + empty seasons array: deletes **all** watch records for this title.
- Maximum 500 season objects per request.

**Response `200 OK`**
```json
{ "ok": true }
```

---

### `PATCH /api/watched/backfill`

🔒 Auth required

Bulk-update the stored `runtime_mins` for watched seasons based on TMDB data. Useful for correcting watch time when TMDB episode runtimes were subsequently fetched.

**Request body**
```json
{
  "updates": [
    { "platform": "netflix", "title": "Breaking Bad", "season_num": 1, "runtime_mins": 329 },
    { "platform": "netflix", "title": "Breaking Bad", "season_num": 2, "runtime_mins": 611 }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `updates` | array | ✅ | List of backfill update objects |
| `updates[].platform` | string | ✅ | Platform key |
| `updates[].title` | string | ✅ | Title name |
| `updates[].season_num` | integer | ✅ | Season number |
| `updates[].runtime_mins` | integer | ✅ | New total runtime in minutes for the season (must be > 0) |

**Response `200 OK`**
```json
{
  "ok": true,
  "updated": 2
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | Always `true` |
| `updated` | integer | Number of rows actually updated |

---

## Ratings Endpoints

---

### `GET /api/ratings`

🔒 Auth required

Returns all titles the user has rated (i.e. `user_rating > 0`), sorted by the given field.

**Query parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| `sort` | string | `"rating"` | Sort order. Values: `rating`, `title`, `year` |

**Sort values**

| Value | Sorts by |
|---|---|
| `rating` | User rating descending, then `updated_at` descending |
| `title` | Title alphabetical ascending |
| `year` | Release year descending |

**Response `200 OK`**
```json
{
  "ratings": [
    {
      "platform": "netflix",
      "title": "Breaking Bad",
      "user_rating": 5,
      "status": "finished",
      "is_fav": true,
      "content_type": "tv",
      "year": "2008",
      "imdb_score": 9.5,
      "tomatometer": 96,
      "genre": "Drama,Crime,Thriller"
    }
  ]
}
```

**Rating entry fields**

| Field | Type | Description |
|---|---|---|
| `platform` | string | Platform key |
| `title` | string | Title name |
| `user_rating` | integer | User's star rating (1–5) |
| `status` | string | User's library status |
| `is_fav` | boolean (0/1) | Whether this is a favourite |
| `content_type` | string\|null | `"movie"` or `"tv"` |
| `year` | string\|null | Release year |
| `imdb_score` | number\|null | IMDB rating |
| `tomatometer` | integer\|null | Rotten Tomatoes score |
| `genre` | string\|null | Comma-separated genres |

---

## Profile Endpoints

Base prefix: `/api/profile`

---

### `GET /api/profile`

🔒 Auth required

Returns the authenticated user's full profile including computed watch-time stats.

**Response `200 OK`**
```json
{
  "username": "alice",
  "display_name": "Alice Smith",
  "email": "alice@example.com",
  "auth_type": "password",
  "member_since": "2024-01-15",
  "profile_pic": "data:image/jpeg;base64,...",
  "home_country": "US",
  "library_public": false,
  "pic_position_y": 50,
  "stats": {
    "total_in_library": 87,
    "favourites": 12,
    "movies_finished": 34,
    "movies_watching": 2,
    "movies_in_library": 40,
    "tv_finished": 8,
    "tv_watching": 3,
    "episodes_watched": 412,
    "movie_watch_time": { "total_minutes": 3570, "hours": 59, "minutes": 30, "label": "2d 11h 30m" },
    "tv_watch_time":    { "total_minutes": 17304, "hours": 288, "minutes": 24, "label": "12d 0h 24m" },
    "total_watch_time": { "total_minutes": 20874, "hours": 347, "minutes": 54, "label": "14d 11h 54m" },
    "top_genres": [
      { "genre": "Drama", "count": 21 },
      { "genre": "Comedy", "count": 14 }
    ]
  }
}
```

**Profile fields**

| Field | Type | Description |
|---|---|---|
| `username` | string | Unique login username |
| `display_name` | string | Public display name (falls back to `username`) |
| `email` | string | Email address or `""` (OAuth accounts may not share it) |
| `auth_type` | string | `"password"` or `"google"` |
| `member_since` | string | ISO date `YYYY-MM-DD` of account creation |
| `profile_pic` | string | Base64 data URI or `""` |
| `home_country` | string | ISO 3166-1 alpha-2 country code or `""` |
| `library_public` | boolean | Whether the library is visible to friends |
| `pic_position_y` | integer | Profile picture vertical crop position (0–100, percent) |

**Stats object fields**

| Field | Type | Description |
|---|---|---|
| `total_in_library` | integer | Total entries in the library (all statuses) |
| `favourites` | integer | Total items marked as favourite |
| `movies_finished` | integer | Finished movies (deduplicated across platforms) |
| `movies_watching` | integer | Currently watching movies |
| `movies_in_library` | integer | Movies with any non-`not-started` status |
| `tv_finished` | integer | Finished TV shows |
| `tv_watching` | integer | Currently watching TV shows |
| `episodes_watched` | integer | Total individual episodes watched |
| `movie_watch_time` | object | See watch-time object below |
| `tv_watch_time` | object | See watch-time object below |
| `total_watch_time` | object | See watch-time object below |
| `top_genres` | array | Up to 6 most-watched genres: `[{genre: string, count: integer}]` |

**Watch-time object**

| Field | Type | Description |
|---|---|---|
| `total_minutes` | integer | Raw total minutes |
| `hours` | integer | Total hours (whole) |
| `minutes` | integer | Remaining minutes after full hours |
| `label` | string | Human-readable string e.g. `"14d 11h 54m"` |

---

### `POST /api/profile`

🔒 Auth required

Update one or more profile fields. Only include fields you want to change — any omitted fields are left unchanged.

**Request body**
```json
{
  "display_name": "Alice S.",
  "username": "alice_new",
  "profile_pic": "data:image/jpeg;base64,...",
  "home_country": "GB",
  "library_public": true,
  "pic_position_y": 40
}
```

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `display_name` | string | — | Max 60 chars | Public display name. Send `""` or `null` to clear. |
| `username` | string | — | 3–30 chars, unique | Change login username. Case-insensitive uniqueness check. |
| `profile_pic` | string\|null | — | Must start with `"data:"`, max ~1.5 MB | Base64-encoded image. Send `null` or `""` to remove. |
| `home_country` | string | — | Exactly 2 alpha chars | ISO 3166-1 alpha-2 code. Send `""` to clear. |
| `library_public` | boolean | — | — | `true` to make library visible to friends |
| `pic_position_y` | integer | — | 0–100 | Vertical crop offset for the profile picture |

**Response `200 OK`**
```json
{ "ok": true }
```

**Error responses**

| Status | `error` value | Cause |
|---|---|---|
| `400` | `"Nothing to update"` | No known fields were included in the body |
| `400` | `"Invalid image format"` | `profile_pic` provided but doesn't start with `"data:"` |
| `400` | `"Image too large (max ~1.5 MB)"` | Base64 data exceeds 2 MB |
| `400` | `"Invalid country code"` | `home_country` contains non-alpha characters |
| `400` | `"Username must be at least 3 characters"` | Username too short |
| `400` | `"Username must be 30 characters or fewer"` | Username too long |
| `409` | `"Username already taken"` | Duplicate username |

---

### `GET /api/profile/watchtime`

🔒 Auth required

Returns every library entry with a non-`not-started` status, with per-title computed watch time.

**Response `200 OK`**
```json
{
  "titles": [
    {
      "platform": "netflix",
      "title": "Breaking Bad",
      "status": "finished",
      "content_type": "tv",
      "genre": "Drama,Crime",
      "imdb_score": 9.5,
      "release_year": "2008",
      "watch_mins": 2938,
      "episodes_watched": 62
    }
  ]
}
```

**Watch-time title fields**

| Field | Type | Description |
|---|---|---|
| `platform` | string | Platform key |
| `title` | string | Title name |
| `status` | string | Library status (never `"not-started"`) |
| `content_type` | string\|null | `"movie"` or `"tv"` |
| `genre` | string\|null | Comma-separated genres |
| `imdb_score` | number | IMDB score (0 if unavailable) |
| `release_year` | string | Release year or `""` |
| `watch_mins` | integer | Calculated total watch time in minutes |
| `episodes_watched` | integer | For TV: total episodes watched. For movies: `0`. |

---

### `GET /api/profile/watchtime-stats`

🔒 Auth required

Debug endpoint. Returns raw library and watch-season counts for the current user.

**Response `200 OK`**
```json
{
  "user_id": 1,
  "library_total": 87,
  "library_active": 53,
  "library_by_status": [
    { "status": "finished", "n": 43 },
    { "status": "watching", "n": 5 },
    { "status": "watchlist", "n": 5 }
  ],
  "watched_seasons_rows": 312
}
```

---

## Friends Endpoints

Base prefix: `/api`

---

### `GET /api/friends`

🔒 Auth required

List all accepted friends of the authenticated user.

**Response `200 OK`**
```json
{
  "friends": [
    {
      "id": 42,
      "username": "bob",
      "display_name": "Bob Jones",
      "profile_pic": "data:image/jpeg;base64,..."
    }
  ]
}
```

**Friend object fields**

| Field | Type | Description |
|---|---|---|
| `id` | integer | User ID |
| `username` | string | Login username |
| `display_name` | string | Display name (falls back to `username`) |
| `profile_pic` | string\|null | Base64 profile picture or `null` |

---

### `GET /api/friends/search`

🔒 Auth required

Search for users by username. Returns up to 20 results with current friendship status.

**Query parameters**

| Param | Type | Required | Description |
|---|---|---|---|
| `q` | string | ✅ | Search query (minimum 2 characters). Case-insensitive `LIKE %q%` match on username. |

**Response `200 OK`**
```json
{
  "users": [
    {
      "id": 42,
      "username": "bob",
      "display_name": "Bob Jones",
      "profile_pic": null,
      "friendship_status": "friends"
    }
  ]
}
```

**User search result fields**

| Field | Type | Description |
|---|---|---|
| `id` | integer | User ID |
| `username` | string | Login username |
| `display_name` | string | Display name |
| `profile_pic` | string\|null | Profile picture or `null` |
| `friendship_status` | string\|null | `null` (no relation), `"friends"`, `"request_sent"`, `"request_received"` |

Returns `{ "users": [] }` if query is fewer than 2 characters.

---

### `POST /api/friends/request`

🔒 Auth required

Send a friend request to another user. If the other user has already sent you a request, it auto-accepts.

**Request body**
```json
{
  "user_id": 42
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `user_id` | integer | ✅ | ID of the user to send the request to |

**Response `200 OK`**
```json
{
  "ok": true,
  "status": "request_sent"
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | Always `true` |
| `status` | string | `"request_sent"` or `"accepted"` (if auto-accepted) |

**Error responses**

| Status | `error` value | Cause |
|---|---|---|
| `400` | `"Invalid user"` | `user_id` is missing, `null`, or equals your own ID |
| `404` | `"User not found"` | No user with that ID |
| `409` | `"Already friends"` | Already accepted friends |
| `409` | `"Request already sent"` | Pending request already exists from you |

---

### `POST /api/friends/accept`

🔒 Auth required

Accept an incoming friend request.

**Request body**
```json
{
  "user_id": 42
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `user_id` | integer | ✅ | ID of the user whose request you are accepting |

**Response `200 OK`**
```json
{ "ok": true }
```

**Error responses**

| Status | `error` value | Cause |
|---|---|---|
| `404` | `"No pending request"` | No pending request from that user to you |

---

### `POST /api/friends/reject`

🔒 Auth required

Reject and delete an incoming friend request.

**Request body**
```json
{
  "user_id": 42
}
```

**Response `200 OK`**
```json
{ "ok": true }
```

(Silent no-op if no matching pending request exists.)

---

### `POST /api/friends/remove`

🔒 Auth required

Remove an existing friendship (in either direction).

**Request body**
```json
{
  "user_id": 42
}
```

**Response `200 OK`**
```json
{ "ok": true }
```

---

### `GET /api/friends/requests`

🔒 Auth required

List all **incoming** pending friend requests.

**Response `200 OK`**
```json
{
  "requests": [
    {
      "id": 7,
      "username": "charlie",
      "display_name": "Charlie",
      "profile_pic": null,
      "created_at": "2024-06-01 10:30:00"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `id` | integer | User ID of the requester |
| `username` | string | Username |
| `display_name` | string | Display name |
| `profile_pic` | string\|null | Profile picture |
| `created_at` | string | ISO 8601 datetime when the request was made |

---

### `GET /api/friends/requests/sent`

🔒 Auth required

List all **outgoing** pending friend requests you have sent.

**Response `200 OK`**
```json
{
  "requests": [
    {
      "id": 15,
      "username": "diana",
      "display_name": "Diana",
      "profile_pic": null,
      "created_at": "2024-06-02 09:00:00"
    }
  ]
}
```

---

### `DELETE /api/friends/request/<user_id>`

🔒 Auth required

Cancel a pending friend request you sent to `user_id`.

**Path parameter**

| Param | Type | Description |
|---|---|---|
| `user_id` | integer | ID of the user you sent the request to |

**Response `200 OK`**
```json
{ "ok": true }
```

---

### `POST /api/friends/share`

🔒 Auth required

Share a library action (status change, favourite toggle, or compose message) with one or more friends. Creates a notification for each recipient.

**Request body**
```json
{
  "friend_ids": [42, 55],
  "action": {
    "type": "shared_action",
    "title": "Breaking Bad",
    "platform": "netflix",
    "status": "finished",
    "is_fav": true
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `friend_ids` | integer[] | ✅ | List of friend user IDs to notify. Only actual friends receive notifications. |
| `action` | object | ✅ | Action payload |
| `action.type` | string | — | `"shared_action"` (default) or `"title_message"` (compose message flow) |
| `action.title` | string | — | Title name |
| `action.platform` | string | — | Platform key |
| `action.status` | string | — | Library status (for `shared_action`) |
| `action.is_fav` | boolean\|null | — | Favourite state (for `shared_action`) |
| `action.message` | string | — | Message text (for `title_message`) |

**Response `200 OK`**
```json
{
  "ok": true,
  "sent": 2
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | Always `true` |
| `sent` | integer | Number of notifications actually created (non-friends are skipped) |

**Error responses**

| Status | `error` value | Cause |
|---|---|---|
| `400` | `"Missing fields"` | `friend_ids` or `action` is missing/empty |

---

### `GET /api/friends/<uid>/profile`

🔒 Auth required

View a friend's public profile and stats. Only accessible if you are friends with `uid`.

**Path parameter**

| Param | Type | Description |
|---|---|---|
| `uid` | integer | Friend's user ID |

**Response `200 OK`**
```json
{
  "id": 42,
  "username": "bob",
  "display_name": "Bob Jones",
  "profile_pic": "",
  "library_public": false,
  "stats": {
    "movies_finished": 20,
    "movies_watching": 1,
    "movies_in_library": 25,
    "tv_finished": 5,
    "tv_watching": 2,
    "episodes_watched": 200,
    "movie_watch_time": { "total_minutes": 2100, "hours": 35, "minutes": 0, "label": "1d 11h 0m" },
    "tv_watch_time": { "total_minutes": 8400, "hours": 140, "minutes": 0, "label": "5d 20h 0m" },
    "total_watch_time": { "total_minutes": 10500, "hours": 175, "minutes": 0, "label": "7d 7h 0m" },
    "top_genres": [{ "genre": "Action", "count": 10 }]
  }
}
```

`stats` will be `null` if the friend's stats have never been computed.

**Error responses**

| Status | `error` value | Cause |
|---|---|---|
| `403` | `"Not friends"` | Not in an accepted friendship with `uid` |
| `404` | `"User not found"` | No user with that ID |

---

### `GET /api/friends/<uid>/watched`

🔒 Auth required

View a friend's recently-watched titles (last 30 items with `finished` or `watching` status). Only accessible if you are friends with `uid`.

**Response `200 OK`**
```json
{
  "titles": [
    {
      "platform": "netflix",
      "title": "Breaking Bad",
      "content_type": "tv",
      "release_year": "2008"
    }
  ]
}
```

---

### `GET /api/friends/<uid>/library`

🔒 Auth required

View a friend's full library. Only accessible if you are friends with `uid` **and** the friend has set `library_public = true`.

**Response `200 OK`**
```json
{
  "library": [
    {
      "platform": "netflix",
      "title": "Breaking Bad",
      "is_fav": true,
      "status": "finished",
      "content_type": "tv",
      "release_year": "2008",
      "imdb_score": 9.5,
      "tomatometer": 96,
      "updated_at": "2024-06-15 14:23:01"
    }
  ]
}
```

**Error responses**

| Status | `error` value | Cause |
|---|---|---|
| `403` | `"Not friends"` | Not in an accepted friendship |
| `403` | `"Library is private"` | Friend has not enabled public library |

---

## Notifications Endpoints

---

### `GET /api/notifications`

🔒 Auth required

Get the authenticated user's notifications, paginated newest-first. Page size is fixed at 10.

**Query parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| `offset` | integer | `0` | Number of notifications to skip |

**Response `200 OK`**
```json
{
  "notifications": [
    {
      "id": 101,
      "type": "friend_request",
      "actor_id": 42,
      "actor_name": "Bob Jones",
      "actor_username": "bob",
      "actor_pic": null,
      "payload": { "username": "Bob Jones" },
      "is_read": false,
      "created_at": "2024-06-15 14:23:01"
    }
  ],
  "unread": 3,
  "has_more": false,
  "offset": 0
}
```

**Notification object fields**

| Field | Type | Description |
|---|---|---|
| `id` | integer | Notification ID |
| `type` | string | Notification type (see below) |
| `actor_id` | integer\|null | User ID of the person who triggered the notification |
| `actor_name` | string\|null | Display name of the actor |
| `actor_username` | string\|null | Username of the actor |
| `actor_pic` | string\|null | Profile picture of the actor |
| `payload` | object | Type-specific payload (see below) |
| `is_read` | boolean | Whether the notification has been read |
| `created_at` | string | ISO 8601 datetime |

**Notification types**

| Type | Payload fields | Description |
|---|---|---|
| `friend_request` | `username` | Someone sent you a friend request |
| `friend_accepted` | `username` | Someone accepted your friend request |
| `shared_action` | `title`, `platform`, `status`, `is_fav`, `actor_name` | A friend changed their library status for a title |
| `title_message` | `title`, `platform`, `message`, `actor_name` | A friend sent you a message about a title |

**Top-level response fields**

| Field | Type | Description |
|---|---|---|
| `notifications` | array | Up to 10 notifications for this page |
| `unread` | integer | Total unread notification count for the user |
| `has_more` | boolean | `true` if more notifications exist beyond this page |
| `offset` | integer | The offset value used for this request |

---

### `POST /api/notifications/read`

🔒 Auth required

Mark one or all notifications as read.

**Request body**
```json
{
  "id": 101
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | integer | — | Notification ID to mark as read. Omit (or `null`) to mark **all** notifications as read. |

**Response `200 OK`**
```json
{ "ok": true }
```

---

### `DELETE /api/notifications/<nid>`

🔒 Auth required

Delete a single notification by ID.

**Path parameter**

| Param | Type | Description |
|---|---|---|
| `nid` | integer | Notification ID to delete |

**Response `200 OK`**
```json
{ "ok": true }
```

---

### `DELETE /api/notifications`

🔒 Auth required

Delete **all** notifications for the authenticated user.

**Response `200 OK`**
```json
{ "ok": true }
```

---

## Push Notification Endpoints

---

### `GET /api/push/vapid-public-key`

No authentication required.

Returns the server's VAPID public key needed to create a Web Push subscription on the client.

**Response `200 OK`**
```json
{
  "publicKey": "BNabc123..."
}
```

---

### `POST /api/push/subscribe`

🔒 Auth required

Register a Web Push subscription. The subscription object is in the format returned by `PushManager.subscribe()`.

**Request body**
```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/abc123...",
  "keys": {
    "p256dh": "BNab123...",
    "auth": "xyz789..."
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `endpoint` | string | ✅ | Push service endpoint URL |
| `keys.p256dh` | string | ✅ | ECDH public key |
| `keys.auth` | string | ✅ | Authentication secret |

**Response `200 OK`**
```json
{ "ok": true }
```

**Error responses**

| Status | `error` value | Cause |
|---|---|---|
| `400` | `"Invalid subscription"` | Missing `endpoint`, `p256dh`, or `auth` |

---

### `POST /api/push/unsubscribe`

🔒 Auth required

Remove a Web Push subscription by endpoint URL.

**Request body**
```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/abc123..."
}
```

**Response `200 OK`**
```json
{ "ok": true }
```

---

## TMDB Proxy Endpoints

These endpoints proxy requests to The Movie Database (TMDB) API, keeping the API key server-side and providing a centralised caching/rate-limit layer.

All TMDB proxy endpoints are **🔒 Auth required** unless stated otherwise.

---

### `GET /api/tmdb/search`

🔒 Auth required

Search TMDB for a movie, TV show, or person. Returns the top 5 results.

**Query parameters**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string | ✅ | — | Search term |
| `type` | string | — | `"movie"` | Media type: `"movie"`, `"tv"`, or `"person"` |
| `year` | string | — | — | Filter by year (for movies/TV, not person) |

**Response `200 OK`**
```json
{
  "results": [
    {
      "id": 1396,
      "title": "Breaking Bad",
      "release_date": "2008-01-20",
      "poster_path": "/ggFHVNu6YYI5L9pCfOacjizRGt.jpg",
      "vote_average": 9.5
    }
  ]
}
```

Results are raw TMDB API objects. For `type=person`, results are sorted by popularity.

---

### `GET /api/tmdb/<media_type>/<tmdb_id>`

🔒 Auth required

Get full details for a movie or TV show from TMDB, including external IDs.

**Path parameters**

| Param | Type | Values | Description |
|---|---|---|---|
| `media_type` | string | `"movie"`, `"tv"` | Content type |
| `tmdb_id` | integer | — | TMDB ID |

**Response `200 OK`** — raw TMDB detail object with `external_ids` appended.

**Error responses**

| Status | `error` value | Cause |
|---|---|---|
| `400` | `"invalid media_type"` | `media_type` is not `"movie"` or `"tv"` |

---

### `GET /api/tmdb/<media_type>/<tmdb_id>/credits`

🔒 Auth required

Get cast and crew credits for a movie or TV show.

**Path parameters**

| Param | Type | Description |
|---|---|---|
| `media_type` | string | `"movie"` or `"tv"` |
| `tmdb_id` | integer | TMDB ID |

**Response `200 OK`** — raw TMDB credits object with `cast` and `crew` arrays.

---

### `GET /api/tmdb/tv/<tmdb_id>/season/<season_num>`

🔒 Auth required

Get episode-level details for a specific season of a TV show.

**Path parameters**

| Param | Type | Description |
|---|---|---|
| `tmdb_id` | integer | TMDB show ID |
| `season_num` | integer | Season number |

**Response `200 OK`** — raw TMDB season object including `episodes` array.

---

### `GET /api/tmdb/person/<person_id>`

🔒 Auth required

Get details for a person (actor, director, etc.) from TMDB.

**Path parameters**

| Param | Type | Description |
|---|---|---|
| `person_id` | integer | TMDB person ID |

**Response `200 OK`** — raw TMDB person object.

---

### `GET /api/tmdb/person/<person_id>/combined_credits`

🔒 Auth required

Get all movie and TV credits for a person.

**Path parameters**

| Param | Type | Description |
|---|---|---|
| `person_id` | integer | TMDB person ID |

**Response `200 OK`** — raw TMDB combined credits object with `cast` and `crew` arrays.

---

### `GET /api/tmdb/<media_type>/<tmdb_id>/external_ids`

🔒 Auth required

Get external IDs (IMDB, TVDB, etc.) for a movie or TV show.

**Path parameters**

| Param | Type | Description |
|---|---|---|
| `media_type` | string | `"movie"` or `"tv"` |
| `tmdb_id` | integer | TMDB ID |

**Response `200 OK`** — raw TMDB external_ids object (e.g. `{"imdb_id": "tt0903747", ...}`).

---

### `GET /api/people/<category>`

🔒 Auth required

Browse trending or popular people from TMDB. Fetches 2 TMDB pages per frontend page (~40 results per page).

**Path parameters**

| Param | Type | Values | Description |
|---|---|---|---|
| `category` | string | `"trending"`, `"popular"` | Which TMDB endpoint to use |

**Query parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Frontend page number (1-based) |

**Response `200 OK`**
```json
{
  "results": [
    {
      "id": 287,
      "name": "Brad Pitt",
      "profile_path": "/kc3M04QQAuZ9woUvH3Ju5T7ZqG5.jpg",
      "known_for_department": "Acting",
      "known_for": [
        { "title": "Fight Club", "media_type": "movie" }
      ],
      "popularity": 42.5
    }
  ],
  "total_pages": 25
}
```

Only returns people who have a `profile_path` and `name`. Results are filtered server-side.

**Error responses**

| Status | `error` value | Cause |
|---|---|---|
| `400` | `"unknown category"` | `category` not `"trending"` or `"popular"` |

---

### `GET /api/people/search`

🔒 Auth required

Search TMDB for a person by name. Fetches 3 TMDB pages per frontend page and sorts by popularity.

**Query parameters**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `q` | string | ✅ | — | Person name search query |
| `page` | integer | — | `1` | Frontend page number |

**Response `200 OK`**
```json
{
  "results": [
    {
      "id": 287,
      "name": "Brad Pitt",
      "profile_path": "/kc3M04QQAuZ9woUvH3Ju5T7ZqG5.jpg",
      "known_for_department": "Acting",
      "known_for": [
        { "title": "Fight Club", "media_type": "movie" }
      ],
      "popularity": 42.5
    }
  ],
  "total_pages": 3
}
```

Returns `{ "results": [] }` when `q` is empty.

---

## Upcoming Episodes Endpoint

---

### `GET /api/upcoming`

🔒 Auth required

Returns upcoming episode air dates for all TV shows in the user's library that are favourited or have a status of `watching` or `finished`. Uses a TMDB cache (6-hour TTL) per show to minimise outbound API calls.

Fetches show data in parallel (up to 10 concurrent TMDB requests) for stale/uncached shows.

**Query parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| `force` | string | — | Set to `"1"` to bypass the TMDB cache and force a fresh fetch for all shows |

**Response `200 OK`**
```json
{
  "episodes": [
    {
      "title_key": "Stranger Things",
      "air_date": "2025-07-04",
      "diff_days": 12,
      "season_number": 5,
      "episode_number": 1,
      "name": "Chapter One: The Vanishing",
      "still_path": "/abc123.jpg",
      "overview": "The friends face a new threat...",
      "runtime": 60,
      "vote_average": 8.7,
      "vote_count": 320,
      "guest_stars": [
        { "name": "Actor Name", "character": "Character Name", "profile_path": "/xyz.jpg" }
      ],
      "crew": [
        { "name": "Director Name", "job": "Director" }
      ]
    }
  ],
  "show_data": {
    "Stranger Things": {
      "tmdb_id": 66732,
      "poster_thumb": "https://image.tmdb.org/t/p/w92/xyz.jpg",
      "end_year": null,
      "is_ongoing": true,
      "cast": [
        { "name": "Millie Bobby Brown", "character": "Eleven", "profile_path": "/abc.jpg", "order": 0 }
      ],
      "show_overview": "When a young boy vanishes..."
    }
  }
}
```

**Episode object fields**

| Field | Type | Description |
|---|---|---|
| `title_key` | string | Show title (matches key in `show_data`) |
| `air_date` | string | ISO date `YYYY-MM-DD` |
| `diff_days` | integer | Days from today until air date (0 = today, always ≥ 0) |
| `season_number` | integer | Season number |
| `episode_number` | integer | Episode number within season |
| `name` | string\|null | Episode title |
| `still_path` | string\|null | TMDB still image path (append to `https://image.tmdb.org/t/p/w300`) |
| `overview` | string\|null | Episode synopsis |
| `runtime` | integer\|null | Episode runtime in minutes |
| `vote_average` | number\|null | TMDB episode vote average |
| `vote_count` | integer\|null | TMDB episode vote count |
| `guest_stars` | array | Up to 8 guest stars: `[{name, character, profile_path}]` |
| `crew` | array | Up to 6 key crew: `[{name, job}]` where job is Director, Writer, Story, or Teleplay |

**Show data fields** (`show_data` object values)

| Field | Type | Description |
|---|---|---|
| `tmdb_id` | integer | TMDB show ID |
| `poster_thumb` | string\|null | `w92` poster thumbnail URL |
| `end_year` | string\|null | Year the show ended (for cancelled/completed shows) |
| `is_ongoing` | boolean | Whether the show is still in production |
| `cast` | array | Top 10 main cast: `[{name, character, profile_path, order}]` |
| `show_overview` | string | TMDB show description (empty string if unavailable) |

Episodes are sorted by `air_date` ascending and deduplicated.

---

## Admin & Scraper Endpoints

These endpoints are primarily used by the admin panel and the scraper tooling.

---

### `GET /api/admin/users`

🔒 Auth required · 🛡 Admin only

Returns a list of all user accounts.

**Response `200 OK`**
```json
{
  "users": [
    {
      "id": 1,
      "username": "alice",
      "email": "alice@example.com",
      "auth_type": "password",
      "is_admin": true,
      "created_at": "2024-01-15 09:00:00",
      "last_login": "2024-06-15 14:23:01"
    }
  ]
}
```

---

### `GET /api/runs`

🔒 Auth required

List the 50 most recent scraper runs.

**Response `200 OK`**
```json
{
  "runs": [
    {
      "id": 12,
      "started_at": "2024-06-10 02:00:00",
      "finished_at": "2024-06-10 02:14:37",
      "mode": "trending",
      "regions": "[\"US\", \"GB\"]",
      "title_count": 1240,
      "status": "done"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `id` | integer | Run ID |
| `started_at` | string | Start timestamp |
| `finished_at` | string\|null | Finish timestamp (`null` if still running) |
| `mode` | string | Scraper mode: `"trending"`, `"catalog"`, `"all"`, `"push"` |
| `regions` | string | JSON-encoded array of region codes |
| `title_count` | integer\|null | Number of titles scraped |
| `status` | string | `"running"`, `"done"`, `"error"`, `"imported"` |

---

### `GET /api/run/<mode>/<regions>`

🔒 Auth required

Trigger the JustWatch scraper and stream live log output as **Server-Sent Events (SSE)**.

**Path parameters**

| Param | Type | Description |
|---|---|---|
| `mode` | string | Scraper mode: `"trending"`, `"catalog"`, `"all"` |
| `regions` | string | Comma-separated region codes (e.g. `"US,GB,PT"`) or `"ALL"` for all regions |

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `min_votes` | string | Minimum IMDB vote count to include a title |
| `multi_sort` | string | Set to `"1"` or `"true"` to enable multi-sort mode |
| `proxy_url` | string | HTTP proxy URL for the scraper (overrides `SCRAPER_PROXY_URL` env var) |

**Response `200 OK`** — `Content-Type: text/event-stream`

The response body is a stream of SSE events:

```
data: Starting — mode=trending regions=US,GB

data: Scraping Netflix US...

data: 42 titles added.

data: __DONE__
```

Each line is a `data:` SSE event. The final event is always `data: __DONE__\n\n` (or an error line followed by `__DONE__`). Occasional `: ping` comment lines are sent to keep the connection alive.

---

### `POST /api/enrich`

🔒 Auth required · 🛡 Admin only

Start a background TMDB enrichment job that fills in missing metadata (posters, backdrops, cast, etc.) for all titles that haven't been enriched yet. Returns immediately — poll `/api/enrich/status` for progress.

**Request body:** none

**Response `200 OK`**
```json
{
  "started": true
}
```

**Error responses**

| Status | Body | Cause |
|---|---|---|
| `403` | `{"error": "Admin access required"}` | Not an admin |
| `409` | `{"started": false, "message": "Enrichment already running"}` | Job already in progress |

---

### `GET /api/enrich/status`

🔒 Auth required · 🛡 Admin only

Poll the background enrichment job's current state.

**Response `200 OK`**
```json
{
  "running": false,
  "done": true,
  "error": null,
  "log": [
    "Starting TMDB enrichment…",
    "Enriched: Breaking Bad",
    "Enrichment complete."
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `running` | boolean | Whether the job is currently active |
| `done` | boolean | Whether the job has completed (success or error) |
| `error` | string\|null | Error message if the job failed |
| `log` | string[] | Last 500 log lines from the enrichment run |

---

### `GET /api/export-library`

🔒 Auth required

Export the current user's library and watched history as JSON. Useful for backup or migration.

**Response `200 OK`**
```json
{
  "library": [
    {
      "platform": "netflix",
      "title": "Breaking Bad",
      "is_fav": 1,
      "status": "finished",
      "notes": null
    }
  ],
  "watched": [
    {
      "platform": "netflix",
      "title": "Breaking Bad",
      "season_num": 1,
      "ep_mask": 127,
      "runtime_mins": 329
    }
  ]
}
```

**Library entry fields**

| Field | Type | Description |
|---|---|---|
| `platform` | string | Platform key |
| `title` | string | Title name |
| `is_fav` | integer | 0 or 1 |
| `status` | string | Library status |
| `notes` | string\|null | Personal notes |

**Watched season fields**

| Field | Type | Description |
|---|---|---|
| `platform` | string | Platform key |
| `title` | string | Title name |
| `season_num` | integer | Season number |
| `ep_mask` | integer | Bitmask: bit `n-1` set means episode `n` is watched |
| `runtime_mins` | integer | Accumulated watch time for this season in minutes |

---

### `POST /api/import-library`

🔒 Auth required

Import a previously exported library + watched history. Existing entries are upserted (safe to run multiple times).

**Request body** — same format as `/api/export-library` response
```json
{
  "library": [
    {
      "platform": "netflix",
      "title": "Breaking Bad",
      "is_fav": 1,
      "status": "finished",
      "notes": null
    }
  ],
  "watched": [
    {
      "platform": "netflix",
      "title": "Breaking Bad",
      "season_num": 1,
      "ep_mask": 127,
      "runtime_mins": 329
    }
  ]
}
```

**Response `200 OK`**
```json
{
  "library_rows": 87,
  "watched_rows": 312
}
```

| Field | Type | Description |
|---|---|---|
| `library_rows` | integer | Number of library entries processed |
| `watched_rows` | integer | Number of watched season entries processed |

---

### `GET /api/download-db`

🔒 Auth required · 🛡 Admin only

Download the entire SQLite database as a binary file attachment (`stream_intel.db`).

**Response `200 OK`** — `Content-Type: application/x-sqlite3`, `Content-Disposition: attachment; filename="stream_intel.db"`

---

### `POST /api/upload-db`

Auth: Admin session **or** `X-Migration-Secret` header matching `MIGRATION_SECRET` env var.

Replace the entire production database with an uploaded SQLite file. Validates integrity before swapping. Applies schema migrations automatically after the swap.

> **Warning:** This is a destructive operation — it replaces the entire database. The `X-Migration-Secret` mechanism exists only for the initial production setup / migration workflow.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `db` | file | ✅ | SQLite database file |

**Headers** (alternative to cookie auth)

| Header | Description |
|---|---|
| `X-Migration-Secret` | One-time migration secret from `MIGRATION_SECRET` env var |

**Response `200 OK`**
```json
{
  "ok": true,
  "users": 3,
  "size_bytes": 2097152
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | Always `true` |
| `users` | integer | Number of user accounts in the uploaded database |
| `size_bytes` | integer | File size in bytes |

**Error responses**

| Status | `error` value | Cause |
|---|---|---|
| `400` | `"No file provided"` | No `db` field in form data |
| `400` | `"Uploaded file is not a valid database: <detail>"` | File failed SQLite integrity check |
| `401` | `"Authentication required"` | No token and no matching migration secret |
| `403` | `"Admin access required"` | Authenticated but not admin |
| `500` | `"Failed to save upload: <detail>"` | Disk write error |

---

### `POST /api/push-titles`

Auth: Admin session **or** `X-Migration-Secret` header.

Merge titles and scrape_run records from a locally-scraped SQLite database into the production database. **Does not touch any user data** (library, watched history, friends, notifications).

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `db` | file | ✅ | Source SQLite database file containing `titles` and `scrape_runs` |

**Response `200 OK`**
```json
{
  "ok": true,
  "titles_merged": 8423
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | Always `true` |
| `titles_merged` | integer | Number of title rows merged from the source database |

**Error responses**

Same pattern as `/api/upload-db`.

---

### `POST /api/import-json`

🔒 Auth required · 🛡 Admin only

One-time import of legacy JSON files from the `output/` directory (pre-SQLite scraper format). Processes all `streaming_*.json` files in chronological order.

**Request body:** none

**Response `200 OK`**
```json
{
  "message": "Imported 12480 titles from 6 files",
  "imported": 12480
}
```

---

## Error Response Format

All error responses return a JSON object with an `error` field:

```json
{
  "error": "Human-readable error message"
}
```

| HTTP Status | Meaning |
|---|---|
| `400` | Bad request — invalid or missing fields |
| `401` | Unauthorized — missing or invalid auth token |
| `403` | Forbidden — valid token but insufficient permissions |
| `404` | Not found — resource does not exist |
| `409` | Conflict — duplicate resource or invalid state transition |
| `500` | Internal server error |

---

## Caching Notes

| Endpoint | Cache mechanism |
|---|---|
| `GET /api/library` | ETag (row count + last `updated_at`) |
| `GET /api/posters/cache` | ETag (row count + last `fetched_at`) |
| `GET /api/upcoming` | TMDB cache per show (6-hour TTL in `tmdb_show_cache` table), bypassable with `?force=1` |
| `GET /api/platform-logos` | DB cache per platform (30-day TTL in `platform_logos` table) |
| `GET /api/profile` | Always computed live (also writes to `user_stats` cache for friend profile views) |
