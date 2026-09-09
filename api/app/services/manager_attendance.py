from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta

import psycopg
from fastapi import HTTPException

from app.auth import CurrentUser, DATABASE_URL
from app.services.member_portal import APP_TIMEZONE
from app.services.permissions import assert_can_see_member, visible_member_ids
from app.services.storage import PrivateObjectStorage


ADJUSTABLE_STATUSES = {"SUCCESS", "WARNING_CONFIRMED", "BLOCKED", "FAILED"}

EVENT_COLUMNS = """
    e.id, e.member_id, u.email, mp.full_name, e.event_type::text, e.status::text, e.server_time,
    e.location_id, l.name, e.latitude, e.longitude, e.gps_accuracy_meters, e.distance_meters,
    e.face_match_score, e.liveness_score, e.image_object_key IS NOT NULL, e.reason, e.created_at,
    e.minutes_late, e.minutes_early_leave,
    e.failure_code, e.deleted_at,
    e.face_distance, e.face_engine,
    EXISTS (SELECT 1 FROM face_embeddings f
            WHERE f.member_id = e.member_id AND f.revoked_at IS NULL AND f.image_object_key IS NOT NULL)
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
        "failure_code": row[20],
        "minutes_late": row[18],
        "minutes_early_leave": row[19],
        "deleted_at": row[21],
        "face_distance": float(row[22]) if row[22] is not None else None,
        "face_engine": row[23],
        "has_enrollment_photo": row[24],
    }


def _managed_member_ids(connection: psycopg.Connection, manager_id: uuid.UUID) -> list[uuid.UUID]:
    rows = connection.execute(
        "SELECT member_user_id FROM manager_memberships WHERE manager_user_id = %s AND status = 'ACTIVE'",
        (manager_id,),
    ).fetchall()
    return [row[0] for row in rows]


# Deleted rows drop out of every listing; they stay reachable by id so a manager
# can still open the one they just removed.
LIVE_ONLY = "e.deleted_at IS NULL"


def _scope(connection: psycopg.Connection, user: CurrentUser) -> tuple[str, list]:
    """
    SQL for "rows this viewer is allowed to see". A super admin gets everything,
    a manager their group plus their own attendance, anyone else only their own.
    Screens are opened by permission; this is what decides whose data appears.
    """
    visible = visible_member_ids(connection, user)
    if visible is None:
        return "TRUE", []
    return "e.member_id = ANY(%s)", [visible]


def _scoped_event(connection: psycopg.Connection, user: CurrentUser, event_id: uuid.UUID) -> tuple:
    scope, scope_params = _scope(connection, user)
    row = connection.execute(
        f"""
        SELECT {EVENT_COLUMNS}
        FROM attendance_events e
        JOIN users u ON u.id = e.member_id
        LEFT JOIN member_profiles mp ON mp.user_id = e.member_id
        JOIN locations l ON l.id = e.location_id
        WHERE e.id = %s AND {scope}
        """,
        [event_id, *scope_params],
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Attendance event is outside your scope")
    return row


def list_attendance(user: CurrentUser, filters: dict) -> dict:
    with psycopg.connect(DATABASE_URL) as scope_connection:
        scope, scope_params = _scope(scope_connection, user)
    conditions = [scope, LIVE_ONLY]
    parameters: list = [*scope_params]
    if not filters.get("include_invalid"):
        # A refused attempt is not attendance. Mixing the two into one list
        # makes every count on the screen quietly wrong.
        conditions.append("e.status IN ('SUCCESS', 'WARNING_CONFIRMED')")
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
            WHERE {where}
            ORDER BY e.server_time DESC
            LIMIT %s OFFSET %s
            """,
            [*parameters, filters.get("limit", 50), filters.get("offset", 0)],
        ).fetchall()
    return {"total": total, "items": [_event(row) for row in rows]}


def get_attendance(user: CurrentUser, event_id: uuid.UUID) -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        return _event(_scoped_event(connection, user, event_id))


