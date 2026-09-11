from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta

import psycopg
from fastapi import HTTPException

from app.auth import CurrentUser, DATABASE_URL
from app.domain.geofence import haversine_distance_meters
from app.services.attendance import _minutes_early_leave, _minutes_late
from app.services.attendance_days import SHIFT_OFFSET_SQL, WORK_DATE_SQL, days as build_days
from app.services.member_portal import APP_TIMEZONE, LOCAL_ZONE
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
            WHERE f.member_id = e.member_id AND f.revoked_at IS NULL AND f.image_object_key IS NOT NULL),
    e.original_server_time,
    e.edited_at, e.edit_reason, editor.email, e.source::text
"""

# The only two reasons a person can put on a record by hand. The system writes
# a wider set of its own (FACE_NOT_FOUND, GPS_ACCURACY_LOW…), and those survive
# an edit untouched unless the manager actually changes the verdict.
ADJUSTABLE_FAILURES = {"FACE_NOT_MATCHED", "OUTSIDE_ALLOWED_ZONE"}


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
        # Null on records a person entered: nobody stood anywhere, so there is
        # no coordinate to report and none is invented.
        "latitude": float(row[9]) if row[9] is not None else None,
        "longitude": float(row[10]) if row[10] is not None else None,
        "gps_accuracy_meters": float(row[11]) if row[11] is not None else None,
        "distance_meters": float(row[12]) if row[12] is not None else None,
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
        "original_server_time": row[25],
        "edited_at": row[26],
        "edit_reason": row[27],
        "edited_by_email": row[28],
        "source": row[29],
    }



# Deleted rows drop out of every listing; they stay reachable by id so a manager
# can still open the one they just removed.
LIVE_ONLY = "e.deleted_at IS NULL"


def _scope(connection: psycopg.Connection, user: CurrentUser) -> tuple[str, list]:
    """
    SQL for "rows this viewer may see".

    A super admin sees everything. A manager sees what happened at the places
    they run, plus their own attendance wherever it happened — scoping by "who
    do I manage" would let two managers of the same person read each other's
    site data through them. Everybody else sees only their own.
    """
    del connection
    if user.role == "SUPER_ADMIN":
        return "TRUE", []
    if user.role == "MANAGER":
        return (
            "(e.location_id IN (SELECT id FROM locations WHERE manager_user_id = %s)"
            " OR e.member_id = %s)",
            [user.id, user.id],
        )
    return "e.member_id = %s", [user.id]


def _scoped_event(connection: psycopg.Connection, user: CurrentUser, event_id: uuid.UUID) -> tuple:
    scope, scope_params = _scope(connection, user)
    row = connection.execute(
        f"""
        SELECT {EVENT_COLUMNS}
        FROM attendance_events e
        JOIN users u ON u.id = e.member_id
        LEFT JOIN member_profiles mp ON mp.user_id = e.member_id
        JOIN locations l ON l.id = e.location_id
        LEFT JOIN users editor ON editor.id = e.edited_by
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
            LEFT JOIN users editor ON editor.id = e.edited_by
            WHERE {where}
            ORDER BY e.server_time DESC
            LIMIT %s OFFSET %s
            """,
            [*parameters, filters.get("limit", 50), filters.get("offset", 0)],
        ).fetchall()
    return {"total": total, "items": [_event(row) for row in rows]}



def attendance_sessions(user: CurrentUser, filters: dict) -> dict:
    """
    One row per person per working day, from the shared day builder — the
    same rows the calendar and the member's own timesheet are made of.
    """
    with psycopg.connect(DATABASE_URL) as connection:
        scope, scope_params = _scope(connection, user)
        parameters = list(scope_params)
        if filters.get("location_id"):
            scope = f"({scope}) AND e.location_id = %s"
            parameters.append(filters["location_id"])
        date_from = filters.get("date_from") or (date.today() - timedelta(days=31))
        date_to = filters.get("date_to") or date.today()
        rows = build_days(
            connection, scope, parameters, date_from, date_to,
            bool(filters.get("include_invalid")), filters.get("member_id"),
        )

    limit = filters.get("limit", 25)
    offset = filters.get("offset", 0)
    return {"total": len(rows), "items": rows[offset:offset + limit]}

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


# What a person may change on a record, and what stays as the machine left it.
EDITABLE_FIELDS = ("status", "failure_code", "server_time", "location_id", "note")


def manual_adjust(user: CurrentUser, event_id: uuid.UUID, payload: dict) -> dict:
    """
    Correct one record: its time, its place, its verdicts, its status.

    A record is evidence, and evidence gets corrected — the phone's clock was
    off, the GPS drifted indoors, the light was bad and a real face was refused.
    What is *not* corrected is what the machine measured: face_match_score and
    face_distance keep the numbers they were born with, so months later it is
    still possible to say what the system saw and what a person decided.

    Every change lands in the audit log. A manager must say why — they answer
    to the person whose day they are changing. The system administrator is who
    those answers go to, so for them the reason is optional.
    """
    manager_id = user.id
    reason = (payload.get("reason") or "").strip()
    if user.role != "SUPER_ADMIN" and len(reason) < 3:
        raise HTTPException(status_code=422, detail="ADJUST_REASON_REQUIRED")

    # Presence, not truthiness: `face_ok: null` is a real instruction — it puts
    # the verdict back to whatever the recogniser measured — and it must not be
    # confused with "the client did not mention this field".
    touched = {field for field in EDITABLE_FIELDS if field in payload}
    if not touched:
        raise HTTPException(status_code=422, detail="NOTHING_TO_ADJUST")

    new_status = payload.get("status")
    new_time: datetime | None = payload.get("server_time")
    new_location = payload.get("location_id")
    new_failure = payload.get("failure_code")
    note = payload.get("note")

    if new_failure is not None and new_failure not in ADJUSTABLE_FAILURES:
        raise HTTPException(status_code=422, detail="INVALID_FAILURE_CODE")
    if new_status is not None and new_status not in ADJUSTABLE_STATUSES:
        raise HTTPException(status_code=422, detail="INVALID_ATTENDANCE_STATUS")

    with psycopg.connect(DATABASE_URL) as connection:
        current = _event(_scoped_event(connection, user, event_id))

        if new_location is not None and str(new_location) != str(current["location_id"]):
            # Moving a record to a site the manager does not own would hide it
            # from themselves and show it to somebody else.
            owned = connection.execute(
                "SELECT 1 FROM locations WHERE id = %s AND (%s OR manager_user_id = %s)",
                (new_location, user.role == "SUPER_ADMIN", manager_id),
            ).fetchone()
            if owned is None:
                raise HTTPException(status_code=404, detail="LOCATION_NOT_FOUND")

        if new_time is not None:
            # A day that ends before it starts is not a correction, it is a typo
            # that would make the hours negative everywhere they are counted.
            other = connection.execute(
                """
                SELECT event_type::text, server_time FROM attendance_events
                WHERE member_id = %s AND id <> %s AND deleted_at IS NULL
                  AND status IN ('SUCCESS', 'WARNING_CONFIRMED')
                  AND (server_time AT TIME ZONE %s)::date = (%s AT TIME ZONE %s)::date
                """,
                (current["member_id"], event_id, APP_TIMEZONE, new_time, APP_TIMEZONE),
            ).fetchall()
            for kind, moment in other:
                if current["event_type"] == "CHECK_OUT" and kind == "CHECK_IN" and new_time < moment:
                    raise HTTPException(status_code=422, detail="TIME_BEFORE_CHECK_IN")
                if current["event_type"] == "CHECK_IN" and kind == "CHECK_OUT" and new_time > moment:
                    raise HTTPException(status_code=422, detail="TIME_AFTER_CHECK_OUT")

        before = {
            "status": current["status"],
            "failure_code": current["failure_code"],
            "server_time": current["server_time"].isoformat(),
            "location_id": str(current["location_id"]),
            "note": current["reason"],
        }
        after = {
            "status": new_status if "status" in touched and new_status else before["status"],
            "server_time": (new_time or current["server_time"]).isoformat(),
            "location_id": str(new_location) if new_location is not None else before["location_id"],
            # A valid record has nothing to explain, so its reason code goes.
            "failure_code": (
                None
                if (new_status or before["status"]) in {"SUCCESS", "WARNING_CONFIRMED"}
                else new_failure if "failure_code" in touched
                else before["failure_code"]
            ),
            "note": (note.strip() or None) if isinstance(note, str) else before["note"],
        }
        if before == after:
            raise HTTPException(status_code=422, detail="NOTHING_TO_ADJUST")

        # Numbers derived from the time and the place have to follow them.
        # Leaving them behind is how a corrected 08:30 arrival went on saying
        # "muộn 12 phút" from the time it replaced.
        effective_time = new_time or current["server_time"]
        rule = connection.execute(
            "SELECT expected_check_in, expected_check_out, grace_minutes, enforce_hours, shift_kind"
            " FROM locations WHERE id = %s",
            (after["location_id"],),
        ).fetchone()
        late_minutes = (
            _minutes_late(rule, effective_time) if current["event_type"] == "CHECK_IN" else None
        )
        early_minutes = (
            _minutes_early_leave(rule, effective_time) if current["event_type"] == "CHECK_OUT" else None
        )

        # The distance was measured against the old site; against the new one it
        # is a different number, computed from the coordinates already stored.
        distance = current["distance_meters"]
        if current["latitude"] is not None and after["location_id"] != str(current["location_id"]):
            place = connection.execute(
                "SELECT latitude, longitude FROM locations WHERE id = %s", (after["location_id"],)
            ).fetchone()
            distance = haversine_distance_meters(
                current["latitude"], current["longitude"], float(place[0]), float(place[1])
            )

        connection.execute(
            """
            UPDATE attendance_events
            SET status = %s::attendance_status,
                server_time = %s,
                location_id = %s,
                minutes_late = %s,
                minutes_early_leave = %s,
                distance_meters = %s,
                failure_code = %s,
                reason = %s,
                -- Keep the device's own timestamp the first time it is corrected.
                original_server_time = COALESCE(original_server_time, %s),
                edited_at = now(),
                edited_by = %s,
                edit_reason = %s
            WHERE id = %s
            """,
            (
                after["status"],
                effective_time,
                after["location_id"],
                late_minutes or None,
                early_minutes or None,
                distance,
                after["failure_code"],
                after["note"],
                current["server_time"],
                manager_id,
                reason or None,
                event_id,
            ),
        )
        connection.execute(
            """
            INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_json, after_json, reason)
            VALUES (%s, 'ATTENDANCE_MANUALLY_ADJUSTED', 'attendance_event', %s, %s::jsonb, %s::jsonb, %s)
            """,
            (manager_id, event_id, json.dumps(before), json.dumps(after), reason or None),
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
    """
    The overview card counts. Every query here ignores soft-deleted rows —
    a day the manager just deleted must not still be "2 lượt hôm nay" — and
    cuts days in the organisation's timezone, the same way the records do.
    """
    today = datetime.now(LOCAL_ZONE).date()
    since = today - timedelta(days=6)
    with psycopg.connect(DATABASE_URL) as connection:
        locations = connection.execute(
            "SELECT count(*) FROM locations WHERE manager_user_id = %s AND is_active = true", (manager_id,)
        ).fetchone()[0]
        members = connection.execute(
            f"""
            SELECT u.id, u.email, mp.full_name,
                   EXISTS (SELECT 1 FROM face_embeddings f WHERE f.member_id = u.id AND f.revoked_at IS NULL),
                   open_event.server_time,
                   last_event.server_time,
                   last_event.event_type::text
            FROM manager_memberships mm
            JOIN users u ON u.id = mm.member_user_id
            LEFT JOIN member_profiles mp ON mp.user_id = u.id
            LEFT JOIN LATERAL (
                -- "In right now": a valid check-in from today with no valid
                -- check-out after it. Yesterday's forgotten check-in is not
                -- somebody at work; the session rule closed it at midnight.
                SELECT e.server_time FROM attendance_events e
                JOIN locations l ON l.id = e.location_id
                WHERE e.member_id = u.id AND e.event_type = 'CHECK_IN' AND e.deleted_at IS NULL
                  AND e.status IN ('SUCCESS', 'WARNING_CONFIRMED')
                  AND {WORK_DATE_SQL} = ((now() AT TIME ZONE %s) - ({SHIFT_OFFSET_SQL}))::date
                  AND NOT EXISTS (
                      SELECT 1 FROM attendance_events c
                      WHERE c.member_id = u.id AND c.event_type = 'CHECK_OUT' AND c.deleted_at IS NULL
                        AND c.status IN ('SUCCESS', 'WARNING_CONFIRMED') AND c.server_time > e.server_time
                  )
                ORDER BY e.server_time DESC LIMIT 1
            ) open_event ON true
            LEFT JOIN LATERAL (
                SELECT e.server_time, e.event_type FROM attendance_events e
                WHERE e.member_id = u.id AND e.deleted_at IS NULL ORDER BY e.server_time DESC LIMIT 1
            ) last_event ON true
            WHERE mm.manager_user_id = %s AND mm.status = 'ACTIVE'
            ORDER BY open_event.server_time DESC NULLS LAST, u.email
            """,
            (APP_TIMEZONE, APP_TIMEZONE, manager_id),
        ).fetchall()
        daily_rows = connection.execute(
            """
            SELECT (e.server_time AT TIME ZONE %s)::date AS day,
                   count(*) FILTER (WHERE e.event_type = 'CHECK_IN') AS check_in,
                   count(*) FILTER (WHERE e.event_type = 'CHECK_OUT') AS check_out,
                   count(*) FILTER (WHERE e.status = 'WARNING_CONFIRMED') AS warnings
            FROM attendance_events e
            JOIN manager_memberships mm ON mm.member_user_id = e.member_id
            WHERE mm.manager_user_id = %s AND mm.status = 'ACTIVE' AND e.deleted_at IS NULL
              AND (e.server_time AT TIME ZONE %s)::date >= %s
            GROUP BY day
            """,
            (APP_TIMEZONE, manager_id, APP_TIMEZONE, since),
        ).fetchall()
        events_today = connection.execute(
            """
            SELECT count(*) FROM attendance_events e
            JOIN manager_memberships mm ON mm.member_user_id = e.member_id
            WHERE mm.manager_user_id = %s AND mm.status = 'ACTIVE' AND e.deleted_at IS NULL
              AND (e.server_time AT TIME ZONE %s)::date = %s
            """,
            (manager_id, APP_TIMEZONE, today),
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
    One month shaped for a wall calendar, from the shared day builder. The
    calendar and the day list can no longer disagree about a day because they
    are the same rows arranged differently.
    """
    try:
        first = datetime.strptime(month, "%Y-%m").date()
    except ValueError:
        raise HTTPException(status_code=422, detail="MONTH_FORMAT_INVALID")
    last = (first + timedelta(days=32)).replace(day=1) - timedelta(days=1)

    with psycopg.connect(DATABASE_URL) as connection:
        scope, scope_params = _scope(connection, user)
        rows = build_days(connection, scope, list(scope_params), first, last, include_invalid)

    days: dict[str, list[dict]] = {}
    events = present = late = open_sessions = rejected_total = off_radius_total = 0
    for row in rows:
        days.setdefault(row["work_date"], []).append({
            "member_id": row["member_id"],
            "member_email": row["member_email"],
            "member_name": row["member_name"],
            "check_in": row["check_in"],
            "check_out": row["check_out"],
            "minutes_late": row["minutes_late"],
            "minutes_early_leave": row["minutes_early_leave"],
            "rejected": row["rejected"],
            "off_radius": row["off_radius"],
            "location_name": row["location_name"],
            "status": row["status"],
        })
        events += row["event_count"]
        rejected_total += row["rejected"]
        off_radius_total += row["off_radius"]
        if row["check_in"] is not None:
            present += 1
            if row["minutes_late"] > 0:
                late += 1
            if row["check_out"] is None:
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

