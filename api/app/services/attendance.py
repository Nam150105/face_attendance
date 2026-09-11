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
from app.services.attendance_days import session_is_open
from app.services.member_portal import APP_TIMEZONE, LOCAL_ZONE, notify
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
    # Either granted to this person directly or attached to a unit they are in.
    return connection.execute(
        """
        SELECT l.id, l.latitude, l.longitude, l.allow_radius_meters, l.warning_radius_meters
        FROM locations l
        WHERE l.id = %s AND l.is_active = true AND (
            EXISTS (SELECT 1 FROM member_locations ml
                    WHERE ml.member_id = %s AND ml.location_id = l.id)
            OR EXISTS (SELECT 1 FROM team_locations tl
                       JOIN manager_memberships mm ON mm.team_id = tl.team_id
                       WHERE tl.location_id = l.id AND mm.member_user_id = %s
                         AND mm.status = 'ACTIVE')
        )
        """,
        (location_id, member_id, member_id),
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


def _unclosed_check_in(connection: psycopg.Connection, member_id: uuid.UUID) -> tuple | None:
    """The latest valid check-in with no valid check-out after it, however old."""
    return connection.execute(
        """
        SELECT id, location_id, server_time FROM attendance_events
        WHERE member_id = %s AND deleted_at IS NULL AND event_type = 'CHECK_IN'
          AND status IN ('SUCCESS', 'WARNING_CONFIRMED')
          AND NOT EXISTS (
              SELECT 1 FROM attendance_events checkout
              WHERE checkout.member_id = attendance_events.member_id
                AND checkout.event_type = 'CHECK_OUT'
                -- A check-out from another site is WARNING_CONFIRMED and still
                -- a check-out. Counting only SUCCESS left people "at work"
                -- for a day after they had gone home.
                AND checkout.status IN ('SUCCESS', 'WARNING_CONFIRMED')
                AND checkout.deleted_at IS NULL
                AND checkout.server_time > attendance_events.server_time
          )
        ORDER BY server_time DESC LIMIT 1
        """,
        (member_id,),
    ).fetchone()


def _open_state(connection: psycopg.Connection, member_id: uuid.UUID) -> tuple | None:
    """
    The session this person can still check out of, or None.

    Open is a matter of time, not of a row somebody wrote: a check-in stays
    open for SESSION_MAX_HOURS and then simply is not. Nothing is inserted to
    close it — the day shows "chưa chấm ra" and a person fixes it — so there
    is no job to run, no fake departure at coordinates 0,0, and nothing that
    lands on tomorrow and blocks it.
    """
    row = _unclosed_check_in(connection, member_id)
    if row is None or not session_is_open(row[2]):
        return None
    return row


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


def _checked_in_today(connection: psycopg.Connection, member_id: uuid.UUID) -> bool:
    """
    Has this person already opened a session today (local time)?

    Counted by check-ins, not check-outs. Counting check-outs meant a departure
    that fell on the next calendar day — after midnight, or invented by the old
    auto-close — locked that whole next day.
    """
    return connection.execute(
        """
        SELECT 1 FROM attendance_events
        WHERE member_id = %s AND deleted_at IS NULL AND event_type = 'CHECK_IN'
          AND status IN ('SUCCESS', 'WARNING_CONFIRMED')
          AND (server_time AT TIME ZONE %s)::date = (now() AT TIME ZONE %s)::date
        LIMIT 1
        """,
        (member_id, APP_TIMEZONE, APP_TIMEZONE),
    ).fetchone() is not None

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
        if _open_state(connection, user.id) is not None:
            raise _reject(409, "CHECK_IN_ALREADY_EXISTS")
        if _checked_in_today(connection, user.id):
            # Already opened a session today. A second one would show up as a
            # second working day for the same date.
            raise _reject(409, "ALREADY_WORKED_TODAY")
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
        # What the recognition libraries actually measured on this photo. The
        # person handing over their face is entitled to see the number that
        # decided it was them, and which engine produced it.
        **_face_reading(face_result),
    }


