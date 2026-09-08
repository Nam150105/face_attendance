from __future__ import annotations

import json
import uuid

import psycopg
from fastapi import HTTPException

from app.auth import DATABASE_URL
from app.domain.geofence import GeofencePolicy, evaluate_geofence


LOCATION_COLUMNS = """
    id, manager_user_id, name, address, latitude, longitude,
    allow_radius_meters, warning_radius_meters, is_active,
    created_at, updated_at, expected_check_in, expected_check_out, grace_minutes, enforce_hours
"""

LOCATION_JOIN_COLUMNS = """
    l.id, l.manager_user_id, l.name, l.address, l.latitude, l.longitude,
    l.allow_radius_meters, l.warning_radius_meters, l.is_active,
    l.created_at, l.updated_at, l.expected_check_in, l.expected_check_out, l.grace_minutes, l.enforce_hours
"""


def _location(row: tuple) -> dict:
    return {
        "id": row[0],
        "manager_user_id": row[1],
        "name": row[2],
        "address": row[3],
        "latitude": float(row[4]),
        "longitude": float(row[5]),
        "allow_radius_meters": row[6],
        "warning_radius_meters": row[7],
        "is_active": row[8],
        "created_at": row[9],
        "updated_at": row[10],
        "expected_check_in": row[11].isoformat() if row[11] else None,
        "expected_check_out": row[12].isoformat() if row[12] else None,
        "grace_minutes": row[13],
        "enforce_hours": row[14],
    }


def _validate_coordinates(latitude: float, longitude: float, accuracy: float | None = None) -> None:
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise HTTPException(status_code=422, detail="Invalid latitude or longitude")
    if accuracy is not None and accuracy < 0:
        raise HTTPException(status_code=422, detail="GPS accuracy must be non-negative")


def list_locations(manager_id: uuid.UUID) -> list[dict]:
    with psycopg.connect(DATABASE_URL) as connection:
        rows = connection.execute(
            f"SELECT {LOCATION_COLUMNS} FROM locations WHERE manager_user_id = %s ORDER BY name",
            (manager_id,),
        ).fetchall()
    return [_location(row) for row in rows]


def get_location(manager_id: uuid.UUID, location_id: uuid.UUID) -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            f"SELECT {LOCATION_COLUMNS} FROM locations WHERE manager_user_id = %s AND id = %s AND is_active = true",
            (manager_id, location_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Location is outside manager scope")
    return _location(row)


def create_location(manager_id: uuid.UUID, payload: dict) -> dict:
    _validate_coordinates(payload["latitude"], payload["longitude"])
    if payload["allow_radius_meters"] <= 0 or payload["warning_radius_meters"] <= payload["allow_radius_meters"]:
        raise HTTPException(status_code=422, detail="warning_radius_meters must be greater than allow_radius_meters")
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            f"""
            INSERT INTO locations (manager_user_id, name, address, latitude, longitude,
                                   allow_radius_meters, warning_radius_meters,
                                   expected_check_in, expected_check_out, grace_minutes, enforce_hours)
            VALUES (%(manager_user_id)s, %(name)s, %(address)s, %(latitude)s, %(longitude)s,
                    %(allow_radius_meters)s, %(warning_radius_meters)s,
                    %(expected_check_in)s, %(expected_check_out)s, %(grace_minutes)s, %(enforce_hours)s)
            RETURNING {LOCATION_COLUMNS}
            """,
            {"manager_user_id": manager_id, **payload},
        ).fetchone()
        connection.execute(
            "INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, after_json) VALUES (%s, 'LOCATION_CREATED', 'location', %s, %s::jsonb)",
            # default=str: the payload now carries time values, which json cannot
            # serialise on its own.
            (manager_id, row[0], json.dumps(payload, default=str)),
        )
        connection.commit()
    return _location(row)


