"""Member self-service: attendance history, notifications, corrections.

Every query in this module filters by the caller's own id. Nothing here takes a
member id from the client — a member can only ever read or change their own row.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import psycopg
from fastapi import HTTPException

from app.auth import DATABASE_URL


MAX_RANGE_DAYS = 366

# Shifts are written in local wall-clock time and people think of "a day" in
# local time too. Comparing either against UTC misjudges lateness and files a
# 06:00 check-in under the previous day for any zone east of UTC.
APP_TIMEZONE = os.environ.get("APP_TIMEZONE", "Asia/Ho_Chi_Minh")
LOCAL_ZONE = ZoneInfo(APP_TIMEZONE)


def local_date(moment: datetime) -> date:
    return moment.astimezone(LOCAL_ZONE).date()

CORRECTION_TYPES = {"MISSING_CHECK_IN", "MISSING_CHECK_OUT", "WRONG_TIME", "OTHER"}


def _range(date_from: date | None, date_to: date | None) -> tuple[date, date]:
    """Default to the current month; cap the span so one call cannot scan years."""
    today = datetime.now(LOCAL_ZONE).date()
    end = date_to or today
    start = date_from or end.replace(day=1)
    if start > end:
        raise HTTPException(status_code=422, detail="DATE_RANGE_INVALID")
    if (end - start).days > MAX_RANGE_DAYS:
        raise HTTPException(status_code=422, detail="DATE_RANGE_TOO_WIDE")
    return start, end


# --------------------------------------------------------------- attendance

def _hours_for(connection: psycopg.Connection, member_id: uuid.UUID) -> tuple | None:
    """
    Working hours come from the member's default location and nowhere else.
    Per-member shifts used to override this; they were removed because two
    sources for one rule meant nobody could say why a day counted as late.
    """
    return connection.execute(
        """
        SELECT l.expected_check_in, l.expected_check_out, l.grace_minutes, l.id
        FROM member_locations ml JOIN locations l ON l.id = ml.location_id
        WHERE ml.member_id = %s AND l.is_active AND l.expected_check_in IS NOT NULL
        ORDER BY ml.is_default DESC
        LIMIT 1
        """,
        (member_id,),
    ).fetchone()


# The member's screen keeps its own vocabulary; the rows underneath are the
# same ones the manager sees, so the two can no longer disagree about a day.
_MEMBER_STATUS = {
    "ON_TIME": "VALID",
    "LATE": "LATE",
    "OPEN": "MISSING_CHECK_OUT",
    "NO_CHECK_IN": "MISSING_CHECK_IN",
    "REJECTED_FACE": "INVALID",
    "REJECTED_PLACE": "INVALID",
}


def attendance_days(member_id: uuid.UUID, date_from: date | None, date_to: date | None) -> dict:
    """One row per day of this person's own attendance, from the shared builder."""
    from app.services.attendance_days import days as build_days

    start, end = _range(date_from, date_to)
    with psycopg.connect(DATABASE_URL) as connection:
        rows = build_days(connection, "e.member_id = %s", [member_id], start, end, True)
        hours = _hours_for(connection, member_id)

    days = [
        {
            "work_date": row["work_date"],
            # Left as datetimes so every screen gets the same "…Z" from the
            # response serializer rather than two spellings of one instant.
            "check_in": row["check_in"],
            "check_out": row["check_out"],
            "worked_minutes": row["worked_minutes"],
            "status": _MEMBER_STATUS[row["status"]],
            "rejected_count": row["rejected"],
            "warning_count": row["off_radius"],
            "event_count": row["event_count"],
            "location_name": row["location_name"],
            "scheduled_start": hours[0].isoformat() if hours else None,
            "scheduled_end": hours[1].isoformat() if hours else None,
        }
        for row in rows
    ]

    present = [d for d in days if d["check_in"]]
    total_minutes = sum(d["worked_minutes"] or 0 for d in days)
    return {
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "days": days,
        "summary": {
            "days_present": len(present),
            "days_late": sum(1 for d in days if d["status"] == "LATE"),
            "days_missing_check_out": sum(1 for d in days if d["status"] == "MISSING_CHECK_OUT"),
            "days_invalid": sum(1 for d in days if d["status"] == "INVALID"),
            "total_worked_minutes": total_minutes,
        },
    }

