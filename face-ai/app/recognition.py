"""
Face recognition built on OpenCV and face_recognition (dlib).

Division of labour, and why it is split this way:

  OpenCV            decodes the upload, converts colour spaces, measures whether
                    the frame is even worth recognising (Laplacian sharpness,
                    mean brightness) and lifts contrast with CLAHE when the room
                    is dark. Rejecting a bad frame here costs milliseconds;
                    letting it through costs a wrong identity.

  face_recognition  locates faces (dlib HOG or CNN), reads the 68 landmarks and
                    turns the aligned face into a 128-D encoding from dlib's
                    ResNet. Identity is decided by Euclidean distance between
                    encodings, which is what the library is built around.

face_recognition wants RGB; OpenCV decodes to BGR. Every conversion below is
explicit for that reason — a silent channel swap does not crash, it just
quietly makes every comparison wrong.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import cv2
import numpy as np

try:
    import dlib
    import face_recognition

    LIBRARY_AVAILABLE = True
    IMPORT_ERROR = ""
except Exception as error:  # pragma: no cover - import guard
    LIBRARY_AVAILABLE = False
    IMPORT_ERROR = str(error)


ENGINE_NAME = "face_recognition"

# dlib's ResNet encoder is 128-D and its authors calibrate identity at a
# Euclidean distance of 0.6. Anything tighter trades false accepts for people
# being turned away at the door.
ENCODING_DIMENSION = 128
DEFAULT_TOLERANCE = 0.6

# "hog" runs on a CPU in tens of milliseconds; "cnn" is markedly more accurate
# on angled faces but needs a GPU to be usable in a queue.
DETECTOR_MODEL = os.environ.get("FACE_DETECTOR", "hog").lower()
TOLERANCE = float(os.environ.get("FACE_MATCH_TOLERANCE", DEFAULT_TOLERANCE))
# Passes over the image during encoding. More passes, steadier encoding, and
# the cost is linear.
ENCODING_JITTERS = int(os.environ.get("FACE_ENCODING_JITTERS", "1"))


@dataclass(frozen=True)
class QualityReport:
    """What OpenCV can say about the frame before anyone is identified."""

    sharpness: float
    brightness: float
    contrast_boosted: bool


def library_versions() -> dict[str, str]:
    return {
        "opencv": cv2.__version__,
        "dlib": getattr(dlib, "__version__", "unavailable") if LIBRARY_AVAILABLE else "unavailable",
        "face_recognition": "1.3.0" if LIBRARY_AVAILABLE else "unavailable",
        "numpy": np.__version__,
    }


def to_rgb(image_bgr: np.ndarray) -> np.ndarray:
    """OpenCV decodes BGR, face_recognition reads RGB."""
    return cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)


def measure_quality(image_bgr: np.ndarray) -> tuple[np.ndarray, QualityReport]:
    """
    Sharpness is the variance of the Laplacian: a blurred frame has little
    high-frequency detail, so that variance collapses. Brightness is the mean
    grey level. When the frame is dark, CLAHE equalises contrast in small tiles
    instead of stretching the whole histogram, which keeps a backlit face from
    being flattened into white.
    """
    grayscale = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    sharpness = float(cv2.Laplacian(grayscale, cv2.CV_64F).var())
    brightness = float(np.mean(grayscale))

    boosted = False
    if brightness < 80:
        lab = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2LAB)
        lightness, a_channel, b_channel = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        lab = cv2.merge((clahe.apply(lightness), a_channel, b_channel))
        image_bgr = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
        boosted = True

    return image_bgr, QualityReport(sharpness, brightness, boosted)


def locate_faces(image_rgb: np.ndarray) -> list[tuple[int, int, int, int]]:
    """
    Boxes as (x1, y1, x2, y2). face_recognition returns (top, right, bottom,
    left), which is the opposite order to everything else in this codebase, so
    it is converted once here rather than at every call site.
    """
    if not LIBRARY_AVAILABLE:
        return []
    found = face_recognition.face_locations(image_rgb, model=DETECTOR_MODEL)
    return [(left, top, right, bottom) for (top, right, bottom, left) in found]


def landmark_count(image_rgb: np.ndarray, box: tuple[int, int, int, int]) -> int:
    """
    How many landmark points dlib could place. The model is the 68-point one,
    but face_recognition groups the points and repeats the closing point of the
    eyes and lips, so a well-read face totals 72 rather than 68. The number is
    used as a floor, not an identity: a face dlib can barely read produces an
    encoding nobody should trust.
    """
    if not LIBRARY_AVAILABLE:
        return 0
    x1, y1, x2, y2 = box
    groups = face_recognition.face_landmarks(image_rgb, face_locations=[(y1, x2, y2, x1)])
    return sum(len(points) for points in groups[0].values()) if groups else 0


def encode(image_rgb: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    """The 128-D encoding dlib's ResNet produces for one located face."""
    if not LIBRARY_AVAILABLE:
        raise RuntimeError("FACE_LIBRARY_NOT_AVAILABLE")
    x1, y1, x2, y2 = box
    encodings = face_recognition.face_encodings(
        image_rgb, known_face_locations=[(y1, x2, y2, x1)], num_jitters=ENCODING_JITTERS
    )
    if not encodings:
        raise RuntimeError("FACE_ENCODING_FAILED")
    return encodings[0].astype(np.float32)


def compare(candidate: np.ndarray, reference: np.ndarray) -> tuple[float, float, bool]:
    """
    Returns (distance, similarity, matched).

    Distance is what face_recognition actually computes and what the tolerance
    is calibrated against. Similarity is only a friendlier reading of the same
    number for the interface — it is not a probability, and no decision is made
    from it.
    """
    distance = float(face_recognition.face_distance([reference], candidate)[0])
    similarity = float(max(0.0, 1.0 - distance / (2.0 * TOLERANCE)))
    return distance, similarity, distance <= TOLERANCE


def annotate(image_bgr: np.ndarray, boxes: list[tuple[int, int, int, int]]) -> bytes:
    """The detected face drawn onto the frame, for showing a human what the
    detector actually saw."""
    canvas = image_bgr.copy()
    for x1, y1, x2, y2 in boxes:
        cv2.rectangle(canvas, (x1, y1), (x2, y2), (16, 185, 129), 2)
    ok, buffer = cv2.imencode(".jpg", canvas, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    return buffer.tobytes() if ok else b""


def describe() -> dict:
    return {
        "engine": ENGINE_NAME,
        "available": LIBRARY_AVAILABLE,
        "detector": f"dlib {DETECTOR_MODEL.upper()}",
        "encoder": "dlib ResNet (face_recognition)",
        "dimension": ENCODING_DIMENSION,
        "tolerance": TOLERANCE,
        "jitters": ENCODING_JITTERS,
        "preprocessing": [
            "cv2.imdecode",
            "cv2.cvtColor BGR→GRAY",
            "cv2.Laplacian variance (độ nét)",
            "cv2.createCLAHE (bù sáng)",
            "cv2.cvtColor BGR→RGB",
        ],
        "versions": library_versions(),
        "error": IMPORT_ERROR,
    }