def update_location(manager_id: uuid.UUID, location_id: uuid.UUID, payload: dict) -> dict:
    _validate_coordinates(payload["latitude"], payload["longitude"])
    if payload["allow_radius_meters"] <= 0 or payload["warning_radius_meters"] <= payload["allow_radius_meters"]:
        raise HTTPException(status_code=422, detail="warning_radius_meters must be greater than allow_radius_meters")
    with psycopg.connect(DATABASE_URL) as connection:
        previous = connection.execute(
            f"SELECT {LOCATION_COLUMNS} FROM locations WHERE manager_user_id = %s AND id = %s",
            (manager_id, location_id),
        ).fetchone()
        if previous is None:
            raise HTTPException(status_code=404, detail="Location is outside manager scope")
        row = connection.execute(
            f"""
            UPDATE locations SET name = %(name)s, address = %(address)s, latitude = %(latitude)s,
                longitude = %(longitude)s, allow_radius_meters = %(allow_radius_meters)s,
                warning_radius_meters = %(warning_radius_meters)s, is_active = %(is_active)s,
                expected_check_in = %(expected_check_in)s, expected_check_out = %(expected_check_out)s,
                grace_minutes = %(grace_minutes)s, enforce_hours = %(enforce_hours)s, updated_at = now()
            WHERE manager_user_id = %(manager_id)s AND id = %(location_id)s
            RETURNING {LOCATION_COLUMNS}
            """,
            {"manager_id": manager_id, "location_id": location_id, **payload},
        ).fetchone()
        connection.execute(
            "INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_json, after_json) VALUES (%s, 'LOCATION_UPDATED', 'location', %s, %s::jsonb, %s::jsonb)",
            (manager_id, location_id, json.dumps(_location(previous), default=str), json.dumps(payload, default=str)),
        )
        connection.commit()
    return _location(row)


def delete_location(manager_id: uuid.UUID, location_id: uuid.UUID) -> dict:
    """
    Erase a location outright. Only allowed while nothing points at it: an
    attendance record without its location would lose the distance it was
    judged against, so a used location can only be switched off.
    """
    with psycopg.connect(DATABASE_URL) as connection:
        owned = connection.execute(
            "SELECT name FROM locations WHERE manager_user_id = %s AND id = %s",
            (manager_id, location_id),
        ).fetchone()
        if owned is None:
            raise HTTPException(status_code=404, detail="Location is outside manager scope")
        used = connection.execute(
            "SELECT 1 FROM attendance_events WHERE location_id = %s LIMIT 1", (location_id,)
        ).fetchone()
        if used is not None:
            raise HTTPException(status_code=409, detail="LOCATION_HAS_ATTENDANCE")

        connection.execute("DELETE FROM member_locations WHERE location_id = %s", (location_id,))
        connection.execute("UPDATE schedules SET location_id = NULL WHERE location_id = %s", (location_id,))
        connection.execute("DELETE FROM locations WHERE id = %s", (location_id,))
        connection.execute(
            "INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_json) "
            "VALUES (%s, 'LOCATION_DELETED', 'location', %s, %s::jsonb)",
            (manager_id, location_id, json.dumps({"name": owned[0]})),
        )
        connection.commit()
    return {"location_id": location_id, "deleted": True}


def remove_location(manager_id: uuid.UUID, location_id: uuid.UUID) -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            "UPDATE locations SET is_active = false, updated_at = now() WHERE manager_user_id = %s AND id = %s RETURNING id",
            (manager_id, location_id),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Location is outside manager scope")
        connection.execute(
            "INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, after_json) VALUES (%s, 'LOCATION_DEACTIVATED', 'location', %s, %s::jsonb)",
            (manager_id, location_id, json.dumps({"is_active": False})),
        )
        connection.commit()
    return {"location_id": location_id, "is_active": False}


def _assert_in_scope(connection: psycopg.Connection, manager_id: uuid.UUID, member_id: uuid.UUID) -> None:
    """A manager who works on site checks in like everybody else, so they count
    as being inside their own scope."""
    if member_id == manager_id:
        return
    allowed = connection.execute(
        "SELECT 1 FROM manager_memberships WHERE manager_user_id = %s AND member_user_id = %s AND status = 'ACTIVE'",
        (manager_id, member_id),
    ).fetchone()
    if allowed is None:
        raise HTTPException(status_code=404, detail="Member is outside manager scope")


