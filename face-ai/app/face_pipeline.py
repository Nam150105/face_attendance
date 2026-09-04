from __future__ import annotations

import os
from dataclasses import dataclass

import cv2
import numpy as np


class FacePipelineError(ValueError):
    pass


@dataclass(frozen=True)
class FaceAnalysis:
    face_count: int
    blur_score: float | None
    brightness_score: float | None
    face_box: tuple[int, int, int, int] | None


class FacePipeline:
    def __init__(self) -> None:
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        self.detector = cv2.CascadeClassifier(cascade_path)
        if self.detector.empty():
            raise RuntimeError("OpenCV face detector could not be loaded")
        self.embeddings_enabled = os.environ.get("FACE_AI_ENABLE_EMBEDDINGS", "false").lower() == "true"

    def decode(self, image_bytes: bytes) -> np.ndarray:
        if not image_bytes or len(image_bytes) > 10 * 1024 * 1024:
            raise FacePipelineError("IMAGE_INVALID")
        image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None or image.size == 0:
            raise FacePipelineError("IMAGE_INVALID")
        height, width = image.shape[:2]
        if width < 160 or height < 160:
            raise FacePipelineError("IMAGE_TOO_SMALL")
        return image

    def analyze(self, image_bytes: bytes) -> FaceAnalysis:
        image = self.decode(image_bytes)
        grayscale = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        faces = self.detector.detectMultiScale(grayscale, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))
        blur_score = float(cv2.Laplacian(grayscale, cv2.CV_64F).var())
        brightness_score = float(np.mean(grayscale))
        face_box = tuple(int(value) for value in faces[0]) if len(faces) == 1 else None
        return FaceAnalysis(len(faces), blur_score, brightness_score, face_box)

    def validate_enrollment(self, image_bytes: bytes) -> FaceAnalysis:
        analysis = self.analyze(image_bytes)
        if analysis.face_count == 0:
            raise FacePipelineError("FACE_NOT_FOUND")
        if analysis.face_count > 1:
            raise FacePipelineError("MULTIPLE_FACES")
        if analysis.blur_score is not None and analysis.blur_score < 40:
            raise FacePipelineError("FACE_QUALITY_LOW")
        if analysis.brightness_score is not None and not 35 <= analysis.brightness_score <= 220:
            raise FacePipelineError("FACE_QUALITY_LOW")
        if not self.embeddings_enabled:
            raise FacePipelineError("FACE_MODEL_NOT_CONFIGURED")
        return analysis
