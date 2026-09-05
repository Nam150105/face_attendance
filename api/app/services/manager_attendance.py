from __future__ import annotations

import json
import uuid
from datetime import date, datetime

import psycopg
from fastapi import HTTPException

from app.auth import DATABASE_URL
from app.services.storage import PrivateObjectStorage


ADJUSTABLE_STATUSES = {"SUCCESS", "WARNING_CONFIRMED", "BLOCKED", "FAILED"}

EVENT_COLUMNS = """
    e.id, e.member_id, u.email, mp.full_name, e.event_type::text, e.status::text, e.server_time,
    e.location_id, l.name, e.latitude, e.longitude, e.gps_accuracy_meters, e.distance_meters,
    e.face_match_score, e.liveness_score, e.image_object_key IS NOT NULL, e.reason, e.created_at
"""


def _event(row: tuple) -> dict:
    return {
        "id": row[0],
        "member_id": row[1],
        "member_email": row[2],
        "member_name": row[3],
        "event_type": row[4],
        "status": row[5],
        "server_time": row[6],
        "location_id": row[7],
        "location_name": row[8],
        "latitude": float(row[9]),
        "longitude": float(row[10]),
        "gps_accuracy_meters": float(row[11]),
        "distance_meters": float(row[12]),
        "face_match_score": float(row[13]) if row[13] is not None else None,
        "liveness_score": float(row[14]) if row[14] is not None else None,
        "has_image": row[15],
        "reason": row[16],
        "created_at": row[17],
    }


def _managed_member_ids(connection: psycopg.Connection, manager_id: uuid.UUID) -> list[uuid.UUID]:
    rows = connection.execute(
        "SELECT member_user_id FROM manager_memberships WHERE manager_user_id = %s AND status = 'ACTIVE'",
        (manager_id,),
    ).fetchall()
    return [row[0] for row in rows]


