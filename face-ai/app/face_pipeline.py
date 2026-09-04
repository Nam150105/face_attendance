from __future__ import annotations

import os
from dataclasses import dataclass

import cv2
import numpy as np

from app.model_runtime import ModelRuntime


class FacePipelineError(ValueError):
    pass


@dataclass(frozen=True)
class FaceAnalysis:
    face_count: int
    blur_score: float | None
    brightness_score: float | None
    face_box: tuple[int, int, int, int] | None


class FacePipeline:
    def __init__(self, model_runtime: ModelRuntime | None = None) -> None:
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        self.detector = cv2.CascadeClassifier(cascade_path)
        if self.detector.empty():
            raise RuntimeError("OpenCV face detector could not be loaded")
        self.model_runtime = model_runtime

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
        detected = self.detect_faces(image)
        blur_score = float(cv2.Laplacian(grayscale, cv2.CV_64F).var())
        brightness_score = float(np.mean(grayscale))
        face_box = tuple(int(value) for value in detected[0][0]) if len(detected) == 1 else None
        return FaceAnalysis(len(detected), blur_score, brightness_score, face_box)

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
        return analysis

    def detect_faces(self, image: np.ndarray) -> list[tuple[np.ndarray, np.ndarray]]:
        if self.model_runtime is not None and self.model_runtime.ready:
            return self._detect_scrfd(image)
        grayscale = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        boxes = self.detector.detectMultiScale(grayscale, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))
        return [(np.array([x, y, x + width, y + height], dtype=np.float32), np.empty((0, 2), dtype=np.float32)) for x, y, width, height in boxes]

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

    def embedding(self, image: np.ndarray, face_box: np.ndarray, landmarks: np.ndarray) -> np.ndarray:
        if self.model_runtime is None or not self.model_runtime.ready:
            raise FacePipelineError("FACE_MODEL_NOT_CONFIGURED")
        if landmarks.shape != (5, 2):
            x1, y1, x2, y2 = face_box.astype(int)
            crop = image[max(0, y1):max(y1 + 1, y2), max(0, x1):max(x1 + 1, x2)]
            crop = cv2.resize(crop, (112, 112))
        else:
            reference = np.array([[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]], dtype=np.float32)
            transform, _ = cv2.estimateAffinePartial2D(landmarks.astype(np.float32), reference, method=cv2.RANSAC)
            crop = cv2.warpAffine(image, transform, (112, 112), borderValue=0)
        tensor = (crop[:, :, ::-1].astype(np.float32) - 127.5) / 127.5
        tensor = np.transpose(tensor, (2, 0, 1))[None, ...]
        vector = self.model_runtime.embedding_session.run(None, {self.model_runtime.embedding_session.get_inputs()[0].name: tensor})[0][0]
        vector = vector.astype(np.float32)
        return vector / max(float(np.linalg.norm(vector)), 1e-12)
