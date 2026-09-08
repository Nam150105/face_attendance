from __future__ import annotations

import os
from dataclasses import dataclass

import cv2
import numpy as np

from app import recognition
from app.model_runtime import ModelRuntime


class FacePipelineError(ValueError):
    pass


# Which engine decides identity. "face_recognition" is the dlib ResNet the
# project is built around; "arcface" is the ONNX alternative kept for
# comparison. They produce encodings of different length that mean different
# things, so an encoding made by one is never fed to the other.
ENGINE = os.environ.get("FACE_ENGINE", "face_recognition").lower()

MINIMUM_SHARPNESS = float(os.environ.get("FACE_MIN_SHARPNESS", "40"))
MINIMUM_BRIGHTNESS = float(os.environ.get("FACE_MIN_BRIGHTNESS", "35"))
MAXIMUM_BRIGHTNESS = float(os.environ.get("FACE_MAX_BRIGHTNESS", "220"))
# dlib places 68 landmarks on a face it can read properly. Well under that and
# the encoding is guesswork.
MINIMUM_LANDMARKS = int(os.environ.get("FACE_MIN_LANDMARKS", "60"))


@dataclass(frozen=True)
class FaceAnalysis:
    face_count: int
    blur_score: float | None
    brightness_score: float | None
    face_box: tuple[int, int, int, int] | None
    landmark_count: int = 0
    contrast_boosted: bool = False


