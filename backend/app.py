"""Flask-based mobile webapp for KAT spectrometer.

Stateless server - all session data stored in browser IndexedDB.
Pi only handles camera operations and spectrum processing.
Serves the frontend directly from the repo root.
"""

import atexit
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
from flask import Flask, send_from_directory
from flask_cors import CORS

from .camera import get_camera

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Log file path (inside data directory)
LOG_DIR = Path("~/.kat/logs").expanduser()

# Data directory (only for calibration files and library - read-only)
DATA_DIR = Path("~/.kat").expanduser()

# Frontend files are in the repo root (one level up from backend/)
FRONTEND_DIR = Path(__file__).resolve().parent.parent


def create_app() -> Flask:
    """Create and configure Flask application."""
    app = Flask(__name__)

    # Enable CORS for cross-origin API calls (webapp hosted on GitHub Pages)
    # allow_private_network=True enables Private Network Access for older Chrome versions
    CORS(app, resources={r"/api/*": {"origins": "*"}}, allow_private_network=True)

    # Set up rotating file handler for centralized log collection
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_file = LOG_DIR / "backend.log"
    file_handler = RotatingFileHandler(
        log_file, maxBytes=2 * 1024 * 1024, backupCount=3  # 2MB per file, 3 backups
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(logging.Formatter(
        "%(asctime)s\t%(levelname)s\t%(name)s\t%(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    ))
    # Add to root logger so all modules' logs are captured
    logging.getLogger().addHandler(file_handler)
    app.config["LOG_FILE"] = log_file

    # Store global state in app config
    camera = get_camera()
    app.config["camera"] = camera
    app.config["DATA_DIR"] = DATA_DIR
    atexit.register(camera.close)

    # Ephemeral settings (not persisted - browser owns the settings)
    app.config["settings"] = {
        "shutter": 5.0,  # seconds
        "gain": 100.0,
        "laser_auto_detect": True,
        "laser_wavelength": 785.0,
    }

    # Register API routes
    from .routes import api_bp
    app.register_blueprint(api_bp, url_prefix="/api")

    @app.route("/")
    def index():
        """Serve the main app page."""
        return send_from_directory(FRONTEND_DIR, "index.html")

    @app.route("/<path:filename>")
    def serve_static(filename):
        """Serve frontend static files (CSS, JS, data, locales, icons, etc.)."""
        return send_from_directory(FRONTEND_DIR, filename)

    return app


def main():
    """Run the mobile webapp."""
    app = create_app()

    logger.info("Starting KAT Mobile Webapp (stateless mode)")
    logger.info(f"Data directory: {DATA_DIR}")
    logger.info(f"Frontend directory: {FRONTEND_DIR}")

    # Run on all interfaces so phone can connect
    app.run(
        host="0.0.0.0",
        port=1312,
        debug=False,
        threaded=True,
    )


if __name__ == "__main__":
    main()
