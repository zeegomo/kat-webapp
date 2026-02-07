"""REST API routes for KAT mobile webapp.

Stateless API - all data returned inline, no server-side persistence.
Browser stores all session data and files in IndexedDB.
"""

import base64
import io
import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Generator

from flask import Blueprint, Response, current_app, jsonify, request

logger = logging.getLogger(__name__)

api_bp = Blueprint("api", __name__)


# ============================================================================
# Settings Endpoints (ephemeral - for current capture session only)
# ============================================================================


@api_bp.route("/settings", methods=["GET"])
def get_settings():
    """Get current camera settings."""
    return jsonify(current_app.config["settings"])


@api_bp.route("/settings", methods=["POST"])
def update_settings():
    """Update camera settings (ephemeral, not persisted)."""
    data = request.get_json()
    settings = current_app.config["settings"]

    # Update allowed fields
    for key in ["shutter", "gain", "laser_wavelength"]:
        if key in data:
            try:
                settings[key] = float(data[key])
            except (ValueError, TypeError):
                return jsonify({"error": f"Invalid value for {key}"}), 400

    # Handle boolean field
    if "laser_auto_detect" in data:
        settings["laser_auto_detect"] = bool(data["laser_auto_detect"])

    current_app.config["settings"] = settings
    return jsonify(settings)


@api_bp.route("/calibration", methods=["GET"])
def get_calibration_status():
    """Check calibration file status."""
    data_dir = current_app.config["DATA_DIR"]
    calibration_dir = data_dir / "calibration"

    camera_cal = calibration_dir / "calib_results.npz"
    wavelength_cal = calibration_dir / "calibration.json"

    return jsonify({
        "camera_calibration": camera_cal.exists(),
        "wavelength_calibration": wavelength_cal.exists(),
        "calibration_dir": str(calibration_dir),
    })


# ============================================================================
# Preview Endpoints
# ============================================================================


