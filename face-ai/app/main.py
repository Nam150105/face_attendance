import json
import os

import numpy as np
from fastapi import FastAPI, File, Form, UploadFile

from app.face_pipeline import FacePipeline, FacePipelineError
from app.model_runtime import ModelRuntime


FACE_MATCH_THRESHOLD = float(os.environ.get("FACE_MATCH_THRESHOLD", "0.35"))

app = FastAPI(title="Face Attendance Face AI", version="0.1.0")
model_runtime = ModelRuntime()
pipeline = FacePipeline(model_runtime)


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "face-ai"}


@app.get("/ready", tags=["system"])
async def ready() -> dict:
    return {
        "status": "ready" if model_runtime.ready else "not_configured",
        "service": "face-ai",
        "embedding_model": "configured" if model_runtime.ready else "not_configured",
        "model_runtime": model_runtime.status().__dict__,
    }


@app.post("/v1/analyze", tags=["face"])
async def analyze(image: UploadFile = File(...)) -> dict:
    try:
        image_bytes = await image.read()
        image_array = pipeline.decode(image_bytes)
        faces = pipeline.detect_faces(image_array)
        result = pipeline.analyze(image_bytes)
        result = result.__class__(len(faces), result.blur_score, result.brightness_score, tuple(faces[0][0].astype(int)) if len(faces) == 1 else None)
    except FacePipelineError as error:
        return {"status": "REJECTED", "code": str(error)}
    return {
        "status": "ANALYZED",
        "face_count": result.face_count,
        "blur_score": result.blur_score,
        "brightness_score": result.brightness_score,
        "face_box": result.face_box,
        "embedding_status": "NOT_CONFIGURED",
    }


@app.post("/v1/enroll", tags=["face"])
async def enroll(image: UploadFile = File(...)) -> dict:
    try:
        image_bytes = await image.read()
        image_array = pipeline.decode(image_bytes)
        faces = pipeline.detect_faces(image_array)
        result = pipeline.validate_enrollment(image_bytes)
    except FacePipelineError as error:
        return {"status": "REJECTED", "code": str(error)}
    if not model_runtime.ready:
        return {"status": "REJECTED", "code": "FACE_MODEL_NOT_CONFIGURED", "model_runtime": model_runtime.status().__dict__}
    embedding = pipeline.embedding(image_array, faces[0][0], faces[0][1])
    return {
        "status": "ENROLLED",
        "face_count": result.face_count,
        "blur_score": result.blur_score,
        "brightness_score": result.brightness_score,
        "model_status": "CONFIGURED",
        "embedding": embedding.tolist(),
        "model_name": model_runtime.model_name,
        "model_version": model_runtime.model_version,
    }


@app.post("/v1/verify", tags=["face"])
async def verify(image: UploadFile = File(...), member_id: str = Form(""), reference_embedding: str = Form("")) -> dict:
    if not model_runtime.ready:
        return {"status": "NOT_CONFIGURED", "code": "FACE_MODEL_NOT_CONFIGURED"}
    try:
        image_bytes = await image.read()
        image_array = pipeline.decode(image_bytes)
        faces = pipeline.detect_faces(image_array)
    except FacePipelineError as error:
        return {"status": "REJECTED", "code": str(error)}
    if len(faces) != 1:
        return {"status": "REJECTED", "code": "FACE_NOT_FOUND" if len(faces) == 0 else "MULTIPLE_FACES"}
    if not reference_embedding:
        return {"status": "REJECTED", "code": "FACE_REFERENCE_NOT_FOUND"}
    embedding = pipeline.embedding(image_array, faces[0][0], faces[0][1])
    reference = np.asarray(json.loads(reference_embedding), dtype=np.float32)
    reference = reference / max(float(np.linalg.norm(reference)), 1e-12)
    score = float(np.dot(embedding, reference))
    matched = score >= FACE_MATCH_THRESHOLD
    return {
        "status": "VERIFIED" if matched else "REJECTED",
        "code": "OK" if matched else "FACE_NOT_MATCHED",
        "face_match_score": score,
        "threshold": FACE_MATCH_THRESHOLD,
        "model_name": model_runtime.model_name,
        "model_version": model_runtime.model_version,
    }
