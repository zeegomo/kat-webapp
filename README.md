# spettromiao Webapp

A complete mobile spectrometer data collection system with PWA frontend and CouchDB backend for data synchronization.

## Components

This repository contains two main components:

### 1. Mobile PWA (root directory)
Progressive web app for field testing with the spettromiao DIY Raman spectrometer. This is the frontend that runs in your browser and communicates with the Raspberry Pi API server.

### 2. CouchDB Server (server/ directory)
Production-ready CouchDB backend for syncing session data across devices. See [server/README.md](server/README.md) for complete setup instructions.

## Quick Start

### Deploy the Mobile App
Follow the [Setup](#setup) below to deploy via the Pi-hosted loader.

### Deploy the Sync Server (Optional)
If you want to sync data across devices:
1. Set up a server (Ubuntu/Debian)
2. Follow the [server setup guide](server/README.md)
3. Configure the mobile app with your server URL and token

## Mobile PWA Architecture

The app is deployed via a lightweight loader served by the Raspberry Pi. The loader fetches the full app from GitHub Pages, caches it in IndexedDB, and renders it inline. All API calls are same-origin.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Pi-Loader Method                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   1. User connects phone to Pi's WiFi (spettromiao)             │
│                                                                 │
│   2. Opens https://192.168.4.1 in browser                       │
│      └── Pi serves pi-loader/index.html (small loader)          │
│                                                                 │
│   3. Loader fetches latest app from GitHub Pages                │
│      └── Caches in IndexedDB for offline use                    │
│                                                                 │
│   4. App renders inline, API calls go to Pi (same origin)       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Benefits:**
- Works in any browser (no special APIs needed)
- Fully offline after first load
- No permission prompts
- Same-origin API calls
- Updates automatically from GitHub when internet is available

## Setup

### Step 1: Deploy to GitHub Pages

```bash
cd spettromiao-webapp
git init
git add .
git commit -m "Initial commit"
gh repo create spettromiao-webapp --public --source=. --push
```

Then enable GitHub Pages:
1. Go to repository Settings > Pages
2. Source: Deploy from branch
3. Branch: `main` / `root`
4. Save

Your webapp will be at: `https://yourusername.github.io/spettromiao-webapp`

### Step 2: Configure the Pi

Ensure your Raspberry Pi:
- Creates a WiFi network named `spettromiao`
- Runs an HTTPS API server on `https://192.168.4.1`
- Has a valid SSL certificate (self-signed is OK, but users must accept it once)

### Step 3: Set up the Pi-Loader

1. Edit `pi-loader/index.html` and update line 67:
   ```javascript
   const GITHUB_BASE = 'https://yourusername.github.io/spettromiao-webapp';
   ```

2. Configure your Pi to serve `pi-loader/index.html` at the root:

   **Option A: Python/Flask**
   ```python
   from flask import send_file

   @app.route('/')
   def index():
       return send_file('pi-loader/index.html')
   ```

   **Option B: Nginx**
   ```nginx
   location / {
       root /path/to/spettromiao-webapp/pi-loader;
       index index.html;
   }
   ```

## Usage

1. Connect your phone to the Pi's WiFi network (`spettromiao`)
2. Open `https://192.168.4.1` in your browser
3. First time: Loader downloads app from GitHub (needs internet via Pi or mobile data)
4. Subsequent uses: Works fully offline from cache
5. Start using the app!

## Updating the Webapp

1. Make changes to files
2. Bump version in `version.txt` (e.g., `0.2.10` → `0.2.11`)
3. Commit and push to GitHub

```bash
echo "0.2.11" > version.txt
git add .
git commit -m "Update webapp"
git push
```

The Pi-loader detects the new version and downloads updates when internet is available. Users can also check for updates manually via Settings > Check for Updates.

## File Structure

```
spettromiao-webapp/
├── index.html          # Main app page
├── manifest.json       # PWA manifest
├── sw.js               # Service worker (local dev only)
├── version.txt         # Version for cache busting
├── css/
│   └── style.css       # Styles
├── js/
│   ├── app.js          # Main app logic, Pi connectivity
│   ├── db.js           # IndexedDB storage
│   ├── i18n.js         # Internationalization
│   ├── identifier.js   # Spectrum identification
│   └── sync.js         # CouchDB sync
├── locales/
│   ├── en.json         # English translations
│   └── it.json         # Italian translations
├── data/
│   └── library.json    # Reference spectra library
├── pi-loader/
│   └── index.html      # Loader served by Pi (fetches app from GitHub)
└── icons/              # PWA icons
```

## Development

### Testing Locally

```bash
# Serve the app locally
python -m http.server 8000
# Open http://localhost:8000
```

When running on localhost, the app uses relative API URLs (same origin). Locale files are served directly via HTTP; the service worker handles caching for local development.

## Pi Connectivity

The app uses relative URLs for all API calls (same origin), since the Pi serves the app via pi-loader.

The app shows a warning banner when the Pi is not reachable:
- Checks connectivity every 2 seconds when disconnected
- Checks every 10 seconds when connected (battery friendly)
- Navigation to Step 2 (Calibration) is blocked until connected

## Features

- **Wizard-style interface** for field testing
- **Pi-hosted deployment** via lightweight loader
- **Offline-capable** with IndexedDB caching
- **Local data storage** using IndexedDB
- **Optional sync** to CouchDB server
- **Browser-based spectrum identification** with reference library
- **Internationalization** (English and Italian)
- **Dark mode** support
- **PWA-ready** with manifest and icons

## License

MIT