@api_bp.route("/preview/stream", methods=["GET"])
def preview_stream():
    """MJPEG stream endpoint for live preview."""
    camera = current_app.config["camera"]

    def generate() -> Generator[bytes, None, None]:
        while camera.is_streaming():
            frame = camera.get_frame()
            if frame:
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
                )
            else:
                # Brief sleep to prevent CPU spin when no frame is available
                time.sleep(0.01)

    return Response(
        generate(),
        mimetype="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@api_bp.route("/preview/start", methods=["POST"])
def start_preview():
    """Start camera preview."""
    logger.info("Preview start requested")
    camera = current_app.config["camera"]

    # Note: start_preview() handles the "already streaming" case internally under lock,
    # so we don't check is_streaming() here to avoid a TOCTOU race condition.
    try:
        camera.start_preview(
            width=640,
            height=480,
            framerate=15,
        )
        logger.info("Preview started successfully, streaming=%s", camera.is_streaming())
    except Exception as e:
        logger.error("Failed to start preview: %s", e, exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500

    return jsonify({"status": "ok", "message": "Preview started"})


@api_bp.route("/preview/stop", methods=["POST"])
def stop_preview():
    """Stop camera preview."""
    logger.info("Preview stop requested")
    camera = current_app.config["camera"]
    camera.stop_preview()
    logger.info("Preview stopped")

    return jsonify({"status": "ok", "message": "Preview stopped"})


@api_bp.route("/preview/status", methods=["GET"])
def preview_status():
    """Get preview streaming status."""
    camera = current_app.config["camera"]
    frame_count, fps, time_since, exposure_us = camera.get_stats()
    is_streaming = camera.is_streaming()

    logger.debug(
        "Preview status: streaming=%s, frames=%d, fps=%.1f, time_since=%.2f, exp=%d",
        is_streaming, frame_count, fps, time_since, exposure_us
    )

    return jsonify({
        "streaming": is_streaming,
        "frame_count": frame_count,
        "fps": round(fps, 1),
        "time_since_frame": round(time_since, 2),
        "exposure_us": exposure_us,
    })


# ============================================================================
# Capture Endpoint - Returns all data inline (stateless)
# ============================================================================


@api_bp.route("/capture", methods=["POST"])
def capture():
    """
    Capture photo, extract spectrum, and identify.

    Returns JSON result with all data inline as base64 - nothing saved to disk.
    Browser is responsible for storing data in IndexedDB.
    """
    camera = current_app.config["camera"]
    settings = current_app.config["settings"]
    data_dir = current_app.config["DATA_DIR"]

    result = {
        "success": False,
        "timestamp": None,
        "photo": None,  # base64 JPEG
        "spectrum": None,  # JSON dict
        "preprocessed_spectrum": None,  # Preprocessed array for browser identification
        "csv": None,  # CSV string
        "summary_plot": None,  # base64 PNG
        "laser_wavelength": None,
        "detection_mode": None,
        "error": None,
    }

    try:
        # Step 1: Capture photo
        shutter_us = int(settings["shutter"] * 1_000_000)
        gain = settings["gain"]

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        result["timestamp"] = timestamp

        # Camera now returns bytes directly
        photo_bytes = camera.capture_photo(
            shutter_us=shutter_us,
            gain=gain,
        )
        result["photo"] = base64.b64encode(photo_bytes).decode("ascii")

        # Step 2: Extract spectrum
        spectrum = None

        try:
            import cv2
            import numpy as np
            import ramanspy as rp
            import matplotlib
            matplotlib.use('Agg')  # Non-interactive backend
            import matplotlib.pyplot as plt
            from kat.acquisition.image_processing import extract_spectrum_calibrated
            from kat.webapp.utils.plotting import create_summary_plot
            from kat.ml.common.preprocessing import get_standard_preprocessing_pipeline

            # Load calibration paths
            calibration_dir = data_dir / "calibration"
            camera_cal = calibration_dir / "calib_results.npz"
            wavelength_cal = calibration_dir / "calibration.json"

            if camera_cal.exists() and wavelength_cal.exists():
                # Decode JPEG bytes to numpy array
                nparr = np.frombuffer(photo_bytes, np.uint8)
                image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                # Determine laser wavelength (auto-detect or manual)
                laser_nm = None  # Auto-detect
                if not settings.get("laser_auto_detect", True):
                    laser_nm = settings.get("laser_wavelength", 785.0)

                spectrum = extract_spectrum_calibrated(
                    image=image,
                    calibration_file=str(wavelength_cal),
                    camera_calibration_file=str(camera_cal),
                    laser_wavelength_nm=laser_nm,
                )

                # Convert spectrum to JSON
                result["spectrum"] = spectrum.to_json_dict()

                # Get laser detection info
                acq_params = spectrum.acquisition_parameters or {}
                result["laser_wavelength"] = acq_params.get("laser_wavelength_nm")
                result["detection_mode"] = acq_params.get("laser_detection_mode")

                # Generate CSV as string
                csv_lines = ["wavenumber,intensity"]
                for wn, intensity in zip(spectrum.spectrum.spectral_axis, spectrum.spectrum.spectral_data.flatten()):
                    csv_lines.append(f"{wn},{intensity}")
                result["csv"] = "\n".join(csv_lines)

                # Preprocess spectrum for browser identification
                try:
                    target_axis = np.arange(500.0, 1801.0, 1.0)  # 1301 points
                    resampled = spectrum.resample_to_axis(target_axis)
                    spec_obj = rp.Spectrum(resampled.spectrum.spectral_data, target_axis)
                    pipeline = get_standard_preprocessing_pipeline()
                    processed = pipeline.apply(spec_obj)
                    result["preprocessed_spectrum"] = processed.spectral_data.flatten().astype(np.float32).tolist()
                except Exception as e:
                    logger.warning(f"Spectrum preprocessing failed: {e}")

                # Create summary plot to BytesIO
                try:
                    # Create a temporary file-like object for the photo
                    photo_buffer = io.BytesIO(photo_bytes)
                    summary_fig = create_summary_plot(
                        spectrum=spectrum,
                        photo_path=photo_buffer,
                    )
                    summary_buffer = io.BytesIO()
                    summary_fig.savefig(summary_buffer, format='png', dpi=100, bbox_inches="tight")
                    plt.close(summary_fig)
                    summary_buffer.seek(0)
                    result["summary_plot"] = base64.b64encode(summary_buffer.getvalue()).decode("ascii")
                except Exception as e:
                    logger.warning(f"Summary plot generation failed: {e}")

        except ImportError as e:
            logger.warning(f"Spectrum extraction not available: {e}")
        except Exception as e:
            logger.error(f"Spectrum extraction failed: {e}")

        result["success"] = True

    except Exception as e:
        logger.exception("Capture failed")
        result["error"] = str(e)

    return jsonify(result)