def attendance_image(user: CurrentUser, event_id: uuid.UUID) -> tuple[bytes, str]:
    with psycopg.connect(DATABASE_URL) as connection:
        _scoped_event(connection, user, event_id)
        row = connection.execute(
            "SELECT image_object_key FROM attendance_events WHERE id = %s", (event_id,)
        ).fetchone()
    if row is None or not row[0]:
        raise HTTPException(status_code=404, detail="Attendance event has no evidence image")
    return PrivateObjectStorage().get_private(row[0])


def enrollment_photo(user: CurrentUser, member_id: uuid.UUID) -> tuple[bytes, str]:
    """The face this person registered, so it can sit next to the face that
    turned up. Anyone enrolled before this was stored has no photo to show."""
    with psycopg.connect(DATABASE_URL) as connection:
        assert_can_see_member(connection, user, member_id)
        row = connection.execute(
            "SELECT image_object_key FROM face_embeddings WHERE member_id = %s AND revoked_at IS NULL"
            " ORDER BY created_at DESC LIMIT 1",
            (member_id,),
        ).fetchone()
    if row is None or not row[0]:
        raise HTTPException(status_code=404, detail="ENROLLMENT_PHOTO_MISSING")
    return PrivateObjectStorage().get_private(row[0])


def login_history(user: CurrentUser, member_id: uuid.UUID, limit: int) -> dict:
    """Sign-in attempts for one account. A run of BAD_PASSWORD followed by
    RATE_LIMITED is what being locked out looks like from the outside."""
    with psycopg.connect(DATABASE_URL) as connection:
        assert_can_see_member(connection, user, member_id)
        rows = connection.execute(
            "SELECT outcome, ip_address, user_agent, created_at FROM login_attempts"
            " WHERE user_id = %s ORDER BY created_at DESC LIMIT %s",
            (member_id, limit),
        ).fetchall()
        totals = connection.execute(
            "SELECT outcome, count(*) FROM login_attempts WHERE user_id = %s GROUP BY outcome",
            (member_id,),
        ).fetchall()
    return {
        "totals": {row[0]: row[1] for row in totals},
        "items": [
            {"outcome": row[0], "ip_address": row[1], "user_agent": row[2], "created_at": row[3]}
            for row in rows
        ],
    }


def manual_adjust(user: CurrentUser, event_id: uuid.UUID, payload: dict) -> dict:
    manager_id = user.id
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
        current = _event(_scoped_event(connection, user, event_id))
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
        return _event(_scoped_event(connection, user, event_id))


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


def member_attendance(user: CurrentUser, member_id: uuid.UUID, filters: dict) -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        assert_can_see_member(connection, user, member_id)
    return list_attendance(user, {**filters, "member_id": member_id})


