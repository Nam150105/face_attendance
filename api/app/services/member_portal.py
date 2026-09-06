"""Member self-service: attendance history, schedule, notifications, corrections.

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

def _schedule_for(connection: psycopg.Connection, member_id: uuid.UUID, work_date: date) -> tuple | None:
    """
    A date-specific row wins over the weekly pattern for the same weekday. If the
    member has no shift at all, the hours configured on their default location
    apply, so a site can set expectations once instead of per person.
    """
    personal = connection.execute(
        """
        SELECT start_time, end_time, grace_minutes, location_id
        FROM schedules
        WHERE member_id = %s AND is_active
          AND (work_date = %s OR (work_date IS NULL AND weekday = %s))
        ORDER BY work_date NULLS LAST
        LIMIT 1
        """,
        (member_id, work_date, (work_date.weekday() + 1) % 7),
    ).fetchone()
    if personal is not None:
        return personal
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


def _day_status(
    check_in: datetime | None,
    check_out: datetime | None,
    schedule: tuple | None,
    had_invalid: bool,
) -> str:
    if check_in is None:
        return "INVALID" if had_invalid else "ABSENT"
    if check_out is None:
        return "MISSING_CHECK_OUT"
    if schedule is not None:
        start_time, _, grace_minutes, _ = schedule
        local_check_in = check_in.astimezone(LOCAL_ZONE)
        latest_ok = datetime.combine(
            local_check_in.date(), start_time, tzinfo=LOCAL_ZONE
        ) + timedelta(minutes=grace_minutes or 0)
        if local_check_in > latest_ok:
            return "LATE"
    return "VALID"


def attendance_days(member_id: uuid.UUID, date_from: date | None, date_to: date | None) -> dict:
    """
    One row per day: first valid check-in, last valid check-out, worked minutes
    and a status. Only SUCCESS/WARNING_CONFIRMED count as presence; BLOCKED and
    FAILED are surfaced separately so a rejected attempt is never mistaken for
    attendance.
    """
    start, end = _range(date_from, date_to)
    with psycopg.connect(DATABASE_URL) as connection:
        rows = connection.execute(
            """
            SELECT
                (e.server_time AT TIME ZONE %s)::date AS work_date,
                min(e.server_time) FILTER (
                    WHERE e.event_type = 'CHECK_IN' AND e.status IN ('SUCCESS', 'WARNING_CONFIRMED')
                ) AS first_check_in,
                max(e.server_time) FILTER (
                    WHERE e.event_type = 'CHECK_OUT' AND e.status IN ('SUCCESS', 'WARNING_CONFIRMED')
                ) AS last_check_out,
                count(*) FILTER (WHERE e.status IN ('BLOCKED', 'FAILED')) AS rejected_count,
                count(*) FILTER (WHERE e.status = 'WARNING_CONFIRMED') AS warning_count,
                count(*) AS event_count,
                (array_agg(l.name ORDER BY e.server_time))[1] AS location_name
            FROM attendance_events e
            JOIN locations l ON l.id = e.location_id
            WHERE e.member_id = %s
              AND (e.server_time AT TIME ZONE %s)::date BETWEEN %s AND %s
            GROUP BY 1
            ORDER BY 1 DESC
            """,
            (APP_TIMEZONE, member_id, APP_TIMEZONE, start, end),
        ).fetchall()

        days = []
        for row in rows:
            work_date, check_in, check_out, rejected, warnings, events, location_name = row
            schedule = _schedule_for(connection, member_id, work_date)
            worked_minutes = None
            if check_in is not None and check_out is not None and check_out > check_in:
                worked_minutes = int((check_out - check_in).total_seconds() // 60)
            days.append(
                {
                    "work_date": work_date.isoformat(),
                    "check_in": check_in.isoformat() if check_in else None,
                    "check_out": check_out.isoformat() if check_out else None,
                    "worked_minutes": worked_minutes,
                    "status": _day_status(check_in, check_out, schedule, rejected > 0),
                    "rejected_count": rejected,
                    "warning_count": warnings,
                    "event_count": events,
                    "location_name": location_name,
                    "scheduled_start": schedule[0].isoformat() if schedule else None,
                    "scheduled_end": schedule[1].isoformat() if schedule else None,
                }
            )

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
            WHERE e.member_id = %s AND (e.server_time AT TIME ZONE %s)::date = %s
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
            "distance_meters": float(row[4]),
            "gps_accuracy_meters": float(row[5]),
            "failure_code": row[6],
            "reason": row[7],
            "location_name": row[8],
            "has_image": row[9],
        }
        for row in rows
    ]


# ----------------------------------------------------------------- schedule

def my_schedule(member_id: uuid.UUID, date_from: date | None, date_to: date | None) -> dict:
    start, end = _range(date_from, date_to)
    with psycopg.connect(DATABASE_URL) as connection:
        rows = connection.execute(
            """
            SELECT s.id, s.weekday, s.work_date, s.start_time, s.end_time, s.timezone,
                   s.grace_minutes, l.name, l.address, l.id
            FROM schedules s
            LEFT JOIN locations l ON l.id = s.location_id
            WHERE s.member_id = %s AND s.is_active
            ORDER BY s.work_date NULLS LAST, s.weekday, s.start_time
            """,
            (member_id,),
        ).fetchall()
        today = datetime.now(LOCAL_ZONE).date()
        today_schedule = _schedule_for(connection, member_id, today)
        open_check_in = connection.execute(
            """
            SELECT server_time FROM attendance_events
            WHERE member_id = %s AND event_type = 'CHECK_IN'
              AND status IN ('SUCCESS', 'WARNING_CONFIRMED')
              AND (server_time AT TIME ZONE %s)::date = %s
            ORDER BY server_time LIMIT 1
            """,
            (member_id, APP_TIMEZONE, today),
        ).fetchone()

    shifts = [
        {
            "id": row[0],
            "weekday": row[1],
            "work_date": row[2].isoformat() if row[2] else None,
            "start_time": row[3].isoformat(),
            "end_time": row[4].isoformat(),
            "timezone": row[5],
            "grace_minutes": row[6],
            "location_name": row[7],
            "location_address": row[8],
            "location_id": row[9],
        }
        for row in rows
    ]
    return {
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "shifts": shifts,
        "today": {
            "date": today.isoformat(),
            "has_shift": today_schedule is not None,
            "start_time": today_schedule[0].isoformat() if today_schedule else None,
            "end_time": today_schedule[1].isoformat() if today_schedule else None,
            "grace_minutes": today_schedule[2] if today_schedule else None,
            "checked_in_at": open_check_in[0] if open_check_in else None,
        },
    }


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
            (manager_id, request_id, json.dumps({"status": decision}), note),
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
    return {"id": request_id, "status": decision}


# ------------------------------------------------- manager side of schedules

def _assert_member_in_scope(connection: psycopg.Connection, manager_id: uuid.UUID, member_id: uuid.UUID) -> None:
    row = connection.execute(
        "SELECT 1 FROM manager_memberships WHERE manager_user_id = %s AND member_user_id = %s AND status = 'ACTIVE'",
        (manager_id, member_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Member is outside manager scope")


def list_member_schedules(manager_id: uuid.UUID, member_id: uuid.UUID) -> list[dict]:
    with psycopg.connect(DATABASE_URL) as connection:
        _assert_member_in_scope(connection, manager_id, member_id)
        rows = connection.execute(
            """
            SELECT s.id, s.weekday, s.work_date, s.start_time, s.end_time, s.timezone,
                   s.grace_minutes, l.name, s.location_id
            FROM schedules s
            LEFT JOIN locations l ON l.id = s.location_id
            WHERE s.member_id = %s AND s.is_active
            ORDER BY s.work_date NULLS LAST, s.weekday, s.start_time
            """,
            (member_id,),
        ).fetchall()
    return [
        {
            "id": row[0],
            "weekday": row[1],
            "work_date": row[2].isoformat() if row[2] else None,
            "start_time": row[3].isoformat(),
            "end_time": row[4].isoformat(),
            "timezone": row[5],
            "grace_minutes": row[6],
            "location_name": row[7],
            "location_id": row[8],
        }
        for row in rows
    ]


def create_member_schedule(manager_id: uuid.UUID, member_id: uuid.UUID, payload: dict) -> dict:
    weekday = payload.get("weekday")
    work_date = payload.get("work_date")
    # The table's CHECK enforces this too; failing here gives a usable message.
    if (weekday is None) == (work_date is None):
        raise HTTPException(status_code=422, detail="SCHEDULE_NEEDS_WEEKDAY_OR_DATE")
    if payload["start_time"] >= payload["end_time"]:
        raise HTTPException(status_code=422, detail="SCHEDULE_END_BEFORE_START")

    with psycopg.connect(DATABASE_URL) as connection:
        _assert_member_in_scope(connection, manager_id, member_id)
        location_id = payload.get("location_id")
        if location_id is not None:
            owned = connection.execute(
                "SELECT 1 FROM locations WHERE id = %s AND manager_user_id = %s",
                (location_id, manager_id),
            ).fetchone()
            if owned is None:
                raise HTTPException(status_code=404, detail="Location is outside manager scope")
        row = connection.execute(
            """
            INSERT INTO schedules (member_id, weekday, work_date, start_time, end_time, timezone,
                                   grace_minutes, location_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                member_id,
                weekday,
                work_date,
                payload["start_time"],
                payload["end_time"],
                payload.get("timezone") or "Asia/Ho_Chi_Minh",
                payload.get("grace_minutes", 10),
                location_id,
            ),
        ).fetchone()
        connection.execute(
            """
            INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, after_json)
            VALUES (%s, 'SCHEDULE_CREATED', 'schedule', %s, %s::jsonb)
            """,
            (manager_id, row[0], json.dumps({
                "member_id": str(member_id),
                "weekday": weekday,
                "work_date": work_date.isoformat() if work_date else None,
                "start_time": payload["start_time"].isoformat(),
                "end_time": payload["end_time"].isoformat(),
            })),
        )
        notify(
            connection,
            member_id,
            "SCHEDULE_CHANGED",
            "Lịch làm việc được cập nhật",
            f"Ca mới: {payload['start_time'].isoformat()} – {payload['end_time'].isoformat()}",
            {"schedule_id": str(row[0])},
        )
        connection.commit()
    return {"id": row[0]}


def delete_member_schedule(manager_id: uuid.UUID, member_id: uuid.UUID, schedule_id: uuid.UUID) -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        _assert_member_in_scope(connection, manager_id, member_id)
        row = connection.execute(
            "UPDATE schedules SET is_active = false WHERE id = %s AND member_id = %s AND is_active RETURNING id",
            (schedule_id, member_id),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="SCHEDULE_NOT_FOUND")
        connection.execute(
            """
            INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_json)
            VALUES (%s, 'SCHEDULE_REMOVED', 'schedule', %s, %s::jsonb)
            """,
            (manager_id, schedule_id, json.dumps({"member_id": str(member_id)})),
        )
        notify(connection, member_id, "SCHEDULE_CHANGED", "Một ca làm việc đã được gỡ", None,
               {"schedule_id": str(schedule_id)})
        connection.commit()
    return {"id": schedule_id, "removed": True}