def _scoped_event(connection: psycopg.Connection, manager_id: uuid.UUID, event_id: uuid.UUID) -> tuple:
    row = connection.execute(
        f"""
        SELECT {EVENT_COLUMNS}
        FROM attendance_events e
        JOIN users u ON u.id = e.member_id
        LEFT JOIN member_profiles mp ON mp.user_id = e.member_id
        JOIN locations l ON l.id = e.location_id
        JOIN manager_memberships mm ON mm.member_user_id = e.member_id
        WHERE e.id = %s AND mm.manager_user_id = %s AND mm.status = 'ACTIVE'
        """,
        (event_id, manager_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Attendance event is outside manager scope")
    return row


def list_attendance(manager_id: uuid.UUID, filters: dict) -> dict:
    conditions = ["mm.manager_user_id = %s", "mm.status = 'ACTIVE'"]
    parameters: list = [manager_id]
    if filters.get("member_id"):
        conditions.append("e.member_id = %s")
        parameters.append(filters["member_id"])
    if filters.get("date_from"):
        conditions.append("e.server_time >= %s")
        parameters.append(filters["date_from"])
    if filters.get("date_to"):
        conditions.append("e.server_time < (%s::date + interval '1 day')")
        parameters.append(filters["date_to"])
    if filters.get("status"):
        conditions.append("e.status = %s::attendance_status")
        parameters.append(filters["status"])
    if filters.get("event_type"):
        conditions.append("e.event_type = %s::attendance_event_type")
        parameters.append(filters["event_type"])
    if filters.get("location_id"):
        conditions.append("e.location_id = %s")
        parameters.append(filters["location_id"])
    where = " AND ".join(conditions)

    with psycopg.connect(DATABASE_URL) as connection:
        total = connection.execute(
            f"""
            SELECT count(*)
            FROM attendance_events e
            JOIN manager_memberships mm ON mm.member_user_id = e.member_id
            WHERE {where}
            """,
            parameters,
        ).fetchone()[0]
        rows = connection.execute(
            f"""
            SELECT {EVENT_COLUMNS}
            FROM attendance_events e
            JOIN users u ON u.id = e.member_id
            LEFT JOIN member_profiles mp ON mp.user_id = e.member_id
            JOIN locations l ON l.id = e.location_id
            JOIN manager_memberships mm ON mm.member_user_id = e.member_id
            WHERE {where}
            ORDER BY e.server_time DESC
            LIMIT %s OFFSET %s
            """,
            [*parameters, filters.get("limit", 50), filters.get("offset", 0)],
        ).fetchall()
    return {"total": total, "items": [_event(row) for row in rows]}


def get_attendance(manager_id: uuid.UUID, event_id: uuid.UUID) -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        return _event(_scoped_event(connection, manager_id, event_id))


def attendance_image(manager_id: uuid.UUID, event_id: uuid.UUID) -> tuple[bytes, str]:
    with psycopg.connect(DATABASE_URL) as connection:
        _scoped_event(connection, manager_id, event_id)
        row = connection.execute(
            "SELECT image_object_key FROM attendance_events WHERE id = %s", (event_id,)
        ).fetchone()
    if row is None or not row[0]:
        raise HTTPException(status_code=404, detail="Attendance event has no evidence image")
    return PrivateObjectStorage().get_private(row[0])


def manual_adjust(manager_id: uuid.UUID, event_id: uuid.UUID, payload: dict) -> dict:
    reason = (payload.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="ADJUST_REASON_REQUIRED")
    new_status = payload.get("status")
    new_time: datetime | None = payload.get("server_time")
    if new_status is None and new_time is None:
        raise HTTPException(status_code=422, detail="NOTHING_TO_ADJUST")
    if new_status is not None and new_status not in ADJUSTABLE_STATUSES:
        raise HTTPException(status_code=422, detail="INVALID_ATTENDANCE_STATUS")

    with psycopg.connect(DATABASE_URL) as connection:
        current = _event(_scoped_event(connection, manager_id, event_id))
        before = {"status": current["status"], "server_time": current["server_time"].isoformat()}
        after = {
            "status": new_status or current["status"],
            "server_time": (new_time or current["server_time"]).isoformat(),
        }
        if before == after:
            raise HTTPException(status_code=422, detail="NOTHING_TO_ADJUST")
        connection.execute(
            "UPDATE attendance_events SET status = %s::attendance_status, server_time = %s WHERE id = %s",
            (after["status"], new_time or current["server_time"], event_id),
        )
        connection.execute(
            """
            INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_json, after_json, reason)
            VALUES (%s, 'ATTENDANCE_MANUALLY_ADJUSTED', 'attendance_event', %s, %s::jsonb, %s::jsonb, %s)
            """,
            (manager_id, event_id, json.dumps(before), json.dumps(after), reason),
        )
        connection.commit()
        return _event(_scoped_event(connection, manager_id, event_id))


def list_audit_logs(manager_id: uuid.UUID, filters: dict) -> dict:
    conditions = ["a.actor_user_id = %s"]
    parameters: list = [manager_id]
    if filters.get("entity_type"):
        conditions.append("a.entity_type = %s")
        parameters.append(filters["entity_type"])
    if filters.get("action"):
        conditions.append("a.action = %s")
        parameters.append(filters["action"])
    where = " AND ".join(conditions)
    with psycopg.connect(DATABASE_URL) as connection:
        total = connection.execute(f"SELECT count(*) FROM audit_logs a WHERE {where}", parameters).fetchone()[0]
        rows = connection.execute(
            f"""
            SELECT a.id, a.actor_user_id, u.email, a.action, a.entity_type, a.entity_id,
                   a.before_json, a.after_json, a.reason, a.created_at
            FROM audit_logs a JOIN users u ON u.id = a.actor_user_id
            WHERE {where}
            ORDER BY a.created_at DESC
            LIMIT %s OFFSET %s
            """,
            [*parameters, filters.get("limit", 50), filters.get("offset", 0)],
        ).fetchall()
    return {
        "total": total,
        "items": [
            {
                "id": row[0],
                "actor_user_id": row[1],
                "actor_email": row[2],
                "action": row[3],
                "entity_type": row[4],
                "entity_id": row[5],
                "before_json": row[6],
                "after_json": row[7],
                "reason": row[8],
                "created_at": row[9],
            }
            for row in rows
        ],
    }


def member_attendance(manager_id: uuid.UUID, member_id: uuid.UUID, filters: dict) -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        if member_id not in _managed_member_ids(connection, manager_id):
            raise HTTPException(status_code=404, detail="Member is outside manager scope")
    return list_attendance(manager_id, {**filters, "member_id": member_id})


def manager_dashboard(manager_id: uuid.UUID) -> dict:
    today = date.today()
    with psycopg.connect(DATABASE_URL) as connection:
        members = connection.execute(
            "SELECT count(*) FROM manager_memberships WHERE manager_user_id = %s AND status = 'ACTIVE'",
            (manager_id,),
        ).fetchone()[0]
        locations = connection.execute(
            "SELECT count(*) FROM locations WHERE manager_user_id = %s AND is_active = true", (manager_id,)
        ).fetchone()[0]
        enrolled = connection.execute(
            """
            SELECT count(DISTINCT f.member_id)
            FROM face_embeddings f
            JOIN manager_memberships mm ON mm.member_user_id = f.member_id
            WHERE mm.manager_user_id = %s AND mm.status = 'ACTIVE' AND f.revoked_at IS NULL
            """,
            (manager_id,),
        ).fetchone()[0]
        today_events, checked_in = connection.execute(
            """
            SELECT
                count(*) FILTER (WHERE e.server_time >= %s),
                count(DISTINCT e.member_id) FILTER (
                    WHERE e.event_type = 'CHECK_IN' AND e.status IN ('SUCCESS', 'WARNING_CONFIRMED')
                      AND e.server_time >= %s
                      AND NOT EXISTS (
                          SELECT 1 FROM attendance_events c
                          WHERE c.member_id = e.member_id AND c.event_type = 'CHECK_OUT'
                            AND c.status = 'SUCCESS' AND c.server_time > e.server_time
                      )
                )
            FROM attendance_events e
            JOIN manager_memberships mm ON mm.member_user_id = e.member_id
            WHERE mm.manager_user_id = %s AND mm.status = 'ACTIVE'
            """,
            (today, today, manager_id),
        ).fetchone()
    return {
        "active_members": members,
        "active_locations": locations,
        "members_with_face": enrolled,
        "events_today": today_events,
        "currently_checked_in": checked_in,
    }