def manager_dashboard(manager_id: uuid.UUID) -> dict:
    today = date.today()
    since = today - timedelta(days=6)
    with psycopg.connect(DATABASE_URL) as connection:
        locations = connection.execute(
            "SELECT count(*) FROM locations WHERE manager_user_id = %s AND is_active = true", (manager_id,)
        ).fetchone()[0]
        members = connection.execute(
            """
            SELECT u.id, u.email, mp.full_name,
                   EXISTS (SELECT 1 FROM face_embeddings f WHERE f.member_id = u.id AND f.revoked_at IS NULL),
                   open_event.server_time,
                   last_event.server_time,
                   last_event.event_type::text
            FROM manager_memberships mm
            JOIN users u ON u.id = mm.member_user_id
            LEFT JOIN member_profiles mp ON mp.user_id = u.id
            LEFT JOIN LATERAL (
                SELECT e.server_time FROM attendance_events e
                WHERE e.member_id = u.id AND e.event_type = 'CHECK_IN'
                  AND e.status IN ('SUCCESS', 'WARNING_CONFIRMED')
                  AND NOT EXISTS (
                      SELECT 1 FROM attendance_events c
                      WHERE c.member_id = u.id AND c.event_type = 'CHECK_OUT'
                        AND c.status = 'SUCCESS' AND c.server_time > e.server_time
                  )
                ORDER BY e.server_time DESC LIMIT 1
            ) open_event ON true
            LEFT JOIN LATERAL (
                SELECT e.server_time, e.event_type FROM attendance_events e
                WHERE e.member_id = u.id ORDER BY e.server_time DESC LIMIT 1
            ) last_event ON true
            WHERE mm.manager_user_id = %s AND mm.status = 'ACTIVE'
            ORDER BY open_event.server_time DESC NULLS LAST, u.email
            """,
            (manager_id,),
        ).fetchall()
        daily_rows = connection.execute(
            """
            SELECT (e.server_time AT TIME ZONE %s)::date AS day,
                   count(*) FILTER (WHERE e.event_type = 'CHECK_IN') AS check_in,
                   count(*) FILTER (WHERE e.event_type = 'CHECK_OUT') AS check_out,
                   count(*) FILTER (WHERE e.status = 'WARNING_CONFIRMED') AS warnings
            FROM attendance_events e
            JOIN manager_memberships mm ON mm.member_user_id = e.member_id
            WHERE mm.manager_user_id = %s AND mm.status = 'ACTIVE' AND e.server_time >= %s
            GROUP BY day
            """,
            (APP_TIMEZONE, manager_id, since),
        ).fetchall()
        events_today = connection.execute(
            """
            SELECT count(*) FROM attendance_events e
            JOIN manager_memberships mm ON mm.member_user_id = e.member_id
            WHERE mm.manager_user_id = %s AND mm.status = 'ACTIVE' AND e.server_time >= %s
            """,
            (manager_id, today),
        ).fetchone()[0]

    by_day = {row[0]: row for row in daily_rows}
    daily = []
    for offset in range(6, -1, -1):
        day = today - timedelta(days=offset)
        row = by_day.get(day)
        daily.append(
            {
                "date": day.isoformat(),
                "check_in": row[1] if row else 0,
                "check_out": row[2] if row else 0,
                "warnings": row[3] if row else 0,
            }
        )

    member_rows = [
        {
            "member_id": row[0],
            "email": row[1],
            "full_name": row[2],
            "face_enrolled": row[3],
            "checked_in_at": row[4],
            "last_event_at": row[5],
            "last_event_type": row[6],
        }
        for row in members
    ]
    return {
        "active_members": len(member_rows),
        "active_locations": locations,
        "members_with_face": sum(1 for item in member_rows if item["face_enrolled"]),
        "events_today": events_today,
        "currently_checked_in": sum(1 for item in member_rows if item["checked_in_at"] is not None),
        "members": member_rows,
        "daily": daily,
    }



