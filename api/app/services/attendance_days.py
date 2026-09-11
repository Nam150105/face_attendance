"""
One working day, computed once.

Three screens used to derive "how did this person's day go" with three copies
of the SQL and three orders of precedence: the manager's table said a late
arrival with no departure was OPEN, the calendar said it was LATE, and the
member's own timesheet recomputed lateness from a different location's hours.
Everything that shows a day now calls `days()` and gets the same answer.

Rules, in one place:

- A day is cut in the organisation's timezone.
- A valid check-out belongs to the day of the check-in it closes, not to the
  calendar date it happened to fall on. Leaving at 00:30 ends yesterday.
- A check-in that is never closed stays a check-in; nothing is invented to
  close it. After SESSION_MAX_HOURS it is simply no longer open, and the day
  shows "chưa chấm ra" until somebody corrects it.
- Refused attempts are counted and named, never mistaken for attendance.
"""

from __future__ import annotations

import os
import uuid
from datetime import date, datetime, timezone

import psycopg

from app.services.member_portal import APP_TIMEZONE

# How long a check-in stays open with no check-out. Long enough for any real
# shift, short enough that tomorrow is never blocked by today.
SESSION_MAX_HOURS = int(os.environ.get("SESSION_MAX_HOURS", "20"))

VALID = "('SUCCESS', 'WARNING_CONFIRMED')"

# Which half a refusal blamed. Mirrors face-ai's own codes.
FACE_FAILURES = {
    "FACE_NOT_MATCHED", "FACE_NOT_FOUND", "FACE_NOT_CLEAR", "MULTIPLE_FACES",
    "FACE_QUALITY_LOW", "FACE_ENGINE_MISMATCH", "FACE_NOT_ENROLLED",
    "IMAGE_INVALID", "IMAGE_TOO_SMALL", "FACE_MODEL_NOT_CONFIGURED",
    "FACE_TOO_BLURRY", "LIGHTING_TOO_DARK", "LIGHTING_TOO_BRIGHT",
}


def day_status(check_in: datetime | None, check_out: datetime | None,
               minutes_late: int, rejected_codes: list[str | None]) -> str:
    """
    ON_TIME · LATE · OPEN · NO_CHECK_IN · REJECTED_FACE · REJECTED_PLACE.

    OPEN covers both "still working" and "forgot to check out": whether the
    person can still close it is a question about *now*, answered by the
    check-in service, not a property of the day. NO_CHECK_IN is the mirror
    image — a departure with no arrival it belongs to, which happens when the
    arrival was more than SESSION_MAX_HOURS earlier.
    """
    if check_in is None and check_out is not None:
        return "NO_CHECK_IN"
    if check_in is None:
        last = next((code for code in reversed(rejected_codes) if code), None)
        if last in FACE_FAILURES:
            return "REJECTED_FACE"
        return "REJECTED_PLACE" if rejected_codes else "REJECTED_FACE"
    if check_out is None:
        return "OPEN"
    return "LATE" if minutes_late > 0 else "ON_TIME"