def attendance_day_events(member_id: uuid.UUID, work_date: date) -> list[dict]:
    """Every attempt on one day, including the rejected ones."""
    with psycopg.connect(DATABASE_URL) as connection:
        rows = connection.execute(
            """
            SELECT e.id, e.event_type::text, e.status::text, e.server_time, e.distance_meters,
                   e.gps_accuracy_meters, e.failure_code, e.reason, l.name,
                   e.image_object_key IS NOT NULL
            FROM attendance_events e
            JOIN locations l ON l.id = e.location_id
            WHERE e.member_id = %s AND e.deleted_at IS NULL AND (e.server_time AT TIME ZONE %s)::date = %s
            ORDER BY e.server_time
            """,
            (member_id, APP_TIMEZONE, work_date),
        ).fetchall()
    return [
        {
            "id": row[0],
            "event_type": row[1],
            "status": row[2],
            "server_time": row[3],
            # Null on a record a person entered: nothing was measured.
            "distance_meters": float(row[4]) if row[4] is not None else None,
            "gps_accuracy_meters": float(row[5]),
            "failure_code": row[6],
            "reason": row[7],
            "location_name": row[8],
            "has_image": row[9],
        }
        for row in rows
    ]


# ------------------------------------------------------------ notifications

def notify(
    connection: psycopg.Connection,
    user_id: uuid.UUID,
    category: str,
    title: str,
    body: str | None = None,
    payload: dict | None = None,
) -> None:
    """Write a notification on an existing connection so it shares the caller's
    transaction: no notification about an event that was rolled back."""
    connection.execute(
        """
        INSERT INTO notifications (user_id, category, title, body, payload_json)
        VALUES (%s, %s, %s, %s, %s::jsonb)
        """,
        (user_id, category, title, body, json.dumps(payload) if payload is not None else None),
    )


def list_notifications(user_id: uuid.UUID, only_unread: bool, limit: int, offset: int) -> dict:
    where = "user_id = %s" + (" AND read_at IS NULL" if only_unread else "")
    with psycopg.connect(DATABASE_URL) as connection:
        total = connection.execute(
            f"SELECT count(*) FROM notifications WHERE {where}", (user_id,)
        ).fetchone()[0]
        unread = connection.execute(
            "SELECT count(*) FROM notifications WHERE user_id = %s AND read_at IS NULL", (user_id,)
        ).fetchone()[0]
        rows = connection.execute(
            f"""
            SELECT id, category, title, body, payload_json, read_at, created_at
            FROM notifications WHERE {where}
            ORDER BY created_at DESC LIMIT %s OFFSET %s
            """,
            (user_id, limit, offset),
        ).fetchall()
    return {
        "total": total,
        "unread": unread,
        "items": [
            {
                "id": row[0],
                "category": row[1],
                "title": row[2],
                "body": row[3],
                "payload": row[4],
                "read_at": row[5],
                "created_at": row[6],
            }
            for row in rows
        ],
    }


def mark_notification_read(user_id: uuid.UUID, notification_id: uuid.UUID) -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        # The user_id filter is the authorization check: another user's id simply
        # matches nothing.
        row = connection.execute(
            "UPDATE notifications SET read_at = COALESCE(read_at, now()) "
            "WHERE id = %s AND user_id = %s RETURNING id",
            (notification_id, user_id),
        ).fetchone()
        connection.commit()
    if row is None:
        raise HTTPException(status_code=404, detail="NOTIFICATION_NOT_FOUND")
    return {"id": row[0], "read": True}


def mark_all_notifications_read(user_id: uuid.UUID) -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        count = connection.execute(
            "UPDATE notifications SET read_at = now() WHERE user_id = %s AND read_at IS NULL",
            (user_id,),
        ).rowcount
        connection.commit()
    return {"marked": count}


# -------------------------------------------------------- correction requests

def create_correction(member_id: uuid.UUID, payload: dict) -> dict:
    request_type = payload["request_type"]
    if request_type not in CORRECTION_TYPES:
        raise HTTPException(status_code=422, detail="INVALID_CORRECTION_TYPE")
    reason = (payload.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="CORRECTION_REASON_REQUIRED")
    work_date: date = payload["work_date"]
    if work_date > datetime.now(LOCAL_ZONE).date():
        raise HTTPException(status_code=422, detail="CORRECTION_DATE_IN_FUTURE")

    with psycopg.connect(DATABASE_URL) as connection:
        duplicate = connection.execute(
            "SELECT 1 FROM attendance_correction_requests "
            "WHERE member_id = %s AND work_date = %s AND status = 'PENDING'",
            (member_id, work_date),
        ).fetchone()
        if duplicate is not None:
            raise HTTPException(status_code=409, detail="CORRECTION_ALREADY_PENDING")
        row = connection.execute(
            """
            INSERT INTO attendance_correction_requests
                (member_id, work_date, request_type, requested_check_in, requested_check_out, reason)
            VALUES (%s, %s, %s::correction_request_type, %s, %s, %s)
            RETURNING id, created_at
            """,
            (
                member_id,
                work_date,
                request_type,
                payload.get("requested_check_in"),
                payload.get("requested_check_out"),
                reason,
            ),
        ).fetchone()
        connection.commit()
    return {"id": row[0], "status": "PENDING", "created_at": row[1]}


