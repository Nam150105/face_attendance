from __future__ import annotations

import hashlib
import json
import os
import secrets
import uuid

import httpx
import psycopg
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.auth import CurrentUser, DATABASE_URL, get_current_user
from app.services.permissions import require_screen
from app.security import MAX_IMAGE_BYTES, enforce_rate_limit, validate_image_upload
from app.services.storage import PrivateObjectStorage


FACE_AI_URL = os.environ.get("FACE_AI_URL", "http://face-ai:8001")
router = APIRouter(prefix="/faces", tags=["faces"])


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@router.get("/me")
async def my_enrollment(user: CurrentUser = Depends(get_current_user)) -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            "SELECT id, model_name, model_version, created_at, image_object_key IS NOT NULL FROM face_embeddings WHERE member_id = %s AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
            (user.id,),
        ).fetchone()
    engine = await _engine_info()
    if row is None:
        return {"enrolled": False, "embedding_id": None, "model_name": None, "model_version": None,
                "enrolled_at": None, "has_photo": False, "needs_reenrollment": False, "engine": engine}
    # An encoding made by a different engine cannot be compared against today's,
    # so say so here rather than letting the person find out at the door.
    stale = bool(engine.get("engine")) and row[1] != engine.get("engine")
    return {
        "enrolled": True, "embedding_id": row[0], "model_name": row[1], "model_version": row[2],
        "enrolled_at": row[3], "has_photo": row[4], "needs_reenrollment": stale, "engine": engine,
    }


@router.post("/enrollment/start", status_code=status.HTTP_201_CREATED)
def start_enrollment(user: CurrentUser = Depends(require_screen("attendance"))) -> dict:
    challenge = secrets.token_urlsafe(32)
    challenge_id = uuid.uuid4()
    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute(
            "UPDATE face_enrollment_challenges SET consumed_at = now() WHERE member_id = %s AND consumed_at IS NULL",
            (user.id,),
        )
        connection.execute(
            "INSERT INTO face_enrollment_challenges (id, member_id, challenge_hash, expires_at) VALUES (%s, %s, %s, now() + interval '10 minutes')",
            (challenge_id, user.id, _hash(challenge)),
        )
        connection.commit()
    return {"challenge_id": challenge_id, "challenge": challenge, "expires_in_seconds": 600}


@router.post("/enrollment/verify")
async def verify_enrollment(
    challenge_id: uuid.UUID = Form(...),
    challenge: str = Form(...),
    image: UploadFile = File(...),
    user: CurrentUser = Depends(require_screen("attendance")),
) -> dict:
    enforce_rate_limit("enroll", str(user.id), limit=10, window_seconds=300)
    image_bytes = await image.read(MAX_IMAGE_BYTES + 1)
    validate_image_upload(image_bytes)
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            "SELECT id FROM face_enrollment_challenges WHERE id = %s AND member_id = %s AND challenge_hash = %s AND consumed_at IS NULL AND expires_at > now()",
            (challenge_id, user.id, _hash(challenge)),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=400, detail="Invalid or expired enrollment challenge")
    try:
        response = await _face_ai_enroll(image_bytes, image.filename or "enrollment.jpg")
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Face AI service unavailable") from error
    if response.get("status") != "ENROLLED":
        return response
    with psycopg.connect(DATABASE_URL) as connection:
        embedding = response.get("embedding")
        expected = int(response.get("dimension") or 0)
        if not isinstance(embedding, list) or not embedding or (expected and len(embedding) != expected):
            raise HTTPException(status_code=502, detail="Face AI returned an invalid embedding")
        embedding_id = uuid.uuid4()
        object_key = f"enrollment/{user.id}/{embedding_id}.jpg"
        try:
            PrivateObjectStorage().put_private(object_key, image_bytes, "image/jpeg")
        except Exception:
            # The embedding is what makes attendance work; the reference photo
            # only helps a human compare. Losing storage must not block enrolment.
            object_key = None
        connection.execute("UPDATE face_embeddings SET revoked_at = now() WHERE member_id = %s AND revoked_at IS NULL", (user.id,))
        connection.execute(
            "INSERT INTO face_embeddings (id, member_id, embedding, model_name, model_version, quality_score, image_object_key) VALUES (%s, %s, %s::vector, %s, %s, %s, %s)",
            (embedding_id, user.id, json.dumps(embedding), response.get("model_name", "unknown"), response.get("model_version", "unknown"), response.get("blur_score"), object_key),
        )
        connection.execute("UPDATE face_enrollment_challenges SET consumed_at = now() WHERE id = %s", (challenge_id,))
        # 07_SECURITY_PRIVACY.md §5 requires face re-enrollment to be auditable.
        connection.execute(
            """
            INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, after_json)
            VALUES (%s, 'FACE_ENROLLED', 'face_embedding', %s, %s::jsonb)
            """,
            (
                user.id,
                user.id,
                json.dumps(
                    {
                        "model_name": response.get("model_name", "unknown"),
                        "model_version": response.get("model_version", "unknown"),
                        "dimension": len(embedding),
                        "detector": response.get("detector"),
                        "encoder": response.get("encoder"),
                        "blur_score": response.get("blur_score"),
                        "brightness_score": response.get("brightness_score"),
                    }
                ),
            ),
        )
        connection.commit()
    return response


@router.post("/verify")
async def verify_face(image: UploadFile = File(...), user: CurrentUser = Depends(get_current_user)) -> dict:
    enforce_rate_limit("face-verify", str(user.id), limit=20, window_seconds=60)
    image_bytes = await image.read(MAX_IMAGE_BYTES + 1)
    validate_image_upload(image_bytes)
    try:
        response = await _face_ai_verify(image_bytes, image.filename or "attendance.jpg", str(user.id))
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Face AI service unavailable") from error
    return response


async def _face_ai_enroll(image_bytes: bytes, filename: str) -> dict:
    files = {"image": (filename, image_bytes, "image/jpeg")}
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(f"{FACE_AI_URL}/v1/enroll", files=files)
        response.raise_for_status()
        return response.json()


async def _face_ai_verify(image_bytes: bytes, filename: str, member_id: str,
                          reference_embedding: list[float] | None = None,
                          reference_model: str = "") -> dict:
    files = {"image": (filename, image_bytes, "image/jpeg")}
    data = {
        "member_id": member_id,
        "reference_embedding": json.dumps(reference_embedding) if reference_embedding else "",
        "reference_model": reference_model,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(f"{FACE_AI_URL}/v1/verify", files=files, data=data)
        response.raise_for_status()
        return response.json()


async def _engine_info() -> dict:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{FACE_AI_URL}/v1/engine")
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError:
        return {"engine": "", "available": False, "error": "FACE_AI_UNAVAILABLE"}


@router.get("/engine")
async def engine_info(user: CurrentUser = Depends(get_current_user)) -> dict:
    """Which libraries decide identity, and on what settings. Read by the
    enrolment screen so the person registering can see what is judging them."""
    return await _engine_info()