def assign_location(manager_id: uuid.UUID, member_id: uuid.UUID, location_id: uuid.UUID, is_default: bool) -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        _assert_in_scope(connection, manager_id, member_id)
        location = connection.execute(
            "SELECT id FROM locations WHERE manager_user_id = %s AND id = %s AND is_active = true",
            (manager_id, location_id),
        ).fetchone()
        if location is None:
            raise HTTPException(status_code=404, detail="Location is outside manager scope or inactive")
        if is_default:
            connection.execute("UPDATE member_locations SET is_default = false WHERE member_id = %s", (member_id,))
        connection.execute(
            """
            INSERT INTO member_locations (member_id, location_id, is_default)
            VALUES (%s, %s, %s)
            ON CONFLICT (member_id, location_id) DO UPDATE SET is_default = EXCLUDED.is_default
            """,
            (member_id, location_id, is_default),
        )
        connection.execute(
            "INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, after_json) VALUES (%s, 'LOCATION_ASSIGNED', 'member_location', %s, %s::jsonb)",
            (manager_id, member_id, json.dumps({"location_id": str(location_id), "is_default": is_default})),
        )
        connection.commit()
    return {"member_id": member_id, "location_id": location_id, "is_default": is_default}


def evaluate_member_location(user_id: uuid.UUID, location_id: uuid.UUID, payload: dict) -> dict:
    _validate_coordinates(payload["latitude"], payload["longitude"], payload["gps_accuracy_meters"])
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            f"""
            SELECT {LOCATION_JOIN_COLUMNS}
            FROM member_locations ml JOIN locations l ON l.id = ml.location_id
            WHERE ml.member_id = %s AND ml.location_id = %s AND l.is_active = true
            """,
            (user_id, location_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Location is not assigned to this member")
    location = _location(row)
    decision = evaluate_geofence(
        payload["latitude"], payload["longitude"], payload["gps_accuracy_meters"],
        location["latitude"], location["longitude"],
        GeofencePolicy(location["allow_radius_meters"], location["warning_radius_meters"], payload.get("minimum_accuracy_meters", 100)),
    )
    return {
        "status": decision.status,
        "distance_meters": round(decision.distance_meters, 3),
        "accuracy_meters": decision.accuracy_meters,
        "location_id": location_id,
    }


def list_member_locations(member_id: uuid.UUID) -> list[dict]:
    with psycopg.connect(DATABASE_URL) as connection:
        rows = connection.execute(
            f"""
            SELECT {LOCATION_JOIN_COLUMNS}, ml.is_default
            FROM member_locations ml JOIN locations l ON l.id = ml.location_id
            WHERE ml.member_id = %s AND l.is_active = true
            ORDER BY ml.is_default DESC, l.name
            """,
            (member_id,),
        ).fetchall()
    return [{**_location(row), "is_default": row[11]} for row in rows]


def list_assigned_locations(manager_id: uuid.UUID, member_id: uuid.UUID) -> list[dict]:
    with psycopg.connect(DATABASE_URL) as connection:
        _assert_in_scope(connection, manager_id, member_id)
        rows = connection.execute(
            f"""
            SELECT {LOCATION_JOIN_COLUMNS}, ml.is_default
            FROM member_locations ml JOIN locations l ON l.id = ml.location_id
            WHERE ml.member_id = %s
            ORDER BY ml.is_default DESC, l.name
            """,
            (member_id,),
        ).fetchall()
    return [{**_location(row), "is_default": row[11]} for row in rows]


def unassign_location(manager_id: uuid.UUID, member_id: uuid.UUID, location_id: uuid.UUID) -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        _assert_in_scope(connection, manager_id, member_id)
        removed = connection.execute(
            """
            DELETE FROM member_locations ml USING locations l
            WHERE ml.location_id = l.id AND ml.member_id = %s AND ml.location_id = %s AND l.manager_user_id = %s
            RETURNING ml.id
            """,
            (member_id, location_id, manager_id),
        ).fetchone()
        if removed is None:
            raise HTTPException(status_code=404, detail="Assignment not found in manager scope")
        connection.execute(
            "INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_json) VALUES (%s, 'LOCATION_UNASSIGNED', 'member_location', %s, %s::jsonb)",
            (manager_id, member_id, json.dumps({"location_id": str(location_id)})),
        )
        connection.commit()
    return {"member_id": member_id, "location_id": location_id, "assigned": False}