def _correction_dict(row: tuple) -> dict:
    return {
        "id": row[0],
        "work_date": row[1].isoformat(),
        "request_type": row[2],
        "requested_check_in": row[3],
        "requested_check_out": row[4],
        "reason": row[5],
        "status": row[6],
        "review_note": row[7],
        "reviewed_at": row[8],
        "created_at": row[9],
        "member_name": row[10] if len(row) > 10 else None,
        "member_email": row[11] if len(row) > 11 else None,
    }


CORRECTION_COLUMNS = (
    "c.id, c.work_date, c.request_type::text, c.requested_check_in, c.requested_check_out, "
    "c.reason, c.status::text, c.review_note, c.reviewed_at, c.created_at"
)


def list_my_corrections(member_id: uuid.UUID, limit: int, offset: int) -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        total = connection.execute(
            "SELECT count(*) FROM attendance_correction_requests WHERE member_id = %s", (member_id,)
        ).fetchone()[0]
        rows = connection.execute(
            f"""
            SELECT {CORRECTION_COLUMNS}
            FROM attendance_correction_requests c
            WHERE c.member_id = %s
            ORDER BY c.created_at DESC LIMIT %s OFFSET %s
            """,
            (member_id, limit, offset),
        ).fetchall()
    return {"total": total, "items": [_correction_dict(row) for row in rows]}


def cancel_correction(member_id: uuid.UUID, request_id: uuid.UUID) -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            "DELETE FROM attendance_correction_requests "
            "WHERE id = %s AND member_id = %s AND status = 'PENDING' RETURNING id",
            (request_id, member_id),
        ).fetchone()
        connection.commit()
    if row is None:
        raise HTTPException(status_code=404, detail="CORRECTION_NOT_FOUND_OR_REVIEWED")
    return {"id": row[0], "cancelled": True}


# ------------------------------------------------- manager side of corrections

def list_corrections_for_manager(manager_id: uuid.UUID, status: str | None, limit: int, offset: int) -> dict:
    clauses = ["mm.manager_user_id = %s", "mm.status = 'ACTIVE'"]
    parameters: list = [manager_id]
    if status:
        clauses.append("c.status = %s::correction_request_status")
        parameters.append(status)
    where = " AND ".join(clauses)
    with psycopg.connect(DATABASE_URL) as connection:
        total = connection.execute(
            f"""
            SELECT count(*) FROM attendance_correction_requests c
            JOIN manager_memberships mm ON mm.member_user_id = c.member_id
            WHERE {where}
            """,
            parameters,
        ).fetchone()[0]
        rows = connection.execute(
            f"""
            SELECT {CORRECTION_COLUMNS}, mp.full_name, u.email
            FROM attendance_correction_requests c
            JOIN manager_memberships mm ON mm.member_user_id = c.member_id
            JOIN users u ON u.id = c.member_id
            LEFT JOIN member_profiles mp ON mp.user_id = c.member_id
            WHERE {where}
            ORDER BY c.created_at DESC LIMIT %s OFFSET %s
            """,
            [*parameters, limit, offset],
        ).fetchall()
    return {"total": total, "items": [_correction_dict(row) for row in rows]}


