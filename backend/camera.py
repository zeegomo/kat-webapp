"""Local camera interface for Raspberry Pi using picamera2."""

import io
import logging
import os
import subprocess
import tempfile
import threading
import time
from collections import deque
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# picamera2 is only available on Raspberry Pi
try:
    from picamera2 import Picamera2
    from picamera2.encoders import MJPEGEncoder
    from picamera2.outputs import FileOutput
    PICAMERA2_AVAILABLE = True
    logger.info("picamera2 imported successfully")
except ImportError as e:
    PICAMERA2_AVAILABLE = False
    logger.warning("picamera2 not available: %s", e)


class StreamOutput(io.BufferedIOBase):
    """Thread-safe output buffer for MJPEG streaming."""

    def __init__(self) -> None:
        self._buffer = io.BytesIO()
        self._frame: Optional[bytes] = None
        self._condition = threading.Condition()

    def writable(self) -> bool:
        return True

    def write(self, data: bytes) -> int:
        """
        picamera2 encoders write each JPEG frame in chunks.

        Detect the start of a new JPEG (SOI marker) and publish the previously
        accumulated buffer as a complete frame.
        """
        with self._condition:
            if data[:2] == b"\xff\xd8":
                frame = self._buffer.getvalue()
                if frame:
                    self._frame = frame
                    self._condition.notify_all()
                self._buffer.seek(0)
                self._buffer.truncate(0)

            return self._buffer.write(data)

    def get_frame(self, timeout: float = 1.0) -> Optional[bytes]:
        """Get the next available frame, waiting up to `timeout` seconds."""
        with self._condition:
            start_frame = self._frame
            deadline = time.monotonic() + timeout

            while self._frame is None or self._frame is start_frame:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                self._condition.wait(timeout=remaining)

            return self._frame


class LocalCamera:
    """
    Local camera interface using picamera2.

    Provides capture and streaming functionality for the mobile webapp
    running directly on the Raspberry Pi.

    Example:
        >>> camera = LocalCamera()
        >>> camera.start_preview()
        >>> frame = camera.get_frame()
        >>> camera.stop_preview()
        >>> jpeg_bytes = camera.capture_photo(shutter_us=5000000, gain=100)
    """

    def __init__(self):
        """Initialize local camera."""
        self._camera: Optional["Picamera2"] = None
        self._stream_output: Optional[StreamOutput] = None
        self._encoder: Optional["MJPEGEncoder"] = None
        self._streaming = False
        self._lock = threading.RLock()

        # Stream statistics (protected by _lock)
        self._frame_count = 0
        self._last_frame_time = 0.0
        self._fps = 0.0
        self._frame_times: deque[float] = deque(maxlen=30)
        self._exposure_time = 0  # microseconds, from camera metadata

    def _get_camera(self) -> "Picamera2":
        """Get or create camera instance."""
        if not PICAMERA2_AVAILABLE:
            raise RuntimeError("picamera2 is not available. This must run on a Raspberry Pi.")

        if self._camera is None:
            self._camera = Picamera2()
        return self._camera

    def start_preview(
        self,
        width: int = 640,
        height: int = 480,
        framerate: int = 15,
    ) -> None:
        """
        Start MJPEG preview streaming.

        Args:
            width: Preview width in pixels
            height: Preview height in pixels
            framerate: Target frames per second
        """
        logger.info("LocalCamera.start_preview() called")
        with self._lock:
            if self._streaming:
                logger.info("Already streaming, returning early")
                return

            logger.info("Getting camera instance...")
            camera = self._get_camera()

            # Configure for video preview
            logger.info("Creating video config (%dx%d @ %d fps)...", width, height, framerate)
            video_config = camera.create_video_configuration(
                main={"size": (width, height), "format": "RGB888"},
                encode="main",
                controls={"FrameRate": framerate},
            )
            logger.info("Configuring camera...")
            camera.configure(video_config)

            # Set up MJPEG streaming output
            logger.info("Setting up MJPEG encoder and output...")
            self._stream_output = StreamOutput()
            self._encoder = MJPEGEncoder()
            output = FileOutput(self._stream_output)

            logger.info("Starting recording...")
            camera.start_recording(self._encoder, output)
            self._streaming = True
            self._frame_count = 0
            self._frame_times = deque(maxlen=30)
            logger.info("Preview started successfully, _streaming=%s", self._streaming)

    def stop_preview(self) -> None:
        """Stop preview streaming."""
        with self._lock:
            if not self._streaming:
                return

            if self._camera:
                # Nuclear option: fully close camera to avoid picamera2 hang issues
                # See: https://github.com/raspberrypi/picamera2/issues/554
                # See: https://github.com/raspberrypi/picamera2/issues/858
                try:
                    self._camera.stop_recording()
                except Exception:
                    pass
                try:
                    self._camera.stop()
                except Exception:
                    pass
                try:
                    self._camera.close()
                except Exception:
                    pass
                self._camera = None

            self._encoder = None
            self._streaming = False
            self._stream_output = None
            self._fps = 0.0
            self._last_frame_time = 0.0  # Reset so time_since_frame doesn't show stale values

    def get_frame(self) -> Optional[bytes]:
        """
        Get the latest preview frame.

        Returns:
            JPEG frame data, or None if not streaming
        """
        # Copy reference under lock to avoid race with stop_preview()
        with self._lock:
            if not self._streaming:
                return None
            stream_output = self._stream_output

        if stream_output is None:
            return None

        frame = stream_output.get_frame()

        if frame:
            # Update statistics under lock
            now = time.time()
            with self._lock:
                self._frame_count += 1
                self._frame_times.append(now)
                # deque with maxlen handles size limiting automatically

                if len(self._frame_times) > 1:
                    time_diff = self._frame_times[-1] - self._frame_times[0]
                    if time_diff > 0:
                        self._fps = (len(self._frame_times) - 1) / time_diff

                self._last_frame_time = now

                # Capture exposure metadata
                if self._camera:
                    try:
                        metadata = self._camera.capture_metadata()
                        self._exposure_time = metadata.get("ExposureTime", 0)
                    except Exception:
                        pass  # Ignore metadata errors

        return frame

    def get_stats(self) -> Tuple[int, float, float, int]:
        """
        Get streaming statistics.

        Returns:
            Tuple of (frame_count, fps, seconds_since_last_frame, exposure_us)
        """
        with self._lock:
            time_since_frame = 0.0
            if self._last_frame_time > 0:
                time_since_frame = time.time() - self._last_frame_time
            return (self._frame_count, self._fps, time_since_frame, self._exposure_time)

    def is_streaming(self) -> bool:
        """Check if preview is currently streaming."""
        return self._streaming

    def capture_photo(
        self,
        shutter_us: int = 5000000,
        gain: float = 100.0,
    ) -> bytes:
        """
        Capture a single photo and return as JPEG bytes.

        Uses rpicam-still command-line tool for capture.

        Args:
            shutter_us: Shutter speed in microseconds
            gain: Camera gain

        Returns:
            JPEG image data as bytes
        """
        logger.info("capture_photo() called with shutter_us=%d, gain=%f", shutter_us, gain)

        with self._lock:
            # Stop preview if running (rpicam-still needs exclusive camera access)
            if self._camera is not None:
                logger.info("Stopping preview before capture...")
                if self._streaming:
                    try:
                        self._camera.stop_recording()
                    except Exception:
                        pass
                try:
                    self._camera.stop()
                except Exception:
                    pass
                try:
                    self._camera.close()
                except Exception:
                    pass
                self._camera = None
                self._encoder = None
                self._streaming = False
                self._stream_output = None
                logger.info("Preview stopped")

            # Capture using rpicam-still
            with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp:
                tmp_path = tmp.name

            logger.info("Temp file created: %s", tmp_path)

            try:
                cmd = [
                    'rpicam-still',
                    '--immediate',
                    '--nopreview',
                    '--shutter', str(shutter_us),
                    '--gain', str(gain),
                    '-o', tmp_path,
                ]
                logger.info("Running command: %s", ' '.join(cmd))

                result = subprocess.run(cmd, capture_output=True, text=True)

                logger.info("rpicam-still exit code: %d", result.returncode)
                if result.stdout:
                    logger.info("rpicam-still stdout: %s", result.stdout)
                if result.stderr:
                    logger.info("rpicam-still stderr: %s", result.stderr)

                if result.returncode != 0:
                    raise RuntimeError(f"rpicam-still failed: {result.stderr}")

                with open(tmp_path, 'rb') as f:
                    jpeg_bytes = f.read()

                logger.info("Captured %d bytes", len(jpeg_bytes))
            finally:
                # Clean up temp file
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass

        return jpeg_bytes

    def close(self) -> None:
        """Release camera resources."""
        with self._lock:
            if self._streaming:
                self.stop_preview()

            if self._camera:
                self._camera.close()
                self._camera = None

    def __enter__(self) -> "LocalCamera":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()


