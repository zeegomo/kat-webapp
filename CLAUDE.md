# CLAUDE.md

## Project Overview

This is **spettromiao Webapp**, a mobile web application for a DIY Raman spectrometer. The frontend runs in the browser and communicates with a Raspberry Pi API server.

## Version Management

**IMPORTANT**: Always bump the version number in `version.txt` when making changes that include new features or bug fixes.

- Current version format: `X.Y.Z` (e.g., `0.2.9`)
- For now, always increment only the **last number** (patch version)
- Example: `0.2.9` → `0.2.10` → `0.2.11`

After making changes:
```bash
# Read current version, increment last number, and save
# e.g., if version.txt contains "0.2.9", update it to "0.2.10"
```

## Key Files

```
├── index.html          # Main app page
├── version.txt         # Version number (bump on changes!)
├── manifest.json       # PWA manifest
├── sw.js               # Service worker for caching
├── css/
│   └── style.css       # Styles
├── js/
│   ├── app.js          # Main app logic, Pi connectivity, LNA detection
│   ├── db.js           # IndexedDB storage operations
│   ├── sync.js         # CouchDB sync functionality
│   ├── identifier.js   # Spectrum identification logic
│   └── i18n.js         # Internationalization
├── locales/
│   ├── en.json         # English translations
│   └── it.json         # Italian translations
├── data/
│   └── library.json    # Reference spectra library
└── pi-loader/
    └── index.html      # Fallback loader for Pi deployment
```

## Development

### Running Locally

```bash
python -m http.server 8000
# Open http://localhost:8000
```

### Testing

When running on localhost, the app uses relative API URLs (same origin) and won't attempt LNA.

## Commit Guidelines

1. Make your changes
2. Bump the version in `version.txt` (increment last number)
3. Commit with a descriptive message
4. Push to the appropriate branch