def _apply_correction(
    connection: psycopg.Connection,
    request_id: uuid.UUID,
    member_id: uuid.UUID,
    work_date,
    manager_id: uuid.UUID,
) -> dict:
    """
    Write the approved correction into the timesheet.

    Until this existed, approving was paperwork: the request went green, the
    member was told yes, and the day they were fixing stayed broken forever.

    A record made this way carries no coordinates, no distance and no face
    score, because none were measured — a person decided it. `source` says so,
    and every screen reads it rather than guessing from a suspiciously round
    zero.
    """
    request = connection.execute(
        """
        SELECT request_type::text, requested_check_in, requested_check_out, reason
        FROM attendance_correction_requests WHERE id = %s
        """,
        (request_id,),
    ).fetchone()
    request_type, wanted_in, wanted_out, member_reason = request

    existing = connection.execute(
        """
        SELECT id, event_type::text FROM attendance_events
        WHERE member_id = %s AND deleted_at IS NULL
          AND status IN ('SUCCESS', 'WARNING_CONFIRMED')
          AND (server_time AT TIME ZONE %s)::date = %s
        ORDER BY server_time
        """,
        (member_id, APP_TIMEZONE, work_date),
    ).fetchall()
    by_type = {kind: row_id for row_id, kind in existing}

    # Where to hang a record that has no place of its own: the day's other half
    # if there is one, else whatever this person is allowed to use.
    location = connection.execute(
        """
        SELECT COALESCE(
            (SELECT location_id FROM attendance_events
             WHERE member_id = %s AND deleted_at IS NULL
               AND (server_time AT TIME ZONE %s)::date = %s
             ORDER BY server_time LIMIT 1),
            (SELECT location_id FROM member_locations WHERE member_id = %s ORDER BY is_default DESC LIMIT 1),
            (SELECT tl.location_id FROM team_locations tl
             JOIN manager_memberships mm ON mm.team_id = tl.team_id
             WHERE mm.member_user_id = %s AND mm.status = 'ACTIVE'
             ORDER BY tl.is_default DESC LIMIT 1),
            -- Last resort: the manager's own site. Somebody not yet assigned
            -- anywhere still has days that need fixing, and a record has to
            -- hang somewhere; `source` already says a person made it.
            (SELECT id FROM locations WHERE manager_user_id = %s AND is_active
             ORDER BY created_at LIMIT 1)
        )
        """,
        (member_id, APP_TIMEZONE, work_date, member_id, member_id, manager_id),
    ).fetchone()[0]
    if location is None:
        raise HTTPException(status_code=409, detail="CORRECTION_NO_LOCATION")

    note = f"Chỉnh công đã duyệt: {member_reason}"[:500]
    changed = {"created": [], "moved": []}

    def write(event_type: str, moment) -> None:
        if moment is None:
            return
        current = by_type.get(event_type)
        if current is None:
            new_id = connection.execute(
                """
                INSERT INTO attendance_events
                    (member_id, location_id, event_type, status, server_time, reason,
                     source, correction_request_id, edited_by, edited_at, edit_reason)
                VALUES (%s, %s, %s::attendance_event_type, 'WARNING_CONFIRMED', %s, %s,
                        'CORRECTION', %s, %s, now(), %s)
                RETURNING id
                """,
                (member_id, location, event_type, moment, note, request_id, manager_id, note),
            ).fetchone()[0]
            changed["created"].append(str(new_id))
        else:
            connection.execute(
                """
                UPDATE attendance_events
                SET server_time = %s,
                    original_server_time = COALESCE(original_server_time, server_time),
                    reason = %s,
                    correction_request_id = %s,
                    edited_by = %s, edited_at = now(), edit_reason = %s
                WHERE id = %s
                """,
                (moment, note, request_id, manager_id, note, current),
            )
            changed["moved"].append(str(current))

    if request_type in {"MISSING_CHECK_IN", "WRONG_TIME", "OTHER"}:
        write("CHECK_IN", wanted_in)
    if request_type in {"MISSING_CHECK_OUT", "WRONG_TIME", "OTHER"}:
        write("CHECK_OUT", wanted_out)

    return changed


def review_correction(manager_id: uuid.UUID, request_id: uuid.UUID, decision: str, note: str | None) -> dict:
    if decision not in {"APPROVED", "REJECTED"}:
        raise HTTPException(status_code=422, detail="INVALID_CORRECTION_DECISION")
    with psycopg.connect(DATABASE_URL) as connection:
        # The join is the authorization check: a request outside this manager's
        # roster is simply not found.
        target = connection.execute(
            """
            SELECT c.id, c.member_id, c.work_date, c.status::text
            FROM attendance_correction_requests c
            JOIN manager_memberships mm ON mm.member_user_id = c.member_id
            WHERE c.id = %s AND mm.manager_user_id = %s AND mm.status = 'ACTIVE'
            """,
            (request_id, manager_id),
        ).fetchone()
        if target is None:
            raise HTTPException(status_code=404, detail="CORRECTION_OUTSIDE_MANAGER_SCOPE")
        if target[3] != "PENDING":
            raise HTTPException(status_code=409, detail="CORRECTION_ALREADY_REVIEWED")

        applied: dict = {}
        if decision == "APPROVED":
            applied = _apply_correction(connection, request_id, target[1], target[2], manager_id)

        connection.execute(
            """
            UPDATE attendance_correction_requests
            SET status = %s::correction_request_status, reviewed_by = %s, reviewed_at = now(), review_note = %s
            WHERE id = %s
            """,
            (decision, manager_id, note, request_id),
        )
        connection.execute(
            """
            INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, after_json, reason)
            VALUES (%s, 'CORRECTION_REVIEWED', 'attendance_correction', %s, %s::jsonb, %s)
            """,
            (manager_id, request_id, json.dumps({"status": decision, **applied}), note),
        )
        notify(
            connection,
            target[1],
            "CORRECTION_REVIEWED",
            "Yêu cầu chỉnh công đã được duyệt" if decision == "APPROVED" else "Yêu cầu chỉnh công bị từ chối",
            note or f"Ngày {target[2].isoformat()}",
            {"request_id": str(request_id), "status": decision, "work_date": target[2].isoformat()},
        )
        connection.commit()
    return {"id": request_id, "status": decision, **applied}
