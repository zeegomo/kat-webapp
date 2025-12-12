# KAT Spectrometer Webapp

Mobile webapp for the KAT DIY Raman spectrometer. This is the frontend that runs in your browser and communicates with the Raspberry Pi API server.

## Architecture

The recommended setup serves a small loader from the Pi that fetches the full app from GitHub:

```
┌─────────────────────────────────────────────────────────────────┐
│                        HOW IT WORKS                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   1. User connects phone to Pi's WiFi (KAT-Spectrometer)        │
│                                                                 │
│   2. Opens https://192.168.4.1 in browser                       │
│      └── Pi serves pi-loader/index.html (tiny loader)           │
│                                                                 │
│   3. Loader fetches latest app from GitHub Pages                │
│      └── Caches in IndexedDB for offline use                    │
│                                                                 │
│   4. App runs locally, API calls go to Pi (same origin)         │
│                                                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Benefits:**
- No mixed content (HTTPS/HTTP) issues
- Updates automatically from GitHub when internet available
- Works fully offline after first load
- Only need to set up Pi once

## Setup

### 1. Deploy to GitHub Pages

```bash
cd kat-webapp
git init
git add .
git commit -m "Initial commit"
gh repo create kat-webapp --public --source=. --push
```

Then enable GitHub Pages:
1. Go to repository Settings > Pages
2. Source: Deploy from branch
3. Branch: `main` / `root`
4. Save

Your webapp source will be at: `https://yourusername.github.io/kat-webapp`

### 2. Update the Loader URL

Edit `pi-loader/index.html` and update the GitHub URL:

```javascript
// Line ~62 - Update to your GitHub Pages URL
const GITHUB_BASE = 'https://yourusername.github.io/kat-webapp';
```

### 3. Configure the Pi

Copy `pi-loader/index.html` to your Raspberry Pi and configure your API server to serve it.

**Option A: If using Python/Flask for the API**

Add a route to serve the loader:

```python
from flask import send_file

@app.route('/')
def index():
    return send_file('index.html')
```

**Option B: If using a separate web server**

Configure nginx/apache to serve `pi-loader/index.html` at the root.

**Option C: Simple Python server alongside API**

Run alongside your API on a different port:
```bash
cd pi-loader
python -m http.server 80
```
Then access via `https://192.168.4.1/`

### 4. Using the App

1. Connect phone to Pi's WiFi network (KAT-Spectrometer)
2. Open `https://192.168.4.1` (or whichever port serves the loader)
3. First time: Loader downloads app from GitHub (needs internet via Pi or mobile data)
4. Subsequent uses: Works offline from cache

## Updating the Webapp

1. Make changes to files
2. Bump version in `version.txt` (e.g., `1.0.0` → `1.0.1`)
3. Commit and push to GitHub

```bash
echo "1.0.1" > version.txt
git add .
git commit -m "Update webapp"
git push
```

The loader will detect the new version and download updates when internet is available.

## File Structure

```
kat-webapp/
├── index.html          # Main app page
├── manifest.json       # PWA manifest
├── sw.js               # Service worker (for direct GitHub access)
├── version.txt         # Version for cache busting
├── css/
│   └── style.css       # Styles
├── js/
│   ├── app.js          # Main app logic
│   ├── db.js           # IndexedDB storage
│   ├── identifier.js   # Spectrum identification
│   └── sync.js         # CouchDB sync
├── data/
│   └── library.json    # Reference spectra library
├── pi-loader/
│   └── index.html      # Loader to deploy on Pi
└── icons/              # PWA icons
```

## Development

### Testing Locally

```bash
# Serve the app locally
python -m http.server 8000
# Open http://localhost:8000
```

When running on localhost, the app uses relative API URLs (same origin).

### Direct GitHub Pages Access

You can still access the app directly at `https://yourusername.github.io/kat-webapp`, but:
- API calls to the Pi will be blocked (mixed content)
- Useful for UI development without Pi connected

## Pi Connectivity

The app shows a warning banner when the Pi is not reachable:
- Checks connectivity every 2 seconds when disconnected
- Checks every 10 seconds when connected (battery friendly)
- Navigation to Step 2 (Calibration) is blocked until connected

## Features

- Wizard-style interface for field testing
- Offline-capable (cached via loader)
- Local data storage (IndexedDB)
- Optional sync to CouchDB server
- Browser-based spectrum identification
- Dark mode support

## License

MIT
