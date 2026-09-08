from __future__ import annotations

import json
import uuid

import psycopg
from fastapi import HTTPException

from app.auth import CurrentUser, DATABASE_URL
from app.services.permissions import managed_by, owner_filter


def _profile_from_row(row: tuple) -> dict:
    return {
        "id": row[0],
        "user_id": row[1],
        "email": row[2],
        "role": row[3],
        "status": row[4],
        "full_name": row[5],
        "phone": row[6],
        "birth_date": row[7],
        "employee_code": row[8],
        "position": row[9],
        "department": row[10],
        "avatar_object_key": row[11],
    }


PROFILE_COLUMNS = """
    mp.id, u.id, u.email, u.role::text, u.status::text,
    mp.full_name, mp.phone, mp.birth_date, mp.employee_code,
    mp.position, mp.department, mp.avatar_object_key
"""


def get_member_profile(user_id: uuid.UUID) -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            f"SELECT {PROFILE_COLUMNS} FROM users u LEFT JOIN member_profiles mp ON mp.user_id = u.id WHERE u.id = %s",
            (user_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="USER_NOT_FOUND")
    if row[0] is None:
        return {
            "id": None,
            "user_id": row[1],
            "email": row[2],
            "role": row[3],
            "status": row[4],
            "full_name": None,
            "phone": None,
            "birth_date": None,
            "employee_code": None,
            "position": None,
            "department": None,
            "avatar_object_key": None,
        }
    return _profile_from_row(row)


def update_member_profile(user_id: uuid.UUID, payload: dict) -> dict:
    # Treat a blank code as "no code" so several members without one do not
    # collide on the unique index.
    code = (payload.get("employee_code") or "").strip()
    payload = {**payload, "employee_code": code or None}
    with psycopg.connect(DATABASE_URL) as connection:
        # Everybody keeps their own profile, managers included. Without a name
        # and a phone number on the manager's record, the people they manage
        # have nobody to contact when something goes wrong.
        user = connection.execute("SELECT id FROM users WHERE id = %s", (user_id,)).fetchone()
        if user is None:
            raise HTTPException(status_code=404, detail="USER_NOT_FOUND")
        if code:
            taken = connection.execute(
                "SELECT 1 FROM member_profiles "
                "WHERE lower(btrim(employee_code)) = lower(%s) AND user_id <> %s",
                (code, user_id),
            ).fetchone()
            if taken is not None:
                raise HTTPException(status_code=409, detail="EMPLOYEE_CODE_TAKEN")
        connection.execute(
            """
            INSERT INTO member_profiles (user_id, full_name, phone, birth_date, employee_code, position, department)
            VALUES (%(user_id)s, %(full_name)s, %(phone)s, %(birth_date)s, %(employee_code)s, %(position)s, %(department)s)
            ON CONFLICT (user_id) DO UPDATE SET
                full_name = EXCLUDED.full_name,
                phone = EXCLUDED.phone,
                birth_date = EXCLUDED.birth_date,
                employee_code = EXCLUDED.employee_code,
                position = EXCLUDED.position,
                department = EXCLUDED.department,
                updated_at = now()
            """,
            {"user_id": user_id, **payload},
        )
        try:
            connection.commit()
        except psycopg.errors.UniqueViolation as error:
            raise HTTPException(status_code=409, detail="EMPLOYEE_CODE_TAKEN") from error
    return get_member_profile(user_id)


def list_manager_members(user: CurrentUser) -> list[dict]:
    # A super admin has no roster of their own; theirs is everybody's, otherwise
    # the members screen would open onto an empty list.
    where, parameters = owner_filter(managed_by(user), "mm.manager_user_id")
    with psycopg.connect(DATABASE_URL) as connection:
        rows = connection.execute(
            f"""
            SELECT DISTINCT ON (u.email) {PROFILE_COLUMNS}, mm.status::text
            FROM manager_memberships mm
            JOIN users u ON u.id = mm.member_user_id
            LEFT JOIN member_profiles mp ON mp.user_id = u.id
            WHERE {where} AND mm.status = 'ACTIVE'
            ORDER BY u.email
            """,
            parameters,
        ).fetchall()
    members = []
    for row in rows:
        profile = _profile_from_row(row[:12]) if row[0] is not None else get_member_profile(row[1])
        profile["membership_status"] = row[12]
        members.append(profile)
    return members


