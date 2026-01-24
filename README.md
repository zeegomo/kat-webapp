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
Follow the [Mobile PWA Setup](#setup) below to deploy via GitHub Pages.

### Deploy the Sync Server (Optional)
If you want to sync data across devices:
1. Set up a server (Ubuntu/Debian)
2. Follow the [server setup guide](server/README.md)
3. Configure the mobile app with your server URL and token

## Mobile PWA Architecture

The app supports two deployment methods:

### Method 1: GitHub Pages + Local Network Access (Recommended)

The app is served directly from GitHub Pages and uses **Local Network Access (LNA)** to communicate with the Pi:

```
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Pages + LNA                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   1. User connects phone to Pi's WiFi (spettromiao)             │
│                                                                 │
│   2. Opens your GitHub Pages URL in browser                     │
│      └── https://yourusername.github.io/spettromiao-webapp              │
│                                                                 │
│   3. App served from GitHub (HTTPS) communicates with Pi        │
│      └── Uses Local Network Access to reach https://192.168.4.1 │
│                                                                 │
│   4. Browser prompts to allow private network access            │
│      └── User grants permission once                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Benefits:**
- Updates automatically from GitHub (no Pi deployment needed)
- Simple setup - just enable GitHub Pages
- Secure HTTPS connection

**Requirements:** Chrome/Edge/Safari (iOS 17+)

### Method 2: Pi-Loader (Fallback)

For browsers without LNA support or fully offline scenarios:

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
- Works in any browser (no LNA needed)
- Fully offline after first load
- No permission prompts
- Same-origin API calls

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

### Step 3: (Optional) Set up Pi-Loader for Fallback

If you want to support browsers without LNA or provide a fallback:

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

### Method 1: GitHub Pages + LNA (Recommended)

1. Connect your phone to the Pi's WiFi network (`spettromiao`)
2. Open your GitHub Pages URL: `https://yourusername.github.io/spettromiao-webapp`
3. Browser will prompt to allow access to devices on local network
4. Grant permission - this allows the app to communicate with the Pi
5. Accept the Pi's SSL certificate if prompted
6. Start using the app!

### Method 2: Pi-Loader (Fallback)

1. Connect your phone to the Pi's WiFi network (`spettromiao`)
2. Open `https://192.168.4.1` in your browser
3. First time: Loader downloads app from GitHub (needs internet via Pi or mobile data)
4. Subsequent uses: Works fully offline from cache
5. Start using the app!

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

Updates are deployed automatically:
- **GitHub Pages + LNA**: Users get the new version on their next visit (or after refresh)
- **Pi-Loader**: Loader detects the new version and downloads updates when internet is available

## File Structure

```
spettromiao-webapp/
├── index.html          # Main app page
├── manifest.json       # PWA manifest
├── sw.js               # Service worker
├── version.txt         # Version for cache busting
├── css/
│   └── style.css       # Styles
├── js/
│   ├── app.js          # Main app logic (includes LNA detection)
│   ├── db.js           # IndexedDB storage
│   ├── identifier.js   # Spectrum identification
│   └── sync.js         # CouchDB sync
├── data/
│   └── library.json    # Reference spectra library
├── pi-loader/
│   └── index.html      # Fallback loader for Pi (fetches from GitHub)
└── icons/              # PWA icons
```

## Development

### Testing Locally

```bash
# Serve the app locally
python -m http.server 8000
# Open http://localhost:8000
```

When running on localhost, the app automatically uses relative API URLs (same origin), so it won't attempt to use Local Network Access.

### Testing with GitHub Pages

You can test the full LNA flow by:
1. Deploying to GitHub Pages
2. Connecting to the Pi's WiFi
3. Opening your GitHub Pages URL
4. Granting LNA permission when prompted

For UI development without the Pi, you can still access GitHub Pages, but API calls will fail gracefully.

## Pi Connectivity

The app automatically detects whether it needs Local Network Access based on where it's served from:
- When served from GitHub Pages: Uses LNA to communicate with `https://192.168.4.1`
- When served from localhost/Pi: Uses relative URLs (same origin)

The app shows a warning banner when the Pi is not reachable:
- Checks connectivity every 2 seconds when disconnected
- Checks every 10 seconds when connected (battery friendly)
- Navigation to Step 2 (Calibration) is blocked until connected

## Features

- **Wizard-style interface** for field testing
- **Local Network Access** for Pi communication from GitHub Pages
- **Offline-capable** with service worker caching
- **Local data storage** using IndexedDB
- **Optional sync** to CouchDB server
- **Browser-based spectrum identification** with reference library
- **Dark mode** support
- **PWA-ready** with manifest and icons

## License

MIT