def days(
    connection: psycopg.Connection,
    scope_sql: str,
    scope_params: list,
    date_from: date,
    date_to: date,
    include_invalid: bool,
    member_id: uuid.UUID | None = None,
) -> list[dict]:
    """
    One dict per (member, day) in [date_from, date_to], newest first.

    `scope_sql` is the caller's "rows this viewer may see" clause over `e`.
    """
    conditions = [scope_sql, "e.deleted_at IS NULL"]
    parameters: list = [*scope_params]
    if member_id is not None:
        conditions.append("e.member_id = %s")
        parameters.append(member_id)
    if not include_invalid:
        conditions.append(f"e.status IN {VALID}")
    where = " AND ".join(conditions)

    rows = connection.execute(
        f"""
        WITH events AS (
            SELECT e.id, e.member_id, e.event_type::text AS event_type, e.status::text AS status,
                   e.server_time, e.location_id, l.name AS location_name,
                   e.failure_code, e.minutes_late, e.minutes_early_leave, e.source::text AS source,
                   (e.server_time AT TIME ZONE %s)::date AS own_date
            FROM attendance_events e
            LEFT JOIN locations l ON l.id = e.location_id
            WHERE {where}
              -- One day of slack on each side so a check-out just after
              -- midnight is fetched together with the check-in it closes.
              AND (e.server_time AT TIME ZONE %s)::date BETWEEN (%s::date - 1) AND (%s::date + 1)
        ),
        assigned AS (
            SELECT ev.*,
                   CASE
                       WHEN ev.event_type = 'CHECK_OUT' AND ev.status IN {VALID} THEN COALESCE((
                           SELECT (ci.server_time AT TIME ZONE %s)::date
                           FROM attendance_events ci
                           WHERE ci.member_id = ev.member_id
                             AND ci.event_type = 'CHECK_IN'
                             AND ci.status IN {VALID}
                             AND ci.deleted_at IS NULL
                             AND ci.server_time < ev.server_time
                             AND ci.server_time > ev.server_time - make_interval(hours => %s)
                           ORDER BY ci.server_time DESC
                           LIMIT 1
                       ), ev.own_date)
                       ELSE ev.own_date
                   END AS work_date
            FROM events ev
        )
        SELECT
            a.work_date,
            a.member_id,
            u.email,
            mp.full_name,
            min(a.server_time) FILTER (WHERE a.event_type = 'CHECK_IN' AND a.status IN {VALID}) AS check_in,
            max(a.server_time) FILTER (WHERE a.event_type = 'CHECK_OUT' AND a.status IN {VALID}) AS check_out,
            max(a.minutes_late) FILTER (WHERE a.event_type = 'CHECK_IN' AND a.status IN {VALID}) AS minutes_late,
            max(a.minutes_early_leave) FILTER (WHERE a.event_type = 'CHECK_OUT' AND a.status IN {VALID}) AS minutes_early,
            count(*) FILTER (WHERE a.status IN ('BLOCKED', 'FAILED')) AS rejected,
            count(*) FILTER (WHERE a.status = 'WARNING_CONFIRMED') AS excused,
            count(*) AS events,
            array_agg(a.failure_code ORDER BY a.server_time) FILTER (WHERE a.status IN ('BLOCKED', 'FAILED')) AS rejected_codes,
            COALESCE(
                (array_agg(a.location_name ORDER BY a.server_time) FILTER (WHERE a.status IN {VALID}))[1],
                (array_agg(a.location_name ORDER BY a.server_time))[1]
            ) AS location_name,
            (array_agg(a.id ORDER BY a.server_time) FILTER (WHERE a.event_type = 'CHECK_IN' AND a.status IN {VALID}))[1] AS check_in_id,
            (array_agg(a.id ORDER BY a.server_time DESC) FILTER (WHERE a.event_type = 'CHECK_OUT' AND a.status IN {VALID}))[1] AS check_out_id,
            jsonb_agg(jsonb_build_object(
                'id', a.id, 'event_type', a.event_type, 'status', a.status,
                'server_time', a.server_time, 'location_name', a.location_name,
                'failure_code', a.failure_code, 'source', a.source
            ) ORDER BY a.server_time) AS attempts
        FROM assigned a
        JOIN users u ON u.id = a.member_id
        LEFT JOIN member_profiles mp ON mp.user_id = a.member_id
        WHERE a.work_date BETWEEN %s AND %s
        GROUP BY a.work_date, a.member_id, u.email, mp.full_name
        ORDER BY a.work_date DESC, check_in DESC NULLS LAST, u.email
        """,
        [APP_TIMEZONE, *parameters, APP_TIMEZONE, date_from, date_to, APP_TIMEZONE, SESSION_MAX_HOURS, date_from, date_to],
    ).fetchall()

    result = []
    for row in rows:
        check_in, check_out = row[4], row[5]
        # A departure recorded before the arrival is not a closed day; it is two
        # halves that do not belong together.
        if check_in is not None and check_out is not None and check_out <= check_in:
            check_out = None
        minutes_late = row[6] or 0
        worked = None
        if check_in is not None and check_out is not None:
            worked = int((check_out - check_in).total_seconds() // 60)
        result.append({
            "work_date": row[0].isoformat(),
            "member_id": row[1],
            "member_email": row[2],
            "member_name": row[3],
            "check_in": check_in,
            "check_out": check_out,
            "worked_minutes": worked,
            "minutes_late": minutes_late,
            "minutes_early_leave": row[7] or 0,
            "rejected": row[8],
            "off_radius": row[9],
            "event_count": row[10],
            "location_name": row[12],
            "check_in_id": row[13],
            "check_out_id": row[14] if check_out is not None else None,
            "status": day_status(check_in, check_out, minutes_late, list(row[11] or [])),
            "attempts": row[15],
        })
    return result


def session_is_open(opened_at: datetime, now: datetime | None = None) -> bool:
    """A check-in with no check-out is 'open' only for SESSION_MAX_HOURS."""
    now = now or datetime.now(timezone.utc)
    return (now - opened_at).total_seconds() < SESSION_MAX_HOURS * 3600
