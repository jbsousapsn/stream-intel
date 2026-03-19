# StreamIntel — Android APK Guide

This guide walks you through deploying StreamIntel as a hosted web app and packaging it as a real Android APK using a **Trusted Web Activity (TWA)** via [PWABuilder](https://pwabuilder.com).

A TWA wraps your hosted PWA in a full-screen Chrome shell — it behaves exactly like a native app, passes Google Play review, and supports push notifications, offline mode, and app shortcuts.

---

## Prerequisites

- A **Railway** (or Render/Fly.io) account for hosting
- A **Google Play Developer** account ($25 one-time) if you plan to publish to the Play Store
- Your Google OAuth credentials (already configured — see `GOOGLE_OAUTH_SETUP.md`)
- Node.js 18+ installed locally (only needed for signing the APK)

---

## Step 1 — Deploy to Railway

Your app already has a `Procfile` and is Railway-ready.

1. Go to [railway.app](https://railway.app) and create a new project
2. Click **Deploy from GitHub repo** and select `JoaoSousa03/stream-intel`
3. Railway auto-detects the `Procfile` and uses:
   ```
   gunicorn run:app --bind 0.0.0.0:$PORT --worker-class gthread --workers 1 --threads 4 --timeout 3600 --preload
   ```
4. In **Variables**, add all required environment variables:

   | Variable | Value |
   |---|---|
   | `SECRET_KEY` | A long random string (e.g. output of `python -c "import secrets; print(secrets.token_hex(32))"`) |
   | `GOOGLE_CLIENT_ID` | From Google Cloud Console |
   | `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
   | `GOOGLE_REDIRECT_URI` | Leave blank — Railway auto-detects via `RAILWAY_PUBLIC_DOMAIN` |
   | `TMDB_API_KEY` | Your TMDb API key (if used) |

5. Click **Deploy**. Railway gives you a public URL like `https://stream-intel-production.up.railway.app`
6. Visit the URL and confirm the app loads and login works

> **Persistent database:** Railway's filesystem resets on redeploy. To keep your SQLite data, either use Railway's **Volume** feature (attach a persistent disk at `/app`) or migrate to PostgreSQL later.

---

## Step 2 — Update Google OAuth Redirect URI

Your deployed app will have a new HTTPS domain. You must add it to Google Cloud Console:

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → **APIs & Services** → **Credentials**
2. Click your OAuth 2.0 Client ID
3. Under **Authorised redirect URIs**, add:
   ```
   https://your-app.up.railway.app/api/auth/google-callback
   ```
4. Click **Save**

---

## Step 3 — Verify the PWA Checklist

Your `manifest.json` and `sw.js` are already well-configured, but confirm these in production:

| Check | Status |
|---|---|
| Served over HTTPS | ✅ Railway provides this automatically |
| `manifest.json` linked in `index.html` | ✅ Already present |
| `start_url: "/"` | ✅ Already set |
| `display: "standalone"` | ✅ Already set |
| `icons` includes 192×192 and 512×512 PNG | ✅ Already present at `/icons/` |
| Service worker registered | ✅ Already in `sw.js` |
| `theme_color` set | ✅ `#0f1923` |

To double-check, open Chrome DevTools → **Application** → **Manifest** and **Service Workers** on your deployed URL.

---

## Step 4 — Generate the APK with PWABuilder

1. Go to [pwabuilder.com](https://pwabuilder.com)
2. Enter your Railway URL (e.g. `https://stream-intel-production.up.railway.app`) and click **Start**
3. PWABuilder analyses your manifest and service worker. All scores should be green
4. Click **Package for Stores** → **Android**
5. Configure the Android package:

   | Field | Recommended value |
   |---|---|
   | **Package ID** | `com.streamintel.app` (no hyphens — Java identifiers don't allow them) |
   | **App name** | `StreamIntel` |
   | **Short name** | `StreamIntel` |
   | **Version code** | `1` |
   | **Version name** | `1.0.0` |
   | **Host** | `your-app.up.railway.app` |
   | **Start URL** | `/` |
   | **Theme colour** | `#0f1923` |
   | **Background colour** | `#0f1923` |
   | **Display mode** | `standalone` |
   | **Signing** | Choose **New** to generate a keystore (see Step 5) |

6. Click **Download** — you get a ZIP containing:
   - `app-release-signed.apk` — ready to install directly
   - `app-release.aab` — for Google Play Store submission
   - `assetlinks.json` — **critical** (see Step 6)
   - `signing.keystore` + passwords — **back this up securely**

---

## Step 5 — Sign the APK (if using your own keystore)

If you chose to bring your own keystore instead of letting PWABuilder generate one:

```bash
# Generate a keystore (one-time)
keytool -genkey -v -keystore streamintel.keystore -alias streamintel -keyalg RSA -keysize 2048 -validity 10000

# Sign the APK
jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 \
  -keystore streamintel.keystore app-release-unsigned.apk streamintel

# Verify
jarsigner -verify -verbose app-release-unsigned.apk
```

> Keep `streamintel.keystore` and its passwords safe. If you lose it you can never update your Play Store listing.

---

## Step 6 — Add assetlinks.json to Your Server

This file proves to Android that your app owns the domain, enabling the TWA to run without the Chrome address bar.

1. Take the `assetlinks.json` from the PWABuilder ZIP. It looks like:
   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "com.streamintel.app",
       "sha256_cert_fingerprints": ["AA:BB:CC:..."]
     }
   }]
   ```

2. Your Flask backend needs to serve this at `/.well-known/assetlinks.json`. Add this route to `backend/routes/auth.py` (or a new file):

   ```python
   import json, os
   from flask import Blueprint, send_file, abort

   well_known_bp = Blueprint('well_known', __name__)

   @well_known_bp.route('/.well-known/assetlinks.json')
   def assetlinks():
       path = os.path.join(os.path.dirname(__file__), '../../.well-known/assetlinks.json')
       if os.path.exists(path):
           return send_file(path, mimetype='application/json')
       abort(404)
   ```

3. Create the file at `.well-known/assetlinks.json` in your project root (paste the content from PWABuilder)

4. Register the blueprint in `backend/app.py`:
   ```python
   from backend.routes.well_known import well_known_bp
   app.register_blueprint(well_known_bp)
   ```

5. Redeploy to Railway and verify it's accessible:
   ```
   https://your-app.up.railway.app/.well-known/assetlinks.json
   ```
   You should see the JSON with no 404.

---

## Step 7 — Install the APK on Your Phone

**Direct install (sideload):**

1. On your Android phone, go to **Settings** → **Apps** → **Special app access** → **Install unknown apps**
2. Enable installs from your file manager or browser
3. Transfer `app-release-signed.apk` to your phone (ADB, email, Google Drive, USB)
4. Open the file and tap **Install**
5. Launch **StreamIntel** — it opens full-screen with no browser UI

**Test that the TWA is working correctly:**

- There should be **no address bar** — if you see one, the `assetlinks.json` is not being served correctly (go back to Step 6)
- App shortcuts (Library, Discover) should appear when long-pressing the icon

---

## Step 8 — Publish to Google Play (optional)

1. Go to [play.google.com/console](https://play.google.com/console) and create a new app
2. Fill in the store listing (title, description, screenshots, category: **Entertainment**)
3. Upload `app-release.aab` (the Android App Bundle from the PWABuilder ZIP) under **Production** → **Releases**
4. Complete the content rating questionnaire
5. Submit for review (typically 1–3 days for new apps)

---

## Push Notifications (optional)

Your `sw.js` already has the push notification handler. To wire it up end-to-end:

### 1. Generate VAPID keys

```bash
pip install py-vapid
python -c "from py_vapid import Vapid; v = Vapid(); v.generate_keys(); print('Public:', v.public_key); print('Private:', v.private_key)"
```

Add to Railway environment variables:
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_CLAIMS_EMAIL` (e.g. `mailto:you@example.com`)

### 2. Add subscription endpoint to backend

Add to `requirements.txt`:
```
pywebpush
```

Add a route to store subscriptions and send pushes (e.g. in `backend/routes/`):
```python
from flask import Blueprint, request, jsonify, g
from pywebpush import webpush, WebPushException
import json, os

push_bp = Blueprint('push', __name__)

@push_bp.route('/api/push/subscribe', methods=['POST'])
def subscribe():
    sub = request.get_json()
    # Store sub in DB against g.user_id
    # db.execute('INSERT OR REPLACE INTO push_subscriptions ...')
    return jsonify({'ok': True})

@push_bp.route('/api/push/send', methods=['POST'])   # internal/admin use
def send_push():
    data = request.get_json()
    # Load all subscriptions from DB and send
    webpush(
        subscription_info=data['subscription'],
        data=json.dumps({'title': data['title'], 'body': data['body']}),
        vapid_private_key=os.getenv('VAPID_PRIVATE_KEY'),
        vapid_claims={'sub': os.getenv('VAPID_CLAIMS_EMAIL')}
    )
    return jsonify({'ok': True})
```

### 3. Subscribe from the frontend

Add to your JS (e.g. after login):
```js
async function subscribePush() {
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return; // already subscribed

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: '<YOUR_VAPID_PUBLIC_KEY>'
  });
  await api('POST', '/api/push/subscribe', sub.toJSON());
}
```

---

## Checklist Summary

- [ ] App deployed to Railway with HTTPS URL
- [ ] Google OAuth redirect URI updated in Cloud Console
- [ ] PWABuilder generates APK without errors
- [ ] `assetlinks.json` served at `/.well-known/assetlinks.json`
- [ ] APK installed and opens without address bar
- [ ] Keystore file backed up securely
- [ ] (optional) App Bundle uploaded to Play Console
- [ ] (optional) Push notifications wired up with VAPID keys