def get_managed_member(user: CurrentUser, member_id: uuid.UUID) -> dict:
    where, parameters = owner_filter(managed_by(user), "mm.manager_user_id")
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            f"""
            SELECT {PROFILE_COLUMNS}, mm.status::text
            FROM manager_memberships mm
            JOIN users u ON u.id = mm.member_user_id
            LEFT JOIN member_profiles mp ON mp.user_id = u.id
            WHERE {where} AND mm.member_user_id = %s AND mm.status <> 'REMOVED'
            LIMIT 1
            """,
            [*parameters, member_id],
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Member is outside your scope")
    profile = _profile_from_row(row[:12]) if row[0] is not None else get_member_profile(row[1])
    profile["membership_status"] = row[12]
    return profile


def add_member_by_email(user: CurrentUser, email: str) -> dict:
    # Whoever adds someone becomes their manager, super admin included: a
    # membership with no manager on the other end is a row nobody can act on.
    manager_id = user.id
    with psycopg.connect(DATABASE_URL) as connection:
        member = connection.execute(
            "SELECT id FROM users WHERE email = %s AND role IN ('MEMBER', 'MANAGER')", (email.lower(),)
        ).fetchone()
        if member is None:
            raise HTTPException(status_code=404, detail="MEMBER_EMAIL_NOT_FOUND")
        if member[0] == manager_id:
            raise HTTPException(status_code=409, detail="CANNOT_ADD_SELF")
        existing = connection.execute(
            "SELECT id, status::text FROM manager_memberships WHERE manager_user_id = %s AND member_user_id = %s",
            (manager_id, member[0]),
        ).fetchone()
        if existing is None:
            connection.execute(
                "INSERT INTO manager_memberships (manager_user_id, member_user_id, status) VALUES (%s, %s, 'ACTIVE')",
                (manager_id, member[0]),
            )
            action = "MEMBER_ADDED"
            before_status = None
        elif existing[1] == "ACTIVE":
            raise HTTPException(status_code=409, detail="Member is already managed")
        else:
            connection.execute(
                "UPDATE manager_memberships SET status = 'ACTIVE', updated_at = now() WHERE id = %s",
                (existing[0],),
            )
            action = "MEMBERSHIP_REACTIVATED"
            before_status = existing[1]
        connection.execute(
            """
            INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_json, after_json)
            VALUES (%s, %s, 'manager_membership', %s, %s::jsonb, %s::jsonb)
            """,
            (
                manager_id,
                action,
                member[0],
                json.dumps({"status": before_status}) if before_status else None,
                json.dumps({"status": "ACTIVE"}),
            ),
        )
        connection.commit()
    return get_managed_member(user, member[0])


def update_membership(user: CurrentUser, member_id: uuid.UUID, membership_status: str) -> dict:
    if membership_status not in {"INVITED", "ACTIVE", "SUSPENDED", "REMOVED"}:
        raise HTTPException(status_code=422, detail="Invalid membership status")
    manager_id = user.id
    where, parameters = owner_filter(managed_by(user))
    with psycopg.connect(DATABASE_URL) as connection:
        previous = connection.execute(
            f"SELECT status::text FROM manager_memberships WHERE {where} AND member_user_id = %s",
            [*parameters, member_id],
        ).fetchone()
        result = connection.execute(
            f"UPDATE manager_memberships SET status = %s::membership_status, updated_at = now()"
            f" WHERE {where} AND member_user_id = %s RETURNING id",
            [membership_status, *parameters, member_id],
        ).fetchone()
        if result is None:
            raise HTTPException(status_code=404, detail="Member is outside your scope")
        connection.execute(
            """
            INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_json, after_json, reason)
            VALUES (%s, %s, 'manager_membership', %s, %s::jsonb, %s::jsonb, %s)
            """,
            (
                manager_id,
                "MEMBERSHIP_REMOVED" if membership_status == "REMOVED" else "MEMBERSHIP_STATUS_CHANGED",
                member_id,
                json.dumps({"status": previous[0]}) if previous else None,
                json.dumps({"status": membership_status}),
                "Manager membership update",
            ),
        )
        connection.commit()
    return get_managed_member(user, member_id) if membership_status != "REMOVED" else {"member_id": member_id, "membership_status": "REMOVED"}


MAX_BULK_EMAILS = 200
BULK_ADDED = "ADDED"
BULK_REACTIVATED = "REACTIVATED"
BULK_ALREADY = "ALREADY_MANAGED"
BULK_NOT_REGISTERED = "NOT_REGISTERED"
BULK_INVALID = "INVALID_EMAIL"


