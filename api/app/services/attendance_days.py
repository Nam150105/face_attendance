"""
One working day, computed once.

Three screens used to derive "how did this person's day go" with three copies
of the SQL and three orders of precedence: the manager's table said a late
arrival with no departure was OPEN, the calendar said it was LATE, and the
member's own timesheet recomputed lateness from a different location's hours.
Everything that shows a day now calls `days()` and gets the same answer.

Rules, in one place:

- A day is cut in the organisation's timezone, at midnight. Only day shifts
  exist for now; a night shift straddling midnight is not representable yet.
- A check-in is open until it is checked out or the day ends, whichever
  comes first. Past midnight nothing is invented to close it: the day keeps
  its check-in only, shows "chưa chấm ra", and the next day starts clean.
- After a check-out the day is done; a second session the same day is refused.
- Refused attempts are counted and named, never mistaken for attendance.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
import psycopg

from app.services.member_portal import APP_TIMEZONE, LOCAL_ZONE

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
    person can still close it is a question about *now* — is it still the
    same day — answered by the check-in service, not a property of the day.
    NO_CHECK_IN is the mirror image: a departure with no arrival on that day,
    which only a correction or a manual edit can produce.
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
        WITH a AS (
            SELECT e.id, e.member_id, e.event_type::text AS event_type, e.status::text AS status,
                   e.server_time, e.location_id, l.name AS location_name,
                   e.failure_code, e.minutes_late, e.minutes_early_leave, e.source::text AS source,
                   (e.server_time AT TIME ZONE %s)::date AS work_date
            FROM attendance_events e
            LEFT JOIN locations l ON l.id = e.location_id
            WHERE {where}
              AND (e.server_time AT TIME ZONE %s)::date BETWEEN %s AND %s
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
            ) ORDER BY a.server_time) AS attempts,
            (array_agg(a.location_id ORDER BY a.server_time) FILTER (WHERE a.status IN {VALID}))[1] AS location_id
        FROM a
        JOIN users u ON u.id = a.member_id
        LEFT JOIN member_profiles mp ON mp.user_id = a.member_id
        GROUP BY a.work_date, a.member_id, u.email, mp.full_name
        ORDER BY a.work_date DESC, check_in DESC NULLS LAST, u.email
        """,
        [APP_TIMEZONE, *parameters, APP_TIMEZONE, date_from, date_to],
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
            "location_id": row[16],
        })
    return result


def local_today(now: datetime | None = None) -> date:
    return (now or datetime.now(timezone.utc)).astimezone(LOCAL_ZONE).date()


def session_is_open(opened_at: datetime, now: datetime | None = None) -> bool:
    """A check-in with no check-out is 'open' only until the local day ends."""
    return opened_at.astimezone(LOCAL_ZONE).date() == local_today(now)
