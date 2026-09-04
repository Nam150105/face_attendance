from fastapi import FastAPI, File, UploadFile

from app.face_pipeline import FacePipeline, FacePipelineError


app = FastAPI(title="Face Attendance Face AI", version="0.1.0")
pipeline = FacePipeline()


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "face-ai"}


@app.get("/ready", tags=["system"])
async def ready() -> dict[str, str]:
    return {
        "status": "ready" if pipeline.embeddings_enabled else "not_configured",
        "service": "face-ai",
        "embedding_model": "configured" if pipeline.embeddings_enabled else "not_configured",
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
    return {
        "status": "READY_FOR_EMBEDDING",
        "face_count": result.face_count,
        "blur_score": result.blur_score,
        "brightness_score": result.brightness_score,
        "model_status": "NOT_CONFIGURED",
    }
