from fastapi import FastAPI, File, UploadFile

from app.face_pipeline import FacePipeline, FacePipelineError
from app.model_runtime import ModelRuntime


app = FastAPI(title="Face Attendance Face AI", version="0.1.0")
pipeline = FacePipeline()
model_runtime = ModelRuntime()


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
        result = pipeline.analyze(await image.read())
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
        result = pipeline.validate_enrollment(await image.read())
    except FacePipelineError as error:
        return {"status": "REJECTED", "code": str(error)}
    if not model_runtime.ready:
        return {"status": "REJECTED", "code": "FACE_MODEL_NOT_CONFIGURED", "model_runtime": model_runtime.status().__dict__}
    return {
        "status": "READY_FOR_EMBEDDING",
        "face_count": result.face_count,
        "blur_score": result.blur_score,
        "brightness_score": result.brightness_score,
        "model_status": "NOT_CONFIGURED",
    }


@app.post("/v1/verify", tags=["face"])
async def verify(image: UploadFile = File(...), member_id: str = "") -> dict:
    if not model_runtime.ready:
        return {"status": "NOT_CONFIGURED", "code": "FACE_MODEL_NOT_CONFIGURED"}
    try:
        result = pipeline.analyze(await image.read())
    except FacePipelineError as error:
        return {"status": "REJECTED", "code": str(error)}
    if result.face_count != 1:
        return {"status": "REJECTED", "code": "FACE_NOT_FOUND" if result.face_count == 0 else "MULTIPLE_FACES"}
    return {"status": "NOT_CONFIGURED", "code": "FACE_MODEL_INFERENCE_NOT_IMPLEMENTED"}