class FacePipeline:
    def __init__(self, model_runtime: ModelRuntime | None = None) -> None:
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        self.cascade = cv2.CascadeClassifier(cascade_path)
        if self.cascade.empty():
            raise RuntimeError("OpenCV face detector could not be loaded")
        self.model_runtime = model_runtime

    # ----------------------------------------------------------- OpenCV stage

    def decode(self, image_bytes: bytes) -> np.ndarray:
        """OpenCV turns the uploaded bytes into a BGR matrix. Anything it cannot
        decode was never an image, whatever the client called it."""
        if not image_bytes or len(image_bytes) > 10 * 1024 * 1024:
            raise FacePipelineError("IMAGE_INVALID")
        image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None or image.size == 0:
            raise FacePipelineError("IMAGE_INVALID")
        height, width = image.shape[:2]
        if width < 160 or height < 160:
            raise FacePipelineError("IMAGE_TOO_SMALL")
        return image

    def prepare(self, image_bytes: bytes) -> tuple[np.ndarray, recognition.QualityReport]:
        """Decode, then let OpenCV judge and if needed rescue the frame."""
        return recognition.measure_quality(self.decode(image_bytes))

    # ------------------------------------------------------- detection stage

    def detect(self, image_bgr: np.ndarray) -> list[tuple[int, int, int, int]]:
        if ENGINE == "face_recognition" and recognition.LIBRARY_AVAILABLE:
            return recognition.locate_faces(recognition.to_rgb(image_bgr))
        if self.model_runtime is not None and self.model_runtime.ready:
            return [tuple(int(value) for value in box) for box, _ in self._detect_scrfd(image_bgr)]
        return self._detect_haar(image_bgr)

    def _detect_haar(self, image_bgr: np.ndarray) -> list[tuple[int, int, int, int]]:
        """OpenCV's Haar cascade — the fallback when no learned detector is
        loaded. Fast and old; misses angled faces the HOG detector catches."""
        grayscale = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
        boxes = self.cascade.detectMultiScale(grayscale, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))
        return [(int(x), int(y), int(x + width), int(y + height)) for x, y, width, height in boxes]

    # --------------------------------------------------------- analysis stage

    def analyze(self, image_bytes: bytes) -> tuple[np.ndarray, FaceAnalysis]:
        image, quality = self.prepare(image_bytes)
        boxes = self.detect(image)
        box = boxes[0] if len(boxes) == 1 else None
        landmarks = 0
        if box is not None and ENGINE == "face_recognition" and recognition.LIBRARY_AVAILABLE:
            landmarks = recognition.landmark_count(recognition.to_rgb(image), box)
        return image, FaceAnalysis(
            face_count=len(boxes),
            blur_score=quality.sharpness,
            brightness_score=quality.brightness,
            face_box=box,
            landmark_count=landmarks,
            contrast_boosted=quality.contrast_boosted,
        )

    def validate(self, analysis: FaceAnalysis, strict: bool) -> None:
        """
        `strict` is enrolment: the reference face is compared against for months,
        so a poor one poisons every check that follows. A daily check-in is held
        to the looser bar because the person is standing there waiting.
        """
        if analysis.face_count == 0:
            raise FacePipelineError("FACE_NOT_FOUND")
        if analysis.face_count > 1:
            raise FacePipelineError("MULTIPLE_FACES")
        if analysis.blur_score is not None and analysis.blur_score < MINIMUM_SHARPNESS:
            raise FacePipelineError("FACE_TOO_BLURRY")
        if analysis.brightness_score is not None and analysis.brightness_score < MINIMUM_BRIGHTNESS:
            raise FacePipelineError("LIGHTING_TOO_DARK")
        if analysis.brightness_score is not None and analysis.brightness_score > MAXIMUM_BRIGHTNESS:
            raise FacePipelineError("LIGHTING_TOO_BRIGHT")
        if strict and ENGINE == "face_recognition" and analysis.landmark_count < MINIMUM_LANDMARKS:
            raise FacePipelineError("FACE_NOT_CLEAR")

    # -------------------------------------------------------- encoding stage

    def encode(self, image_bgr: np.ndarray, box: tuple[int, int, int, int]) -> tuple[np.ndarray, str, int]:
        """Returns (encoding, engine name, dimension)."""
        if ENGINE == "face_recognition":
            if not recognition.LIBRARY_AVAILABLE:
                raise FacePipelineError("FACE_MODEL_NOT_CONFIGURED")
            try:
                vector = recognition.encode(recognition.to_rgb(image_bgr), box)
            except RuntimeError as error:
                raise FacePipelineError(str(error)) from error
            return vector, recognition.ENGINE_NAME, recognition.ENCODING_DIMENSION

        if self.model_runtime is None or not self.model_runtime.ready:
            raise FacePipelineError("FACE_MODEL_NOT_CONFIGURED")
        vector = self._embed_arcface(image_bgr, np.array(box, dtype=np.float32), np.empty((0, 2), dtype=np.float32))
        return vector, self.model_runtime.model_name, self.model_runtime.embedding_dimension

    def compare(self, candidate: np.ndarray, reference: np.ndarray) -> dict:
        """
        Identity, and the numbers behind it. face_recognition decides on
        Euclidean distance against its own tolerance; ArcFace on cosine
        similarity against a threshold. Both are reported the same way so the
        rest of the system does not have to know which engine ran.
        """
        if ENGINE == "face_recognition":
            distance, similarity, matched = recognition.compare(candidate, reference)
            return {
                "matched": matched,
                "metric": "euclidean_distance",
                "distance": distance,
                "similarity": similarity,
                "threshold": recognition.TOLERANCE,
            }
        candidate = candidate / max(float(np.linalg.norm(candidate)), 1e-12)
        reference = reference / max(float(np.linalg.norm(reference)), 1e-12)
        similarity = float(np.dot(candidate, reference))
        threshold = float(os.environ.get("FACE_MATCH_THRESHOLD", "0.35"))
        return {
            "matched": similarity >= threshold,
            "metric": "cosine_similarity",
            "distance": 1.0 - similarity,
            "similarity": similarity,
            "threshold": threshold,
        }

    def engine_info(self) -> dict:
        if ENGINE == "face_recognition":
            return recognition.describe()
        return {
            "engine": "arcface",
            "available": self.model_runtime is not None and self.model_runtime.ready,
            "detector": "SCRFD (ONNX)" if self.model_runtime and self.model_runtime.ready else "OpenCV Haar cascade",
            "encoder": "ArcFace (ONNX Runtime)",
            "dimension": self.model_runtime.embedding_dimension if self.model_runtime else 0,
            "tolerance": float(os.environ.get("FACE_MATCH_THRESHOLD", "0.35")),
            "preprocessing": ["cv2.imdecode", "cv2.cvtColor", "cv2.Laplacian variance", "cv2.warpAffine"],
            "versions": recognition.library_versions(),
            "error": "",
        }

    @property
    def ready(self) -> bool:
        if ENGINE == "face_recognition":
            return recognition.LIBRARY_AVAILABLE
        return self.model_runtime is not None and self.model_runtime.ready

    # --------------------------------------------------------- ONNX fallback

    def _detect_scrfd(self, image: np.ndarray) -> list[tuple[np.ndarray, np.ndarray]]:
        session = self.model_runtime.detector_session
        input_meta = session.get_inputs()[0]
        input_height = 640
        input_width = 640
        scale = min(input_width / image.shape[1], input_height / image.shape[0])
        resized = cv2.resize(image, (int(image.shape[1] * scale), int(image.shape[0] * scale)))
        canvas = np.zeros((input_height, input_width, 3), dtype=np.uint8)
        canvas[:resized.shape[0], :resized.shape[1]] = resized
        tensor = (canvas.astype(np.float32) - 127.5) / 128.0
        tensor = np.transpose(tensor, (2, 0, 1))[None, ...]
        outputs = session.run(None, {input_meta.name: tensor})
        detections: list[tuple[np.ndarray, np.ndarray, float]] = []
        for stride, score_output, box_output, landmark_output in zip((8, 16, 32), outputs[0:3], outputs[3:6], outputs[6:9]):
            scores = score_output.reshape(-1)
            boxes = box_output.reshape(-1, 4)
            landmarks = landmark_output.reshape(-1, 5, 2)
            grid_width = input_width // stride
            centers = np.stack(np.meshgrid(np.arange(grid_width), np.arange(grid_width)), axis=-1).reshape(-1, 2)
            centers = np.repeat((centers + 0.5) * stride, 2, axis=0)
            for index in np.where(scores >= 0.5)[0]:
                center = centers[index]
                box = np.array([
                    center[0] - boxes[index, 0] * stride,
                    center[1] - boxes[index, 1] * stride,
                    center[0] + boxes[index, 2] * stride,
                    center[1] + boxes[index, 3] * stride,
                ], dtype=np.float32) / scale
                points = (center + landmarks[index] * stride) / scale
                detections.append((box, points, float(scores[index])))
        if not detections:
            return []
        boxes = np.array([item[0] for item in detections])
        scores = [item[2] for item in detections]
        indices = cv2.dnn.NMSBoxes(boxes.tolist(), scores, 0.5, 0.4)
        return [(detections[int(index)][0], detections[int(index)][1]) for index in indices]

    def _embed_arcface(self, image: np.ndarray, face_box: np.ndarray, landmarks: np.ndarray) -> np.ndarray:
        if landmarks.shape != (5, 2):
            x1, y1, x2, y2 = face_box.astype(int)
            crop = image[max(0, y1):max(y1 + 1, y2), max(0, x1):max(x1 + 1, x2)]
            crop = cv2.resize(crop, (112, 112))
        else:
            reference = np.array([
                [38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
                [41.5493, 92.3655], [70.7299, 92.2041],
            ], dtype=np.float32)
            transform, _ = cv2.estimateAffinePartial2D(landmarks.astype(np.float32), reference, method=cv2.RANSAC)
            crop = cv2.warpAffine(image, transform, (112, 112), borderValue=0)
        tensor = (crop[:, :, ::-1].astype(np.float32) - 127.5) / 127.5
        tensor = np.transpose(tensor, (2, 0, 1))[None, ...]
        session = self.model_runtime.embedding_session
        vector = session.run(None, {session.get_inputs()[0].name: tensor})[0][0].astype(np.float32)
        return vector / max(float(np.linalg.norm(vector)), 1e-12)