def _normalise_emails(raw: list[str]) -> list[str]:
    """Keep the order the manager pasted them in, drop blanks and duplicates."""
    seen: set[str] = set()
    ordered: list[str] = []
    for item in raw:
        email = item.strip().strip(",;").lower()
        if not email or email in seen:
            continue
        seen.add(email)
        ordered.append(email)
    return ordered


def _looks_like_email(email: str) -> bool:
    if email.count("@") != 1:
        return False
    local, _, domain = email.partition("@")
    return bool(local) and "." in domain and not domain.startswith(".") and not domain.endswith(".")


def bulk_add_members(user: CurrentUser, raw_emails: list[str]) -> dict:
    manager_id = user.id
    emails = _normalise_emails(raw_emails)
    if not emails:
        raise HTTPException(status_code=422, detail="NO_EMAIL_PROVIDED")
    if len(emails) > MAX_BULK_EMAILS:
        raise HTTPException(status_code=422, detail="TOO_MANY_EMAILS")

    results: list[dict] = []
    with psycopg.connect(DATABASE_URL) as connection:
        for email in emails:
            if not _looks_like_email(email):
                results.append({"email": email, "status": BULK_INVALID})
                continue
            member = connection.execute(
                "SELECT id FROM users WHERE email = %s AND role IN ('MEMBER', 'MANAGER')", (email,)
            ).fetchone()
            if member is None:
                results.append({"email": email, "status": BULK_NOT_REGISTERED})
                continue
            existing = connection.execute(
                "SELECT id, status::text FROM manager_memberships WHERE manager_user_id = %s AND member_user_id = %s",
                (manager_id, member[0]),
            ).fetchone()
            if existing is not None and existing[1] == "ACTIVE":
                results.append({"email": email, "status": BULK_ALREADY})
                continue
            if existing is None:
                connection.execute(
                    "INSERT INTO manager_memberships (manager_user_id, member_user_id, status) VALUES (%s, %s, 'ACTIVE')",
                    (manager_id, member[0]),
                )
                action, outcome, before_status = "MEMBER_ADDED", BULK_ADDED, None
            else:
                connection.execute(
                    "UPDATE manager_memberships SET status = 'ACTIVE', updated_at = now() WHERE id = %s",
                    (existing[0],),
                )
                action, outcome, before_status = "MEMBERSHIP_REACTIVATED", BULK_REACTIVATED, existing[1]
            connection.execute(
                """
                INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_json, after_json)
                VALUES (%s, %s, 'manager_membership', %s, %s::jsonb, %s::jsonb)
                """,
                (
                    manager_id,
                    action,
                    member[0],
                    json.dumps({"status": before_status}) if before_status else None,
                    json.dumps({"status": "ACTIVE", "email": email}),
                ),
            )
            results.append({"email": email, "status": outcome})
        connection.commit()

    succeeded = sum(1 for item in results if item["status"] in {BULK_ADDED, BULK_REACTIVATED})
    return {
        "requested": len(results),
        "succeeded": succeeded,
        "already_managed": sum(1 for item in results if item["status"] == BULK_ALREADY),
        "failed": sum(1 for item in results if item["status"] in {BULK_NOT_REGISTERED, BULK_INVALID}),
        "results": results,
    }


def my_managers(member_id: uuid.UUID) -> list[dict]:
    """
    Who to ask. A member whose check-in was refused, or whose hours look wrong,
    needs a name and a way to reach them — not a support address for a system
    nobody in the building runs.
    """
    with psycopg.connect(DATABASE_URL) as connection:
        rows = connection.execute(
            """
            SELECT u.id, u.email, mp.full_name, mp.phone, mp.position, mp.department
            FROM manager_memberships mm
            JOIN users u ON u.id = mm.manager_user_id
            LEFT JOIN member_profiles mp ON mp.user_id = u.id
            WHERE mm.member_user_id = %s AND mm.status = 'ACTIVE' AND u.status = 'ACTIVE'
            ORDER BY mp.full_name NULLS LAST, u.email
            """,
            (member_id,),
        ).fetchall()
    return [
        {
            "user_id": row[0],
            "email": row[1],
            "full_name": row[2],
            "phone": row[3],
            "position": row[4],
            "department": row[5],
        }
        for row in rows
    ]
