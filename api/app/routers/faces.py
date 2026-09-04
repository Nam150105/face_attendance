from __future__ import annotations

import hashlib
import os
import secrets
import uuid

import httpx
import psycopg
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.auth import CurrentUser, DATABASE_URL, get_current_user


FACE_AI_URL = os.environ.get("FACE_AI_URL", "http://face-ai:8001")
MAX_IMAGE_BYTES = 10 * 1024 * 1024
router = APIRouter(prefix="/faces", tags=["faces"])


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@router.post("/enrollment/start", status_code=status.HTTP_201_CREATED)
def start_enrollment(user: CurrentUser = Depends(get_current_user)) -> dict:
    if user.role != "MEMBER":
        raise HTTPException(status_code=403, detail="Only members can enroll a face")
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
    challenge_id: uuid.UUID,
    challenge: str,
    image: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    if user.role != "MEMBER":
        raise HTTPException(status_code=403, detail="Only members can enroll a face")
    image_bytes = await image.read(MAX_IMAGE_BYTES + 1)
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds 10 MB limit")
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
    if response.get("status") != "READY_FOR_EMBEDDING":
        return response
    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute("UPDATE face_enrollment_challenges SET consumed_at = now() WHERE id = %s", (challenge_id,))
        connection.commit()
    return response


@router.post("/verify")
async def verify_face(image: UploadFile = File(...), user: CurrentUser = Depends(get_current_user)) -> dict:
    image_bytes = await image.read(MAX_IMAGE_BYTES + 1)
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds 10 MB limit")
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


async def _face_ai_verify(image_bytes: bytes, filename: str, member_id: str) -> dict:
    files = {"image": (filename, image_bytes, "image/jpeg")}
    data = {"member_id": member_id}
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(f"{FACE_AI_URL}/v1/verify", files=files, data=data)
        response.raise_for_status()
        return response.json()
