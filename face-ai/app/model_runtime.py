from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import onnxruntime as ort


@dataclass(frozen=True)
class ModelRuntimeStatus:
    enabled: bool
    detector_loaded: bool
    embedding_loaded: bool
    embedding_dimension: int
    provider: str
    message: str


class ModelRuntime:
    def __init__(self) -> None:
        # The ONNX pair (SCRFD + ArcFace) is the alternative engine. With
        # face_recognition selected it was still being loaded — about 250 MB
        # resident for models nothing ever called.
        self.enabled = (
            os.environ.get("FACE_AI_ENABLE_EMBEDDINGS", "false").lower() == "true"
            and os.environ.get("FACE_ENGINE", "face_recognition").lower() != "face_recognition"
        )
        self.detector_path = Path(os.environ.get("FACE_DETECTOR_MODEL_PATH", "/models/detector/face_detector.onnx"))
        self.embedding_path = Path(os.environ.get("FACE_EMBEDDING_MODEL_PATH", "/models/embedding/arcface.onnx"))
        self.embedding_dimension = int(os.environ.get("FACE_EMBEDDING_DIMENSION", "512"))
        self.model_name = os.environ.get("FACE_MODEL_NAME", "arcface")
        self.model_version = os.environ.get("FACE_MODEL_VERSION", "unknown")
        self.provider = "CPUExecutionProvider" if "CPUExecutionProvider" in ort.get_available_providers() else "none"
        self.detector_session = None
        self.embedding_session = None
        self.message = "disabled"
        if self.enabled:
            self._load()

    def _load(self) -> None:
        if not self.detector_path.is_file():
            self.message = f"detector model not found: {self.detector_path}"
            return
        if not self.embedding_path.is_file():
            self.message = f"embedding model not found: {self.embedding_path}"
            return
        self.detector_session = ort.InferenceSession(str(self.detector_path), providers=["CPUExecutionProvider"])
        self.embedding_session = ort.InferenceSession(str(self.embedding_path), providers=["CPUExecutionProvider"])
        self.message = "models loaded; preprocessing and model-specific inference must be verified"

    @property
    def ready(self) -> bool:
        return self.enabled and self.detector_session is not None and self.embedding_session is not None

    def status(self) -> ModelRuntimeStatus:
        return ModelRuntimeStatus(
            enabled=self.enabled,
            detector_loaded=self.detector_session is not None,
            embedding_loaded=self.embedding_session is not None,
            embedding_dimension=self.embedding_dimension,
            provider=self.provider,
            message=self.message,
        )
