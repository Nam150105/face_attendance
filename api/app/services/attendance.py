from __future__ import annotations

import uuid
from datetime import datetime, timezone

import httpx
import psycopg
from fastapi import HTTPException

from app.auth import CurrentUser, DATABASE_URL
from app.domain.geofence import GeofencePolicy, GeofenceStatus, evaluate_geofence
from app.services.storage import PrivateObjectStorage


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _face_ai_not_configured(response: dict) -> bool:
    return response.get("code") == "FACE_MODEL_NOT_CONFIGURED" or response.get("status") == "NOT_CONFIGURED"


def _verify_face(image: bytes, member_id: uuid.UUID) -> dict:
    try:
        response = httpx.post(
            "http://face-ai:8001/v1/verify",
            files={"image": ("attendance.jpg", image, "image/jpeg")},
            data={"member_id": str(member_id)},
            timeout=30,
        )
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Face AI service unavailable") from error


def _location_for_member(connection: psycopg.Connection, member_id: uuid.UUID, location_id: uuid.UUID) -> tuple | None:
    return connection.execute(
        """
        SELECT l.id, l.latitude, l.longitude, l.allow_radius_meters, l.warning_radius_meters
        FROM member_locations ml JOIN locations l ON l.id = ml.location_id
        WHERE ml.member_id = %s AND ml.location_id = %s AND l.is_active = true
        """,
        (member_id, location_id),
    ).fetchone()


def _open_state(connection: psycopg.Connection, member_id: uuid.UUID) -> tuple | None:
    return connection.execute(
        """
        SELECT id, location_id, server_time FROM attendance_events
        WHERE member_id = %s AND event_type = 'CHECK_IN' AND status IN ('SUCCESS', 'WARNING_CONFIRMED')
          AND NOT EXISTS (
              SELECT 1 FROM attendance_events checkout
              WHERE checkout.member_id = attendance_events.member_id
                AND checkout.event_type = 'CHECK_OUT'
                AND checkout.status = 'SUCCESS'
                AND checkout.server_time > attendance_events.server_time
          )
        ORDER BY server_time DESC LIMIT 1
        """,
        (member_id,),
    ).fetchone()


def _event_response(row: tuple) -> dict:
    return {"status": row[0], "event_id": row[1], "distance_meters": float(row[2]), "message": row[3]}