def attendance_calendar(user: CurrentUser, month: str, include_invalid: bool = False) -> dict:
    """
    One month of attendance shaped for a wall calendar: a row per member per
    local day, so a manager sees who turned up and how the day went without
    reading a table of raw events.

    Days are cut in the organisation's own timezone. Grouping by UTC would file
    an early-morning arrival under the day before.
    """
    try:
        first = datetime.strptime(month, "%Y-%m").date()
    except ValueError:
        raise HTTPException(status_code=422, detail="MONTH_FORMAT_INVALID")
    last = (first + timedelta(days=32)).replace(day=1)

    with psycopg.connect(DATABASE_URL) as connection:
        scope, scope_params = _scope(connection, user)
        include_invalid_sql = "TRUE" if include_invalid else "FALSE"
        rows = connection.execute(
            f"""
            SELECT
                (e.server_time AT TIME ZONE %s)::date AS work_date,
                e.member_id,
                u.email,
                mp.full_name,
                min(e.server_time) FILTER (
                    WHERE e.event_type = 'CHECK_IN' AND e.status IN ('SUCCESS', 'WARNING_CONFIRMED')
                ) AS first_check_in,
                max(e.server_time) FILTER (
                    WHERE e.event_type = 'CHECK_OUT' AND e.status IN ('SUCCESS', 'WARNING_CONFIRMED')
                ) AS last_check_out,
                max(e.minutes_late) FILTER (WHERE e.event_type = 'CHECK_IN') AS minutes_late,
                max(e.minutes_early_leave) FILTER (WHERE e.event_type = 'CHECK_OUT') AS minutes_early,
                count(*) FILTER (WHERE e.status IN ('SUCCESS', 'WARNING_CONFIRMED')) AS accepted,
                count(*) FILTER (WHERE e.status IN ('BLOCKED', 'FAILED')) AS rejected,
                count(*) FILTER (WHERE e.status = 'WARNING_CONFIRMED') AS off_radius,
                (array_agg(l.name ORDER BY e.server_time))[1] AS location_name
            FROM attendance_events e
            JOIN users u ON u.id = e.member_id
            LEFT JOIN member_profiles mp ON mp.user_id = u.id
            LEFT JOIN locations l ON l.id = e.location_id
            WHERE {scope}
              AND e.deleted_at IS NULL
              AND ({include_invalid_sql} OR e.status IN ('SUCCESS', 'WARNING_CONFIRMED'))
              AND (e.server_time AT TIME ZONE %s)::date >= %s
              AND (e.server_time AT TIME ZONE %s)::date < %s
            GROUP BY work_date, e.member_id, u.email, mp.full_name
            ORDER BY work_date, first_check_in NULLS LAST, u.email
            """,
            (APP_TIMEZONE, *scope_params, APP_TIMEZONE, first, APP_TIMEZONE, last),
        ).fetchall()

    days: dict[str, list[dict]] = {}
    events = present = late = open_sessions = rejected_total = off_radius_total = 0
    for row in rows:
        work_date = row[0].isoformat()
        minutes_late = row[6] or 0
        check_in, check_out = row[4], row[5]
        if check_in is None:
            # Only rejected attempts that day: worth showing, but nobody was present.
            status = "REJECTED"
        elif minutes_late > 0:
            status = "LATE"
        elif check_out is None:
            status = "OPEN"
        else:
            status = "ON_TIME"

        days.setdefault(work_date, []).append({
            "member_id": row[1],
            "member_email": row[2],
            "member_name": row[3],
            "check_in": check_in,
            "check_out": check_out,
            "minutes_late": minutes_late,
            "minutes_early_leave": row[7] or 0,
            "rejected": row[9],
            "off_radius": row[10],
            "location_name": row[11],
            "status": status,
        })

        events += row[8] + row[9]
        rejected_total += row[9]
        off_radius_total += row[10]
        if check_in is not None:
            present += 1
            if minutes_late > 0:
                late += 1
            if check_out is None:
                open_sessions += 1

    return {
        "month": first.strftime("%Y-%m"),
        "summary": {
            "events": events,
            "attended": present,
            "late": late,
            "open_sessions": open_sessions,
            "off_radius": off_radius_total,
            "rejected": rejected_total,
        },
        "days": [{"date": day, "people": people} for day, people in sorted(days.items())],
    }


def delete_attendance(user: CurrentUser, event_id: uuid.UUID, reason: str) -> dict:
    manager_id = user.id
    """
    Remove a record from the books. Soft delete on purpose: a manager can undo a
    mistake only if the row still exists, and the evidence photo stays attached
    to it. Erasing for good is a super-admin action.
    """
    reason = (reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="DELETE_REASON_REQUIRED")
    with psycopg.connect(DATABASE_URL) as connection:
        current = _event(_scoped_event(connection, user, event_id))
        if current.get("deleted_at"):
            raise HTTPException(status_code=409, detail="ATTENDANCE_ALREADY_DELETED")
        connection.execute(
            "UPDATE attendance_events SET deleted_at = now(), deleted_by = %s, delete_reason = %s "
            "WHERE id = %s",
            (manager_id, reason, event_id),
        )
        connection.execute(
            """
            INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_json, reason)
            VALUES (%s, 'ATTENDANCE_DELETED', 'attendance_event', %s, %s::jsonb, %s)
            """,
            (
                manager_id,
                event_id,
                json.dumps(
                    {
                        "member_email": current["member_email"],
                        "event_type": current["event_type"],
                        "status": current["status"],
                        "server_time": current["server_time"].isoformat(),
                    }
                ),
                reason,
            ),
        )
        connection.commit()
    return {"id": event_id, "deleted": True}
