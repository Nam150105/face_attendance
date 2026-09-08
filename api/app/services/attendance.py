from __future__ import annotations

import json
import os
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


def _reference_embedding(connection: psycopg.Connection, member_id: uuid.UUID) -> tuple[list[float], str] | None:
    """The registered encoding and the engine that made it. The engine travels
    with it: 128 dlib numbers and 512 ArcFace numbers are not comparable, and a
    comparison across them would still return a plausible-looking score."""
    row = connection.execute(
        "SELECT embedding::text, model_name FROM face_embeddings WHERE member_id = %s AND revoked_at IS NULL"
        " ORDER BY created_at DESC LIMIT 1",
        (member_id,),
    ).fetchone()
    return (json.loads(row[0]), row[1]) if row else None


def _verify_face(image: bytes, member_id: uuid.UUID, reference: tuple[list[float], str] | None) -> dict:
    embedding, model_name = reference if reference else (None, "")
    try:
        response = httpx.post(
            "http://face-ai:8001/v1/verify",
            files={"image": ("attendance.jpg", image, "image/jpeg")},
            data={
                "member_id": str(member_id),
                "reference_embedding": json.dumps(embedding) if embedding else "",
                "reference_model": model_name or "",
            },
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


def _hour_rule(connection: psycopg.Connection, member_id: uuid.UUID, location_id: uuid.UUID) -> tuple | None:
    """
    The working hours for this place: (start, end, grace_minutes, enforce).

    Hours live on the location and nowhere else. Per-member shifts were removed
    because two sources for the same rule meant nobody could say why a given
    arrival counted as late.
    """
    row = connection.execute(
        "SELECT expected_check_in, expected_check_out, grace_minutes, enforce_hours "
        "FROM locations WHERE id = %s",
        (location_id,),
    ).fetchone()
    if row is None or row[0] is None:
        return None
    return (row[0], row[1], row[2] or 0, row[3])


def _minutes_late(rule: tuple | None, moment: datetime) -> int:
    """
    Minutes past the *start* time, not past the grace deadline.

    The grace window decides how to react, not whether the person was late: a
    member arriving 5 minutes into a 10-minute window is still told they were
    late, they are simply not refused.
    """
    if rule is None or rule[0] is None:
        return 0
    local_moment = moment.astimezone(LOCAL_ZONE)
    start = datetime.combine(local_moment.date(), rule[0], tzinfo=LOCAL_ZONE)
    delta = (local_moment - start).total_seconds() // 60
    return int(delta) if delta > 0 else 0


def _beyond_grace(rule: tuple | None, late_minutes: int) -> bool:
    """True when the arrival is past the window the location allows."""
    return rule is not None and late_minutes > (rule[2] or 0)


def _minutes_early_leave(rule: tuple | None, moment: datetime) -> int:
    """Minutes before the expected end, 0 when leaving on time or later."""
    if rule is None or rule[1] is None:
        return 0
    local_moment = moment.astimezone(LOCAL_ZONE)
    expected_end = datetime.combine(local_moment.date(), rule[1], tzinfo=LOCAL_ZONE)
    delta = (expected_end - local_moment).total_seconds() // 60
    return int(delta) if delta > 0 else 0


def describe_duration(minutes: int) -> str:
    hours, rest = divmod(abs(int(minutes)), 60)
    if hours and rest:
        return f"{hours} giờ {rest} phút"
    if hours:
        return f"{hours} giờ"
    return f"{rest} phút"


def _notify_managers(
    connection: psycopg.Connection,
    member_id: uuid.UUID,
    category: str,
    title: str,
    body: str,
    payload: dict,
) -> None:
    """Send one notification to every manager currently responsible for a member."""
    managers = connection.execute(
        "SELECT manager_user_id FROM manager_memberships "
        "WHERE member_user_id = %s AND status = 'ACTIVE'",
        (member_id,),
    ).fetchall()
    for (manager_id,) in managers:
        notify(connection, manager_id, category, title, body, payload)


AUTO_CHECK_OUT_HOURS = int(os.environ.get("AUTO_CHECK_OUT_HOURS", "24"))


def close_stale_sessions(connection: psycopg.Connection, member_id: uuid.UUID) -> int:
    """
    Close a check-in nobody ever checked out of.

    Someone who forgets to check out would otherwise stay "still working" for
    ever and be unable to start the next day, because a second check-in is
    refused while one is open. The closing event is marked as system-generated:
    it has no photo and no location reading, because nobody was measured.
    """
    open_event = _open_state(connection, member_id)
    if open_event is None:
        return 0
    opened_at = open_event[2]
    if (_utc_now() - opened_at).total_seconds() < AUTO_CHECK_OUT_HOURS * 3600:
        return 0

    closes_at = opened_at + timedelta(hours=AUTO_CHECK_OUT_HOURS)
    connection.execute(
        """
        INSERT INTO attendance_events
            (member_id, location_id, event_type, status, server_time, latitude, longitude,
             gps_accuracy_meters, distance_meters, reason, idempotency_key)
        VALUES (%s, %s, 'CHECK_OUT', 'SUCCESS', %s, 0, 0, 0, 0, %s, %s)
        """,
        (
            member_id,
            open_event[1],
            closes_at,
            f"Hệ thống tự kết thúc sau {AUTO_CHECK_OUT_HOURS} giờ vì không có lượt ra",
            f"auto-checkout-{open_event[0]}",
        ),
    )
    notify(
        connection, member_id, "AUTO_CHECK_OUT",
        "Hệ thống đã tự kết thúc buổi làm việc",
        f"Buổi bắt đầu lúc {opened_at.astimezone(LOCAL_ZONE).strftime('%H:%M %d/%m')} chưa có lượt ra, "
        f"nên hệ thống tự đóng sau {AUTO_CHECK_OUT_HOURS} giờ. Lần tới bạn nhớ bấm ra khi kết thúc nhé.",
        {"opened_at": opened_at.isoformat(), "auto": True},
    )
    _notify_managers(
        connection, member_id, "AUTO_CHECK_OUT",
        f"{_member_label(connection, member_id)} không bấm giờ ra",
        f"Buổi bắt đầu lúc {opened_at.astimezone(LOCAL_ZONE).strftime('%H:%M %d/%m')} đã được hệ thống "
        f"tự đóng sau {AUTO_CHECK_OUT_HOURS} giờ.",
        {"member_id": str(member_id), "opened_at": opened_at.isoformat()},
    )
    return 1


def _location_name(connection: psycopg.Connection, location_id: uuid.UUID) -> str:
    row = connection.execute("SELECT name FROM locations WHERE id = %s", (location_id,)).fetchone()
    return row[0] if row else "địa điểm"


def _member_label(connection: psycopg.Connection, member_id: uuid.UUID) -> str:
    row = connection.execute(
        "SELECT COALESCE(mp.full_name, u.email) FROM users u "
        "LEFT JOIN member_profiles mp ON mp.user_id = u.id WHERE u.id = %s",
        (member_id,),
    ).fetchone()
    return row[0] if row else "Thành viên"


def _notify_check_in(
    connection: psycopg.Connection,
    member_id: uuid.UUID,
    location_id: uuid.UUID,
    distance_meters: float,
    event_status: str,
    late_minutes: int = 0,
) -> None:
    name = _location_name(connection, location_id)
    moment = _utc_now().astimezone(LOCAL_ZONE)
    notify(
        connection, member_id, "CHECK_IN",
        "Đã ghi nhận giờ vào",
        f"{name} lúc {moment.strftime('%H:%M')}"
        + (" · có ghi lý do về vị trí" if event_status == "WARNING_CONFIRMED" else ""),
        {"location_id": str(location_id), "distance_meters": round(distance_meters, 1)},
    )
    if late_minutes > 0:
        gap = describe_duration(late_minutes)
        notify(
            connection, member_id, "LATE",
            f"Bạn đến muộn {gap}",
            f"Ghi nhận lúc {moment.strftime('%H:%M')} tại {name}.",
            {"location_id": str(location_id), "minutes_late": late_minutes},
        )
        # The manager needs the number too, not just the fact.
        _notify_managers(
            connection, member_id, "LATE",
            f"{_member_label(connection, member_id)} vào muộn {gap}",
            f"Ghi nhận lúc {moment.strftime('%H:%M')} tại {name}.",
            {"member_id": str(member_id), "location_id": str(location_id), "minutes_late": late_minutes},
        )


def _notify_check_out(
    connection: psycopg.Connection,
    member_id: uuid.UUID,
    location_id: uuid.UUID,
    distance_meters: float,
    early_minutes: int = 0,
) -> None:
    name = _location_name(connection, location_id)
    moment = _utc_now().astimezone(LOCAL_ZONE)
    notify(
        connection, member_id, "CHECK_OUT",
        "Đã ghi nhận giờ ra",
        f"{name} lúc {moment.strftime('%H:%M')}",
        {"location_id": str(location_id), "distance_meters": round(distance_meters, 1)},
    )
    if early_minutes > 0:
        gap = describe_duration(early_minutes)
        notify(
            connection, member_id, "EARLY_LEAVE",
            f"Bạn ra sớm {gap}",
            f"Ghi nhận lúc {moment.strftime('%H:%M')} tại {name}.",
            {"location_id": str(location_id), "minutes_early_leave": early_minutes},
        )
        _notify_managers(
            connection, member_id, "EARLY_LEAVE",
            f"{_member_label(connection, member_id)} ra sớm {gap}",
            f"Ghi nhận lúc {moment.strftime('%H:%M')} tại {name}.",
            {"member_id": str(member_id), "location_id": str(location_id), "minutes_early_leave": early_minutes},
        )


def _open_state(connection: psycopg.Connection, member_id: uuid.UUID) -> tuple | None:
    return connection.execute(
        """
        SELECT id, location_id, server_time FROM attendance_events
        WHERE member_id = %s AND deleted_at IS NULL AND event_type = 'CHECK_IN' AND status IN ('SUCCESS', 'WARNING_CONFIRMED')
          AND NOT EXISTS (
              SELECT 1 FROM attendance_events checkout
              WHERE checkout.member_id = attendance_events.member_id
                AND checkout.event_type = 'CHECK_OUT'
                AND checkout.status = 'SUCCESS' AND checkout.deleted_at IS NULL
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
        # A forgotten check-out from yesterday must not block today's start.
        close_stale_sessions(connection, user.id)
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

        # Working-hour rule is checked before the camera work: refusing early
        # costs the member nothing and saves a pointless face comparison.
        rule = _hour_rule(connection, user.id, location_id)
        late_minutes = _minutes_late(rule, _utc_now())
        # Only an arrival past the allowed window can be refused, and only when
        # the location owner asked for that.
        if _beyond_grace(rule, late_minutes) and rule[3]:
            _record_rejection(
                connection, user, location_id, "CHECK_IN", "BLOCKED", "CHECK_IN_TOO_LATE",
                latitude, longitude, gps_accuracy_meters, decision.distance_meters, idempotency_key,
            )
            raise _reject(403, "CHECK_IN_TOO_LATE")

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
            INSERT INTO attendance_events (member_id, location_id, event_type, status, server_time, latitude, longitude, gps_accuracy_meters, distance_meters, face_match_score, face_distance, face_engine, liveness_score, image_object_key, reason, idempotency_key, minutes_late)
            VALUES (%s, %s, 'CHECK_IN', %s::attendance_status, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING status::text, id, distance_meters
            """,
            (user.id, location_id, event_status, _utc_now(), latitude, longitude, gps_accuracy_meters, decision.distance_meters, face_result.get("face_match_score"), face_result.get("face_distance"), face_result.get("model_name"), face_result.get("liveness_score"), object_key, reason, idempotency_key, late_minutes or None),
        ).fetchone()
        _notify_check_in(connection, user.id, location[0], decision.distance_meters, event_status, late_minutes)
        connection.commit()

    within_grace = late_minutes > 0 and not _beyond_grace(rule, late_minutes)
    if late_minutes == 0:
        message = "Đã ghi nhận giờ vào. Bạn đến đúng giờ."
    elif within_grace:
        message = f"Đã ghi nhận giờ vào. Bạn muộn {describe_duration(late_minutes)}, vẫn trong mức cho phép."
    else:
        message = f"Đã ghi nhận giờ vào. Bạn muộn {describe_duration(late_minutes)}."
    return {
        "status": row[0],
        "event_id": row[1],
        "distance_meters": float(row[2]),
        "message": message,
        "minutes_late": late_minutes,
        "late_within_grace": within_grace,
    }


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

        rule = _hour_rule(connection, user.id, location_id)
        early_minutes = _minutes_early_leave(rule, _utc_now())

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
            INSERT INTO attendance_events (member_id, location_id, event_type, status, server_time, latitude, longitude, gps_accuracy_meters, distance_meters, face_match_score, face_distance, face_engine, liveness_score, image_object_key, idempotency_key, minutes_early_leave)
            VALUES (%s, %s, 'CHECK_OUT', 'SUCCESS', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING status::text, id, distance_meters
            """,
            (user.id, location_id, _utc_now(), latitude, longitude, gps_accuracy_meters, decision.distance_meters, face_result.get("face_match_score"), face_result.get("face_distance"), face_result.get("model_name"), face_result.get("liveness_score"), object_key, idempotency_key, early_minutes or None),
        ).fetchone()
        _notify_check_out(connection, user.id, location_id, decision.distance_meters, early_minutes)
        connection.commit()

    # Leaving late is never a problem: the worked time is recorded either way.
    message = (
        f"Đã ghi nhận giờ ra. Bạn về sớm {describe_duration(early_minutes)} so với giờ tan."
        if early_minutes > 0
        else "Đã ghi nhận giờ ra."
    )
    return {
        "status": row[0],
        "event_id": row[1],
        "distance_meters": float(row[2]),
        "message": message,
        "minutes_early_leave": early_minutes,
    }


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
        if close_stale_sessions(connection, user.id):
            connection.commit()
        open_event = _open_state(connection, user.id)
        enrolled = connection.execute(
            "SELECT 1 FROM face_embeddings WHERE member_id = %s AND revoked_at IS NULL LIMIT 1", (user.id,)
        ).fetchone()
        last = connection.execute(
            f"SELECT {MY_EVENT_COLUMNS} FROM attendance_events e JOIN locations l ON l.id = e.location_id WHERE e.member_id = %s AND e.deleted_at IS NULL ORDER BY e.server_time DESC LIMIT 1",
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
            f"SELECT {MY_EVENT_COLUMNS} FROM attendance_events e JOIN locations l ON l.id = e.location_id WHERE e.member_id = %s AND e.deleted_at IS NULL ORDER BY e.server_time DESC LIMIT %s",
            (user.id, limit),
        ).fetchall()
    return [_event_dict(row) for row in rows]