def roll_call(user: CurrentUser, day: date) -> dict:
    """
    Everybody expected on one day, with what they did — including the people
    who did nothing, which the calendar cannot show because it only knows
    about rows that exist. A manager's roster is their active memberships;
    the super admin's is every active membership in the system.
    """
    with psycopg.connect(DATABASE_URL) as connection:
        if user.role == "SUPER_ADMIN":
            roster_sql, roster_params = "mm.status = 'ACTIVE'", []
        else:
            roster_sql, roster_params = "mm.status = 'ACTIVE' AND mm.manager_user_id = %s", [user.id]
        roster = connection.execute(
            f"""
            SELECT DISTINCT ON (u.id) u.id, u.email, mp.full_name, t.name
            FROM manager_memberships mm
            JOIN users u ON u.id = mm.member_user_id AND u.status = 'ACTIVE'
            LEFT JOIN member_profiles mp ON mp.user_id = u.id
            LEFT JOIN teams t ON t.id = mm.team_id
            WHERE {roster_sql}
            ORDER BY u.id, mm.created_at DESC
            """,
            roster_params,
        ).fetchall()
        scope, scope_params = _scope(connection, user)
        rows = build_days(connection, scope, list(scope_params), day, day, False)

    by_member = {row["member_id"]: row for row in rows}
    people = []
    for member_id, email, full_name, team_name in roster:
        row = by_member.get(member_id)
        if row is None or row["check_in"] is None:
            status = "ABSENT"
        elif row["check_out"] is None:
            status = "LATE" if row["minutes_late"] > 0 else "OPEN"
        else:
            status = "LATE" if row["minutes_late"] > 0 else "PRESENT"
        people.append({
            "member_id": member_id,
            "member_email": email,
            "member_name": full_name,
            "team_name": team_name,
            "status": status,
            "check_in": row["check_in"] if row else None,
            "check_out": row["check_out"] if row else None,
            "minutes_late": row["minutes_late"] if row else 0,
            "minutes_early_leave": row["minutes_early_leave"] if row else 0,
            "location_name": row["location_name"] if row else None,
            "check_in_id": row["check_in_id"] if row else None,
            "check_out_id": row["check_out_id"] if row else None,
        })
    # Absentees first when the day is under way: they are the ones to call.
    order = {"ABSENT": 0, "LATE": 1, "OPEN": 2, "PRESENT": 3}
    people.sort(key=lambda item: (order[item["status"]], (item["member_name"] or item["member_email"]).lower()))
    return {
        "date": day.isoformat(),
        "summary": {
            "expected": len(people),
            "present": sum(1 for item in people if item["status"] != "ABSENT"),
            "late": sum(1 for item in people if item["minutes_late"] > 0),
            "open": sum(1 for item in people if item["status"] in ("OPEN", "LATE") and item["check_out"] is None),
            "absent": sum(1 for item in people if item["status"] == "ABSENT"),
        },
        "people": people,
    }


