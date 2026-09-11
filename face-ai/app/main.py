import json

import numpy as np
from fastapi import FastAPI, File, Form, Response, UploadFile

from app import recognition
from app.face_pipeline import ENGINE, FacePipeline, FacePipelineError
from app.model_runtime import ModelRuntime


app = FastAPI(title="Face Attendance Face AI", version="0.2.0")
model_runtime = ModelRuntime()
pipeline = FacePipeline(model_runtime)


def _quality(analysis) -> dict:
    """What OpenCV measured, named so a reader can tell which number came from
    where."""
    return {
        "face_count": analysis.face_count,
        "blur_score": analysis.blur_score,
        "brightness_score": analysis.brightness_score,
        "landmark_count": analysis.landmark_count,
        "contrast_boosted": analysis.contrast_boosted,
        "face_box": analysis.face_box,
    }


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "face-ai"}


@app.get("/ready", tags=["system"])
async def ready() -> dict:
    info = pipeline.engine_info()
    return {
        "status": "ready" if pipeline.ready else "not_configured",
        "service": "face-ai",
        "engine": info["engine"],
        "embedding_model": "configured" if pipeline.ready else "not_configured",
        "model_runtime": model_runtime.status().__dict__,
    }


@app.get("/v1/engine", tags=["face"])
async def engine() -> dict:
    """Exactly which libraries are deciding identity, and on what settings."""
    return pipeline.engine_info()


@app.post("/v1/analyze", tags=["face"])
async def analyze(image: UploadFile = File(...)) -> dict:
    try:
        frame, analysis = pipeline.analyze(await image.read())
    except FacePipelineError as error:
        return {"status": "REJECTED", "code": str(error)}
    return {
        "status": "ANALYZED",
        "engine": ENGINE,
        **_quality(analysis),
        # Live guidance for the camera screen: the same numbers, turned into
        # the one thing the person should do next.
        **pipeline.guide(analysis, frame),
    }


@app.post("/v1/preview", tags=["face"])
async def preview(image: UploadFile = File(...)) -> Response:
    """The frame with the detected box drawn on, so a person can see what the
    detector saw rather than take a number on trust."""
    try:
        image_bgr, analysis = pipeline.analyze(await image.read())
    except FacePipelineError as error:
        return Response(content=str(error), status_code=422, media_type="text/plain")
    boxes = [analysis.face_box] if analysis.face_box else []
    return Response(content=recognition.annotate(image_bgr, boxes), media_type="image/jpeg")


@app.post("/v1/enroll", tags=["face"])
async def enroll(image: UploadFile = File(...)) -> dict:
    try:
        image_bgr, analysis = pipeline.analyze(await image.read())
        pipeline.validate(analysis, strict=True)
        if not pipeline.ready:
            return {"status": "REJECTED", "code": "FACE_MODEL_NOT_CONFIGURED",
                    "model_runtime": model_runtime.status().__dict__}
        encoding, engine_name, dimension = pipeline.encode(image_bgr, analysis.face_box)
    except FacePipelineError as error:
        return {"status": "REJECTED", "code": str(error)}
    info = pipeline.engine_info()
    return {
        "status": "ENROLLED",
        "embedding": encoding.tolist(),
        "model_name": engine_name,
        "model_version": f"{info['detector']} · {info['encoder']}",
        "dimension": dimension,
        "detector": info["detector"],
        "encoder": info["encoder"],
        "versions": info["versions"],
        **_quality(analysis),
    }


@app.post("/v1/verify", tags=["face"])
async def verify(
    image: UploadFile = File(...),
    member_id: str = Form(""),
    reference_embedding: str = Form(""),
    reference_model: str = Form(""),
) -> dict:
    info = pipeline.engine_info()
    if not pipeline.ready:
        return {"status": "NOT_CONFIGURED", "code": "FACE_MODEL_NOT_CONFIGURED"}
    if not reference_embedding:
        return {"status": "REJECTED", "code": "FACE_REFERENCE_NOT_FOUND"}
    # An encoding made by one engine means nothing to another: 128 dlib numbers
    # and 512 ArcFace numbers describe different spaces. Comparing them would
    # still produce a score, and that score would be noise.
    if reference_model and reference_model != info["engine"]:
        return {
            "status": "REJECTED",
            "code": "FACE_ENGINE_MISMATCH",
            "reference_model": reference_model,
            "current_engine": info["engine"],
        }
    try:
        image_bgr, analysis = pipeline.analyze(await image.read())
        pipeline.validate(analysis, strict=False)
        encoding, engine_name, _ = pipeline.encode(image_bgr, analysis.face_box)
    except FacePipelineError as error:
        return {"status": "REJECTED", "code": str(error), **_quality_safe(error)}

    reference = np.asarray(json.loads(reference_embedding), dtype=np.float32)
    if reference.shape[0] != encoding.shape[0]:
        return {"status": "REJECTED", "code": "FACE_ENGINE_MISMATCH",
                "reference_dimension": int(reference.shape[0]), "current_dimension": int(encoding.shape[0])}

    result = pipeline.compare(encoding, reference)
    return {
        "status": "VERIFIED" if result["matched"] else "REJECTED",
        "code": "OK" if result["matched"] else "FACE_NOT_MATCHED",
        "face_match_score": result["similarity"],
        "face_distance": result["distance"],
        "metric": result["metric"],
        "threshold": result["threshold"],
        "model_name": engine_name,
        "detector": info["detector"],
        "encoder": info["encoder"],
        **_quality(analysis),
    }


def _quality_safe(_error: FacePipelineError) -> dict:
    return {}
