# StreamIntel — Complete Mobile Design Specification
## React Native Android Replication Guide

This document describes every screen, every component, every button, every filter, and every data source in the StreamIntel mobile PWA. Use it as a complete blueprint to rebuild the app in React Native for Android.

---

## Table of Contents

1. [Design System](#1-design-system)
2. [App Architecture & Navigation](#2-app-architecture--navigation)
3. [Auth Screen](#3-auth-screen)
4. [Google Account Setup Screen](#4-google-account-setup-screen)
5. [Main App — Top Header](#5-main-app--top-header)
6. [Main App — Nav Tabs (Top Horizontal Bar)](#6-main-app--nav-tabs-top-horizontal-bar)
7. [Main App — Filter Toolbar](#7-main-app--filter-toolbar)
8. [Title Card Grid](#8-title-card-grid)
9. [Title Detail Screen](#9-title-detail-screen)
10. [Actor Detail Screen](#10-actor-detail-screen)
11. [For You Panel](#11-for-you-panel)
12. [Discover Panel](#12-discover-panel)
13. [Upcoming Panel](#13-upcoming-panel)
14. [Actors & Directors Panel](#14-actors--directors-panel)
15. [Stats Panel (Admin only)](#15-stats-panel-admin-only)
16. [Library View](#16-library-view)
17. [Friends Screen](#17-friends-screen)
18. [Notifications Panel](#18-notifications-panel)
19. [Profile Screen](#19-profile-screen)
20. [Watch History Screen](#20-watch-history-screen)
21. [Nav Drawer (Bottom Sheet)](#21-nav-drawer-bottom-sheet)
22. [Overlays & Dialogs](#22-overlays--dialogs)
23. [API Reference](#23-api-reference)
24. [State Management Reference](#24-state-management-reference)

---

## 1. Design System

### 1.1 Color Tokens

| Token | Hex | Usage |
|---|---|---|
| `--bg` | `#13151a` | App background |
| `--surface` | `#1a1d24` | Input backgrounds, secondary surfaces |
| `--card` | `#1f2229` | Card backgrounds, panel backgrounds |
| `--border` | `#2a2f3a` | All borders and dividers |
| `--accent` | `#5eead4` | Teal — primary accent, active states, links |
| `--accent2` | `#f87171` | Red — errors, destructive actions |
| `--gold` | `#e2c97e` | IMDb score color, top-3 rank badges |
| `--tomato` | `#f07070` | Rotten Tomatoes score color |
| `--text` | `#d4d8e0` | Primary text |
| `--muted` | `#6b7585` | Secondary/placeholder text, labels |
| `--fav` | `#f472b6` | Pink — favourite star/button |
| `--watching` | `#60a5fa` | Blue — "Watching" status |
| `--finished` | `#34d399` | Green — "Finished" status / episode check |
| `--watchlist` | `#a78bfa` | Purple — "Watchlist" status |
| `--radius` | `10px` | Default border radius |
| `--transition` | `220ms cubic-bezier(.4,0,.2,1)` | Default transition |

**Background texture**: A noise SVG overlay at 0.4 opacity sits on top of `--bg` using `::before` on `body`. In React Native, skip this or use a very subtle grain image at low opacity.

### 1.2 Typography

| Role | Font | Weights |
|---|---|---|
| Headings, logo, labels | **Syne** (Google Fonts) | 400, 600, 700, 800 |
| Body, buttons, UI | **DM Sans** (Google Fonts) | 300, 400, italic 300 |

- Headings: font-family `var(--font-head)` = `'Syne', system-ui, sans-serif`
- Body: font-family `var(--font-body)` = `'DM Sans', 'Inter', system-ui, sans-serif`

### 1.3 Spacing & Grid

- **Mobile card grid**: 2 columns on ≤480px, `auto-fill minmax(140px, 1fr)` on 481–768px
- **Bottom nav height**: `56px` + safe area inset bottom
- **Body padding-bottom on mobile**: `60px + safe area inset bottom` (to clear bottom nav)
- **Border radius**: cards use `10px`, modals/overlays use `10–20px` depending on type
- **Card gap**: 8px on small phones, 10–14px on larger mobile

### 1.4 Platform Badge Colors

Each streaming platform has specific badge styling used in cards and detail pages:

| Platform key | Background | Text color | Border |
|---|---|---|---|
| `netflix` | `rgba(229,9,20,.15)` | `#ff3a3a` | `rgba(229,9,20,.35)` |
| `disney_plus` | `rgba(17,60,207,.15)` | `#5b8aff` | `rgba(17,60,207,.35)` |
| `hbo_max` | `rgba(106,35,226,.15)` | `#b07dff` | `rgba(106,35,226,.35)` |
| `apple_tv` | `rgba(255,255,255,.08)` | `#d1d5db` | `rgba(255,255,255,.18)` |
| `prime_video` | `rgba(0,168,225,.15)` | `#38c0f0` | `rgba(0,168,225,.35)` |
| `hulu` | `rgba(28,231,131,.12)` | `#1ce783` | `rgba(28,231,131,.32)` |
| `peacock` | `rgba(248,190,0,.12)` | `#f8be00` | `rgba(248,190,0,.32)` |
| `paramount_plus` | `rgba(0,100,255,.15)` | `#5b9aff` | `rgba(0,100,255,.35)` |

### 1.5 Status Colors

| Status | Color variable | Color |
|---|---|---|
| Watching | `--watching` | `#60a5fa` (blue) |
| Finished | `--finished` | `#34d399` (green) |
| Watchlist | `--watchlist` | `#a78bfa` (purple) |
| Favourite | `--fav` | `#f472b6` (pink) |

A 3px colored bar at the bottom of title cards indicates watch status.

### 1.6 Animations

| Animation | Trigger | CSS |
|---|---|---|
| Card enter | Card renders in grid | `@keyframes cardIn { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }` — `.3s ease both` |
| Screen slide-in | Detail/actor/friends/profile open | `transform: translateX(100%) → translateX(0)` over `.32s cubic-bezier(.4,0,.2,1)` |
| Screen slide-out (closing) | Detail/actor/friends close | `.closing { animation: friendsOverlayOut .28s cubic-bezier(.4,0,.2,1) both }` |
| Nav drawer bottom sheet | `toggleNavDrawer()` | `transform: translateY(100%) → translateY(0)` over `.28s cubic-bezier(.4,0,.2,1)` |
| Notification panel | Bell tap | `opacity: 0 + translateY(16px) scale(.97) → normal` over `.28s` |
| Friend row entrance | Friends list load | `@keyframes friendRowIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }` — nth-child stagger: 1=0ms, 2=50ms, 3=100ms… 9+=400ms |
| Friends section title | Section renders | `@keyframes friendsSectionIn { from{opacity:0;transform:translateY(6px)} to{opacity:1} }` |
| Trending dot pulse | Always on trending items | `@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }` — `2s ease infinite` |
| Loading shimmer | Filmography score loading | `@keyframes shimmer { 0%,100%{opacity:.4} 50%{opacity:.9} }` — `1.4s ease infinite` |
| Logo/loader pulse | Global loader, actor loader | `@keyframes logo-pulse { 0%,100%{opacity:.55} 50%{opacity:1} }` — `1.8s ease-in-out infinite` |
| Signal arcs (loader) | Streaming signal icon | 3 arcs + dot ping at `.28s` staggered delays, `1.8s` cycle |
| Spinner | API loading states | `@keyframes spin { to{transform:rotate(360deg)} }` — `.7s linear infinite` |
| Button press lift | Submit/action buttons on hover | `transform: translateY(-1px)` + `opacity: .85` |
| Profile time card lift | Hover over watch-time card | `transform: translateY(-2px)` + stronger border-color |
| Upcoming card nudge | Hover over upcoming episode | `transform: translateX(4px)` + box-shadow |
| Label blink | "Loading…" text in actor loader | `@keyframes label-blink { 0%,100%{opacity:.4} 55%{opacity:.9} }` |

**Transition standard**: All interactive state changes use `var(--transition)` = `220ms cubic-bezier(.4,0,.2,1)` unless explicitly overridden.

```css
/* global transition shorthand */
--transition: 220ms cubic-bezier(.4,0,.2,1);

/* Detail/Actor/Friends screens */
.detail-page    { transition: transform .32s cubic-bezier(.4,0,.2,1); }
.actor-overlay  { transition: transform .32s cubic-bezier(.4,0,.2,1); }
.friends-overlay.open    { animation: friendsOverlayIn  .32s cubic-bezier(.4,0,.2,1) both; }
.friends-overlay.closing { animation: friendsOverlayOut .28s cubic-bezier(.4,0,.2,1) both; }
@keyframes friendsOverlayIn  { from { transform: translateX(100%); } to { transform: translateX(0); } }
@keyframes friendsOverlayOut { from { transform: translateX(0); }   to { transform: translateX(100%); } }

/* card entrance */
@keyframes cardIn { from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);} }
.card { animation: cardIn .3s ease both; }

/* nav drawer */
.nav-drawer { transition: transform .28s cubic-bezier(.4,0,.2,1); }
/* desktop: translateX(-100%) → 0 */
/* mobile: translateY(100%) → 0 */

/* friend row stagger */
@keyframes friendRowIn   { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
@keyframes friendsSectionIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }

/* status dot animations */
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }

/* spinner */
@keyframes spin { to{transform:rotate(360deg)} }
.spinner { width:16px; height:16px; border:2px solid rgba(94,234,212,.2); border-top-color:var(--accent); border-radius:50%; animation:spin .7s linear infinite; }
```

---

## 2. App Architecture & Navigation

### 2.1 Screen Stack (z-index layers)

| Layer | z-index | Component |
|---|---|---|
| Base app | 0 | `#appLayout` — main grid, toolbar, header |
| Bottom nav | 500 | `#bottomNav` — always on top of app |
| Nav drawer overlay | 505–510 | `#navDrawerOverlay`, `#navDrawer` |
| Title detail | 100 | `#overlay` (detail page) |
| Actor detail | 450 | `#actorOverlay` |
| Profile | 350 | `#profileOverlay` |
| Watch history | 350 | `#watchHistoryOverlay` |
| People all | — | `#peopleAllOverlay` |
| Friends | 300 | `.friends-overlay` |
| Notifications panel | 500 | `.notif-panel` |
| For You / Discover detail | — | `#forYouDetailOverlay`, `#discoverDetailOverlay` |
| Episode detail | — | `#epDetailOverlay` |
| Friend profile card | 650 | `.fpm-overlay` |
| Notifications panel | 500 | `.notif-panel` |
| Notification detail | 950 | `.notif-detail-overlay` |
| Share dialog | 2400 | `.share-msg-overlay` |
| Global loader | 9999 | `#globalLoader` |

In React Native, model this as a stack navigator where each screen slides from the right. The bottom nav is always visible (except on auth).

### 2.2 Mobile Navigation Structure

```
Bottom Nav (5 tabs — always visible after login)
├── 🏠 Home       → setView('all') + clearAllFilters()
├── 📈 Trending   → setView('trending')
├── 🔖 Library    → gotoLibrary()  [activates Library sub-tabs]
├── 👥 Friends    → openFriends()  [full-screen slide from right]
└── ••• More      → toggleNavDrawer()  [opens bottom-sheet drawer]
```

**Active state**: The active bottom nav button gets `--accent` color on both icon (SVG stroke) and label text. Icon scales to 1.12x. On press, icon scales to 0.88x then back.

### 2.3 App Initialization

On app startup:
1. Check `localStorage` for `si_token` (JWT)
2. If no token → show **Auth Screen**
3. If token exists → call `GET /api/auth/me` to validate
4. If valid → call `GET /api/geoip` to detect user's country → set `activeRegion`
5. Call `GET /api/titles?limit=15000&sort=rank&unique=1` → populate `allTitles[]`
6. Call `GET /api/library` → populate `libraryMap{}`
7. Show main app layout with `setView('all')`

---

## 3. Auth Screen

**Screen ID**: `#authScreen`  
**Condition**: Shown when not logged in (no valid JWT token)

### 3.1 Layout

Full-screen centered layout on `--bg` background:
- Centered content box (`max-width: 380px`, `padding: 40px 32px`, `background: var(--card)`, `border: 1px solid var(--border)`, `border-radius: 16px`)
- On mobile: `width: calc(100% - 32px)`, `padding: 28px 20px`, `border-radius: 12px`

```css
/* Full-screen overlay hosting the box */
.auth-screen {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg);
}
/* The box itself */
.auth-box {
  width: 380px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 40px 36px;
}
/* Mobile override */
@media (max-width: 768px) {
  .auth-box { width: calc(100% - 32px); padding: 28px 20px; border-radius: 12px; }
}
@media (max-width: 480px) {
  .auth-box { padding: 22px 16px; }
}
```

### 3.2 Logo / Header

- App icon: `80×80px` rounded square, image from `/icons/icon.png`
- Title: **"StreamIntel"** — Syne font, `font-weight: 800`, color `var(--text)`
- Subtitle: **"Track everything you watch."** — DM Sans, `14px`, color `var(--muted)`, margin-bottom `28px`

```css
.auth-logo-mark {
  font-size: 11px; font-weight: 800; letter-spacing: .2em;
  text-transform: uppercase; color: var(--accent);
}
.auth-title {
  font-family: var(--font-head); font-size: 28px; font-weight: 800; margin-bottom: 8px;
}
.auth-sub {
  font-size: 14px; color: var(--muted); margin-bottom: 32px; line-height: 1.5;
}
/* Mobile */
@media (max-width: 480px) { .auth-title { font-size: 23px; } }
```

### 3.3 Tab Toggle: Login / Register

Two buttons side by side:
- **Sign In** tab / **Create Account** tab
- Active tab: solid fill `rgba(94,234,212,.12)`, `border: 1px solid var(--accent)`, color `var(--accent)`
- Inactive tab: no background, `border: 1px solid var(--border)`, color `var(--muted)`
- Switching tabs shows/hides the display name field

### 3.4 Form Fields

Each field:
- Full width input
- `background: var(--surface)`, `border: 1px solid var(--border)`, `border-radius: 10px`
- `padding: 12px 14px`, `font-size: 15px`, `color: var(--text)`
- On focus: `border-color: var(--accent)`
- Placeholder: color `var(--muted)`

```css
.auth-field label {
  font-size: 11px; font-weight: 600; letter-spacing: .12em;
  text-transform: uppercase; color: var(--muted);
}
.auth-input {
  width: 100%; padding: 11px 14px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text); font-size: 15px;
  outline: none;
  transition: border-color var(--transition);
}
.auth-input:focus { border-color: var(--accent); }
```

Fields for **Register** mode:
1. Display name (text input, `placeholder: "Your name"`)
2. Username (text input, `placeholder: "Username"`)
3. Password (password input, `placeholder: "Password"`)

Fields for **Sign In** mode:
1. Username (text input)
2. Password (password input)

### 3.5 Buttons

**Primary submit button** (Sign In / Create Account):
- Full width, `padding: 13px`, `border-radius: 10px`
- Background: `var(--accent)`, color: `#080c10`, `font-weight: 700`, `font-size: 15px`
- On hover: `opacity: 0.88`
- Loading state: shows `⟳ Signing in…` / `⟳ Creating account…` text

**Google Sign In button**:
- Full width, `padding: 12px`, `border-radius: 10px`
- Background: `#ffffff`, color: `#1f2937`
- Icon: Google "G" SVG (multicolor), `18×18px`, flex row with `gap: 10px`
- Text: **"Continue with Google"**
- Action: redirects to `GET /api/auth/google` which redirects to Google OAuth

**Divider between buttons**: `— or —` text with lines on each side, color `var(--muted)`

```css
.auth-btn {
  width: 100%; padding: 13px;
  background: var(--accent); border: none;
  border-radius: var(--radius);
  color: #080c10; font-size: 15px; font-weight: 700;
  cursor: pointer; transition: opacity var(--transition), transform var(--transition);
}
.auth-btn:hover { opacity: .85; transform: translateY(-1px); }

/* Google button variant */
.auth-btn.google-btn {
  background: #ffffff; color: #1f2937;
  display: flex; align-items: center; justify-content: center; gap: 10px;
}

/* Or-divider */
.auth-divider {
  position: relative; text-align: center;
  font-size: 12px; color: var(--muted); margin: 4px 0;
}
.auth-divider::before, .auth-divider::after {
  content: ''; position: absolute; top: 50%;
  width: calc(50% - 20px); height: 1px; background: var(--border);
}
.auth-divider::before { left: 0; }
.auth-divider::after  { right: 0; }

/* Error message */
.auth-error { color: var(--accent2); font-size: 13px; margin-top: 12px; text-align: center; }
```

### 3.6 Error Display

- Error message appears below form in red (`var(--accent2)`, `font-size: 13px`)
- API call: `POST /api/auth/login` with `{username, password}` body or `POST /api/auth/register` with `{username, password, display_name}`
- On success: store JWT in `localStorage` as `si_token`, then call `loadApp()`

### 3.7 Data Sources

| Variable | Source |
|---|---|
| JWT token | `POST /api/auth/login` → `{token, user}` |
| User object | `POST /api/auth/login` → `{user: {id, username, display_name, is_admin, ...}}` |

### 3.8 Tab Toggle CSS

```css
/* Two-button toggle: Sign In / Create Account */
.auth-tab-bar {
  display: flex; gap: 4px;
  background: var(--bg); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 3px;
  margin-bottom: 24px;
}
.auth-tab-btn {
  flex: 1; padding: 8px;
  border-radius: 7px; border: none;
  background: transparent; color: var(--muted);
  font-size: 14px; font-weight: 600; cursor: pointer;
  transition: all var(--transition);
}
.auth-tab-btn.active {
  background: rgba(94,234,212,.12);
  border: 1px solid var(--accent);
  color: var(--accent);
}
```

---

## 4. Google Account Setup Screen

**Screen ID**: `#setupScreen`  
**Condition**: Shown after first Google OAuth login when username hasn't been set yet.

### 4.1 Layout

Same centered box as auth screen, overlaid on top of the app.

### 4.2 Content

- Title: **"One last step"** — Syne, `28px`, `font-weight: 800`
- Subtitle: **"Choose a username to complete your account."`** — 14px, muted
- Username input field (same style as auth fields)
- **"Save & Continue"** button (same style as primary submit)
- Error display below field

### 4.3 Data Source

- `POST /api/auth/setup` with `{username}` body
- On success: dismiss setup screen, continue to app

---

## 5. Main App — Top Header

**Component ID**: `#topHeader` (position: `sticky`, `top: 0`, `z-index: 200`)

### 5.1 Header Row 1 (primary header bar)

Height: `60px` on mobile (`68px` desktop)  
Background: `rgba(19,21,26,1)` on mobile (no `backdrop-filter` to prevent scroll flicker on iOS/mobile Chrome); desktop uses `rgba(19,21,26,.98) + backdrop-filter: blur(16px)`  
Border-bottom: `1px solid var(--border)`

```css
.top-header {
  display: flex; flex-direction: column;
  background: rgba(19,21,26,.98); backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 11;
}
.header-row1 {
  display: flex; align-items: stretch;
  padding: 0 16px 0 0; height: 68px;
}
/* Mobile: remove backdrop-filter, solid bg, shorter */
@media (max-width: 768px) {
  .top-header  { backdrop-filter: none; background: rgba(19,21,26,1); }
  .header-row1 { height: 60px; padding: 0 14px 0 0; position: relative; }
  .header-logo-text { display: none; }           /* hide wordmark */
  .header-stats     { display: none; }           /* hide desktop stats strip */
  .header-nav       { display: none; }           /* hide tab strip */
  .header-right     { gap: 12px; }
}
```

#### Left side:
- **Logo button** (tapping goes home / `goHome()`):
  - App icon: `36×36px` rounded square image (`/icons/icon.png`)
  - Wordmark "StreamIntel" — **hidden on mobile** (only shown on desktop)
  - On mobile: a centered page title appears instead (see below)

#### Center (mobile only):
- **Mobile page title** — `position: absolute`, `left: 50%`, `transform: translateX(-50%)`
- Shows current view name (e.g., "All Titles", "Movies", "Trending")
- Tapping it opens a dropdown for quick view switching (same options as drawer items)
- Has a small chevron icon indicating it's tappable
- When the current view doesn't support sub-navigation (e.g., Friends, Profile), chevron is hidden

```css
.mobile-page-title {
  position: absolute; left: 50%; transform: translateX(-50%);
  top: 50%; margin-top: -10px;
  font-size: 15px; font-weight: 700; color: var(--text);
  white-space: nowrap; letter-spacing: .01em;
}
/* Tappable button inside .mobile-page-title */
.mpt-trigger {
  display: flex; align-items: center; gap: 4px;
  background: none; border: none; padding: 0;
  font-size: 15px; font-weight: 700; color: var(--text);
  font-family: var(--font-body); cursor: pointer;
}
.mpt-trigger svg { flex-shrink: 0; opacity: .7; transition: transform .2s; }
.mpt-trigger.open svg { transform: rotate(180deg); }
.mpt-trigger.no-arrow svg { display: none; }   /* non-navigable views */
/* Quick-nav dropdown */
.mpt-dropdown {
  position: fixed; top: 62px;
  left: 50%; transform: translateX(-50%);
  background: var(--card); border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,.45);
  overflow: hidden; z-index: 1200; min-width: 140px;
}
.mpt-dropdown button {
  display: block; width: 100%; padding: 11px 18px;
  background: none; border: none; text-align: left;
  font-size: 14px; font-weight: 500; color: var(--text);
  font-family: var(--font-body); cursor: pointer;
  transition: background .15s;
}
.mpt-dropdown button.active { color: var(--accent); font-weight: 700; }
```

#### Right side (from left to right):
1. **Header search box** (inline within header)
   - Width: `110px` initially, expands to `150px` on focus (mobile)
   - `placeholder: "Search…"`, autocomplete off
   - Has a magnifier icon (⌕) on the left
   - On input: debounced search triggers `hsDebounced()` (see search dropdown below)
   - On focus: shows search dropdown

2. **Notification bell button** (`#notifBtn`)
   - `34×34px` circle on mobile
   - Background: `var(--surface)`, border: `1px solid var(--border)`
   - Bell SVG icon, color: `var(--muted)`
   - **Red badge** (`#notifBadge`): top-right, `17px` height, red background `#e53e3e`, white text, shows unread count
   - Active/open state: `border-color: var(--accent)`, teal glow ring `box-shadow: 0 0 0 3px rgba(94,234,212,.18)`

3. **User avatar button** (`#userAvatarBtn`)
   - `34×34px` circle on mobile
   - Shows profile image if set, else initials (`#headerAvatarInitial`, font-size `15px`)
   - Tapping opens user menu dropdown

```css
/* Notification button */
.notif-btn {
  width: 42px; height: 42px; border-radius: 50%;
  background: var(--surface); border: 1px solid var(--border);
  position: relative;
}
.notif-btn.notif-open { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(94,234,212,.18); }
.notif-badge {
  position: absolute; top: -4px; right: -4px;
  min-width: 17px; height: 17px;
  background: #e53e3e; color: #fff;
  border-radius: 9px; font-size: 10px; font-weight: 700;
  border: 2px solid var(--bg);
  display: flex; align-items: center; justify-content: center;
}

/* User avatar button */
.user-avatar-btn {
  width: 42px; height: 42px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,.18);
  background: linear-gradient(135deg, #5eead4 0%, #6366f1 100%);
  overflow: hidden;
}
.user-avatar-btn.menu-open { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(94,234,212,.24); }

/* Mobile overrides */
@media (max-width: 768px) {
  .notif-btn      { width: 34px; height: 34px; }
  .user-avatar-btn { width: 34px; height: 34px; border-width: 1.5px; }
  #headerAvatarInitial { font-size: 15px; }
}
@media (max-width: 480px) {
  .notif-btn      { width: 38px; height: 38px; }
  .user-avatar-btn { width: 38px; height: 38px; }
  #headerAvatarInitial { font-size: 12px; }
}

/* Header search input */
.header-search-input {
  width: 200px; padding: 7px 12px 7px 32px;
  border-radius: 20px; border: 1px solid var(--border);
  background: rgba(255,255,255,.04); font-size: 14px;
  transition: border-color var(--transition), width var(--transition);
}
.header-search-input:focus {
  border-color: var(--accent); width: 260px;
  box-shadow: 0 0 0 3px rgba(94,234,212,.1);
}
@media (max-width: 768px) {
  .header-search-input { width: 110px; }
  .header-search-input:focus { width: 150px; }
}
@media (max-width: 480px) {
  .header-search-input { width: 88px; }
  .header-search-input:focus { width: 120px; }
}
```

#### Header Search Dropdown

When search input is focused or has text, a floating dropdown appears below:
- Position: `position: fixed`, `left: 8px`, `right: 8px` (full width on mobile)
- Background: `var(--card)`, border, border-radius, box-shadow
- Contains:
  - List of search results (title cards, mini format)
  - **"Show more results"** button → switches main view to show all search results
- Data: debounced call to local `allTitles[]` array filtered by search term. Also searches TMDB if no local matches via `GET /api/tmdb/search?query={q}&type=multi`

```css
.search-dropdown {
  position: fixed; min-width: 320px;
  max-height: 560px; overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 20px 60px rgba(0,0,0,.7);
  z-index: 200;
}
/* Mobile: full-width, fixed from sides */
@media (max-width: 768px) {
  .hs-dropdown {
    position: fixed !important;
    left: 8px !important; right: 8px !important;
    width: auto !important; max-width: none !important;
    z-index: 2000;
  }
}
.search-result-item {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 16px; cursor: pointer;
  border-bottom: 1px solid rgba(255,255,255,.04);
}
.sr-poster  { width: 68px; height: 100px; border-radius: 6px; background: rgba(255,255,255,.06); }
.sr-title   { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sr-meta    { font-size: 12px; color: var(--muted); margin-top: 3px; }
.search-more-btn {
  width: 100%; padding: 13px;
  background: transparent; color: var(--accent);
  font-size: 14px; font-weight: 600;
  border-top: 1px solid var(--border);
}
```

### 5.2 User Menu Dropdown

Dropdown that appears below avatar button on tap:
- Background: `var(--card)`, border, border-radius: `var(--radius)`
- Menu items:
  - **👤 Profile** → `openProfile()`
  - **Sign out** (red color `var(--accent2)`) → `doLogout()` which clears localStorage token
- On outside click: closes dropdown

```css
.user-menu-dropdown {
  position: absolute; top: calc(100% + 10px); right: 0;
  z-index: 400;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0,0,0,.55);
  min-width: 170px; overflow: hidden;
}
.user-menu-item {
  display: block; width: 100%; padding: 11px 16px;
  background: transparent; border: none; text-align: left;
  color: var(--text); font-size: 14px; cursor: pointer;
  transition: background var(--transition);
}
.user-menu-item:hover { background: rgba(255,255,255,.06); }
.user-menu-item.signout { color: var(--accent2); }
@media (max-width: 768px) {
  .user-menu-dropdown { top: calc(100% + 8px); }
}
```

---

## 6. Main App — Nav Tabs (Top Horizontal Bar)

**Component**: `.header-nav` — scrollable horizontal tab strip below header row  
**Visibility**: **Hidden on mobile** (replaced by bottom nav + drawer). The nav tabs appear only on desktop (>768px).

On mobile, navigation is handled by:
- Bottom navigation bar (5 primary tabs)
- Side drawer bottom sheet (all items including secondary ones)
- Mobile page title dropdown (quick switch)

### 6.1 Tab List (in order)

Each tab is a `<button>` with class `.nav-tab`:

| Tab | Data attribute | Action | Notes |
|---|---|---|---|
| All | `all` | `setView('all')` | Shows full title grid |
| 🎬 Movies | `movie` | `setView('movie')` | Filter: content_type = movie |
| 📺 TV | `tv` | `setView('tv')` | Filter: content_type = tv |
| 🔥 Trending | `trending` | `setView('trending')` | Shows trending titles |
| ✨ For You | `foryou` | `setView('foryou')` | Personalized recommendations panel |
| 🧭 Discover | `discover` | `setView('discover')` | Curated discovery sections panel |
| 📅 Upcoming | `upcoming` | `setView('upcoming')` | Upcoming releases panel |
| 🎭 Actors | `actors` | `setView('actors')` | Actors & directors panel |
| 📊 Stats | `stats` | `setView('stats')` | Admin only — site-wide stats |

**Active tab style**: `color: var(--accent)`, `border-bottom: 2px solid var(--accent)`  
**Favorited views**: Favourites/Watchlist/Watching/Finished sub-views get `color: var(--fav)` when active

```css
/* Tab strip container — hidden on mobile */
.header-nav {
  display: flex; align-items: stretch;
  height: 44px; overflow-x: auto;
  border-top: 1px solid var(--border);
}
@media (max-width: 768px) { .header-nav { display: none; } }

/* Individual tab */
.nav-tab {
  padding: 0 14px; height: auto; align-self: stretch;
  border: none; border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--muted); font-size: 14px; font-weight: 500;
  cursor: pointer; white-space: nowrap;
  transition: color var(--transition), border-color var(--transition);
}
.nav-tab.active         { color: var(--accent); border-bottom-color: var(--accent); }
.nav-tab.fav-tab.active { color: var(--fav);    border-bottom-color: var(--fav); }
.nav-tab:hover:not(.active) { color: var(--text); }
/* Tablet: slightly smaller */
@media (max-width: 768px) {
  .nav-tab { padding: 0 10px; font-size: 13px; }
}
@media (max-width: 480px) {
  .nav-tab { padding: 0 8px;  font-size: 12px; }
}
```

---

## 7. Main App — Filter Toolbar

**Component**: `.toolbar` — positioned directly below header  
Background: `rgba(19,21,26,.95)`, border-bottom: `1px solid var(--border)`, padding: `8px 12px` on mobile

On mobile, the toolbar works as two parts:
- **Row 1** (always visible): Search box + "Filters" toggle button + "Clear filters ✕" button
- **Row 2** (collapsible): Filter pills and dropdowns (toggled by the Filters button)

### 7.1 Search Box

- Input, `placeholder: "Search titles…"`, border-radius: `20px`
- On mobile: `width: 100%` (flex: 1)
- On input: debounced search against local `allTitles[]`
- On the right: **×** clear button (only shown when there's text) — calls `clearSearch()`
- "People suggestion strip" (`#catalogPeopleStrip`): appears below toolbar when search matches a person name — shows clickable person chips to view that person's filmography

### 7.2 "Filters" Toggle Button

- Shows only on mobile (`.filter-toggle-btn { display: none }` on desktop, `display: flex` on mobile)
- Label: `Filters` with a funnel-style SVG icon (3 horizontal lines getting shorter)
- Active state (when filters visible): `border-color: var(--accent)`, `color: var(--accent)`, teal tinted background
- Tapping: adds/removes `.filters-hidden` class on `.toolbar-filters`

### 7.3 "Clear filters ✕" Button

- Hidden by default (`display: none`), shown when any filter is active
- Color: `var(--accent2)` (red), border: `1px solid var(--accent2)`
- Tapping: calls `clearAllFilters()` — resets all filters to defaults

### 7.4 Filter Group — Platform Pills

- Dynamically generated from `allTitles[].platform` values
- Each pill: `<button>` with class `.pill`
  - Platform name (formatted: "Netflix", "Disney+", etc.)
  - Platform logo SVG icon (`16×16px`) on the left
  - Default: muted text + `--border` border
  - Active: `border-color: var(--accent)`, `color: var(--accent)`, teal tinted background
- **"All"** pill first (always present)
- If there are many platforms: an expand button shows `+N more` to reveal hidden ones
- State variable: `activePlatform` (string matching platform key)

### 7.5 Region Dropdown

- Shows only when there are multiple regions available
- Button label: "All Countries ▾" or current region name
- Opens a dropdown menu with list of available regions
  - Each option has a country flag emoji + country name
  - Includes a search box at top for filtering
- When a region is selected: filters `allTitles[]` to only show content available in that region
- Data from: `GET /api/regions` → array of `{code, name}` objects
- State variable: `activeRegion` (ISO 3166-1 alpha-2 code, e.g., "US")

### 7.6 Trending Type Toggle (Trending view only)

- Visible only when `activeType === 'trending'`
- Three-button segmented control: **All** / **Movies** / **TV**
- Style: pill shape with a bordered container, active option gets `background: var(--accent)`, `color: #fff`
- State variable: `trendingTypeFilter`

### 7.7 Ongoing Filter (TV view only)

- Visible only when `activeType === 'tv'`
- Three-button segmented control: **All** / **Ongoing** / **Ended**
- Same style as trending type toggle
- State variable: `ongoingFilter`

### 7.8 Genre Include Dropdown

- Button label: "All Genres ▾" or comma-joined selected genres
- Opens scrollable dropdown (max 280px height)
- "Clear" link at top clears all genre selections
- Each genre option has a checkbox on the left (CSS-styled, not native)
  - Checked: `background: var(--accent)`, `border-color: var(--accent)`, white checkmark
  - Unchecked: `background: var(--bg)`, `border: 1px solid var(--border)`
- Multiple genres can be selected (OR logic — shows titles matching any selected genre)
- Genres derived from `allTitles[].genre` values (split by comma)
- State variable: `activeGenres` (Set of genre strings)

### 7.9 Genre Exclude Dropdown

- Same structure as genre include, but filters OUT titles with selected genres
- Button label: "Exclude Genres ▾"
- State variable: `excludedGenres` (Set of genre strings)

### 7.10 Votes Filter Dropdown

- Button label: "Any votes ▾" or selected threshold
- Fixed options:
  - Any votes (0)
  - 1K+ votes (1,000)
  - 10K+ votes (10,000)
  - 50K+ votes (50,000)
  - 100K+ votes (100,000)
  - 500K+ votes (500,000)
- Filters by `imdb_votes >= threshold`
- State variable: `activeVotes` (number)

### 7.11 Sort Dropdown

- Button label: "By Rank ▾" or current sort name
- Options:
  - By Rank (default) — sorts by `ranking_position` ascending
  - IMDb Score — sorts by `imdb_score` descending
  - Rotten Tomatoes — sorts by `tomatometer` descending
  - Year — sorts by `release_year` descending
  - Title A–Z — sorts alphabetically by `title`
- State variable: `activeSort` (string: `'rank'|'imdb'|'rt'|'year'|'title'`)

### 7.12 Toolbar CSS Reference

```css
/* ── Outer toolbar container ── */
.toolbar {
  flex-shrink: 0; padding: 10px 20px;
  background: rgba(19,21,26,.95); backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}

/* Mobile: no backdrop-filter (creates containing block breaking fixed dropdowns) */
@media (max-width: 768px) {
  .toolbar {
    padding: 8px 12px; gap: 8px; flex-wrap: wrap;
    max-height: 600px; overflow: hidden;
    backdrop-filter: none;
    transition: max-height 0.25s ease, padding 0.25s ease, border 0.25s ease;
  }
  /* Collapsed state when user scrolls down */
  .toolbar.toolbar-hide { max-height: 0; padding-top: 0; padding-bottom: 0; border-bottom-width: 0; }
  /* Search + toggle on first row */
  .search-wrap { flex: 1; min-width: 0; }
  .search-box  { flex: 1; min-width: 0; width: 100%; }
  /* Filters section: togglable */
  .toolbar-filters.filters-hidden { display: none; }
  .toolbar-filters { width: 100%; }
  .filter-group { flex-wrap: wrap; gap: 4px; }
}

/* ── Filter toggle button (mobile only) ── */
.filter-toggle-btn {
  display: none; /* desktop: hidden */
  padding: 5px 12px; border-radius: 20px;
  border: 1px solid var(--border);
  background: transparent; color: var(--muted); font-size: 13px;
}
.filter-toggle-btn.filters-open {
  border-color: var(--accent); color: var(--accent);
  background: rgba(94,234,212,.08);
}
@media (max-width: 768px) { .filter-toggle-btn { display: flex; flex-shrink: 0; } }

/* ── Platform pills ── */
.pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 12px; border-radius: 20px;
  border: 1px solid var(--border); background: transparent;
  color: var(--muted); font-size: 13px; cursor: pointer;
  transition: all var(--transition);
}
.pill:hover, .pill.active {
  border-color: var(--accent); color: var(--accent);
  background: rgba(94,234,212,.08);
}
@media (max-width: 768px) { .pill { padding: 5px 10px; font-size: 12px; } }

/* ── Clear filters button ── */
.clear-filters-btn {
  padding: 5px 12px; border-radius: 20px;
  border: 1px solid var(--accent2); background: transparent;
  color: var(--accent2); font-size: 13px;
}

/* ── Segmented controls (trending-type / ongoing) ── */
.trend-type-toggle {
  display: flex; align-items: center; gap: 2px;
  border: 1px solid var(--border); border-radius: 20px;
  padding: 2px; background: var(--surface);
}
.trend-type-btn {
  padding: 4px 12px; border-radius: 16px; border: none;
  background: transparent; color: var(--muted); font-size: 13px; cursor: pointer;
}
.trend-type-btn.active { background: var(--accent); color: #fff; }

/* ── Genre dropdown ── */
.genre-dropdown-menu {
  position: absolute; top: calc(100% + 6px); z-index: 1100;
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius);
  min-width: 200px; max-height: 280px; overflow-y: auto;
  padding: 6px 0; box-shadow: 0 8px 32px rgba(0,0,0,.4);
}
/* Mobile: full-width, attached to viewport */
@media (max-width: 768px) {
  .genre-dropdown-menu {
    position: fixed; left: 8px; right: 8px; top: auto;
    width: auto; z-index: 510; /* above bottom-nav z-500 */
  }
}
.genre-option {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 14px; font-size: 13px; color: var(--muted);
  cursor: pointer; transition: background var(--transition);
}
.genre-option:hover { background: rgba(255,255,255,.04); }
.genre-checkbox {
  width: 14px; height: 14px;
  border: 1px solid var(--border); border-radius: 3px;
  background: var(--bg); flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.genre-option.checked .genre-checkbox {
  background: var(--accent); border-color: var(--accent);
}
.genre-checkbox::after { content: '✓'; font-size: 10px; color: #13151a; opacity: 0; }
.genre-option.checked .genre-checkbox::after { opacity: 1; }

/* ── Sort select ── */
.sort-select {
  padding: 5px 10px; border-radius: 20px;
  border: 1px solid var(--border); background: transparent;
  color: var(--muted); font-size: 13px; cursor: pointer;
}
.sort-select:focus { outline: none; border-color: var(--accent); }
@media (max-width: 768px) { .sort-select { width: 100%; } }

/* ── Pagination ── */
.pagination {
  display: flex; align-items: center; justify-content: center;
  gap: 8px; padding: 28px 28px 36px; flex-wrap: wrap;
}
.pg-btn {
  height: 34px; min-width: 34px; padding: 0 10px;
  background: var(--card); border: 1px solid var(--border);
  border-radius: 8px; color: var(--text); font-size: 14px; font-weight: 600;
}
.pg-btn.active  { background: var(--accent); border-color: var(--accent); color: #080c10; }
.pg-btn:disabled { opacity: .3; cursor: not-allowed; }
```

---

## 8. Title Card Grid

**Component**: `.grid-wrap > .grid` — the main content area

### 8.1 Grid Layout

- Desktop: `auto-fill minmax(200px, 1fr)`, gap `14px`
- Mobile (>480px): `auto-fill minmax(140px, 1fr)`, gap `10px`
- Small phone (≤480px): `repeat(2, 1fr)`, gap `8px`
- Pagination at bottom (shown for large result sets)

Cards enter with a fade+slide animation: `opacity:0, translateY(12px)` → natural over 300ms.

### 8.2 Title Card Structure

Each card is a `<button>` with class `.card`. Tapping opens the Title Detail Screen.

```
┌─────────────────────────────┐
│  POSTER (2:3 aspect ratio)  │
│  ┌─────┐         ┌──────┐   │
│  │RANK │         │❤️ FAV│   │
│  └─────┘         └──────┘   │
│  ⋮  (menu btn — mobile)     │
│                             │
│  [STATUS INDICATOR if set]  │  <- bottom of poster overlay
│  [TRENDING DOT if trending] │
│───────────────────────────  │
│  TITLE (truncated 1 line)   │
│  [MOVIE/TV] [YEAR] [RATING] │
│  [Season info / ongoing tag]│
│  ─────────────────────────  │
│  IMDb: 8.2   RT: 92%        │
└─────────────────────────────┘
[STATUS COLOR BAR — 3px]
```

### 8.3 Card Poster Area

- `aspect-ratio: 2/3` (portrait)
- Background: `var(--surface)`
- Shows poster image if available: `GET https://image.tmdb.org/t/p/w342{poster_path}`
  - `poster_path` comes from `_tmdbShowData[titleKey].posterThumb`
  - Fetched lazily via IntersectionObserver queue
- If no image: placeholder with emoji icon (`🎬`) + title text

**Poster overlay** (gradient from top and bottom):
- Appears on hover (desktop) / always visible when status set (mobile)
- Contains:
  - **Top-left**: Rank badge (or "Unranked")
  - **Top-right**: Trending dot (if `is_trending = true`)
  - **Bottom-left**: Status indicator badge (if fav/watchlist/watching/finished)

#### Rank Badge
- Background: `rgba(0,0,0,.7)`, border: teal border
- Shows `#N` ranking position (e.g., `#1`, `#42`)
- If ranked in top 3: text color `var(--gold)`, gold border
- If unranked: muted text, `"—"` displayed

#### Trending Dot
- Small `6px` circle in `var(--accent)` teal
- Has a glow box-shadow + 2s infinite pulse animation

#### Status Indicator Badge  
- Pill shape, `background: rgba(0,0,0,.75)`, blur
- Format: `[dot] [STATUS TEXT]`
  - `watching` → blue dot + "Watching"
  - `finished` → green dot + "Finished"
  - `watchlist` → purple dot (pulsing) + "Watchlist"

### 8.4 Card Action Buttons

- **FAV button** (`♡` heart): top-right of card, `30×30px` circle
  - Inactive: semi-transparent dark background, white heart icon
  - Active (favourited): `border-color: var(--fav)`, pink heart, pink border
  - On desktop: appears on hover
  - On mobile: always visible at `opacity: 0.85`
  
- **Watchlist button** (`🔖`): top-right, to the LEFT of fav button
  - Visible on desktop hover only; hidden on mobile touch devices
  - Active: `border-color: var(--watchlist)`, purple icon

- **Context menu button** (`⋮` dots): top-LEFT of card, mobile only
  - `display: none` on desktop, `display: flex` on touch devices
  - Tapping opens a floating popup menu (`.card-menu-popup`):
    - "Add to Watchlist" (purple)
    - "Mark as Watching" (blue)
    - "Mark as Finished" (green)
    - "❤️ Favourite" (pink)
    - "Remove from Library" (red, shown only if already in library)
    - Active item gets teal text + teal background

### 8.5 Card Body Area

`padding: 8–12px` depending on screen size

1. **Title**: `font-size: 13–14px`, `font-weight: 700`, single line with ellipsis overflow

2. **Sub-line** (flex row):
   - Type tag: `"MOVIE"` (gold background) or `"TV"` (teal background), 10px uppercase
   - Year: `"2024"` or `"2019–2024"` for finished series, or `"2022–"` for ongoing
   - Maturity rating: small grey badge (e.g., `"TV-MA"`, `"PG-13"`)

3. **Season/Episodes row** (TV only):
   - Shows `"N seasons"` or `"N seasons, N eps"`
   - Ongoing tag: `"ONGOING"` (green border+text) or `"ENDED"` (grey)

4. **Scores section** (separated by top border):
   - **IMDb block**: label "IMDB" (9px uppercase), score in gold (e.g., `8.4`), vote count below (e.g., `"1.2M votes"`)
   - **RT block**: label "RT" (9px uppercase), score in tomato red (e.g., `92%`)
   - **TMDB block** (optional): label "TMDB", score in light blue

5. **Genre chips** (optional): small grey pill chips for each genre (`flex-wrap: wrap`)

### 8.6 Status Color Bar

A `3px` bar at the very bottom of the card:
- `background: var(--watching)` (blue) for "watching"
- `background: var(--finished)` (green) for "finished"
- `background: var(--watchlist)` (purple) for "watchlist"
- No bar if no status

### 8.7 Platform Badges (shown on cards in some views)

When cards are grouped by platform (e.g., in Library view):
- Small pill badges at bottom of card showing platform names
- Up to 2 badges, then `+N more` overflow badge
- Each badge has platform-specific color (see Platform Badge Colors table)

### 8.8 Data Source for Title Cards

All title data comes from: `GET /api/titles?limit=15000&sort=rank&unique=1`

Response: array of title objects with these fields:

| Field | Type | Description |
|---|---|---|
| `title` | string | Title name |
| `platform` | string | Primary platform key (e.g., `"netflix"`) |
| `content_type` | string | `"movie"` or `"tv"` |
| `release_year` | integer | Year of release |
| `end_year` | integer or null | Year ended (null if ongoing/movie) |
| `is_ongoing` | boolean | Whether TV show is still airing |
| `imdb_score` | float or null | IMDb rating (0–10) |
| `imdb_votes` | integer or null | Number of IMDb votes |
| `tomatometer` | integer or null | Rotten Tomatoes % |
| `tmdb_score` | float or null | TMDB rating |
| `genre` | string | Comma-separated genres (e.g., `"Drama, Thriller"`) |
| `synopsis` | string | Plot synopsis |
| `maturity_rating` | string or null | e.g., `"TV-14"`, `"PG-13"` |
| `ranking_position` | integer or null | Current rank position |
| `ranking_region` | string or null | Region code for the ranking |
| `is_trending` | boolean | Whether currently trending |
| `runtime_mins` | integer or null | Runtime in minutes (movies) |
| `num_seasons` | integer or null | Number of seasons (TV) |
| `regions` | JSON string | `["US", "GB", ...]` — available regions |
| `platforms` | JSON string | `["netflix", "hulu"]` — all platforms |
| `platform_regions` | JSON string | `{platform: [regions]}` map |
| `platform_urls` | JSON string | `{platform: url}` map |
| `is_fav` | boolean | User's fav status (requires auth) |
| `status` | string or null | `"watching"`, `"finished"`, `"watchlist"`, or null |
| `notes` | string | User's personal notes |

**Poster images**: Loaded lazily on scroll. Key is `{platform}::{title_lower}`. On card render, the app checks `_tmdbShowData[key]` for a poster path; if not cached, it adds to a queue and fetches `GET /api/tmdb/search?query={title}&type={movie|tv}` to get the TMDB poster path, then constructs the full URL: `https://image.tmdb.org/t/p/w342{poster_path}`.

### 8.9 Empty State

When no titles match filters:
- Large empty icon (emoji or SVG, `48px`)
- Title: e.g., "No titles found" (21px, muted, bold)
- Subtitle: explanatory message about clearing filters

### 8.10 Full Card CSS Reference

```css
/* ── Grid wrapper ── */
.grid-wrap { padding: 24px 28px; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 14px;
}
@media (max-width: 768px) {
  .grid-wrap { padding: 12px; }
  .grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
}
@media (max-width: 480px) {
  .grid { grid-template-columns: repeat(2, 1fr); gap: 8px; }
}

/* ── Base card ── */
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer; position: relative;
  overflow: hidden;
  transition: border-color var(--transition), transform var(--transition), box-shadow var(--transition);
  animation: cardIn .3s ease both;
  -webkit-tap-highlight-color: transparent;
  outline: none;
}
@keyframes cardIn {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── Poster ── */
.card-poster {
  width: 100%; aspect-ratio: 2/3;
  overflow: hidden; background: var(--surface); position: relative;
}
.card-poster img {
  width: 100%; height: 100%; object-fit: cover;
  transition: transform .4s ease; display: block;
}
.card-poster-placeholder {
  background: linear-gradient(135deg, var(--surface) 0%, var(--card) 100%);
  color: var(--muted); font-size: 12px;
  display: flex; align-items: center; justify-content: center;
  flex-direction: column; gap: 6px; text-align: center; padding: 8px;
}

/* ── Poster overlay ── */
.card-poster-overlay {
  position: absolute; inset: 0;
  background: linear-gradient(to bottom,
    rgba(0,0,0,.5) 0%, transparent 40%,
    transparent 55%, rgba(0,0,0,.85) 100%);
  opacity: 0; transition: opacity var(--transition);
}

/* Desktop hover */
@media (hover: hover) {
  .card:hover { border-color: rgba(94,234,212,.35); transform: translateY(-3px); box-shadow: 0 12px 40px rgba(0,0,0,.5); }
  .card:hover .card-poster img          { transform: scale(1.04); }
  .card:hover .card-poster-overlay      { opacity: 1; }
  .card:hover .card-actions             { width: 68px; }
  .card:hover .action-btn               { opacity: 1; pointer-events: all; }
  .card:hover .wl-btn                   { right: 38px; }
}
/* Mobile touch */
@media (hover: none) {
  .card-actions              { width: 30px; height: 30px; }
  .action-btn                { opacity: 0.85; pointer-events: all; }
  .wl-btn                    { display: none !important; }       /* watchlist btn hidden on touch */
  .action-btn.menu-btn       { display: flex; top: 8px; right: auto; left: 8px; opacity: 0.85; }
  .card.card-tapped          { border-color: rgba(94,234,212,.35); transform: translateY(-3px); box-shadow: 0 12px 40px rgba(0,0,0,.5); }
  /* show overlay only when there's a status badge */
  .card-poster-overlay:has(.status-indicator) {
    opacity: 1;
    background: linear-gradient(to bottom, transparent 55%, rgba(0,0,0,.82) 100%);
  }
}

/* ── Action buttons ── */
.card-actions {
  position: absolute; top: 8px; right: 8px; z-index: 2;
  width: 30px; height: 30px; transition: width var(--transition);
}
.action-btn {
  width: 30px; height: 30px; border-radius: 50%;
  background: rgba(10,14,20,.92); border: 1px solid rgba(255,255,255,.25);
  font-size: 15px; backdrop-filter: blur(4px);
  opacity: 0; pointer-events: none;
  position: absolute; right: 0; top: 0;
  transition: opacity var(--transition), background var(--transition);
  display: flex; align-items: center; justify-content: center;
}
.action-btn.fav-btn.active {
  background: rgba(0,0,0,.50); border-color: var(--fav); color: var(--fav);
}
.action-btn.menu-btn { font-size: 17px; display: none; } /* shown via @media(hover:none) */

/* ── Rank badge ── */
.rank-badge {
  min-width: 28px; height: 28px; padding: 0 5px;
  background: rgba(0,0,0,.7);
  border: 1px solid rgba(94,234,212,.5);
  border-radius: 6px; font-size: 12px; font-weight: 800;
  color: var(--accent);
  display: flex; align-items: center; justify-content: center;
}
.rank-badge.top3    { color: var(--gold); border-color: rgba(212,175,55,.5); }
.rank-badge.unranked { color: var(--muted); font-size: 10px; border-color: rgba(255,255,255,.1); }

/* ── Trending dot ── */
.trending-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent); box-shadow: 0 0 6px var(--accent);
  animation: pulse 2s ease infinite;
}
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }

/* ── Status indicator badge (bottom of poster overlay) ── */
.status-indicator {
  display: inline-flex; align-items: center; gap: 5px;
  background: rgba(0,0,0,.75); padding: 4px 8px;
  border-radius: 20px; font-size: 11px; font-weight: 600;
  backdrop-filter: blur(4px); border: 1px solid rgba(255,255,255,.1);
}
.status-indicator .s-dot { width: 6px; height: 6px; border-radius: 50%; }
.status-indicator.watching  { color: var(--watching); border-color: rgba(96,165,250,.3); }
.status-indicator.watching .s-dot  { background: var(--watching); box-shadow: 0 0 6px var(--watching); }
.status-indicator.finished .s-dot  { background: var(--finished); }
.status-indicator.watchlist .s-dot { background: var(--watchlist); box-shadow: 0 0 4px var(--watchlist); }

/* ── Context menu popup ── */
.card-menu-popup {
  background: var(--card); border: 1px solid var(--border);
  border-radius: 14px; padding: 6px; min-width: 158px;
  box-shadow: 0 10px 30px rgba(0,0,0,.6); backdrop-filter: blur(10px);
}
.card-menu-item {
  display: block; width: 100%; padding: 10px 14px;
  background: transparent; border: none; border-radius: 9px;
  color: var(--muted); font-size: 14px; text-align: left; cursor: pointer;
  transition: background var(--transition), color var(--transition);
}
.card-menu-item.active { color: var(--accent); background: rgba(94,234,212,.08); font-weight: 600; }
.card-menu-item.remove { color: var(--accent2); }
.card-menu-item:hover:not(.active):not(.remove) { background: rgba(255,255,255,.04); color: var(--text); }

/* ── Card body ── */
.card-body { padding: 12px 14px 14px; }
@media (max-width: 768px) { .card-body { padding: 8px 10px 10px; } }

.card-title {
  font-size: 14px; font-weight: 700; color: var(--text);
  line-height: 1.3; margin-bottom: 5px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
@media (max-width: 768px) { .card-title { font-size: 13px; } }

/* Sub-line */
.card-sub { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.type-tag { font-size: 10px; font-weight: 600; letter-spacing: .02em; padding: 2px 7px; border-radius: 4px; }
.type-tag.movie { background: rgba(226,201,126,.12); color: var(--gold); }
.type-tag.tv    { background: rgba(94,234,212,.10);  color: var(--accent); }
.year-text      { font-size: 12px; color: var(--muted); }
.rating-tag     { font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,.06); color: var(--muted); }

/* Seasons row */
.card-seasons { font-size: 11px; color: var(--muted); margin-bottom: 8px; }
.ongoing-tag.ongoing { background: rgba(52,211,153,.12);  color: var(--finished); border: 1px solid rgba(52,211,153,.3); font-size: 10px; padding: 1px 6px; border-radius: 4px; }
.ongoing-tag.ended   { background: rgba(255,255,255,.06); color: var(--muted); border: 1px solid var(--border); font-size: 10px; padding: 1px 6px; border-radius: 4px; }

/* Scores */
.card-scores {
  display: flex; align-items: flex-start; gap: 10px;
  padding-top: 8px; border-top: 1px solid var(--border);
}
.score-label { font-size: 9px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.score-value { font-size: 15px; font-weight: 800; line-height: 1; }
.score-value.imdb { color: var(--gold); }
.score-value.rt   { color: var(--tomato); }
.score-value.tmdb { color: #4fc3f7; }
.score-votes { font-size: 10px; color: var(--muted); }

/* Genre chips */
.genre-chip {
  font-size: 10px; color: var(--muted);
  background: var(--bg); border: 1px solid var(--border);
  padding: 2px 7px; border-radius: 4px;
}

/* Status bar */
.card-status-bar { height: 3px; width: 100%; }
.card-status-bar.watching  { background: var(--watching); }
.card-status-bar.finished  { background: var(--finished); }
.card-status-bar.watchlist { background: var(--watchlist); }
```

---

## 9. Title Detail Screen

**Trigger**: Tap any title card  
**Animation**: Slides in from the right (`translateX(100%)` → 0), 320ms  
**Z-index**: 100  
**Back**: "← Back" button or Android back gesture → `closeModalDirect()`

### 9.1 Back Bar (Sticky Top)

Height: auto, `padding: 8–10px 12–24px`  
Background: semi-transparent dark with blur (or solid on mobile)

Items from left to right:
1. **← Back button**: pill-shaped, border, `"← Back"` text
2. **Crumb text**: title name (hidden on mobile to save space)
3. **Inline search box**: same search functionality as header (expands to fill available space on mobile)
4. **Logo/home button** (right-aligned): rounded rectangle, teal gradient background, `28×28px` app icon + "StreamIntel" text — tapping goes to `goHome()`

### 9.2 Hero Banner

Height: `460px` desktop / `200px` mobile (≤768px) / `160px` small phone (≤480px)

- **Backdrop image**: `object-fit: cover`, `object-position: center 20%`, brightness 0.92, saturation 1.08
  - Source: `https://image.tmdb.org/t/p/original{backdrop_path}` (from TMDB API)
  - Placeholder: `rgba(var(--surface))` background with large `🎬` emoji at 8% opacity
  - Tapping image: opens full-screen image lightbox
- **Gradient overlay**: dual gradient: right-to-left fade + bottom-to-top fade, both in `--bg` color
- **Poster thumbnail** (floating, bottom-left of hero):
  - Desktop: `150×225px` at `left: 28–36px`
  - Mobile: `80×120px` at `left: 12px`
  - Border-radius: `12px`, border: `3px solid rgba(255,255,255,.1)`, large drop shadow
  - Source: `https://image.tmdb.org/t/p/w342{poster_path}`
  - Tapping: opens lightbox

### 9.3 Title Header Section

On desktop: content starts to the right of the poster (padding-left = poster width + gap).  
On mobile: normal left padding, content starts below hero.

**Region selector** (optional, shown when title has multi-region data):
- Pill button: `"🌍 All regions ▾"` or selected region name
- Tapping opens dropdown with available regions for this title
- Data from: `title.platform_regions` object

**Platform pills** (below region selector):
- One pill per platform the title is available on
- Platform-specific colors (see Design System section)
- Includes a `28×28px` platform logo on the left of each pill
- If `platform_urls` has a URL for that platform, the pill is a link (tapping opens the streaming service)
- If no regions/platforms available: shows italic muted text "Not currently available in [region]"

**Title**: H1, Syne font
- Desktop: `36px`, `font-weight: 800`
- Mobile: `21px` (≤768px), `18px` (≤480px)

**Tagline**: italic, `16px`, muted — from TMDB `tagline` field

**Tags row** (flex wrap):
- Type badge: `"MOVIE"` or `"TV"` pill (colored by type)
- Year badge: e.g., `"2019"` or `"2019–2024"` or `"2022–"`
- Maturity rating chip: e.g., `"TV-MA"`
- Ranking badge: e.g., `"#4 US"` (if ranked)

**Show meta bar** (TV shows only):
- Ongoing/Ended badge
- Number of seasons
- Next episode info (if available from TMDB)

### 9.4 Action Buttons Row

`padding: 14–20px 16–500px` (responsive)

1. **❤️ Add to Favourites** button:
   - Pill shape, border style, muted color default
   - Active (favourited): pink text + pink border + pink tinted background
   - Tapping calls `toggleFavFromModal()`
   - API: `POST /api/library` with `{platform, title, is_fav: true/false}`

2. **Status label**: `"STATUS"` (uppercase, small, muted)

3. **Status segmented control** (3 buttons in a pill container):
   - 🔖 **Watchlist** — purple accent when active
   - ▶️ **Watching** — blue accent when active
   - ✅ **Finished** — green accent when active
   - Tapping calls `setStatusFromModal(status)` — if already that status, removes it (toggle)
   - API: `POST /api/library` with `{platform, title, status: 'watchlist'|'watching'|'finished'|null}`

### 9.5 Share Row

Shown below action buttons when the title has a fav, status, or user rating.

1. **Send to a Friend** button:
   - Teal border + teal text + teal tinted background
   - Icon: paper plane SVG
   - Tapping: opens "Share Message" compose dialog

2. **Share Status** button (shown conditionally):
   - Same style as above
   - Icon: share/nodes SVG
   - Tapping: shows status sharing flow

### 9.6 Star Rating Row

- Label: `"Your Rating"` (uppercase, small, muted)
- 5 star buttons (★), each calling `setRatingFromModal(n)` where n = 1–5
- Active stars: gold color
- `✕ Clear` button (shown when rated) → `setRatingFromModal(0)`
- API: `POST /api/ratings` with `{platform, title, rating: 1-5}` or `DELETE /api/ratings` to clear

### 9.7 Scores Row

Two score blocks side by side (stack vertically on mobile):

1. **IMDb block**:
   - IMDb logo SVG (golden star icon)
   - Label: `"IMDB RATING"` (uppercase, muted)
   - Sub-label: vote count formatted (e.g., `"1.2M votes"`) in muted
   - Large score value: `32px`, gold color, `font-weight: 800` (e.g., `"8.4"`)
   - If no score: shows `"N/A"` in muted

2. **Rotten Tomatoes block**:
   - RT tomato icon SVG
   - Label: `"TOMATOMETER"` (uppercase, muted)
   - Large score value: `32px`, tomato red color (e.g., `"92%"`)
   - If no score: shows `"N/A"`

### 9.8 Tab Bar

Three tabs below scores row:
- **Overview** (default active)
- **Cast**
- **Seasons & Episodes** (only shown for TV content — `num_seasons > 0`)

Active tab: `color: var(--accent)`, `border-bottom: 2px solid var(--accent)`

### 9.9 Overview Tab

Two-column layout (desktop), single column (mobile):

**Left column** (synopsis + info):

1. **Synopsis section**:
   - Section label: `"SYNOPSIS"` (uppercase, small, muted)
   - Synopsis text: `17px`, `line-height: 1.85`, slightly muted white
   - Source: `title.synopsis` from API or from TMDB overview

2. **Genre chips**:
   - Pill chips for each genre, muted text, surface background, border
   - Source: `title.genre` split by comma

3. **Detail table** (`.detail-table`):
   - Zebra-striped rows: key (uppercase, muted, fixed 110px width) + value
   - Rows included (if data available):
     - **Director** — from TMDB credits (first `job: "Director"`)
     - **Cast** — from TMDB credits (first 3 actors, comma-separated; linked to actor pages)
     - **Runtime** — `{X} min` or `~{X} min per episode` for TV
     - **Country** — from TMDB `production_countries`
     - **Language** — from TMDB `original_language`
     - **First Air** / **Release** — formatted date
     - **Last Air** — for ended TV shows
     - **Seasons** — `N seasons`
     - **Platform** — platform name(s)
     - **Genre** — listed genres

**Right column** (notes):

- **Personal Notes** textarea:
  - Label: `"PERSONAL NOTES"` (uppercase, muted)
  - Textarea: `min-height: 90px`, resizable, surface background
  - Placeholder: `"Your thoughts, reminders, episode notes…"`
  - Source: `title.notes` from `/api/library`
  
- **Save notes button**: pill-shaped, border style
  - Tapping: calls `saveNotes()` → `POST /api/library` with updated notes
  - `"✓ Saved"` confirmation fades in then out after save

### 9.10 Cast Tab

Grid of cast cards: `auto-fill minmax(110–150px, 1fr)`, gap `10–18px`

Each cast card (`.cast-card`):
- Tappable → opens Actor Detail Screen
- **Photo**: `aspect-ratio: 2/3`, `object-fit: cover`
  - Source: `https://image.tmdb.org/t/p/w185{profile_path}` from TMDB credits
  - Placeholder: `48px` theater mask emoji on gradient background
- **Name**: `14px`, bold, primary color
- **Character**: `13px`, muted (the character they played)
- Data from: `GET /api/tmdb/{type}/{tmdb_id}/credits`
  - Response: `{cast: [{id, name, character, profile_path, order}], crew: [...]}`
  - Show first 20 cast members sorted by `order`

### 9.11 Seasons & Episodes Tab

Visible only for TV shows.

**Toolbar** (shown when there are seasons):
- `"✓ Mark all watched"` button — marks all episodes of all seasons as watched
  - When all watched: button text changes to `"✓ All watched"` with filled teal background
  - API: `POST /api/watched/all` with `{platform, title}`

**Seasons list** (`.seasons-list`):

Each season (`.season-block`):
- **Season header** (tappable to expand/collapse):
  - Season checkbox (`.season-check`):
    - Unchecked: empty box
    - Partial: light green with partial indicator `~`
    - Watched: filled green with `✓`
    - Tapping: toggles all episodes in that season
  - Season title: `"Season 1"`, `"Season 2"`, etc.
  - Progress text: `"5/10"` (watched/total episodes) in green, right-aligned
  - Chevron icon (rotates 180° when expanded)
  
- **Episodes list** (shown when season is expanded):
  - Episodes fetched lazily: `GET /api/tmdb/{type}/{tmdb_id}/season/{season_number}`
  - Each episode row (`.episode-row`):
    - **Ep check** (`17×17px`): checkbox, watched = filled green
    - **Ep number**: `"E01"` format, muted, 24px wide
    - **Episode name**: `14px`, bold
    - **Meta row**: air date + runtime
    - **Overview**: short description, `13px`, faded text
    - Future episodes (not yet aired): 35% opacity, not checkable
    - API to toggle: `POST /api/watched` with `{platform, title, season_num, episode_num, watched: true/false}`

### 9.12 Image Lightbox

Full-screen overlay when tapping hero or poster:
- Background: `rgba(0,0,0,.92)` fullscreen
- Image: centered, `max-width: 100%`, `max-height: 100vh`, `object-fit: contain`
- Tapping anywhere closes it

### 9.13 Full Title Detail CSS Reference

```css
/* ── Detail page slide-in ── */
.detail-page {
  position: fixed; inset: 0; z-index: 100;
  background: var(--bg);
  transform: translateX(100%);
  transition: transform .32s cubic-bezier(.4,0,.2,1);
  display: flex; flex-direction: column;
  overflow: hidden; pointer-events: none;
}
.detail-page.open { transform: translateX(0); pointer-events: all; }

/* ── Back bar ── */
.detail-back-bar {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 24px;
  background: rgba(19,21,26,.96); backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  position: sticky; top: 0;
}
@media (max-width: 768px) {
  .detail-back-bar { padding: 8px 12px; gap: 8px; }
  .detail-back-crumb { display: none; }  /* hide crumb text on mobile */
  .header-logo-text-small { display: none; }
}
.detail-back-btn {
  display: flex; align-items: center; gap: 7px;
  padding: 6px 16px; border-radius: 20px;
  border: 1px solid var(--border);
  background: transparent; color: var(--muted); font-size: 14px;
  transition: all var(--transition);
}
.detail-back-btn:hover { border-color: var(--accent); color: var(--accent); }
@media (max-width: 768px) { .detail-back-btn { padding: 7px 16px; } }

/* Logo button (top-right of back bar) */
.logo-link-small {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 14px; border-radius: 12px;
  background: linear-gradient(135deg, rgba(94,234,212,.10) 0%, rgba(94,234,212,.04) 100%);
  border: 1.5px solid rgba(94,234,212,.25);
  margin-left: auto;
  transition: border-color var(--transition), box-shadow var(--transition), transform var(--transition);
}
.logo-link-small:hover {
  border-color: var(--accent);
  box-shadow: 0 0 14px rgba(94,234,212,.25);
  transform: translateY(-1px);
}

/* ── Hero banner ── */
.modal-hero {
  width: 100%; height: 460px;
  position: relative; overflow: hidden; background: var(--surface);
}
.modal-hero img {
  width: 100%; height: 100%; object-fit: cover;
  object-position: center 20%;
  filter: brightness(.92) saturate(1.08);
}
.modal-hero-overlay {
  position: absolute; inset: 0;
  background:
    linear-gradient(to right, rgba(19,21,26,.92) 0%, rgba(19,21,26,.55) 35%, rgba(19,21,26,.1) 62%, transparent 100%),
    linear-gradient(to bottom, transparent 30%, rgba(19,21,26,.55) 72%, var(--bg) 100%);
}
/* Poster floating in hero */
.modal-hero-poster {
  position: absolute; bottom: -10px; left: 500px;
  width: 150px; height: 225px;
  border-radius: 12px;
  border: 3px solid rgba(255,255,255,.1);
  box-shadow: 0 20px 60px rgba(0,0,0,.8);
}
@media (max-width: 768px) {
  .modal-hero { height: 200px; min-height: 200px; }
  .modal-hero img { object-position: center center; filter: brightness(.88) saturate(1.05); }
  .modal-hero-poster { left: 12px; width: 80px; height: 120px; bottom: -8px; }
}
@media (max-width: 480px) {
  .modal-hero { height: 160px; min-height: 160px; }
  .modal-hero img { object-position: center top; }
  .modal-hero-poster { width: 79px; height: 115px; left: 16px; bottom: -12px; }
}

/* ── Header section (title, tags, meta) ── */
.modal-header { padding: 16px 48px 0 500px; }
@media (max-width: 768px) { .modal-header { padding: 12px 16px 0 14px; min-height: 60px; } }
@media (max-width: 480px) { .modal-header { padding: 10px 14px 0 16px; } }

.modal-title { font-size: 36px; font-weight: 800; line-height: 1.15; margin-bottom: 10px; }
.modal-tagline { font-size: 16px; color: var(--muted); font-style: italic; margin-bottom: 10px; line-height: 1.5; }
.modal-tags { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
.show-meta { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; font-size: 14px; color: var(--muted); }
.badge-ongoing { font-size: 12px; font-weight: 700; padding: 3px 11px; border-radius: 20px; background: rgba(52,211,153,.15); color: var(--finished); border: 1px solid rgba(52,211,153,.3); }
.badge-ended   { font-size: 12px; font-weight: 700; padding: 3px 11px; border-radius: 20px; background: rgba(107,117,133,.1); color: var(--muted); border: 1px solid var(--border); }
@media (max-width: 768px) {
  .modal-title   { font-size: 21px; margin-bottom: 6px; }
  .modal-tagline { font-size: 14px; }
  .show-meta     { font-size: 13px; gap: 8px; }
}
@media (max-width: 480px) { .modal-title { font-size: 18px; } }

/* Platform pills */
.modal-platform-pill {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 14px; border-radius: 20px;
  font-size: 13px; font-weight: 600;
  border: 1px solid;
}
.modal-platform-pill .plat-logo { width: 30px; height: 30px; border-radius: 6px; }
/* Platform-specific colors */
.modal-platform-pill.netflix        { background: rgba(229,9,20,.16);    color: #ff4040;  border-color: rgba(229,9,20,.45); }
.modal-platform-pill.disney_plus    { background: rgba(17,60,207,.16);   color: #6b9aff;  border-color: rgba(17,60,207,.45); }
.modal-platform-pill.hbo_max        { background: rgba(106,35,226,.16);  color: #bf93ff;  border-color: rgba(106,35,226,.45); }
.modal-platform-pill.apple_tv       { background: rgba(255,255,255,.08); color: #d1d5db;  border-color: rgba(255,255,255,.22); }
.modal-platform-pill.prime_video    { background: rgba(0,168,225,.16);   color: #38c8f8;  border-color: rgba(0,168,225,.45); }
.modal-platform-pill.hulu           { background: rgba(28,231,131,.13);  color: #1ce783;  border-color: rgba(28,231,131,.42); }
.modal-platform-pill.peacock        { background: rgba(248,190,0,.13);   color: #f8be00;  border-color: rgba(248,190,0,.42); }
.modal-platform-pill.paramount_plus { background: rgba(0,100,255,.16);   color: #6b9aff;  border-color: rgba(0,100,255,.45); }

/* ── Action buttons row ── */
.modal-actions {
  display: flex; gap: 20px; flex-wrap: wrap; align-items: center;
  padding: 20px 500px;
}
@media (max-width: 768px) { .modal-actions { padding: 14px 16px; gap: 14px; flex-wrap: wrap; } }

.modal-fav-btn {
  padding: 9px 20px; border-radius: 20px;
  border: 1px solid var(--border); background: transparent;
  color: var(--muted); font-size: 14px; font-weight: 600; cursor: pointer;
  transition: all var(--transition);
}
.modal-fav-btn.active { border-color: var(--fav); color: var(--fav); background: rgba(244,114,182,.12); }
@media (hover: hover) { .modal-fav-btn:hover { border-color: var(--fav); color: var(--fav); } }
@media (max-width: 768px) { .modal-fav-btn { padding: 7px 14px; font-size: 13px; } }

/* Status segmented control */
.status-btn-group {
  display: flex; flex: 1; border-radius: 22px;
  border: 1px solid var(--border); overflow: hidden;
}
.status-btn-lg {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  flex: 1; padding: 9px 14px;
  border: none; border-right: 1px solid var(--border);
  background: transparent; color: var(--muted);
  font-size: 14px; cursor: pointer;
  transition: all var(--transition);
}
.status-btn-lg:last-child { border-right: none; }
.status-btn-lg.active-watchlist { color: var(--watchlist); background: rgba(167,139,250,.25); }
.status-btn-lg.active-watching  { color: var(--watching);  background: rgba(96,165,250,.25); }
.status-btn-lg.active-finished  { color: var(--finished);  background: rgba(52,211,153,.25); }
@media (max-width: 768px) { .status-btn-lg { padding: 8px 10px; font-size: 13px; } }
@media (max-width: 380px) { .status-btn-lbl { display: none; } .status-btn-lg { padding: 10px 12px; } }

/* Share row */
.modal-share-row { padding: 0 500px 20px; display: flex; gap: 10px; flex-wrap: wrap; }
@media (max-width: 768px) { .modal-share-row { padding: 0 16px 14px; } }
.modal-share-msg-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 18px; border-radius: 20px;
  border: 1px solid rgba(94,234,212,.4); background: rgba(94,234,212,.06);
  color: var(--accent); font-size: 13px; font-weight: 600; cursor: pointer;
  transition: background var(--transition), border-color var(--transition);
}
.modal-share-msg-btn:hover { background: rgba(94,234,212,.14); border-color: var(--accent); }
@media (max-width: 768px) { .modal-share-msg-btn { font-size: 12px; padding: 7px 14px; } }

/* ── Scores row ── */
.modal-scores {
  display: flex; flex-direction: row; gap: 12px;
  padding: 12px 500px 4px; flex-wrap: nowrap;
}
@media (max-width: 768px) { .modal-scores { padding: 8px 12px 2px; gap: 8px; } }
.modal-score-block {
  display: flex; align-items: center; gap: 14px;
  flex: 1; padding: 12px 16px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); min-width: 0;
}
.modal-score-value { font-size: 32px; font-weight: 800; line-height: 1; margin-left: auto; }
.modal-score-label { font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.modal-score-sub   { font-size: 12px; color: var(--muted); margin-top: 2px; white-space: nowrap; }
/* Mobile: stack vertically */
@media (max-width: 768px) {
  .modal-score-block  { flex-direction: column; align-items: flex-start; padding: 12px 10px; gap: 2px; }
  .modal-score-icon-svg { width: 20px; height: 20px; margin-bottom: 4px; }
  .modal-score-sub    { white-space: normal; }
  .modal-score-value  { font-size: 26px; margin-left: 0; margin-top: 2px; }
}

/* ── Tab bar ── */
.modal-tabs {
  display: flex; border-bottom: 1px solid var(--border);
  padding: 0 500px; margin-top: 20px; flex-shrink: 0;
}
@media (max-width: 768px) {
  .modal-tabs { padding: 0 8px; overflow-x: auto; scrollbar-width: none; flex-shrink: 0; }
  .modal-tabs::-webkit-scrollbar { display: none; }
}
.modal-tab {
  padding: 11px 20px; font-size: 14px; font-weight: 600;
  color: var(--muted); border: none; border-bottom: 2px solid transparent;
  background: transparent; cursor: pointer; white-space: nowrap;
  transition: color var(--transition), border-color var(--transition);
}
.modal-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.modal-tab:hover  { color: var(--text); }
@media (max-width: 768px) { .modal-tab { padding: 10px 14px; font-size: 13px; } }

/* ── Tab panels ── */
.modal-body  { flex: 1; }
.modal-panel { display: none; padding: 36px 500px 60px; }
.modal-panel.active { display: block; }
@media (max-width: 768px) { .modal-panel { padding: 20px 16px 40px; } }

/* ── Overview tab: two-column layout ── */
.overview-layout { display: grid; grid-template-columns: 1fr 340px; gap: 40px; align-items: start; }
@media (max-width: 900px) { .overview-layout { grid-template-columns: 1fr; } }
@media (max-width: 768px) { .overview-layout { grid-template-columns: 1fr; gap: 24px; } }

.section-label { font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); margin-bottom: 10px; }
.synopsis-text { font-size: 17px; line-height: 1.85; color: rgba(212,216,224,.85); margin-bottom: 28px; }

/* Detail table */
.detail-table { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; margin-bottom: 28px; }
.detail-row { display: flex; align-items: baseline; gap: 16px; padding: 11px 16px; border-bottom: 1px solid var(--border); }
.detail-row:last-child { border-bottom: none; }
.detail-row:nth-child(even) { background: rgba(255,255,255,.018); }
.detail-key { font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); width: 110px; flex-shrink: 0; }
.detail-val { font-size: 15px; color: var(--text); line-height: 1.5; }
.detail-val a { color: var(--accent); text-decoration: none; }
.detail-val a:hover { text-decoration: underline; }

/* Notes textarea */
.notes-input {
  width: 100%; padding: 12px 14px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--text);
  font-family: var(--font-body); font-size: 15px;
  resize: vertical; min-height: 90px;
  outline: none; transition: border-color var(--transition);
}
.notes-input:focus { border-color: var(--accent); }
.notes-save-btn {
  margin-top: 10px; padding: 8px 20px; border-radius: 20px;
  border: 1px solid var(--border); background: transparent;
  color: var(--muted); font-size: 14px; cursor: pointer;
  transition: all var(--transition);
}
.notes-save-btn:hover { border-color: var(--accent); color: var(--accent); }

/* ── Cast grid ── */
.cast-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 18px;
}
@media (max-width: 768px) {
  .cast-grid { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px; }
}
.cast-card {
  cursor: pointer; border-radius: var(--radius); overflow: hidden;
  background: var(--surface); border: 1px solid var(--border);
  transition: border-color var(--transition), transform var(--transition), box-shadow var(--transition);
}
.cast-card:hover { border-color: rgba(94,234,212,.4); transform: translateY(-3px); box-shadow: 0 10px 30px rgba(0,0,0,.4); }
.cast-photo { width: 100%; aspect-ratio: 2/3; object-fit: cover; display: block; }
.cast-photo-ph { width: 100%; aspect-ratio: 2/3; display: flex; align-items: center; justify-content: center; font-size: 48px; background: linear-gradient(135deg, var(--surface), var(--bg)); color: var(--muted); }
.cast-info  { padding: 10px 12px 12px; }
.cast-name  { font-size: 14px; font-weight: 700; line-height: 1.3; margin-bottom: 3px; }
.cast-role  { font-size: 13px; color: var(--muted); line-height: 1.4; }

/* ── Seasons & Episodes ── */
.seasons-toolbar { display: flex; align-items: center; padding: 12px 0 14px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
.seasons-toggle-all-btn {
  padding: 8px 18px; background: transparent;
  border: 1px solid var(--accent); border-radius: var(--radius);
  color: var(--accent); font-size: 13px; font-weight: 600;
  cursor: pointer; transition: background var(--transition);
}
.seasons-toggle-all-btn:hover { background: rgba(94,234,212,.1); }
.seasons-list { display: flex; flex-direction: column; gap: 8px; }
.season-block { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.season-header {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 14px; cursor: pointer; user-select: none;
  transition: background var(--transition);
}
.season-header:hover { background: rgba(255,255,255,.025); }
@media (max-width: 768px) { .season-header { padding: 10px 12px; } }
.season-check {
  width: 20px; height: 20px; border-radius: 5px;
  border: 1px solid var(--border); background: var(--card);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; flex-shrink: 0; transition: all var(--transition);
}
.season-check.watched { background: var(--finished); border-color: var(--finished); color: #071a10; }
.season-check.partial { background: rgba(52,211,153,.18); border-color: var(--finished); color: var(--finished); }
.season-title    { font-size: 14px; font-weight: 700; color: var(--text); flex: 1; }
.season-progress { font-size: 12px; font-weight: 600; color: var(--finished); margin-left: auto; white-space: nowrap; }
.season-chevron  { font-size: 11px; color: var(--muted); transition: transform var(--transition); flex-shrink: 0; }
.season-block.open .season-chevron { transform: rotate(180deg); }
.episodes-list { border-top: 1px solid var(--border); }
.episode-row {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 14px; border-bottom: 1px solid rgba(42,47,58,.5);
  transition: background var(--transition);
}
.episode-row:last-child { border-bottom: none; }
.episode-row:hover { background: rgba(255,255,255,.02); }
@media (max-width: 768px) { .episode-row { padding: 8px 10px; } }
.ep-check {
  width: 17px; height: 17px; border-radius: 4px;
  border: 1px solid var(--border); background: var(--card);
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; flex-shrink: 0; margin-top: 2px; cursor: pointer;
  transition: all var(--transition);
}
.ep-check.watched    { background: var(--finished); border-color: var(--finished); color: #071a10; }
.ep-check.ep-future  { opacity: 0.35; cursor: not-allowed; }
.ep-num     { font-size: 12px; color: var(--muted); width: 24px; flex-shrink: 0; margin-top: 3px; text-align: right; }
.ep-name    { font-size: 14px; font-weight: 600; color: var(--text); margin-bottom: 2px; line-height: 1.3; }
.ep-meta    { font-size: 12px; color: var(--muted); display: flex; gap: 10px; }
.ep-overview { font-size: 13px; color: rgba(212,216,224,.55); margin-top: 4px; line-height: 1.5; }
```

**Trigger**: Tap any cast card in the Cast tab  
**Animation**: Same slide-from-right as title detail  
**Z-index**: 450 (above title detail at 100)  
**Back**: "← Back" → `closeActorModalDirect()`

### 10.1 Loading State

While actor data is fetching, a branded loader screen is shown (same animation as global loader but fills the screen):
- StreamIntel logo icon with pulsing signal arcs animation
- "Stream" / "Intel" wordmark
- "Loading profile…" blinking text

### 10.2 Back Bar

Same structure as Title Detail back bar (Back button + crumb + search + logo button).

### 10.3 Actor Content Layout

On desktop: Two columns (`260px photo + remaining details`)  
On mobile: Single column, photo centered with max-width `180px`

**Photo column** (sticky on desktop):
- Portrait photo: `aspect-ratio: 2/3`, `border-radius: 14px`, large drop shadow
- Source: `https://image.tmdb.org/t/p/w342{profile_path}` from TMDB person API
- Placeholder: large `🎭` emoji on gradient background
- If tapping: opens lightbox

**Details column**:

1. **Actor/Director name**: `32px` Syne, `font-weight: 800` (mobile: `24px`)
2. **Character** (if opened from a title's cast): teal color, `16px`, bold
3. **Meta table** (same style as title detail table):
   - Known For
   - Birthday
   - Birthplace
   - Deathday (if applicable)
4. **Biography** section:
   - Section label: `"BIOGRAPHY"` (small, muted, uppercase)
   - Biography text: `16px`, `line-height: 1.9`, slightly muted
   - Long bios: truncated with `"...show more"` link that expands
   - Source: TMDB person API `biography` field
5. **Filmography** section:
   - Section label: `"FILMOGRAPHY"` (small, muted, uppercase)
   - Bordered list of films/shows
   - Each row:
     - `42×63px` poster thumbnail (with link to title detail)
     - Title (bold, tappable → opens that title's detail)
     - Sub-row: year + `MOVIE`/`TV` type badge
     - Character name (italic, muted) — only if this person was cast
     - IMDb + RT scores on right (hidden on mobile)
   - If many items: `"See all →"` button at bottom
   - Data from: `GET /api/tmdb/person/{tmdb_person_id}?append_to_response=combined_credits`

### 10.4 Data Source

All data from: `GET /api/tmdb/person/{person_id}?append_to_response=combined_credits,external_ids`

The `person_id` is obtained from the TMDB cast entry when tapping a cast card.

### 10.5 Actor Detail CSS Reference

```css
/* ── Actor overlay (slides in from right, above title detail) ── */
.actor-overlay {
  position: fixed; inset: 0; z-index: 450;
  background: var(--bg);
  transform: translateX(100%);
  transition: transform .32s cubic-bezier(.4,0,.2,1);
  display: flex; flex-direction: column; overflow: hidden;
  pointer-events: none;
}
.actor-overlay.open { transform: translateX(0); pointer-events: all; }

/* ── Back bar ── */
.actor-back-bar {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 24px;
  background: rgba(19,21,26,.96); backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
@media (max-width: 768px) {
  .actor-back-bar { padding: 8px 12px; gap: 8px; }
  .actor-back-crumb { display: none; }     /* hide breadcrumb on mobile */
}

/* ── Scrollable content ── */
.actor-scroll { flex: 1; overflow-y: auto; overscroll-behavior: contain; }

/* ── Two-column content grid ── */
.actor-content {
  max-width: 1000px; margin: 0 auto;
  padding: 48px;
  display: grid; grid-template-columns: 260px 1fr;
  gap: 52px; align-items: start;
}
@media (max-width: 768px) {
  .actor-content { padding: 20px 16px 40px; grid-template-columns: 1fr; gap: 24px; }
}

/* ── Photo column ── */
.actor-photo-col { position: sticky; top: 20px; }
.actor-photo-col img {
  width: 100%; border-radius: 14px;
  box-shadow: 0 20px 60px rgba(0,0,0,.7);
}
@media (max-width: 768px) {
  .actor-photo-col { position: static; }
  .actor-photo-col img { max-width: 180px; margin: 0 auto; display: block; }
}

/* ── Name + character ── */
.actor-name { font-size: 32px; font-weight: 800; margin-bottom: 6px; line-height: 1.1; }
@media (max-width: 768px) { .actor-name { font-size: 24px; } }
.actor-character { font-size: 16px; color: var(--accent); margin-bottom: 24px; font-weight: 600; }

/* ── Biography ── */
.actor-bio {
  font-size: 16px; line-height: 1.9;
  color: rgba(212,216,224,.85); margin-bottom: 32px;
}
.bio-toggle {
  background: none; border: none; padding: 0;
  color: var(--accent); font-size: 15px;
  text-decoration: underline; cursor: pointer;
}

/* ── Filmography list ── */
.filmography-list {
  display: flex; flex-direction: column;
  border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden;
}
.filmography-row {
  display: flex; align-items: center; gap: 16px;
  padding: 10px 14px; border-bottom: 1px solid var(--border);
  transition: background var(--transition);
}
.filmography-row:nth-child(even) { background: rgba(255,255,255,.015); }
.filmography-row:hover            { background: rgba(94,234,212,.05); }

.filmography-thumb {
  width: 42px; height: 63px; border-radius: 6px; overflow: hidden;
  flex-shrink: 0; background: var(--surface);
  border: 1px solid var(--border); cursor: pointer;
  object-fit: cover;
}
.filmography-thumb:hover { opacity: .8; }

.filmography-title {
  font-size: 15px; font-weight: 700; color: var(--text);
  cursor: pointer; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
  transition: color var(--transition);
}
.filmography-title:hover { color: var(--accent); }

.filmography-type {
  font-size: 11px; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; border-radius: 4px; padding: 2px 7px;
}
.filmography-type.movie { background: rgba(226,201,126,.12); color: var(--gold); }
.filmography-type.tv    { background: rgba(94,234,212,.1);   color: var(--accent); }

.filmography-character { font-size: 13px; color: var(--muted); font-style: italic; }

/* Scores column — hidden on mobile */
.filmography-scores {
  display: flex; flex-direction: column; align-items: flex-end;
  gap: 5px; min-width: 60px; margin-left: auto;
}
@media (max-width: 768px) {
  .filmography-scores { display: none; }
  .filmography-thumb  { width: 36px; height: 54px; }
}

/* "See all" footer row */
.filmography-see-all {
  display: flex; align-items: center; justify-content: center;
  width: 100%; padding: 14px;
  background: rgba(94,234,212,.04); color: var(--accent);
  font-size: 14px; font-weight: 600;
  border-top: 1px solid var(--border); cursor: pointer;
  transition: background var(--transition);
}
.filmography-see-all:hover { background: rgba(94,234,212,.11); }

/* ── Actor branded loader ── */
@keyframes logo-pulse   { 0%,100%{opacity:.55} 50%{opacity:1} }
@keyframes signal-pulse { 0%,100%{opacity:.18} 50%{opacity:1} }
/* Signal arcs staggered: arc-1 delay 0ms, arc-2 delay .28s, arc-3 delay .56s, dot .14s */
@keyframes label-blink  { 0%,100%{opacity:.4} 55%{opacity:.9} }

.actor-loader {
  position: absolute; inset: 0; z-index: 10;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg);
  transition: opacity .28s ease;
}
.actor-loader.hidden { opacity: 0; visibility: hidden; pointer-events: none; }
.actor-loader-title {
  font-family: var(--font-head); font-size: 23px; font-weight: 800; color: var(--text);
}
.actor-loader-sub {
  font-family: var(--font-body); font-size: 12px;
  letter-spacing: .22em; text-transform: uppercase; color: var(--muted);
}
.actor-loader-label {
  font-size: 13px; color: var(--muted);
  animation: label-blink 1.8s ease-in-out infinite;
}
```

---

## 11. For You Panel

**Trigger**: Tab `"✨ For You"` or nav drawer item  
**Container**: `#forYouPanel` replaces main grid  
**Back**: tap another tab or nav item

### 11.1 Layout

Vertical scrolling container (`.discover-wrap`, `padding: 16–28px`):
- Multiple discovery "sections", each with a title and a horizontal/grid row of title cards

### 11.2 Section Structure

Each section:
- **Section title bar**: `"SECTION NAME ─────────"` (uppercase, teal accent, decorative horizontal line fills remaining width)
- **Card row**: `auto-fill minmax(160px, 1fr)` grid, `2fr` columns on mobile
- **"See more →"** button at bottom of section row
  - Tapping opens `#forYouDetailOverlay` full screen with all titles in that section

### 11.3 Section Types

Generated server-side based on the user's library. Typical sections:
- Based on genres you like
- More from platforms you use
- Titles similar to recent watches
- Highly rated you haven't seen

### 11.4 Data Source

`GET /api/foryou` — returns sections array:
```json
[
  {
    "title": "Because you watch Drama",
    "key": "genre_drama",
    "titles": [/* array of title objects */]
  }
]
```

Title objects have the same shape as `/api/titles` response.

### 11.5 Section Detail Overlay

When tapping "See more →":
- `#forYouDetailOverlay` slides in from right
- Back bar with crumb title + Back button
- Grid of all titles in that section

### 11.6 For You / Discover CSS Reference

```css
/* ── Shared discover / for-you layout ── */
.discover-wrap {
  padding: 28px;
  display: flex; flex-direction: column; gap: 48px;
}

/* Section title bar */
.discover-section-title {
  font-family: var(--font-head); font-size: 13px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase; color: var(--accent);
  margin-bottom: 16px; display: flex; align-items: center; gap: 10px;
}
/* Decorative horizontal rule that fills remaining width */
.discover-section-title::after {
  content: ''; flex: 1; height: 1px; background: var(--border);
}

/* Card row within each section */
.discover-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 14px;
}

/* "See more →" button */
.foryou-see-more {
  display: inline-flex; align-items: center; gap: 6px;
  margin-top: 12px; padding: 8px 18px;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: transparent; color: var(--accent);
  font-family: var(--font-body); font-size: 13px; font-weight: 600;
  cursor: pointer;
  transition: background var(--transition), border-color var(--transition);
}
.foryou-see-more:hover { background: rgba(94,234,212,.08); border-color: var(--accent); }

/* Full-page detail grid behind "See more" */
.foryou-detail-grid {
  padding: 24px;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 14px;
}
```

---

## 12. Discover Panel

**Trigger**: Tab `"🧭 Discover"` or nav drawer item  
**Container**: `#discoverPanel`

### 12.1 Structure

Same layout as For You panel but with predefined discovery sections:
- **Top Rated** — sorted by `imdb_score` descending
- **Latest Releases** — sorted by `release_year` descending
- **New on [Platform]** — grouped by platform, recently added
- **Hidden Gems** — low ranking_position but high imdb_score
- etc. (server-generated)

### 12.2 Rank Badge on Cards

Cards in Discover panel show a rank overlay badge (`.discover-rank-badge`, `position: absolute`, top-left):
- Dark background, border
- Rank number in muted color
- Top-3: gold color + gold border

### 12.3 Data Source

`GET /api/discover` — returns sections array (same structure as `/api/foryou`)

### 12.4 Discover CSS Reference

```css
/* Rank badge — overlaid on top-left of each card poster */
.discover-rank-badge {
  position: absolute; top: 8px; left: 8px; z-index: 2;
  min-width: 28px; height: 28px; padding: 0 6px;
  background: rgba(0,0,0,.78);
  border: 1px solid rgba(255,255,255,.15); border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 800; color: var(--muted); line-height: 1;
  pointer-events: none;
}
/* Top-3 rank: gold color + gold border */
.discover-rank-badge.top3 {
  color: var(--gold);
  border-color: rgba(212,175,55,.4);
}
```

> Section layout (`.discover-wrap`, `.discover-section-title::after`, `.discover-row`, `.foryou-see-more`) is shared with the For You panel — see **Section 11.6**.

---

## 13. Upcoming Panel

**Trigger**: Tab `"📅 Upcoming"` or nav drawer item  
**Container**: `#upcomingPanel > .upcoming-wrap`

### 13.1 Structure

Chronological list of upcoming releases:
- Grouped by date (or timeframe: "This Week", "This Month", "Later")
- Each title shows:
  - Poster thumbnail
  - Title name
  - Expected release/air date
  - Platform
  - Type badge (Movie/TV)

### 13.2 Data Source

`GET /api/upcoming` (or derived from TMDB data already in the database + scheduled scrapes)  
Titles where `release_year` matches current/near future or `next_episode_date` is upcoming.

### 13.3 Upcoming Panel CSS Reference

```css
/* ── Upcoming panel container ── */
.upcoming-wrap { padding: 28px; max-width: 900px; margin: 0 auto; }

/* Section group (one per day / timeframe) */
.upcoming-group { margin-bottom: 32px; }

/* Day label pill ("This Week", "Today", etc.) */
.upcoming-day-pill {
  display: inline-block; background: var(--surface);
  border: 1px solid var(--border); border-radius: 20px;
  padding: 4px 16px; font-size: 12px; font-weight: 700;
  letter-spacing: .12em; text-transform: uppercase; color: var(--muted);
  margin-bottom: 12px;
}
/* Special states */
.upcoming-day-pill.upc-pill-today {
  color: var(--accent); border-color: rgba(94,234,212,.35);
  background: rgba(94,234,212,.07);
}
.upcoming-day-pill.upc-pill-tomorrow {
  color: var(--watching); border-color: rgba(96,165,250,.35);
  background: rgba(96,165,250,.07);
}

.upcoming-list { display: flex; flex-direction: column; gap: 10px; }

/* ── Individual upcoming-episode card ── */
.upcoming-ep-card {
  display: flex; align-items: stretch;
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius); overflow: hidden; cursor: pointer;
  transition: border-color var(--transition), transform var(--transition), box-shadow var(--transition);
}
.upcoming-ep-card:hover {
  border-color: rgba(94,234,212,.4); transform: translateX(4px);
  box-shadow: 0 4px 20px rgba(0,0,0,.35);
}

/* Poster thumbnail — left side */
.upc-thumb {
  width: 72px; flex-shrink: 0; background: var(--surface); overflow: hidden;
}
.upc-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.upc-thumb-ph {
  width: 100%; height: 100%; min-height: 90px;
  display: flex; align-items: center; justify-content: center; font-size: 26px;
}

/* Info column — center */
.upc-info {
  flex: 1; padding: 12px 16px; min-width: 0;
  display: flex; flex-direction: column; gap: 4px;
}

/* Show status pill */
.upc-show-pill {
  display: inline-flex; align-items: center; gap: 5px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 20px; padding: 3px 10px;
  font-size: 12px; font-weight: 700; color: var(--muted);
  max-width: max-content; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
  transition: border-color var(--transition);
}
.upc-show-pill.watching { color: var(--watching); border-color: rgba(96,165,250,.35); }
.upc-show-pill.finished { color: var(--finished); border-color: rgba(52,211,153,.35); }
.upc-show-pill.fav      { color: var(--fav);      border-color: rgba(244,114,182,.35); }

/* Episode label e.g. "S3 E8" */
.upc-ep-label { font-size: 20px; font-weight: 800; color: var(--text); line-height: 1.1; }
.upc-ep-name  { font-size: 13px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.upc-ep-overview {
  font-size: 12px; color: var(--muted); line-height: 1.45; margin-top: 3px;
  overflow: hidden; display: -webkit-box;
  -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
}

/* Date column — right side */
.upc-date {
  flex-shrink: 0; padding: 12px 16px;
  border-left: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 600; color: var(--muted);
  white-space: nowrap; text-align: center;
}
.upc-date.upc-date-today    { color: var(--accent);   font-weight: 800; }
.upc-date.upc-date-tomorrow { color: var(--watching); font-weight: 700; }

/* Mobile overrides */
@media (max-width: 768px) {
  .upcoming-wrap   { padding: 16px; }
  .upc-ep-label    { font-size: 17px; }
  .upc-thumb       { width: 60px; }
  .upc-info        { padding: 10px 12px; }
  .upc-date        { padding: 10px 12px; font-size: 12px; }
}
```

---

## 14. Actors & Directors Panel

**Trigger**: Tab `"🎭 Actors"` or nav drawer item  
**Container**: `#actorsPanel`

### 14.1 Toolbar

1. **Search input**:
   - Placeholder: `"Search actors, directors…"`
   - Left icon: `⌕`
   - Right: `×` clear button (hidden when empty)
   - On input: calls `actorPanelSearch(value)`

2. **Category toggle tabs**:
   - `"🔥 Trending"` — actors/directors trending in current content
   - `"⭐ Popular"` — most popular overall
   - Active tab: filled teal background pill style
   - Calling `setActorCategory('trending'|'popular', el)`

### 14.2 Actors Grid

`.actors-grid` — same card grid layout as title cards but for people:
- `auto-fill minmax(160px, 1fr)` (approximately)
- Each card shows:
  - Profile photo (portrait 2:3)
  - Name
  - Known for (role type)
  - Known for title (most notable work)
- Tapping opens Actor Detail Screen

### 14.3 "Load More" Button

Pagination button below grid:
- `"Load more"` pill button, shown when there are more results
- Calls `actorPanelLoadMore()`

### 14.4 Data Source

`GET /api/tmdb/trending/person/week` for trending  
`GET /api/tmdb/person/popular?page={n}` for popular  
Each person: `{id, name, profile_path, known_for_department, known_for: [{title|name, ...}]}`

### 14.5 Actors Panel CSS Reference

```css
/* ── Actors panel wrapper ── */
.actors-panel-wrap {
  padding: 24px; display: flex; flex-direction: column; gap: 16px;
}

/* Toolbar row */
.actors-panel-toolbar {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
}
.actors-search-wrap {
  flex: 1; max-width: 360px; position: relative;
}
.actors-search-input {
  width: 100%; padding: 8px 36px 8px 36px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 20px; color: var(--text); font-family: var(--font-body); font-size: 14px;
  outline: none; transition: border-color var(--transition);
}
.actors-search-input:focus { border-color: rgba(94,234,212,.5); }

/* Category toggle pills */
.actors-cat-btn {
  padding: 7px 18px; border-radius: 20px;
  border: 1px solid var(--border); background: transparent;
  color: var(--muted); font-family: var(--font-body); font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all var(--transition);
}
.actors-cat-btn.active { background: var(--accent); border-color: var(--accent); color: #0f1923; }
.actors-cat-btn:not(.active):hover { border-color: rgba(94,234,212,.4); color: var(--text); }

/* ── Actor cards grid ── */
.actors-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 20px;
}
@media (max-width: 600px) {
  .actors-panel-wrap  { padding: 16px; }
  .actors-panel-toolbar { gap: 10px; }
  .actors-search-wrap { max-width: 100%; }
  .actors-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 14px; }
}

/* Actor card */
.actor-card {
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius); overflow: hidden; cursor: pointer;
  transition: border-color var(--transition), transform var(--transition);
  display: flex; flex-direction: column;
}
.actor-card:hover { border-color: rgba(94,234,212,.35); transform: translateY(-3px); }

/* Portrait photo area (2:3 ratio) */
.actor-card-photo {
  width: 100%; aspect-ratio: 2/3;
  background: rgba(255,255,255,.06);
  display: flex; align-items: center; justify-content: center; font-size: 42px;
  overflow: hidden; position: relative;
}
.actor-card-photo img { width: 100%; height: 100%; object-fit: cover; display: block; }

/* Info section below portrait */
.actor-card-info { padding: 10px 12px 12px; flex: 1; }
.actor-card-name {
  font-size: 14px; font-weight: 700; color: var(--text); line-height: 1.3;
  margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.actor-card-dept { font-size: 11px; color: var(--accent); font-weight: 600; margin-bottom: 5px; }
.actor-card-known {
  font-size: 11px; color: var(--muted); line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2;
  -webkit-box-orient: vertical; overflow: hidden;
}

/* Empty / loading states */
.actors-loading, .actors-no-results {
  grid-column: 1 / -1; padding: 60px 0; text-align: center;
  color: var(--muted); font-size: 14px;
}
.actors-loading .spinner { width: 30px; height: 30px; border-width: 3px; display: inline-block; margin-bottom: 12px; }

/* "Load more" pagination button */
.actors-load-more { text-align: center; margin-top: 32px; }
.actors-load-more-btn {
  padding: 10px 32px; border-radius: 24px;
  border: 1px solid var(--border); background: transparent;
  color: var(--text); font-family: var(--font-body); font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all var(--transition);
}
.actors-load-more-btn:hover { border-color: var(--accent); color: var(--accent); }
```

---

## 15. Stats Panel (Admin only)

**Trigger**: Tab `"📊 Stats"` (hidden for non-admin users)  
**Container**: `#statsPanel`  
**Visibility**: Only shown if `user.is_admin === true`

### 15.1 Layout

Responsive grid of stat cards (`.stats-panel-wrap`): `auto-fill minmax(300px, 1fr)`

### 15.2 Stat Card Types

Each stat card (`.stat-card`):
- Card title: small uppercase muted label

**Big number card**:
- Large number: `48px`, teal, bold
- Sub-label: muted description

**Bar chart card**:
- List of bars with label + value + fill bar (4px height, teal fill)

**Top list card**:
- Numbered list: rank number + title + score (gold)
- Each row tappable → opens that title's detail

### 15.3 Data Source

`GET /api/admin/stats` — returns:
- Total titles count
- Total users count  
- Top rated titles
- Most popular platforms
- Most common genres
- etc.

### 15.4 Stats Panel CSS Reference

```css
/* ── Stats panel grid ── */
.stats-panel-wrap {
  padding: 28px;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px;
}

/* Each stat card */
.stat-card {
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 20px 22px;
}
/* Card title — small uppercase muted label */
.stat-card-title {
  font-size: 11px; font-weight: 700; letter-spacing: .14em;
  text-transform: uppercase; color: var(--muted); margin-bottom: 16px;
}

/* ── Big number card ── */
.stat-big { font-size: 48px; font-weight: 800; line-height: 1; color: var(--accent); }
.stat-sub { font-size: 13px; color: var(--muted); margin-top: 6px; }

/* ── Bar chart card ── */
.stat-bar-list  { display: flex; flex-direction: column; gap: 10px; }
.stat-bar-row   { display: flex; flex-direction: column; gap: 4px; }
.stat-bar-label { display: flex; justify-content: space-between; font-size: 13px; color: var(--text); }
.stat-bar-val   { font-size: 12px; color: var(--muted); }
.stat-bar-track { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
.stat-bar-fill  { height: 100%; border-radius: 2px; transition: width .6s cubic-bezier(.4,0,.2,1); }

/* ── Top list card ── */
.stat-top-list { display: flex; flex-direction: column; gap: 8px; }
.stat-top-row {
  display: flex; align-items: center; gap: 10px;
  cursor: pointer; padding: 6px 0; border-bottom: 1px solid var(--border);
  transition: color var(--transition);
}
.stat-top-row:last-child { border-bottom: none; }
.stat-top-row:hover .stat-top-title { color: var(--accent); }
.stat-top-num   { font-size: 14px; font-weight: 800; color: var(--muted); width: 20px; flex-shrink: 0; }
.stat-top-title { font-size: 14px; font-weight: 600; color: var(--text); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: color var(--transition); }
.stat-top-score { font-size: 14px; font-weight: 800; color: var(--gold); flex-shrink: 0; }
```

---

## 16. Library View

**Trigger**: Bottom nav "Library" tab → `gotoLibrary()`  
**Visual change**: Activates the Library sub-tab bar and sets `activeType = 'library'`

### 16.1 Library Sub-Tab Bar

Horizontal scrollable bar below toolbar:
- Background: `var(--bg)`, border-bottom

Tabs (styled as pill buttons):
| Tab | Emoji | Filter |
|---|---|---|
| All | 📚 | All user-saved titles |
| Favourites | ❤️ | `is_fav === true` |
| Watchlist | 🔖 | `status === 'watchlist'` |
| Watching | ▶️ | `status === 'watching'` |
| Finished | ✅ | `status === 'finished'` |

On mobile: scrollable with scrollbar hidden, right-edge fade mask to indicate more items.

Active tab style: teal fill + accent border.

### 16.2 Library Grid

Same title card grid as main grid, but:
- Filtered by `is_fav` or `status` matching the active library sub-tab
- Data comes from `allTitles[]` cross-referenced with `libraryMap{}` (local state)
- Cards show the same structure but always show the status indicator badge

### 16.3 Data Source

- `GET /api/library` — returns array of user's library entries:
  ```json
  [{"platform": "netflix", "title_key": "netflix::the crown", "title": "The Crown", "is_fav": true, "status": "watching", "notes": "...", "user_rating": 4}]
  ```
- The app merges this into `allTitles[]` data to get full title details for display

### 16.4 Library Sub-Tab CSS Reference

```css
/* ── Library sub-tab bar ── */
.library-sub-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px; overflow-x: auto; flex-shrink: 0; width: 100%;
  border-bottom: 1px solid var(--border); background: var(--bg);
  scrollbar-width: none;              /* Firefox */
}
.library-sub-bar::-webkit-scrollbar { display: none; }

/* Individual pill tabs */
.library-sub-tab {
  display: flex; align-items: center; gap: 5px;
  padding: 5px 14px; border-radius: 20px;
  border: 1px solid var(--border); background: transparent;
  color: var(--muted); font-size: 13px; font-family: var(--font-body);
  white-space: nowrap; cursor: pointer; flex-shrink: 0;
  transition: all var(--transition); touch-action: manipulation;
}
@media (hover: hover) {
  .library-sub-tab:hover { border-color: var(--accent); color: var(--accent); }
}
/* Active state: teal fill */
.library-sub-tab.active {
  background: rgba(94,234,212,.12);
  border-color: var(--accent); color: var(--accent); font-weight: 600;
}
```

---

## 17. Friends Screen

**Trigger**: Bottom nav "Friends" tab → `openFriends()`  
**Animation**: Slides in from the right (`.friendsOverlayIn` animation)  
**Z-index**: 300  
**Close**: Back functionality → `closeFriends()`

### 17.1 Back Bar

Same as detail pages, but without search — just `← Back` and logo button.

### 17.2 Layout

Scrollable `.friends-scroll` with 3 sections, each animated in with staggered delays:

---

**Section 1: Search for friends**

- Section title: `"FIND FRIENDS ─────"` (uppercase teal, decorative line)
- Search input:
  - Full width, `max-width: 400px`
  - Placeholder: `"Search by username…"`
  - Source: calls `GET /api/friends/search?q={query}` on input
- Search results (`.friends-search-results`):
  - Each result row: avatar + display name + username + relationship tag + action button
  - Relationship tags: `FRIENDS` (teal chip) or `PENDING` (grey chip)
  - Action button (for non-friends): `"+ Add"` teal button → `POST /api/friends/request`
  - If pending outgoing: `"Cancel"` button
  - If pending incoming: `Accept` (teal) + `Decline` (grey) buttons

---

**Section 2: Friend Requests**

- Shown only if there are pending incoming requests
- Section title with badge count: `"FRIEND REQUESTS [2]"`
- Each request row: avatar + name + username + **Accept** / **Decline** buttons
  - Accept: `POST /api/friends/accept/{request_id}`
  - Decline: `POST /api/friends/reject/{request_id}`

---

**Section 3: My Friends**

- Section title: `"MY FRIENDS ─────"`
- Empty state: `"No friends yet. Search above to connect."` (muted)
- Friends list (`.friends-list`):
  - Each row animated in with staggered 50ms delay
  - Row structure: avatar + display name + username + **Remove** button
    - Clicking the name/avatar area → opens **Friend Profile Card** (mini stats popup)
    - Remove button: `POST /api/friends/remove/{friend_id}` with confirmation

### 17.3 Friend Profile Card (`.fpm-overlay`)

A centered modal card shown when tapping a friend's name:
- Blurred backdrop
- Card (max-width `340px`):
  - Close button (×)
  - Head row: avatar + display name + username
  - **Total watch time** pill: teal background, formatted time (e.g., `"124h 30m"`)
  - Stats grid (2×2): Movies watched, Shows watched, Avg IMDb, Avg RT
  - Genre chips: top 3–5 genres
- Data from: `GET /api/profile/{username}` or `GET /api/friends/{id}/profile`

### 17.4 Avatars

- Profile photos: `34px` circle, `object-fit: cover`
- If no photo: initials placeholder (`34px` circle, `background: var(--surface)`, first letter of display_name, bold, muted color)

### 17.5 Data Sources

| Action | API |
|---|---|
| Search users | `GET /api/friends/search?q={username}` |
| Send request | `POST /api/friends/request` with `{to_user_id}` |
| Accept request | `POST /api/friends/accept` with `{request_id}` |
| Reject request | `POST /api/friends/reject` with `{request_id}` |
| Remove friend | `DELETE /api/friends/{friend_id}` |
| List friends | `GET /api/friends` |
| Friend profile | `GET /api/friends/{id}/profile` |

### 17.6 Friends Screen CSS Reference

```css
/* ── Friends overlay (full screen, slides from right) ── */
.friends-overlay {
  position: fixed; inset: 0; background: var(--bg); z-index: 300;
  display: flex; flex-direction: column; overflow: hidden;
}
.friends-overlay.hidden  { display: none; }
.friends-overlay.open    { animation: friendsOverlayIn  .32s cubic-bezier(.4,0,.2,1) both; }
.friends-overlay.closing { animation: friendsOverlayOut .28s cubic-bezier(.4,0,.2,1) both; pointer-events: none; }

@keyframes friendsOverlayIn  { from{transform:translateX(100%)} to{transform:translateX(0)} }
@keyframes friendsOverlayOut { from{transform:translateX(0)}    to{transform:translateX(100%)} }

/* ── Scroll area ── */
.friends-scroll {
  flex: 1; overflow-y: auto; overscroll-behavior: contain;
  padding: 28px; display: flex; flex-direction: column; gap: 32px;
}

/* ── Section title bars ("FIND FRIENDS ─────") ── */
.friends-section-title {
  font-family: var(--font-head); font-size: 13px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase; color: var(--accent);
  margin-bottom: 14px; display: flex; align-items: center; gap: 10px;
  animation: friendsSectionIn .35s cubic-bezier(.4,0,.2,1) both;
}
/* Stagger sections in */
.friends-section:nth-child(1) .friends-section-title { animation-delay:  80ms; }
.friends-section:nth-child(2) .friends-section-title { animation-delay: 160ms; }
.friends-section:nth-child(3) .friends-section-title { animation-delay: 240ms; }
@keyframes friendsSectionIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }

/* Decorative line after title (fills remaining width) */
.friends-section-title::after { content: ''; flex: 1; height: 1px; background: var(--border); }

/* Section dividers */
.friends-section + .friends-section {
  padding-top: 32px; border-top: 1px solid var(--border); margin-top: -8px;
}

/* Request count badge */
.friends-req-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px;
  background: var(--accent); color: #0f172a; border-radius: 99px;
  font-size: 11px; font-weight: 700; margin-left: 2px;
}

/* ── Search input ── */
.friends-search-input {
  width: 100%; max-width: 400px; padding: 9px 14px;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text); font-family: var(--font-body); font-size: 14px; outline: none;
  transition: border-color var(--transition);
}
.friends-search-input:focus { border-color: var(--accent); }

/* Results / list containers */
.friends-search-results, .friends-list {
  display: flex; flex-direction: column; gap: 8px; max-width: 500px;
}
.friends-empty { font-size: 13px; color: var(--muted); padding: 8px 0; }

/* ── Individual friend row ── */
.friend-row {
  display: flex; align-items: center; gap: 12px;
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 10px 14px;
  transition: border-color var(--transition), box-shadow var(--transition);
  animation: friendRowIn .28s cubic-bezier(.4,0,.2,1) both;
}
.friend-row:hover { border-color: rgba(94,234,212,.25); box-shadow: 0 2px 12px rgba(94,234,212,.06); }
@keyframes friendRowIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }

/* Staggered entry delays (50ms each, cap at 400ms) */
.friend-row:nth-child(1)   { animation-delay:   0ms; }
.friend-row:nth-child(2)   { animation-delay:  50ms; }
.friend-row:nth-child(3)   { animation-delay: 100ms; }
.friend-row:nth-child(4)   { animation-delay: 150ms; }
.friend-row:nth-child(5)   { animation-delay: 200ms; }
.friend-row:nth-child(6)   { animation-delay: 250ms; }
.friend-row:nth-child(7)   { animation-delay: 300ms; }
.friend-row:nth-child(8)   { animation-delay: 350ms; }
.friend-row:nth-child(n+9) { animation-delay: 400ms; }

/* Avatars */
.friend-avatar    { border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.friend-avatar-ph {
  border-radius: 50%; background: var(--surface); border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; color: var(--muted); flex-shrink: 0;
}

/* Clickable name/avatar area */
.friend-clickable {
  display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;
  cursor: pointer; border-radius: 6px; padding: 2px 4px; margin: -2px -4px;
  transition: background var(--transition);
}
.friend-clickable:hover { background: rgba(94,234,212,.06); }
.friend-info { flex: 1; min-width: 0; }
.friend-name     { font-size: 14px; font-weight: 600; color: var(--text); }
.friend-username { font-size: 12px; color: var(--muted); }

/* Action buttons */
.friend-add-btn {
  font-size: 12px; font-weight: 600; color: var(--accent);
  background: rgba(94,234,212,.1); border: 1px solid rgba(94,234,212,.35);
  border-radius: 6px; padding: 4px 12px; cursor: pointer; white-space: nowrap;
  transition: background var(--transition);
}
.friend-add-btn:hover { background: rgba(94,234,212,.2); }

.friend-accept-btn, .friend-reject-btn {
  font-size: 12px; font-weight: 600; border-radius: 6px;
  padding: 4px 12px; cursor: pointer; white-space: nowrap;
  border: 1px solid; transition: all var(--transition);
}
.friend-accept-btn { background: rgba(94,234,212,.12); color: var(--accent); border-color: rgba(94,234,212,.4); }
.friend-accept-btn:hover { background: rgba(94,234,212,.25); }
.friend-reject-btn { background: none; color: var(--muted); border-color: var(--border); }
.friend-reject-btn:hover { color: #e53e3e; border-color: rgba(229,62,62,.4); }

.friend-remove-btn {
  margin-left: auto; flex-shrink: 0; background: none;
  border: 1px solid var(--border); color: var(--muted);
  font-size: 12px; border-radius: 6px; padding: 4px 10px; cursor: pointer;
  transition: border-color var(--transition), color var(--transition);
}
.friend-remove-btn:hover { border-color: #f87171; color: #f87171; }

/* Relationship tags */
.fs-tag { font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding: 3px 9px; border-radius: 12px; }
.fs-tag.friends { background: rgba(94,234,212,.12); color: var(--accent); }
.fs-tag.pending { background: rgba(255,255,255,.06); color: var(--muted); }

/* ── Friend Profile Card overlay (.fpm) ── */
.fpm-overlay {
  position: fixed; inset: 0; z-index: 650;
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.fpm-overlay.hidden { display: none; }
.fpm-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.6); backdrop-filter: blur(4px); }
.fpm-card {
  position: relative; z-index: 1;
  background: var(--card); border: 1px solid var(--border);
  border-radius: 16px; width: 100%; max-width: 340px;
  padding: 22px 18px 18px; display: flex; flex-direction: column; gap: 16px;
}
.fpm-close-btn {
  position: absolute; top: 12px; right: 12px;
  width: 26px; height: 26px; border-radius: 50%;
  border: 1px solid var(--border); background: none;
  color: var(--muted); cursor: pointer; font-size: 11px;
  display: flex; align-items: center; justify-content: center;
  transition: all var(--transition);
}
.fpm-close-btn:hover { color: var(--text); border-color: var(--text); }
.fpm-head { display: flex; align-items: center; gap: 12px; }
.fpm-name { font-size: 17px; font-weight: 700; color: var(--text); line-height: 1.2; }
.fpm-username { font-size: 12px; color: var(--muted); margin-top: 2px; }
.fpm-time-pill {
  background: rgba(94,234,212,.1); border: 1px solid rgba(94,234,212,.25);
  border-radius: 20px; padding: 5px 12px;
  font-size: 12px; color: var(--accent); font-weight: 600; text-align: center;
}
.fpm-stat-group { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.fpm-stat { background: var(--surface); border-radius: 10px; padding: 10px 12px; }
.fpm-stat-value { font-size: 19px; font-weight: 800; color: var(--accent); }
.fpm-stat-label { font-size: 10px; color: var(--muted); margin-top: 2px; text-transform: uppercase; letter-spacing: .05em; }
.fpm-genres { display: flex; flex-wrap: wrap; gap: 6px; }
.fpm-genre-chip {
  font-size: 11px; background: rgba(94,234,212,.08); color: var(--accent);
  border: 1px solid rgba(94,234,212,.25); border-radius: 20px; padding: 3px 10px;
}
```

---

## 18. Notifications Panel

**Trigger**: Tap bell icon in header  
**Component**: `.notif-panel` (fixed position, not full-screen)  
**Position**: On mobile: `top: 60px`, `left: 8px`, `right: 8px` (full width), `max-height: 65vh`  
**Z-index**: 500

### 18.1 Panel Structure

1. **Header row**:
   - Title: `"Notifications"` (bold, 13px)
   - Right side: `"Mark all read"` button + `"Clear all"` button (red on hover)

2. **Push notification opt-in prompt** (shown on first visit):
   - Text: `"Enable push notifications to stay updated"`
   - `"Enable"` button (teal) + `"Dismiss"` link
   - Hidden after response stored in localStorage

3. **Notification list** (scrollable, max `520px` height):
   - Empty state: centered muted text `"No notifications yet."`
   - Each notification item:
     - **Unread indicator**: very subtle teal tint on background (`rgba(94,234,212,.04)`)
     - **Avatar**: `34px` circle (sender's profile photo or initials placeholder)
     - **Body**:
       - Main text (13px): e.g., `"JohnDoe added The Crown to their Watchlist"`
       - Linked elements: username/title in teal bold, tappable
       - Timestamp: `"2h ago"`, `"Just now"`, etc.
       - Optional: `44×63px` title poster thumbnail on the right
     - **Action buttons** (for friend requests):
       - `"Accept"` (teal) + `"Decline"` (grey) buttons
     - **Controls** (per item):
       - `✓` mark-read button (22px circle)
       - `✕` delete button (22px circle, red on hover)
   - `"Show more"` button at bottom for pagination

4. **Load more button**: full-width, loads next page of notifications

### 18.2 Notification Types

| Type | Message format |
|---|---|
| `friend_request` | `"{name} sent you a friend request"` |
| `friend_accepted` | `"{name} accepted your friend request"` |
| `title_message` | `"{name} sent you a message about {title}: {message}"` |
| `shared_action` | `"{name} added {title} to their {status/favourites}"` |

### 18.3 Notification Detail Overlay

Tapping a notification item opens a detailed view:
- On mobile: slides up from bottom (bottom sheet)
- On desktop: centered modal
- Shows: sender info + timestamp + title card preview + full message
- Friend request: Accept/Decline buttons

### 18.4 Data Source

`GET /api/notifications?offset={n}&limit=20` — paginated  
Response: `{notifications: [...], total: N, unread: N}`

Each notification:
```json
{
  "id": 42,
  "type": "shared_action",
  "from_user": {"id": 5, "username": "jane", "display_name": "Jane", "avatar_url": null},
  "title": "The Crown",
  "platform": "netflix",
  "action": "watching",
  "message": null,
  "is_read": false,
  "created_at": "2024-01-15T10:30:00Z"
}
```

Mark read: `POST /api/notifications/{id}/read`  
Delete: `DELETE /api/notifications/{id}`  
Mark all read: `POST /api/notifications/read-all`  
Clear all: `DELETE /api/notifications/all`

### 18.5 Notifications Panel CSS Reference

```css
/* ── Notifications panel (fixed dropdown) ── */
.notif-panel {
  display: none; position: fixed;
  width: 380px; max-height: 80vh;
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius); box-shadow: 0 12px 40px rgba(0,0,0,.55);
  z-index: 500; overflow: hidden;
}
.notif-panel.open { display: flex; flex-direction: column; }

/* Header row */
.notif-panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 13px 16px 11px; border-bottom: 1px solid var(--border);
}
.notif-panel-title { font-size: 13px; font-weight: 700; color: var(--text); }
.notif-mark-all {
  font-size: 11px; color: var(--muted); background: none; border: none;
  cursor: pointer; transition: color var(--transition); font-family: var(--font-body);
}
.notif-mark-all:hover { color: var(--accent); }
.notif-close-btn  { display: none; }   /* shown on mobile via @media overrides */

/* Push opt-in prompt */
.notif-push-prompt {
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px 14px;
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-card));
  border-bottom: 1px solid var(--border); font-size: 12px; color: var(--text);
}
.notif-push-prompt.hidden { display: none; }
.notif-push-actions { display: flex; gap: 8px; }
.notif-push-enable {
  font-size: 11px; padding: 4px 12px; border-radius: 12px;
  background: var(--accent); color: #fff; border: none; cursor: pointer;
  font-family: var(--font-body); font-weight: 600; transition: opacity var(--transition);
}
.notif-push-enable:hover { opacity: .85; }
.notif-push-dismiss {
  font-size: 11px; padding: 4px 10px; border-radius: 12px;
  background: none; color: var(--muted); border: 1px solid var(--border);
  cursor: pointer; font-family: var(--font-body);
  transition: color var(--transition), border-color var(--transition);
}
.notif-push-dismiss:hover { color: var(--text); border-color: var(--text); }

/* ── Notification list ── */
.notif-list { max-height: 520px; overflow-y: auto; }
.notif-list::-webkit-scrollbar { width: 4px; }
.notif-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.notif-empty { padding: 24px 16px; text-align: center; font-size: 13px; color: var(--muted); }

/* Individual notification item */
.notif-item {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 11px 14px; border-bottom: 1px solid var(--border);
  transition: background var(--transition);
}
.notif-item:last-child { border-bottom: none; }
.notif-item.unread { background: rgba(94,234,212,.04); }  /* subtle teal tint */

/* Sender avatar */
.notif-avatar, .notif-avatar-ph {
  width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0; object-fit: cover;
}
.notif-avatar-ph {
  background: var(--surface); border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700; color: var(--muted);
}

/* Notification body */
.notif-body { flex: 1; min-width: 0; }
.notif-text { font-size: 13px; color: var(--text); line-height: 1.45; }
.notif-text b { color: var(--accent); font-weight: 700; }

/* Tappable links within notification text */
.notif-title-link {
  color: var(--accent); font-weight: 700; cursor: pointer;
  text-decoration: underline; text-decoration-style: dotted;
  text-underline-offset: 2px; transition: color var(--transition);
}
.notif-title-link:hover { color: #fff; }
.notif-actor-link {
  cursor: pointer; border-bottom: 1px dotted rgba(94,234,212,.5);
  transition: border-color var(--transition);
}
.notif-actor-link:hover { border-bottom-color: var(--accent); }

.notif-meta { margin-top: 5px; font-size: 11px; color: var(--muted); letter-spacing: .02em; }
.notif-time { font-size: 11px; color: var(--muted); margin-top: 3px; }

/* Optional title poster thumbnail (right side) */
.notif-poster-wrap { width: 44px; flex-shrink: 0; align-self: center; }
.notif-poster {
  width: 44px; height: 63px; object-fit: cover; border-radius: 5px; display: block;
  box-shadow: 0 2px 8px rgba(0,0,0,.4);
}

/* ── Notification bell button (in header) ── */
.notif-wrap { position: relative; display: flex; align-items: center; }
.notif-btn {
  width: 42px; height: 42px; border-radius: 50%; background: var(--surface);
  border: 1px solid var(--border); display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: var(--muted); position: relative;
  transition: border-color var(--transition), color var(--transition);
}
.notif-btn.notif-open {
  border-color: var(--accent); color: var(--accent); background: var(--surface);
  box-shadow: 0 0 0 3px rgba(94,234,212,.18);
}
@media (hover: hover) { .notif-btn:hover { border-color: var(--accent); color: var(--accent); } }

/* Unread count badge on bell */
.notif-badge {
  position: absolute; top: -4px; right: -4px;
  min-width: 17px; height: 17px;
  background: #e53e3e; color: #fff; border-radius: 9px;
  font-size: 10px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; padding: 0 4px;
  border: 2px solid var(--bg);
}
.notif-badge.hidden { display: none; }
```

---

## 19. Profile Screen

**Trigger**: User menu → Profile, or nav drawer → "👤 Profile"  
**Animation**: Slide from right  
**Z-index**: 350  
**Back**: "← Back" → `closeProfile()`

### 19.1 Hero Section

Flex row on desktop, centered column on mobile.

**Avatar** (`profile-avatar-wrap`):
- `110×110px` circle, `border: 3px solid rgba(255,255,255,.12)`, large drop shadow
- Shows profile image or SVG placeholder (concentric arcs shape)
- Edit button: small `28px` teal circle with pencil icon, overlaid bottom-right
  - Tapping triggers `<input type="file" accept="image/*">` (hidden)
  - On file select: preview + `POST /api/profile/avatar` (multipart upload)
  - API: uses FormData with the image file

**Identity**:
- **Display name** (contenteditable div):
  - `30px`, Syne, `font-weight: 800`
  - Tapping: puts cursor in div for inline edit
  - On blur: calls `saveDisplayName()` → `PATCH /api/profile` with `{display_name}`
  - Edit indicator: bottom border turns teal when focused
  
- **Username sub**: `"@username"`, muted, 14px

- **Meta chips row**:
  - Auth type chip (e.g., `"Google"` or `"Password"`)
  - Member since chip (formatted date)

- **Home country row**:
  - Label: `"🌍 Home Country"`
  - Native `<select>` dropdown with all country options
  - Data: all 250 countries (ISO codes + names)
  - API: `PATCH /api/profile` with `{home_country: "US"}`

### 19.2 Total Watch Time Card

Tappable card (background: surface with subtle teal gradient, teal border):
- Large main time value: e.g., `"124h"` or `"5d 12h"` in teal, `46px`, extra bold
- Below time: breakdown rows:
  - 🎬 Movies: e.g., `"52h 30m"`
  - 📺 TV Episodes: e.g., `"71h 20m"`
- Tapping opens **Watch History Screen**
- Hover: border brightens, slight lift

Data from: `GET /api/profile` → `{total_watch_time_mins, movie_watch_time_mins, tv_watch_time_mins}`

### 19.3 Movies Stats Section

Section title: `"🎬 MOVIES"` (uppercase, muted, small)

**Stats grid** (3 columns):
Each stat card (tappable, opens filtered library):
| Stat | Value source |
|---|---|
| Total watched | `profile.movie_count` |
| Favourites | `profile.movie_fav_count` |
| Watchlist | `profile.movie_watchlist_count` |

**Movie time pill**: `"Xh Ym"` (teal tinted pill) — total movie watch time

### 19.4 TV Shows Stats Section

Same structure as Movies:
- Stat cards: TV Shows watched, Favourites, Watchlist
- TV time pill

### 19.5 Favourite Genres Section

- Shown only if user has watched titles (hidden otherwise)
- Section title: `"FAVOURITE GENRES"` (uppercase, muted)
- Chips (`profile-genre-chip`): flex wrap row
  - Each chip: genre name + `60px` progress bar (teal fill proportion = genre count / max genre count)
  - Horizontal bar at 4px height inside chip

Data: computed on server from user's watched/finished titles' genres.

### 19.6 Library Overview Section

Section title: `"LIBRARY"` (uppercase, muted)

Stats grid (3 cols):
- Total saved
- Currently watching
- Finished

Tapping each opens filtered library view.

### 19.7 Top Actors Section

- Hidden until user has watched content
- Section title: `"🎭 TOP ACTORS"`
- "View all →" button (right side of header) → opens **People All Overlay**
- List of top actors the user has watched most (up to 5 shown, more in full view)
- Each actor row (`profile-people-list`):
  - `40px` circle photo or initials
  - Actor name
  - `N titles watched` count in muted text

Data: `GET /api/profile` → `{top_actors: [{name, tmdb_id, count, profile_path}]}`

### 19.8 Top Directors Section

Same structure as Top Actors, but for directors.

### 19.9 Your Ratings Section

- Hidden until user has rated titles
- Section header with sort buttons: `"★ Highest"` / `"A–Z"` / `"Year"`
- List of rated titles:
  - Poster thumbnail (`36×54px`)
  - Title name
  - Star rating display (`★★★★☆` style, 5 stars, filled = gold)
  - Platform + year
  - Tapping → opens title detail

Data: `GET /api/ratings` → array of `{title, platform, rating, release_year}`  
Sort options call `GET /api/ratings?sort=rating|title|year`

### 19.10 Account Settings Section

Section title: `"👤 ACCOUNT"`

**Username row**:
- Label: `"Username"`
- Display mode: shows `@current_username` + pencil icon button
- Edit mode (on pencil tap):
  - Input field for new username, max 30 chars
  - Save button (teal tinted) + Cancel (×)
  - On Enter key: saves; on Escape: cancels
  - API: `PATCH /api/profile` with `{username: "newname"}`
  - Error hint text below field if username taken

### 19.11 Privacy Settings Section

Section title: `"⚙️ PRIVACY"`

**Library sharing toggle**:
- Label: `"Share library with friends"`
- Sub-text: `"Friends can browse your favourites, watchlist, and watch history"`
- iOS-style toggle switch (custom CSS implementation)
  - Off: grey track
  - On: teal track
  - API: `PATCH /api/profile` with `{library_public: true/false}`

### 19.12 Data Source

`GET /api/profile` → complete profile object:
```json
{
  "username": "john",
  "display_name": "John Doe",
  "avatar_url": "https://...",
  "auth_type": "password",
  "member_since": "2023-06-01",
  "home_country": "US",
  "library_public": true,
  "total_watch_time_mins": 7450,
  "movie_watch_time_mins": 3150,
  "tv_watch_time_mins": 4300,
  "movie_count": 42,
  "tv_count": 18,
  "movie_fav_count": 8,
  "library_total": 60,
  "top_genres": [{"genre": "Drama", "count": 25}, ...],
  "top_actors": [{"name": "...", "tmdb_id": 123, "count": 8, "profile_path": "..."}],
  "top_directors": [...],
  "avg_rating": 4.1
}
```

### 19.13 Profile Screen CSS Reference

```css
/* ── Profile overlay (slides in from right) ── */
.profile-overlay {
  position: fixed; inset: 0; z-index: 350; background: var(--bg);
  transform: translateX(100%);
  transition: transform .32s cubic-bezier(.4,0,.2,1);
  display: flex; flex-direction: column; overflow: hidden;
  pointer-events: none;
}
.profile-overlay.open { transform: translateX(0); pointer-events: all; }

/* ── Hero section ── */
.profile-hero {
  display: flex; align-items: flex-end; gap: 28px;
  padding: 40px 500px 28px;
  background: linear-gradient(to bottom, rgba(255,255,255,.03), transparent);
  border-bottom: 1px solid var(--border);
}
@media (max-width: 768px) {
  .profile-hero { padding: 24px 16px 20px; flex-direction: column; align-items: center; text-align: center; gap: 16px; }
}

/* ── Avatar ── */
.profile-avatar {
  width: 110px; height: 110px; border-radius: 50%; overflow: hidden;
  border: 3px solid rgba(255,255,255,.12); background: var(--surface);
  box-shadow: 0 8px 32px rgba(0,0,0,.5); cursor: pointer;
}
.profile-avatar-edit {
  position: absolute; bottom: 4px; right: 4px;
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--accent); color: var(--bg);
  box-shadow: 0 2px 8px rgba(0,0,0,.4);
  display: flex; align-items: center; justify-content: center;
}

/* ── Display name (inline editable) ── */
.profile-displayname {
  font-size: 30px; font-weight: 800; color: var(--text);
  border-bottom: 2px solid transparent; cursor: text;
  transition: border-color var(--transition); outline: none;
}
.profile-displayname:focus { border-bottom-color: var(--accent); }
@media (max-width: 768px) { .profile-displayname { font-size: 23px; } }

/* Meta chips (auth type, member since) */
.profile-meta-chip {
  font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  color: var(--muted); background: var(--surface);
  border: 1px solid var(--border); padding: 3px 10px; border-radius: 20px;
}

/* ── Watch time card ── */
.profile-time-card {
  background: linear-gradient(135deg, var(--surface) 55%, rgba(94,234,212,.04) 100%);
  border: 1px solid rgba(94,234,212,.18); border-radius: var(--radius);
  padding: 22px 24px 18px; cursor: pointer; overflow: hidden; position: relative;
  transition: border-color var(--transition), transform var(--transition);
}
.profile-time-card:hover { border-color: rgba(94,234,212,.55); transform: translateY(-2px); }
/* Subtle glow orb */
.profile-time-card::before {
  content: ''; position: absolute; top: -70px; right: -70px;
  width: 180px; height: 180px; border-radius: 50%;
  background: radial-gradient(circle, rgba(94,234,212,.09) 0%, transparent 68%);
  pointer-events: none;
}
.profile-time-main { font-size: 46px; font-weight: 800; color: var(--accent); }
@media (max-width: 768px) {
  .profile-time-main { font-size: 34px; }
  .profile-time-card { padding: 18px 18px 14px; }
}

/* ── Stats grid (3 cols) ── */
.profile-stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
@media (max-width: 768px) { .profile-stats-grid { gap: 6px; } }

.profile-stat-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 16px 18px;
  cursor: pointer; touch-action: manipulation;
}
@media (hover: hover) { .profile-stat-card:hover { background: var(--card); border-color: var(--accent); } }
.profile-stat-value { font-size: 32px; font-weight: 800; line-height: 1; margin-bottom: 4px; }
.profile-stat-value.accent { color: var(--accent); }
.profile-stat-value.gold   { color: var(--gold); }
@media (max-width: 768px) {
  .profile-stat-value { font-size: 19px; }
  .profile-stat-card  { padding: 10px 8px; }
}

/* ── Favourite genres chips ── */
.profile-genre-chip {
  display: flex; align-items: center; gap: 8px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 20px; padding: 6px 14px;
  font-size: 14px; color: var(--text); cursor: pointer;
  transition: border-color .2s, background .2s;
}
.profile-genre-chip:hover { border-color: var(--accent); background: rgba(94,234,212,.08); }
.profile-genre-bar-wrap { width: 60px; height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
.profile-genre-bar { height: 100%; background: var(--accent); border-radius: 2px; }

/* ── Profile content sections ── */
.profile-section { padding: 28px 500px 0; }
@media (max-width: 768px) { .profile-section { padding: 20px 16px 0; } }
.profile-section-title {
  font-size: 11px; font-weight: 700; letter-spacing: .14em;
  text-transform: uppercase; color: var(--muted); margin-bottom: 14px;
}
```

---

## 20. Watch History Screen

**Trigger**: Tap the watch time card in Profile screen  
**Component**: `#watchHistoryOverlay` (same Profile overlay-style component)  
**Z-index**: 350+  
**Back**: "← Back" → `closeWatchHistory()`

### 20.1 Back Bar

`← Back` | `"Watch History"` crumb

### 20.2 Type Tabs

Sub-bar (same style as library sub-tabs):
- 📚 All
- 🎬 Movies
- 📺 TV Shows

### 20.3 Filter Toolbar

Same structure as main toolbar:
- Search input (filters shown titles)
- "Filters" toggle button (mobile)
- Platform pills
- Region dropdown
- Sort dropdown

### 20.4 Content

Grid or list of titles the user has watched/finished:
- Shows same card format as main grid
- Includes watch time information per title

### 20.5 Data Source

`GET /api/watched` (paginated, with platform/title/type filters)  
Returns: array of watched title summaries with episode counts and derived watch time.

---

## 21. Nav Drawer (Bottom Sheet)

**Trigger**: Bottom nav `"••• More"` tap → `toggleNavDrawer()`  
**On mobile**: Slides up from bottom as a bottom sheet  
**On desktop**: Would be a left sidebar (but hidden on mobile since bottom nav replaces it)

### 21.1 Structure

**Backdrop**: semi-transparent overlay covering entire screen behind drawer  
**Bottom sheet**: `border-radius: 20px 20px 0 0` (top rounded corners only)
- Max height: `82dvh`
- Background: `var(--surface)`, `border-top: 1px solid var(--border)`
- Bottom safe area padding

**Drag handle**: `36×4px` rounded pill at top center, `var(--border)` color

**Header row**:
- `× Close` button (left — `30px` circle)
- `"MENU"` title (uppercase, muted, small, right side)

**Body** (scrollable):

Navigation items (tapping closes drawer + navigates):
```
All Titles          → setView('all')
🎬 Movies           → setView('movie')
📺 TV Shows         → setView('tv')
🔥 Trending         → setView('trending')
✨ For You          → setView('foryou')
🧭 Discover         → setView('discover')
──────────────────────────────────────
❤️ Favourites       → setView('favourites')
🔖 Watchlist        → setView('watchlist')
▶️ Watching         → setView('watching')
✅ Finished         → setView('finished')
──────────────────────────────────────
📅 Upcoming         → setView('upcoming')
🎭 Actors & Directors → setView('actors')
📊 Stats            → setView('stats') [admin only]
──────────────────────────────────────
👤 Profile          → openProfile()
🚪 Sign out         → doLogout()  [red color]
```

**Active item style**: teal text + very subtle teal background + `3px` left accent bar  
**Dividers**: `1px` border lines between groups

### 21.2 Nav Drawer + Bottom Nav CSS Reference

```css
/* ─────────── Nav drawer overlay backdrop ─────────── */
.nav-drawer-overlay {
  position: fixed; inset: 0; z-index: 290;
  background: rgba(0,0,0,.55); backdrop-filter: blur(2px);
  opacity: 0; pointer-events: none; transition: opacity .28s ease;
}
.nav-drawer-overlay.open { opacity: 1; pointer-events: all; }

/* ─────────── Nav drawer panel — desktop: left sidebar ─────────── */
.nav-drawer {
  position: fixed; top: 0; left: 0; bottom: 0; z-index: 300;
  width: 260px; max-width: 85vw;
  background: var(--surface); border-right: 1px solid var(--border);
  display: flex; flex-direction: column;
  transform: translateX(-100%);
  transition: transform .28s cubic-bezier(.4,0,.2,1);
  pointer-events: none;
}
.nav-drawer.open { transform: translateX(0); pointer-events: all; }
body.nav-drawer-open { overflow: hidden; }

/* ─────────── Mobile: becomes bottom sheet ─────────── */
@media (max-width: 768px) {
  .nav-drawer {
    z-index: 510;
    top: auto; left: 0; right: 0; bottom: 0;
    width: 100%; max-width: 100%; max-height: 82dvh;
    border-right: none; border-top: 1px solid var(--border);
    border-radius: 20px 20px 0 0;
    transform: translateY(100%);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  .nav-drawer.open { transform: translateY(0); }
  .nav-drawer-overlay { z-index: 505; }
  /* Drag handle pill (hidden on desktop) */
  .nav-drawer-handle {
    display: block;
    width: 36px; height: 4px;
    background: var(--border); border-radius: 2px;
    margin: 12px auto 8px;
  }
}

/* ─────────── Drawer items ─────────── */
.nav-drawer-item {
  display: block; width: 100%; padding: 13px 20px;
  background: transparent; border: none; text-align: left;
  color: var(--muted); font-family: var(--font-body); font-size: 15px; font-weight: 500;
  cursor: pointer; position: relative;
  transition: color var(--transition), background var(--transition);
}
.nav-drawer-item:hover { color: var(--text); background: rgba(255,255,255,.04); }

/* Active item: teal + very subtle teal background + 3px left accent bar */
.nav-drawer-item.active {
  color: var(--accent); font-weight: 700; background: rgba(94,234,212,.07);
}
.nav-drawer-item.active::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0;
  width: 3px; background: var(--accent); border-radius: 0 2px 2px 0;
}
.nav-drawer-divider { height: 1px; background: var(--border); margin: 6px 0; }

/* Mobile: make items a bit bigger for touch */
@media (max-width: 768px) { .nav-drawer-item { padding: 14px 22px; font-size: 16px; } }

/* ─────────── Bottom navigation bar (mobile only) ─────────── */
.bottom-nav { display: none; }  /* default: hidden */

@media (max-width: 768px) {
  .bottom-nav {
    display: flex; position: fixed; bottom: 0; left: 0; right: 0;
    z-index: 500; background: rgba(19,21,26,.97); backdrop-filter: blur(14px);
    border-top: 1px solid var(--border);
    height: calc(56px + env(safe-area-inset-bottom, 0px));
    padding-bottom: env(safe-area-inset-bottom, 0px);
    align-items: stretch; justify-content: space-around;
  }
  /* Shift main content up so it isn't hidden behind bottom nav */
  .main { padding-bottom: calc(60px + env(safe-area-inset-bottom, 0px)); }
}

/* Bottom nav buttons */
.bottom-nav-btn {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex: 1; gap: 3px; background: transparent; border: none;
  color: var(--muted); font-size: 10px; font-family: var(--font-body); font-weight: 500;
  cursor: pointer; padding: 0; touch-action: manipulation;
  transition: color var(--transition);
}
.bottom-nav-btn svg { transition: transform .15s ease, stroke .2s; }
.bottom-nav-btn.active      { color: var(--accent); }
.bottom-nav-btn.active svg  { stroke: var(--accent); transform: scale(1.12); }
.bottom-nav-btn.panel-open  { color: var(--accent); }                /* "More" when drawer is open */
.bottom-nav-btn:active svg  { transform: scale(.88); }               /* press feedback */
```

---

## 22. Overlays & Dialogs

### 22.1 Share Message Dialog

**Trigger**: Tap `"Send to a Friend"` in title detail  
**Style**: Bottom sheet (slides up from bottom on mobile)

Structure:
- Header: `"Send a Message"` + `×` close
- **Title preview row**: content type badge + title name + platform
- **"TO:" row**: `"Select"` + `"Select all"` button
- **Friends chips**: horizontally scrollable row of friend chips
  - Each chip: `36px` avatar + friend name
  - Selected: teal border + teal tinted background
- **Message textarea**: `min-height: 90–110px`
- **Footer**: character count (left) + **Send** button (right, teal filled)
  - Send disabled when no friends selected or message empty
  - API: `POST /api/notifications/send` with `{to_user_ids: [], title, platform, message}`

### 22.2 People All Overlay

**Trigger**: `"View all →"` in Profile's Top Actors or Top Directors sections  
**Component**: `#peopleAllOverlay`

Structure:
- Back bar with title (either `"Top Actors"` or `"Top Directors"`)
- Scrollable grid of people cards (same format as Actor panel)
- Each card: photo + name + watch count
- Tapping: opens Actor Detail Screen

Data: passed from profile data (full list of actors/directors with counts)

### 22.3 Episode Detail Overlay

**Trigger**: Tap an episode row in Seasons & Episodes tab  
**Component**: `#epDetailOverlay`

Structure:
- Back bar
- Episode still image (hero banner from TMDB episode still)
- Episode detail body: episode number + title + air date + runtime + overview

Data: from TMDB episode data already loaded in seasons list.

### 22.4 Global Loader

**Component**: `#globalLoader`  
**Condition**: Shown during long operations (e.g., initial load, DB operations)

Structure (centered in screen):
- StreamIntel signal-arc logo icon (animated pulsing arcs, 80px)
- `"STREAM"` wordmark (DM Sans, uppercase, spaced, muted)
- `"Intel"` wordmark (Syne, 23px, bold)

Animation: The 3 signal arcs and center dot pulse opacity `0.18→1→0.18` with staggered 0.28s delays.

### 22.5 Overlays CSS Reference

#### Share Message Compose Overlay

```css
/* Full-screen backdrop + bottom-sheet panel */
.share-msg-overlay {
  position: fixed; inset: 0; z-index: 2400;
  display: flex; align-items: flex-end; justify-content: center;
  opacity: 0; pointer-events: none; transition: opacity .28s;
}
.share-msg-overlay.open   { opacity: 1; pointer-events: auto; }
.share-msg-overlay.hidden { display: none; }
.share-msg-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.55); }

/* Panel slides up from bottom */
.share-msg-panel {
  position: relative; z-index: 1;
  width: min(520px, 100vw);
  background: var(--card); border: 1px solid var(--border);
  border-radius: 18px 18px 0 0; padding: 22px 22px 32px;
  max-height: 92dvh; overflow-y: auto;
  transform: translateY(24px); transition: transform .28s cubic-bezier(.4,0,.2,1);
}
.share-msg-overlay.open .share-msg-panel { transform: translateY(0); }
@media (max-width: 768px) {
  .share-msg-panel { width: 100vw; border-radius: 20px 20px 0 0; padding: 20px 16px 36px; max-height: 90dvh; }
  /* Horizontal scrollable friends row on mobile */
  .share-msg-friends { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; max-height: none; }
  .share-msg-friend-chip { flex-shrink: 0; }
}

/* Header */
.share-msg-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.share-msg-header-title { font-size: 14px; font-weight: 700; color: var(--text); }
.share-msg-close {
  background: none; border: none; color: var(--muted); font-size: 17px;
  cursor: pointer; padding: 0; line-height: 1; transition: color var(--transition);
}
.share-msg-close:hover { color: var(--text); }

/* Title preview row */
.share-msg-title-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px 14px; background: var(--surface); border-radius: 10px; margin-bottom: 16px;
}
.share-msg-content-type {
  font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  color: var(--accent); background: rgba(94,234,212,.1); border-radius: 6px; padding: 2px 7px;
}
.share-msg-content-title { font-size: 14px; font-weight: 700; color: var(--text); flex: 1; }
.share-msg-content-plat  { font-size: 12px; color: var(--muted); }

/* "To:" row */
.share-to-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.share-msg-to-label { font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.share-select-all-btn {
  background: none; border: none; color: var(--accent); font-size: 12px; font-weight: 600;
  cursor: pointer; padding: 0; font-family: var(--font-body); transition: opacity var(--transition);
}
.share-select-all-btn:hover { opacity: .75; }

/* Friends chips */
.share-msg-friends { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; max-height: 130px; overflow-y: auto; }
.share-msg-friend-chip {
  display: flex; align-items: center; gap: 6px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 20px;
  padding: 4px 12px 4px 6px; cursor: pointer; font-size: 13px; color: var(--muted);
  transition: all var(--transition);
}
.share-msg-friend-chip.selected {
  background: rgba(94,234,212,.12); border-color: rgba(94,234,212,.45); color: var(--text);
}

/* Message textarea */
.share-msg-textarea {
  width: 100%; min-height: 110px; resize: vertical;
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  color: var(--text); font-family: var(--font-body); font-size: 14px;
  padding: 12px 14px; line-height: 1.5; outline: none; box-sizing: border-box;
  transition: border-color var(--transition);
}
.share-msg-textarea:focus { border-color: rgba(94,234,212,.5); }

/* Footer: char count + send button */
.share-msg-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
.share-msg-char-count { font-size: 12px; color: var(--muted); }
.share-msg-send-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 22px; background: var(--accent); color: #080c10;
  font-weight: 700; font-size: 13px; border: none; border-radius: 10px;
  cursor: pointer; font-family: var(--font-body); transition: opacity var(--transition);
}
.share-msg-send-btn:hover:not(:disabled) { opacity: .85; }
.share-msg-send-btn:disabled { opacity: .5; cursor: default; }
```

#### Notification Detail Overlay

```css
/* Centered dialog on desktop; bottom sheet on mobile */
.notif-detail-overlay {
  position: fixed; inset: 0; z-index: 950;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; pointer-events: none; transition: opacity .28s;
}
.notif-detail-overlay.open   { opacity: 1; pointer-events: auto; }
.notif-detail-overlay.hidden { display: none; }
.notif-detail-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.6); }

.notif-detail-panel {
  position: relative; z-index: 1;
  width: min(460px, calc(100vw - 32px)); max-height: 80vh;
  background: var(--card); border: 1px solid var(--border);
  border-radius: 16px; overflow: hidden;
  box-shadow: 0 16px 48px rgba(0,0,0,.5);
  transform: translateY(16px) scale(.97); transition: transform .28s cubic-bezier(.4,0,.2,1);
}
.notif-detail-overlay.open .notif-detail-panel { transform: translateY(0) scale(1); }

/* Mobile: becomes bottom sheet */
@media (max-width: 768px) {
  .notif-detail-overlay { align-items: flex-end; justify-content: stretch; }
  .notif-detail-panel {
    width: 100%; max-width: 100%; border-radius: 20px 20px 0 0; max-height: 85dvh;
    transform: translateY(24px) scale(1);
  }
  .notif-detail-overlay.open .notif-detail-panel { transform: translateY(0); }
}

.notif-detail-scroll  { padding: 24px; overflow-y: auto; max-height: 80vh; }
.notif-detail-close   { position: absolute; top: 14px; right: 16px; background: none; border: none; color: var(--muted); font-size: 18px; cursor: pointer; z-index: 2; transition: color var(--transition); }
.notif-detail-close:hover { color: var(--text); }

/* Sender row */
.nd-actor-row  { display: flex; gap: 12px; align-items: center; margin-bottom: 20px; }
.nd-avatar     { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; }
.nd-avatar-ph  { width: 44px; height: 44px; border-radius: 50%; background: var(--surface); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; color: var(--muted); }
.nd-actor-name { font-size: 15px; font-weight: 700; color: var(--text); }
.nd-time       { font-size: 12px; color: var(--muted); margin-top: 2px; }

/* Title block (tappable to open title detail) */
.nd-title-block {
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
  padding: 14px 16px; margin-bottom: 18px;
  transition: border-color var(--transition);
}
.nd-title-block:hover { border-color: rgba(94,234,212,.4); }
.nd-meta   { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin-bottom: 4px; }
.nd-title  { font-size: 17px; font-weight: 700; color: var(--text); line-height: 1.3; }
.nd-scores { display: flex; align-items: center; gap: 10px; margin-top: 7px; flex-wrap: wrap; }
.nd-imdb   { font-size: 13px; font-weight: 600; color: var(--gold); }
.nd-rt     { font-size: 13px; font-weight: 600; color: var(--tomato); }

/* Message block */
.nd-message {
  font-size: 16px; line-height: 1.6; color: var(--text);
  background: var(--surface);
  border-left: 3px solid var(--accent); border-radius: 0 10px 10px 0;
  padding: 14px 16px; margin-bottom: 4px; font-style: italic; position: relative;
}
/* Truncated with gradient mask when long */
.nd-message.nd-collapsed {
  max-height: 152px; overflow: hidden;
  -webkit-mask-image: linear-gradient(to bottom, black 55%, transparent 100%);
  mask-image:         linear-gradient(to bottom, black 55%, transparent 100%);
}
.nd-read-more {
  display: block; background: none; border: none; padding: 2px 0 10px;
  font-size: 13px; font-weight: 600; color: var(--accent);
  cursor: pointer; letter-spacing: .02em;
}
.nd-read-more:hover { text-decoration: underline; }

/* Friend request action buttons */
.nd-fr-actions { display: flex; gap: 10px; margin-top: 16px; }
```

#### Global Loader

```css
.global-loader {
  position: fixed; inset: 0; z-index: 9999;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,.7); opacity: 1;
  transition: opacity .28s ease, visibility .28s ease;
}
.global-loader.hidden { opacity: 0; visibility: hidden; pointer-events: none; }
.global-loader-inner  { display: flex; flex-direction: column; align-items: center; gap: 20px; }
.global-loader-icon   { width: 80px; height: 80px; }
.global-loader-icon svg { width: 100%; height: 100%; overflow: visible; }
/* SVG elements inside use @keyframes logo-pulse / signal-pulse (see Section 1.6) */
.global-loader-wordmark {
  display: flex; flex-direction: column; align-items: center; gap: 2px; line-height: 1;
}
.global-loader-sub   { font-family: var(--font-body); font-size: 12px; font-weight: 400; letter-spacing: .22em; text-transform: uppercase; color: var(--muted); }
.global-loader-title { font-family: var(--font-head); font-size: 23px; font-weight: 800; letter-spacing: .04em; color: var(--text); }

/* General spinner (used in various loading states) */
.spinner {
  width: 16px; height: 16px;
  border: 2px solid rgba(94,234,212,.2); border-top-color: var(--accent);
  border-radius: 50%; animation: spin .7s linear infinite;
  display: inline-block; vertical-align: middle; margin-right: 6px;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

---

## 23. API Reference

### Base URL

`https://stream-intel.up.railway.app` (production)  
`http://localhost:5000` (local development)

### Authentication

All authenticated requests require header:  
`Authorization: Bearer {jwt_token}`

Or cookie-based (for web browser): `si_token` cookie set by login response.

### 23.1 Auth Endpoints

| Method | Endpoint | Body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/auth/login` | `{username, password}` | `{token, user}` | Standard login |
| POST | `/api/auth/register` | `{username, password, display_name}` | `{token, user}` | Registration |
| GET | `/api/auth/me` | — | `{user}` | Validate token |
| GET | `/api/auth/google` | — | Redirect | OAuth start |
| GET | `/api/auth/google/callback` | — | Redirect + token | OAuth callback |
| POST | `/api/auth/setup` | `{username}` | `{token, user}` | First-time Google setup |
| POST | `/api/auth/logout` | — | `{ok}` | Logout (clears server cookie) |

User object: `{id, username, display_name, is_admin, avatar_url, library_public, home_country, member_since}`

### 23.2 Titles Endpoints

| Method | Endpoint | Params | Response |
|---|---|---|---|
| GET | `/api/titles` | `limit`, `sort`, `unique`, `region`, `platform`, `type`, `genre`, `min_votes`, `search` | Array of title objects |
| GET | `/api/geoip` | — | `{country_code: "US"}` |
| GET | `/api/regions` | — | Array of `{code, name}` |

Title object fields: see Section 8.8.

### 23.3 Library Endpoints

| Method | Endpoint | Body/Params | Response |
|---|---|---|---|
| GET | `/api/library` | — | Array of library entries |
| POST | `/api/library` | `{platform, title, is_fav?, status?, notes?, user_rating?}` | `{ok}` |
| DELETE | `/api/library` | `{platform, title}` | `{ok}` |

### 23.4 Watched Episodes Endpoints

| Method | Endpoint | Body/Params | Response |
|---|---|---|---|
| GET | `/api/watched` | `platform`, `title` | Array of watched episodes |
| POST | `/api/watched` | `{platform, title, season_num, episode_num, watched}` | `{ok}` |
| POST | `/api/watched/all` | `{platform, title}` | `{ok}` |
| DELETE | `/api/watched/all` | `{platform, title}` | `{ok}` |

### 23.5 Ratings Endpoints

| Method | Endpoint | Body/Params | Response |
|---|---|---|---|
| GET | `/api/ratings` | `sort` | Array of ratings |
| POST | `/api/ratings` | `{platform, title, rating}` | `{ok}` |
| DELETE | `/api/ratings` | `{platform, title}` | `{ok}` |

### 23.6 Profile Endpoints

| Method | Endpoint | Body | Response |
|---|---|---|---|
| GET | `/api/profile` | — | Full profile object |
| PATCH | `/api/profile` | `{display_name?, username?, home_country?, library_public?}` | `{ok}` |
| POST | `/api/profile/avatar` | FormData with `file` field | `{avatar_url}` |

### 23.7 Friends Endpoints

| Method | Endpoint | Body | Response |
|---|---|---|---|
| GET | `/api/friends` | — | `{friends: [...], pending_in: [...], pending_out: [...]}` |
| GET | `/api/friends/search` | `?q={query}` | Array of user results |
| POST | `/api/friends/request` | `{to_user_id}` | `{ok}` |
| POST | `/api/friends/accept` | `{request_id}` | `{ok}` |
| POST | `/api/friends/reject` | `{request_id}` | `{ok}` |
| DELETE | `/api/friends/{id}` | — | `{ok}` |
| GET | `/api/friends/{id}/profile` | — | Condensed profile |

### 23.8 Notifications Endpoints

| Method | Endpoint | Body/Params | Response |
|---|---|---|---|
| GET | `/api/notifications` | `?offset=0&limit=20` | `{notifications: [...], total, unread}` |
| POST | `/api/notifications/{id}/read` | — | `{ok}` |
| POST | `/api/notifications/read-all` | — | `{ok}` |
| DELETE | `/api/notifications/{id}` | — | `{ok}` |
| DELETE | `/api/notifications/all` | — | `{ok}` |
| POST | `/api/notifications/send` | `{to_user_ids, title, platform, message}` | `{ok}` |

### 23.9 TMDB Proxy Endpoints

All TMDB calls go through the server proxy (`/api/tmdb/*`). The server forwards to `https://api.themoviedb.org/3/*` with its own API key.

| Endpoint | TMDB endpoint | Notes |
|---|---|---|
| `GET /api/tmdb/search?query=X&type=movie\|tv\|multi` | `/search/{type}` | Title search |
| `GET /api/tmdb/movie/{id}` | `/movie/{id}` | Movie details |
| `GET /api/tmdb/tv/{id}` | `/tv/{id}` | TV details |
| `GET /api/tmdb/movie/{id}/credits` | `/movie/{id}/credits` | Cast/crew |
| `GET /api/tmdb/tv/{id}/credits` | `/tv/{id}/credits` | Cast/crew |
| `GET /api/tmdb/tv/{id}/season/{n}` | `/tv/{id}/season/{n}` | Episode list |
| `GET /api/tmdb/person/{id}` | `/person/{id}?append_to_response=combined_credits` | Actor data |
| `GET /api/tmdb/trending/person/week` | `/trending/person/week` | Trending actors |

**Image base URLs**:
- Posters: `https://image.tmdb.org/t/p/w342{poster_path}` (cards)
- Posters (HQ): `https://image.tmdb.org/t/p/w500{poster_path}` (detail page)
- Backdrops: `https://image.tmdb.org/t/p/original{backdrop_path}` (hero)
- Actor photos: `https://image.tmdb.org/t/p/w185{profile_path}` (cast cards)
- Actor photos (HQ): `https://image.tmdb.org/t/p/w342{profile_path}` (actor page)

---

## 24. State Management Reference

### 24.1 Core State Variables

```javascript
// All title data from server (deduplicated)
let allTitles = [];

// User's library: "platform::title_lower" → {is_fav, status, notes, user_rating}
let libraryMap = {};

// Current active view
let activeType = 'all';
// Possible values: 'all' | 'movie' | 'tv' | 'trending' | 'foryou' | 'discover' |
//                 'upcoming' | 'actors' | 'stats' |
//                 'favourites' | 'watchlist' | 'watching' | 'finished'

// Status sub-filter (shown on All/Movies/TV/Trending)
let activeStatusFilter = 'all';
// Possible values: 'all' | 'favourites' | 'watchlist' | 'watching' | 'finished'

// Filter state
let activePlatform = 'all';        // "all" or platform key string
let activeRegion = 'all';          // "all" or ISO country code
let activeGenres = new Set();      // set of genre strings (include)
let excludedGenres = new Set();    // set of genre strings (exclude)
let activeVotes = 0;               // minimum vote count filter
let activeSort = 'rank';           // 'rank'|'imdb'|'rt'|'year'|'title'
let trendingTypeFilter = 'all';    // 'all'|'movie'|'tv' (trending view only)
let ongoingFilter = 'all';         // 'all'|'ongoing'|'ended' (TV view only)
let searchQuery = '';              // current search string

// Currently open title object in detail screen
let currentModalTitle = null;

// TMDB data cache: titleKey → {tmdbId, ongoing, endYear, nextEp, posterThumb, backdropThumb}
const _tmdbShowData = {};

// Card data store: titleKey → title object
const cardDataStore = {};

// Current user
let currentUser = null; // {id, username, display_name, is_admin, avatar_url, ...}
```

### 24.2 Library Map Key Format

The key used to look up library data for a title:
```
"{platform}::{title.toLowerCase()}"
```
Example: `"netflix::the crown"` or `"prime_video::jack ryan"`

### 24.3 Title Key

Same as library map key:
```javascript
function titleKey(platform, title) {
  return `${platform}::${title.toLowerCase()}`;
}
```

### 24.4 Filtering Logic

When `setView()` is called or a filter changes, `renderCards()` is called which:
1. Starts with `allTitles[]`
2. Merges library data from `libraryMap`
3. Applies view filter (content_type, is_trending, etc.)
4. Applies platform filter
5. Applies region filter (checks `title.regions` array includes `activeRegion`)
6. Applies genre include filter (title.genre contains any selected genre)
7. Applies genre exclude filter (title.genre does NOT contain any excluded genre)
8. Applies votes filter (`imdb_votes >= activeVotes`)
9. Applies search filter (case-insensitive match in title string)
10. Applies sort
11. Renders to DOM

### 24.5 Pagination

The grid supports pagination:
- Default page size: 50 titles per page on desktop / adaptive on mobile
- Pagination bar at bottom with: `← Prev | 1 2 3 ... N | Next →`
- Active page button: filled teal background
- Disabled buttons: 30% opacity

---

## Appendix A: View → Panel Mapping

| `activeType` value | What's shown | Filter Toolbar shown |
|---|---|---|
| `'all'` | Main grid (all titles) | Yes |
| `'movie'` | Main grid (movies only) | Yes |
| `'tv'` | Main grid (TV only) + Ongoing filter | Yes |
| `'trending'` | Main grid (trending) + Trending type toggle | Yes |
| `'favourites'` | Main grid (user fav titles) | Yes |
| `'watchlist'` | Main grid (watchlist titles) | Yes |
| `'watching'` | Main grid (watching titles) | Yes |
| `'finished'` | Main grid (finished titles) | Yes |
| `'foryou'` | `#forYouPanel` | No |
| `'discover'` | `#discoverPanel` | No |
| `'upcoming'` | `#upcomingPanel` | No |
| `'actors'` | `#actorsPanel` | No |
| `'stats'` | `#statsPanel` | No |

---

## Appendix B: Genre List

Genres used in the filter dropdowns (derived from titles database):

Action, Adventure, Animation, Biography, Comedy, Crime, Documentary, Drama, Fantasy, History, Horror, Music, Mystery, Romance, Sci-Fi, Sport, Thriller, War, Western, Family, Reality, News, Talk-Show, Game-Show, Musical, Short, Adult

---

## Appendix C: Mobile-Specific Behaviors

1. **Hover → Touch**: All hover-only UI converts to tap-based on touch devices. Cards show their overlay and quick-action menus via tap-and-hold / first-tap.
2. **Bottom nav height**: Accounts for `env(safe-area-inset-bottom)` for iPhones with home indicator.
3. **Overscroll**: `overscroll-behavior: contain` on all scrollable panels to prevent scroll chaining.
4. **Toolbar scroll-hide**: On mobile, the filter toolbar disappears on scroll down and reappears on scroll up.
5. **Backdrop-filter disabled**: On mobile, `backdrop-filter` is disabled on the header and toolbar to prevent GPU compositing flicker during scroll on Android WebView/Chrome.
6. **Touch targets**: All interactive elements maintain minimum `44×44px` touch target size.
7. **-webkit-tap-highlight-color**: Set to `transparent` on cards to remove default tap flash.
8. **Image lazy loading**: Posters use IntersectionObserver to load only when cards scroll into viewport.
9. **Dropdown positioning**: On mobile, dropdowns (genre, sort, region) are positioned with `position: fixed` and `left/right: 8px` to be full-width, with `z-index: 510` (above bottom nav).
10. **Status bar updates**: On mobile PWA, `<meta name="theme-color">` is set to match `--bg` for a native feel.