def check_out(
    user: CurrentUser,
    latitude: float,
    longitude: float,
    gps_accuracy_meters: float,
    idempotency_key: str,
    image: bytes,
    content_type: str,
    location_id: uuid.UUID | None = None,
    reason: str | None = None,
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
            # Two different situations, two different messages: never checked
            # in, or checked in so long ago that the session has lapsed.
            stale = _unclosed_check_in(connection, user.id)
            raise _reject(409, "SESSION_EXPIRED" if stale is not None else "CHECK_OUT_WITHOUT_CHECK_IN")
        opened_at = open_event[1]
        # Leaving from somewhere else is allowed — a shift can end at another
        # site of the same organisation — but it is not the default, and it is
        # not silent: the person says why, and the record carries the reason.
        elsewhere = location_id is not None and location_id != opened_at
        if elsewhere:
            granted = _location_for_member(connection, user.id, location_id)
            if granted is None:
                raise _reject(404, "Location is not assigned to this member")
            if len((reason or "").strip()) < 5:
                raise _reject(422, "CHECKOUT_LOCATION_REASON_REQUIRED")
            checkout_location = (granted[1], granted[2], granted[3], granted[4])
        else:
            location_id = opened_at
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

        # Same-place check-outs stay plain SUCCESS. One at another site is
        # valid too, but flagged so the manager reading the day sees it.
        event_status = "WARNING_CONFIRMED" if elsewhere else "SUCCESS"
        row = connection.execute(
            """
            INSERT INTO attendance_events (member_id, location_id, event_type, status, server_time, latitude, longitude, gps_accuracy_meters, distance_meters, face_match_score, face_distance, face_engine, liveness_score, image_object_key, idempotency_key, minutes_early_leave, reason)
            VALUES (%s, %s, 'CHECK_OUT', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING status::text, id, distance_meters
            """,
            (user.id, location_id, event_status, _utc_now(), latitude, longitude, gps_accuracy_meters, decision.distance_meters, face_result.get("face_match_score"), face_result.get("face_distance"), face_result.get("model_name"), face_result.get("liveness_score"), object_key, idempotency_key, early_minutes or None, (reason or "").strip() or None),
        ).fetchone()
        _notify_check_out(connection, user.id, location_id, decision.distance_meters, early_minutes)
        connection.commit()

    # Leaving late is never a problem: the worked time is recorded either way.
    message = (
        f"Đã ghi nhận giờ ra. Bạn về sớm {describe_duration(early_minutes)} so với giờ tan."
        if early_minutes > 0
        else "Đã ghi nhận giờ ra."
    )
    if elsewhere:
        message += " Bạn chấm ra ở nơi khác nơi chấm vào, lý do đã được ghi lại."
    return {
        "status": row[0],
        "event_id": row[1],
        "distance_meters": float(row[2]),
        "message": message,
        "minutes_early_leave": early_minutes,
        **_face_reading(face_result),
    }


def _face_reading(face_result: dict) -> dict:
    """The comparison, in the terms the engine reported it."""
    return {
        "face_distance": face_result.get("face_distance"),
        "face_threshold": face_result.get("threshold"),
        "face_metric": face_result.get("metric"),
        "face_engine": face_result.get("model_name"),
        "face_detector": face_result.get("detector"),
    }


def _event_dict(row: tuple) -> dict:
    return {
        "id": row[0],
        "event_type": row[1],
        "status": row[2],
        "server_time": row[3],
        "location_id": row[4],
        "location_name": row[5],
        "distance_meters": float(row[6]) if row[6] is not None else None,
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
            f"SELECT {MY_EVENT_COLUMNS} FROM attendance_events e JOIN locations l ON l.id = e.location_id WHERE e.member_id = %s AND e.deleted_at IS NULL ORDER BY e.server_time DESC LIMIT 1",
            (user.id,),
        ).fetchone()
        has_manager = connection.execute(
            "SELECT 1 FROM manager_memberships WHERE member_user_id = %s AND status = 'ACTIVE' LIMIT 1",
            (user.id,),
        ).fetchone() is not None
        place_count = connection.execute(
            """
            SELECT count(*) FROM (
                SELECT location_id FROM member_locations WHERE member_id = %s
                UNION
                SELECT tl.location_id FROM team_locations tl
                JOIN manager_memberships mm ON mm.team_id = tl.team_id
                WHERE mm.member_user_id = %s AND mm.status = 'ACTIVE'
            ) AS allowed
            JOIN locations l ON l.id = allowed.location_id AND l.is_active
            """,
            (user.id, user.id),
        ).fetchone()[0]
    # Why the button is off, decided on the server: the member portal used to
    # let anybody open the camera and only learn at upload time that they have
    # no manager and nowhere to stand.
    blocked = None
    if not has_manager:
        blocked = "NO_MANAGER"
    elif place_count == 0:
        blocked = "NO_LOCATION"
    elif enrolled is None:
        blocked = "NO_FACE"

    return {
        "state": "CHECKED_IN" if open_event is not None else "NOT_CHECKED_IN",
        "face_enrolled": enrolled is not None,
        "location_count": place_count,
        "has_manager": has_manager,
        "can_check_in": blocked is None,
        "blocked_reason": blocked,
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