def delete_attendance_day(
    user: CurrentUser, member_id: uuid.UUID, work_date: date, reason: str
) -> dict:
    """
    Remove a whole working day for one person.

    What a manager sees in the day list is a *session* — the arrival and the
    departure folded into one line — so deleting "that record" has to mean both
    halves. Deleting only the check-in left the check-out behind, and the next
    render showed the leaving photo in the arriving slot: a record nobody made,
    assembled out of the remains of one that was deleted.

    Everything refused that day goes too. A rejected attempt belongs to the day
    it was attempted on, and leaving it behind means the day is still there.
    """
    reason = (reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="DELETE_REASON_REQUIRED")

    with psycopg.connect(DATABASE_URL) as connection:
        scope, scope_params = _scope(connection, user)
        rows = connection.execute(
            f"""
            SELECT e.id, e.event_type::text, e.status::text, e.server_time, u.email
            FROM attendance_events e
            JOIN users u ON u.id = e.member_id
            WHERE e.member_id = %s
              AND (e.server_time AT TIME ZONE %s)::date = %s
              AND e.deleted_at IS NULL
              AND {scope}
            ORDER BY e.server_time
            """,
            [member_id, APP_TIMEZONE, work_date, *scope_params],
        ).fetchall()
        if not rows:
            raise HTTPException(status_code=404, detail="ATTENDANCE_DAY_NOT_FOUND")

        connection.execute(
            "UPDATE attendance_events SET deleted_at = now(), deleted_by = %s, delete_reason = %s"
            " WHERE id = ANY(%s)",
            (user.id, reason, [row[0] for row in rows]),
        )
        # One audit row per event, the same shape a single delete writes, so a
        # super admin restores them the same way — one at a time if they want
        # only half the day back.
        for row in rows:
            connection.execute(
                """
                INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_json, reason)
                VALUES (%s, 'ATTENDANCE_DELETED', 'attendance_event', %s, %s::jsonb, %s)
                """,
                (
                    user.id,
                    row[0],
                    json.dumps(
                        {
                            "member_email": row[4],
                            "event_type": row[1],
                            "status": row[2],
                            "server_time": row[3].isoformat(),
                            "work_date": work_date.isoformat(),
                        }
                    ),
                    reason,
                ),
            )
        connection.commit()

    return {
        "member_id": str(member_id),
        "work_date": work_date.isoformat(),
        "deleted": len(rows),
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