# Mock camera for development/testing on non-Pi systems
class MockCamera:
    """Mock camera for testing on non-Raspberry Pi systems."""

    def __init__(self):
        self._streaming = False
        self._frame_count = 0

    def start_preview(self, width: int = 640, height: int = 480, framerate: int = 15) -> None:
        self._streaming = True
        self._frame_count = 0

    def stop_preview(self) -> None:
        self._streaming = False

    def get_frame(self) -> Optional[bytes]:
        if not self._streaming:
            return None

        # Return a minimal valid JPEG (1x1 red pixel)
        self._frame_count += 1
        return bytes([
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
            0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
            0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
            0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
            0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
            0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
            0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
            0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
            0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
            0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
            0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
            0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
            0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
            0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08,
            0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72,
            0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
            0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45,
            0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
            0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75,
            0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
            0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3,
            0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6,
            0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9,
            0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
            0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4,
            0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01,
            0x00, 0x00, 0x3F, 0x00, 0xFB, 0xD5, 0xDB, 0x20, 0xA8, 0xBA, 0xAE, 0xAF,
            0xE7, 0xFF, 0xD9
        ])

    def get_stats(self) -> Tuple[int, float, float, int]:
        # Return mock exposure of 5000us (5ms) when streaming
        return (self._frame_count, 15.0 if self._streaming else 0.0, 0.0, 5000 if self._streaming else 0)

    def is_streaming(self) -> bool:
        return self._streaming

    def capture_photo(
        self,
        shutter_us: int = 5000000,
        gain: float = 100.0,
    ) -> bytes:
        """Return mock JPEG bytes."""
        return self.get_frame() or b""

    def close(self) -> None:
        self._streaming = False

    def __enter__(self) -> "MockCamera":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()


def get_camera() -> "LocalCamera | MockCamera":
    """
    Get appropriate camera instance based on platform.

    Returns LocalCamera on Raspberry Pi, MockCamera otherwise.
    """
    if PICAMERA2_AVAILABLE:
        logger.info("Creating LocalCamera (picamera2 available)")
        return LocalCamera()
    else:
        logger.info("Creating MockCamera (picamera2 NOT available)")
        return MockCamera()