def check_in(
    user: CurrentUser,
    location_id: uuid.UUID,
    latitude: float,
    longitude: float,
    gps_accuracy_meters: float,
    idempotency_key: str,
    reason: str | None,
    image: bytes,
    content_type: str,
) -> dict:
    if gps_accuracy_meters < 0:
        raise HTTPException(status_code=422, detail="GPS accuracy must be non-negative")
    with psycopg.connect(DATABASE_URL) as connection:
        existing = connection.execute(
            "SELECT status::text, id, distance_meters, 'Request already processed' FROM attendance_events WHERE idempotency_key = %s",
            (idempotency_key,),
        ).fetchone()
        if existing is not None:
            return _event_response(existing)
        connection.execute("SELECT id FROM users WHERE id = %s FOR UPDATE", (user.id,)).fetchone()
        if _open_state(connection, user.id) is not None:
            raise HTTPException(status_code=409, detail="CHECK_IN_ALREADY_EXISTS")
        location = _location_for_member(connection, user.id, location_id)
        if location is None:
            raise HTTPException(status_code=404, detail="Location is not assigned to this member")
        decision = evaluate_geofence(
            latitude, longitude, gps_accuracy_meters, float(location[1]), float(location[2]),
            GeofencePolicy(location[3], location[4], 100),
        )
        if decision.status == GeofenceStatus.GPS_ACCURACY_LOW:
            raise HTTPException(status_code=422, detail="GPS_ACCURACY_LOW")
        if decision.status == GeofenceStatus.BLOCK:
            raise HTTPException(status_code=403, detail="OUTSIDE_ALLOWED_ZONE")
        if decision.status == GeofenceStatus.WARNING_REASON_REQUIRED and not reason:
            raise HTTPException(status_code=422, detail="WARNING_REASON_REQUIRED")
        checkout_location = connection.execute(
            "SELECT latitude, longitude, allow_radius_meters, warning_radius_meters FROM locations WHERE id = %s AND is_active = true",
            (open_event[1],),
        ).fetchone()
        if checkout_location is None:
            raise HTTPException(status_code=404, detail="Checkout location is inactive")
        decision = evaluate_geofence(
            latitude, longitude, gps_accuracy_meters, float(checkout_location[0]), float(checkout_location[1]),
            GeofencePolicy(checkout_location[2], checkout_location[3], 100),
        )
        if decision.status == GeofenceStatus.GPS_ACCURACY_LOW:
            raise HTTPException(status_code=422, detail="GPS_ACCURACY_LOW")
        if decision.status == GeofenceStatus.BLOCK:
            raise HTTPException(status_code=403, detail="OUTSIDE_ALLOWED_ZONE")
        face_result = _verify_face(image, user.id)
        if _face_ai_not_configured(face_result):
            raise HTTPException(status_code=503, detail="FACE_MODEL_NOT_CONFIGURED")
        if face_result.get("status") != "VERIFIED":
            raise HTTPException(status_code=403, detail=face_result.get("code", "FACE_NOT_MATCHED"))
        object_key = f"attendance/{user.id}/{uuid.uuid4()}.jpg"
        PrivateObjectStorage().put_private(object_key, image, content_type)
        event_status = "WARNING_CONFIRMED" if decision.status == GeofenceStatus.WARNING_REASON_REQUIRED else "SUCCESS"
        object_key = f"attendance/{user.id}/{uuid.uuid4()}.jpg"
        row = connection.execute(
            """
            INSERT INTO attendance_events (member_id, location_id, event_type, status, server_time, latitude, longitude, gps_accuracy_meters, distance_meters, face_match_score, liveness_score, image_object_key, reason, idempotency_key)
            VALUES (%s, %s, 'CHECK_IN', %s::attendance_status, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING status::text, id, distance_meters
            """,
            (user.id, location_id, event_status, _utc_now(), latitude, longitude, gps_accuracy_meters, decision.distance_meters, face_result.get("face_match_score"), face_result.get("liveness_score"), object_key, reason, idempotency_key),
        ).fetchone()
        connection.commit()
    return {"status": row[0], "event_id": row[1], "distance_meters": float(row[2]), "message": "Check-in successful"}


def check_out(
    user: CurrentUser,
    latitude: float,
    longitude: float,
    gps_accuracy_meters: float,
    idempotency_key: str,
    image: bytes,
    content_type: str,
) -> dict:
    if gps_accuracy_meters < 0:
        raise HTTPException(status_code=422, detail="GPS accuracy must be non-negative")
    with psycopg.connect(DATABASE_URL) as connection:
        existing = connection.execute(
            "SELECT status::text, id, distance_meters, 'Request already processed' FROM attendance_events WHERE idempotency_key = %s",
            (idempotency_key,),
        ).fetchone()
        if existing is not None:
            return _event_response(existing)
        connection.execute("SELECT id FROM users WHERE id = %s FOR UPDATE", (user.id,)).fetchone()
        open_event = _open_state(connection, user.id)
        if open_event is None:
            raise HTTPException(status_code=409, detail="CHECK_OUT_WITHOUT_CHECK_IN")
        face_result = _verify_face(image, user.id)
        if _face_ai_not_configured(face_result):
            raise HTTPException(status_code=503, detail="FACE_MODEL_NOT_CONFIGURED")
        if face_result.get("status") != "VERIFIED":
            raise HTTPException(status_code=403, detail=face_result.get("code", "FACE_NOT_MATCHED"))
        row = connection.execute(
            """
            INSERT INTO attendance_events (member_id, location_id, event_type, status, server_time, latitude, longitude, gps_accuracy_meters, distance_meters, face_match_score, liveness_score, image_object_key, idempotency_key)
            VALUES (%s, %s, 'CHECK_OUT', 'SUCCESS', %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING status::text, id, distance_meters
            """,
            (user.id, open_event[1], _utc_now(), latitude, longitude, gps_accuracy_meters, decision.distance_meters, face_result.get("face_match_score"), face_result.get("liveness_score"), object_key, idempotency_key),
        ).fetchone()
        connection.commit()
    PrivateObjectStorage().put_private(object_key, image, content_type)
    return {"status": row[0], "event_id": row[1], "distance_meters": float(row[2]), "message": "Check-out successful"}
