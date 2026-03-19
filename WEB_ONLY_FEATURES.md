# Web-Only Features

Features that exist in the **Web App** (`stream-intel`) but are **NOT** present
in the React Native mobile app (`StreamIntelApp`). These are intentionally kept
as-is per project guidelines.

---

## 1. Scraper Sidebar (`#scraperSidebar`)

- **Location:** `frontend/index.html` — the `<aside class="sidebar">` block
- **Purpose:** Admin panel to run the JustWatch scraper directly from the UI,
  including mode/region/proxy controls, enrichment, live log streaming, JSON
  import, and database download.
- **Why web-only:** This is an admin/dev tool — not suitable for a consumer
  mobile app. The scraper runs server-side and can be triggered from the web
  admin UI or via `scrape_and_push.py` CLI.

## 2. Stats Panel (`setView('stats')`)

- **Location:** `frontend/js/catalog.js` → `renderStatsPanel()`; HTML in
  `index.html` (`#statsPanel`); nav tab marked `display:none` by default.
- **Purpose:** Shows platform distribution charts, library overview, and
  trending title counts. Visible to admin users only.
- **Why web-only:** Admin analytics dashboard — the mobile app surfaces
  user-level stats in the Profile screen instead.

## 3. Image Lightbox (`#imgLightbox`)

- **Location:** `frontend/index.html` — the `.img-lightbox` div
- **Purpose:** Full-screen overlay for viewing poster/backdrop images at full
  resolution. Activated by clicking poster images in the title detail page.
- **Why web-only:** Desktop users have large screens where full-res image
  viewing adds value. The mobile app uses native image display and doesn't need
  a separate lightbox overlay.

## 4. Database Download / Upload

- **Location:** Scraper sidebar buttons → calls `/api/download-db` and
  `/api/upload-db` admin endpoints.
- **Purpose:** Backup/restore the SQLite database file.
- **Why web-only:** Admin maintenance operation.

## 5. JSON Import

- **Location:** Scraper sidebar → `importJson()` → `/api/import-json`
- **Purpose:** One-time migration tool to import legacy JSON files from the
  `output/` directory into the database.
- **Why web-only:** Historical migration utility.

---

# Feature Parity Sync Log

## Changes Made (Steps 1–6)

### STEP 2: Authentication Flow
- Added register flow with display name + confirm password fields
- Added auth mode toggle (Login / Register pills)
- Added change-password section in profile overlay (email users only)

### STEP 3: Shared Components — Star Ratings on Cards
- Added user star rating display (★★★☆☆) on title cards in `renderCard()`
  when `entry.user_rating > 0` (matching RN `TitleCard` star display)

### STEP 4a: "More Like This" in Title Modal
- Added "More Like This" section at bottom of Overview tab in title detail modal
- Fetches titles with same genre + content type via `/api/titles`, filters out
  current title, shows up to 10 in horizontal scroll with posters
- Matches RN `TitleDetailScreen`'s "MORE LIKE THIS" section

### STEP 4b: Friend Ratings Section
- Added "Their Ratings" section to friend profile overlay
- Fetches friend's library, filters rated titles, shows stars + metadata
- Shows first 10 with "View all" toggle (matching RN `FriendProfileScreen`)
- Backend: added `l.user_rating` to friend library SQL query

### STEP 4c: Upcoming "Aired" Tab
- Added Upcoming/Aired tab toggle to the upcoming panel
- Aired tab fetches TMDB season data for tracked TV shows, collects past
  episodes (last 90 days), groups by date (newest first)
- Matches RN `UpcomingScreen`'s two-tab (Upcoming/Aired) system

### STEP 5: API & Data Layer
- All shared API endpoints were already covered in both apps
- No functional gaps — both apps use the same Flask backend endpoints

### STEP 6: State Management
- Web uses global JS variables (`libraryMap`, `allTitles`, `cardDataStore`)
- RN uses Zustand stores (`authStore`, `libraryStore`, `titlesStore`, etc.)
- Different paradigms but functionally equivalent — no gaps

### RN-Only Feature (Not Ported)
- **Episode subscription bell** (`subscriptionsStore.ts`): Uses local
  AsyncStorage to persist per-episode notification subscriptions. Not ported
  to web as it relies on native push scheduling and has no backend integration.
