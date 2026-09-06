from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import psycopg
from fastapi import HTTPException

from app.auth import CurrentUser, DATABASE_URL
from app.domain.geofence import GeofencePolicy, GeofenceStatus, evaluate_geofence
from app.services.member_portal import LOCAL_ZONE, notify
from app.services.storage import PrivateObjectStorage


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _face_ai_not_configured(response: dict) -> bool:
    return response.get("code") == "FACE_MODEL_NOT_CONFIGURED" or response.get("status") == "NOT_CONFIGURED"


def _reference_embedding(connection: psycopg.Connection, member_id: uuid.UUID) -> list[float] | None:
    row = connection.execute(
        "SELECT embedding::text FROM face_embeddings WHERE member_id = %s AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
        (member_id,),
    ).fetchone()
    return json.loads(row[0]) if row else None


def _verify_face(image: bytes, member_id: uuid.UUID, reference_embedding: list[float] | None) -> dict:
    try:
        response = httpx.post(
            "http://face-ai:8001/v1/verify",
            files={"image": ("attendance.jpg", image, "image/jpeg")},
            data={"member_id": str(member_id), "reference_embedding": json.dumps(reference_embedding) if reference_embedding else ""},
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


def _location_name(connection: psycopg.Connection, location_id: uuid.UUID) -> str:
    row = connection.execute("SELECT name FROM locations WHERE id = %s", (location_id,)).fetchone()
    return row[0] if row else "địa điểm"


def _is_late(connection: psycopg.Connection, member_id: uuid.UUID, moment: datetime) -> bool:
    """Late only means something when a shift is defined for that day. Shifts are
    local wall-clock times, so the comparison has to happen in that zone."""
    local_moment = moment.astimezone(LOCAL_ZONE)
    work_date = local_moment.date()
    row = connection.execute(
        """
        SELECT start_time, grace_minutes FROM schedules
        WHERE member_id = %s AND is_active
          AND (work_date = %s OR (work_date IS NULL AND weekday = %s))
        ORDER BY work_date NULLS LAST LIMIT 1
        """,
        (member_id, work_date, (work_date.weekday() + 1) % 7),
    ).fetchone()
    if row is None:
        return False
    latest_ok = datetime.combine(work_date, row[0], tzinfo=LOCAL_ZONE) + timedelta(minutes=row[1] or 0)
    return local_moment > latest_ok


def _notify_check_in(
    connection: psycopg.Connection,
    member_id: uuid.UUID,
    location_id: uuid.UUID,
    distance_meters: float,
    event_status: str,
) -> None:
    name = _location_name(connection, location_id)
    moment = _utc_now()
    notify(
        connection, member_id, "CHECK_IN",
        "Check-in thành công",
        f"{name} · cách {distance_meters:.0f} m"
        + (" · đã ghi lý do" if event_status == "WARNING_CONFIRMED" else ""),
        {"location_id": str(location_id), "distance_meters": round(distance_meters, 1)},
    )
    if _is_late(connection, member_id, moment):
        notify(
            connection, member_id, "LATE",
            "Bạn check-in muộn so với ca làm việc",
            f"Thời điểm ghi nhận {moment.astimezone(LOCAL_ZONE).strftime('%H:%M')} tại {name}",
            {"location_id": str(location_id)},
        )


def _notify_check_out(
    connection: psycopg.Connection,
    member_id: uuid.UUID,
    location_id: uuid.UUID,
    distance_meters: float,
) -> None:
    notify(
        connection, member_id, "CHECK_OUT",
        "Check-out thành công",
        f"{_location_name(connection, location_id)} · cách {distance_meters:.0f} m",
        {"location_id": str(location_id), "distance_meters": round(distance_meters, 1)},
    )


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


def _record_rejection(
    connection: psycopg.Connection,
    user: CurrentUser,
    location_id: uuid.UUID,
    event_type: str,
    status: str,
    failure_code: str,
    latitude: float,
    longitude: float,
    gps_accuracy_meters: float,
    distance_meters: float,
    idempotency_key: str,
    face_match_score: float | None = None,
    object_key: str | None = None,
) -> None:
    """A rejected attempt is still evidence: keep it so managers can review it."""
    connection.execute(
        """
        INSERT INTO attendance_events (
            member_id, location_id, event_type, status, server_time, latitude, longitude,
            gps_accuracy_meters, distance_meters, face_match_score, image_object_key,
            failure_code, idempotency_key
        )
        VALUES (%s, %s, %s::attendance_event_type, %s::attendance_status, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            user.id,
            location_id,
            event_type,
            status,
            _utc_now(),
            latitude,
            longitude,
            gps_accuracy_meters,
            distance_meters,
            face_match_score,
            object_key,
            failure_code,
            idempotency_key,
        ),
    )
    connection.commit()


def _reject(status_code: int, detail: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail=detail)


def _geofence_rejection(decision) -> tuple[str, int] | None:
    if decision.status == GeofenceStatus.GPS_ACCURACY_LOW:
        return "GPS_ACCURACY_LOW", 422
    if decision.status == GeofenceStatus.BLOCK:
        return "OUTSIDE_ALLOWED_ZONE", 403
    return None


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
        raise _reject(422, "GPS accuracy must be non-negative")
    with psycopg.connect(DATABASE_URL) as connection:
        # Scoped to the member: the key is globally unique, so an unscoped lookup
        # would hand somebody else's event back to whoever replayed their key.
        existing = connection.execute(
            "SELECT status::text, id, distance_meters, 'Request already processed' FROM attendance_events WHERE idempotency_key = %s AND member_id = %s",
            (idempotency_key, user.id),
        ).fetchone()
        if existing is not None:
            return _event_response(existing)
        # The column is globally unique, so a key already owned by someone else
        # would blow up on INSERT. Refuse it explicitly instead.
        if connection.execute(
            "SELECT 1 FROM attendance_events WHERE idempotency_key = %s", (idempotency_key,)
        ).fetchone() is not None:
            raise _reject(409, "IDEMPOTENCY_KEY_CONFLICT")
        connection.execute("SELECT id FROM users WHERE id = %s FOR UPDATE", (user.id,)).fetchone()
        if _open_state(connection, user.id) is not None:
            raise _reject(409, "CHECK_IN_ALREADY_EXISTS")
        location = _location_for_member(connection, user.id, location_id)
        if location is None:
            raise _reject(404, "Location is not assigned to this member")

        decision = evaluate_geofence(
            latitude, longitude, gps_accuracy_meters, float(location[1]), float(location[2]),
            GeofencePolicy(location[3], location[4], 100),
        )
        rejection = _geofence_rejection(decision)
        if rejection is not None:
            code, status_code = rejection
            _record_rejection(
                connection, user, location_id, "CHECK_IN", "BLOCKED", code,
                latitude, longitude, gps_accuracy_meters, decision.distance_meters, idempotency_key,
            )
            raise _reject(status_code, code)
        if decision.status == GeofenceStatus.WARNING_REASON_REQUIRED and not reason:
            raise _reject(422, "WARNING_REASON_REQUIRED")

        reference_embedding = _reference_embedding(connection, user.id)
        if reference_embedding is None:
            raise _reject(409, "FACE_NOT_ENROLLED")
        face_result = _verify_face(image, user.id, reference_embedding)
        if _face_ai_not_configured(face_result):
            raise _reject(503, "FACE_MODEL_NOT_CONFIGURED")

        object_key = f"attendance/{user.id}/{uuid.uuid4()}.jpg"
        PrivateObjectStorage().put_private(object_key, image, content_type)

        if face_result.get("status") != "VERIFIED":
            code = face_result.get("code", "FACE_NOT_MATCHED")
            _record_rejection(
                connection, user, location_id, "CHECK_IN", "FAILED", code,
                latitude, longitude, gps_accuracy_meters, decision.distance_meters, idempotency_key,
                face_result.get("face_match_score"), object_key,
            )
            raise _reject(403, code)

        event_status = "WARNING_CONFIRMED" if decision.status == GeofenceStatus.WARNING_REASON_REQUIRED else "SUCCESS"
        row = connection.execute(
            """
            INSERT INTO attendance_events (member_id, location_id, event_type, status, server_time, latitude, longitude, gps_accuracy_meters, distance_meters, face_match_score, liveness_score, image_object_key, reason, idempotency_key)
            VALUES (%s, %s, 'CHECK_IN', %s::attendance_status, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING status::text, id, distance_meters
            """,
            (user.id, location_id, event_status, _utc_now(), latitude, longitude, gps_accuracy_meters, decision.distance_meters, face_result.get("face_match_score"), face_result.get("liveness_score"), object_key, reason, idempotency_key),
        ).fetchone()
        _notify_check_in(connection, user.id, location[0], decision.distance_meters, event_status)
        connection.commit()
    return {"status": row[0], "event_id": row[1], "distance_meters": float(row[2]), "message": "Check-in thành công"}


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
        raise _reject(422, "GPS accuracy must be non-negative")
    with psycopg.connect(DATABASE_URL) as connection:
        # Scoped to the member: the key is globally unique, so an unscoped lookup
        # would hand somebody else's event back to whoever replayed their key.
        existing = connection.execute(
            "SELECT status::text, id, distance_meters, 'Request already processed' FROM attendance_events WHERE idempotency_key = %s AND member_id = %s",
            (idempotency_key, user.id),
        ).fetchone()
        if existing is not None:
            return _event_response(existing)
        # The column is globally unique, so a key already owned by someone else
        # would blow up on INSERT. Refuse it explicitly instead.
        if connection.execute(
            "SELECT 1 FROM attendance_events WHERE idempotency_key = %s", (idempotency_key,)
        ).fetchone() is not None:
            raise _reject(409, "IDEMPOTENCY_KEY_CONFLICT")
        connection.execute("SELECT id FROM users WHERE id = %s FOR UPDATE", (user.id,)).fetchone()
        open_event = _open_state(connection, user.id)
        if open_event is None:
            raise _reject(409, "CHECK_OUT_WITHOUT_CHECK_IN")
        location_id = open_event[1]
        checkout_location = connection.execute(
            "SELECT latitude, longitude, allow_radius_meters, warning_radius_meters FROM locations WHERE id = %s AND is_active = true",
            (location_id,),
        ).fetchone()
        if checkout_location is None:
            raise _reject(404, "Checkout location is inactive")

        decision = evaluate_geofence(
            latitude, longitude, gps_accuracy_meters, float(checkout_location[0]), float(checkout_location[1]),
            GeofencePolicy(checkout_location[2], checkout_location[3], 100),
        )
        rejection = _geofence_rejection(decision)
        if rejection is not None:
            code, status_code = rejection
            _record_rejection(
                connection, user, location_id, "CHECK_OUT", "BLOCKED", code,
                latitude, longitude, gps_accuracy_meters, decision.distance_meters, idempotency_key,
            )
            raise _reject(status_code, code)

        reference_embedding = _reference_embedding(connection, user.id)
        if reference_embedding is None:
            raise _reject(409, "FACE_NOT_ENROLLED")
        face_result = _verify_face(image, user.id, reference_embedding)
        if _face_ai_not_configured(face_result):
            raise _reject(503, "FACE_MODEL_NOT_CONFIGURED")

        object_key = f"attendance/{user.id}/{uuid.uuid4()}.jpg"
        PrivateObjectStorage().put_private(object_key, image, content_type)

        if face_result.get("status") != "VERIFIED":
            code = face_result.get("code", "FACE_NOT_MATCHED")
            _record_rejection(
                connection, user, location_id, "CHECK_OUT", "FAILED", code,
                latitude, longitude, gps_accuracy_meters, decision.distance_meters, idempotency_key,
                face_result.get("face_match_score"), object_key,
            )
            raise _reject(403, code)

        row = connection.execute(
            """
            INSERT INTO attendance_events (member_id, location_id, event_type, status, server_time, latitude, longitude, gps_accuracy_meters, distance_meters, face_match_score, liveness_score, image_object_key, idempotency_key)
            VALUES (%s, %s, 'CHECK_OUT', 'SUCCESS', %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING status::text, id, distance_meters
            """,
            (user.id, location_id, _utc_now(), latitude, longitude, gps_accuracy_meters, decision.distance_meters, face_result.get("face_match_score"), face_result.get("liveness_score"), object_key, idempotency_key),
        ).fetchone()
        _notify_check_out(connection, user.id, location_id, decision.distance_meters)
        connection.commit()
    return {"status": row[0], "event_id": row[1], "distance_meters": float(row[2]), "message": "Check-out thành công"}


def _event_dict(row: tuple) -> dict:
    return {
        "id": row[0],
        "event_type": row[1],
        "status": row[2],
        "server_time": row[3],
        "location_id": row[4],
        "location_name": row[5],
        "distance_meters": float(row[6]),
        "gps_accuracy_meters": float(row[7]),
        "face_match_score": float(row[8]) if row[8] is not None else None,
        "reason": row[9],
        "failure_code": row[10],
    }


MY_EVENT_COLUMNS = """
    e.id, e.event_type::text, e.status::text, e.server_time, e.location_id, l.name,
    e.distance_meters, e.gps_accuracy_meters, e.face_match_score, e.reason, e.failure_code
"""


def my_state(user: CurrentUser) -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        open_event = _open_state(connection, user.id)
        enrolled = connection.execute(
            "SELECT 1 FROM face_embeddings WHERE member_id = %s AND revoked_at IS NULL LIMIT 1", (user.id,)
        ).fetchone()
        last = connection.execute(
            f"SELECT {MY_EVENT_COLUMNS} FROM attendance_events e JOIN locations l ON l.id = e.location_id WHERE e.member_id = %s ORDER BY e.server_time DESC LIMIT 1",
            (user.id,),
        ).fetchone()
    return {
        "state": "CHECKED_IN" if open_event is not None else "NOT_CHECKED_IN",
        "face_enrolled": enrolled is not None,
        "open_check_in_id": open_event[0] if open_event is not None else None,
        "open_check_in_location_id": open_event[1] if open_event is not None else None,
        "open_check_in_time": open_event[2] if open_event is not None else None,
        "last_event": _event_dict(last) if last is not None else None,
    }


def my_history(user: CurrentUser, limit: int) -> list[dict]:
    with psycopg.connect(DATABASE_URL) as connection:
        rows = connection.execute(
            f"SELECT {MY_EVENT_COLUMNS} FROM attendance_events e JOIN locations l ON l.id = e.location_id WHERE e.member_id = %s ORDER BY e.server_time DESC LIMIT %s",
            (user.id, limit),
        ).fetchall()
    return [_event_dict(row) for row in rows]
