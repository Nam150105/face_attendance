"""
Super-admin and record-deletion probe — runs against a LIVE stack.

    docker compose run --rm -v "<repo>/api:/src:ro" -w /src \
      -e PROBE_BASE_URL=http://api:8000/api/v1 api python -m tests.admin_probe
"""

from __future__ import annotations

import sys
import uuid

import psycopg
from passlib.context import CryptContext

from tests.security_probe import DATABASE_URL, PASSWORD, call, cleanup, register

results: list[tuple[bool, str, str]] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    results.append((passed, name, detail))
    print(("PASS  " if passed else "FAIL  ") + name + ("  " + detail if detail else ""))


def make_admin(created: list[str]) -> tuple[str, str]:
    email = f"probe-admin-{uuid.uuid4().hex[:10]}@example.com"
    created.append(email)
    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute(
            "INSERT INTO users (email, password_hash, role, status, email_verified_at)"
            " VALUES (%s, %s, 'SUPER_ADMIN', 'ACTIVE', now())",
            (email, CryptContext(schemes=["bcrypt"]).hash(PASSWORD)),
        )
        connection.commit()
    status, payload = call("POST", "/auth/login", body={"email": email, "password": PASSWORD})
    if status != 200:
        raise SystemExit(f"cannot log in as admin: {status} {payload}")
    return email, payload["access_token"]


def seed_event(member_id: str, location_id: str) -> str:
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            """
            INSERT INTO attendance_events
                (member_id, location_id, event_type, status, server_time, latitude, longitude,
                 gps_accuracy_meters, distance_meters, idempotency_key)
            VALUES (%s, %s, 'CHECK_IN', 'SUCCESS', now(), 21, 105, 5, 10, %s)
            RETURNING id
            """,
            (member_id, location_id, "admin-probe-" + uuid.uuid4().hex),
        ).fetchone()
        connection.commit()
    return str(row[0])


def main() -> int:
    created: list[str] = []
    try:
        admin_email, admin = make_admin(created)
        manager_email, manager = register("MANAGER", created)
        member_email, member = register("MEMBER", created)
        call("POST", "/manager/members/add-by-email", manager, {"email": member_email})

        status, roster = call("GET", "/manager/members", manager)
        member_id = roster[0]["user_id"] if isinstance(roster, list) and roster else None

        status, location = call("POST", "/manager/locations", manager, {
            "name": "Admin probe", "address": None, "latitude": 21.0, "longitude": 105.8,
            "allow_radius_meters": 100, "warning_radius_meters": 200, "is_active": True,
            "expected_check_in": "08:00", "expected_check_out": "17:00",
        })
        location_id = location.get("id")

        # --- role boundary ---------------------------------------------------
        for label, token in (("MANAGER", manager), ("MEMBER", member)):
            status, _ = call("GET", "/admin/overview", token)
            check(f"{label} không vào được khu quản trị hệ thống", status == 403, f"HTTP {status}")

        status, data = call("GET", "/admin/overview", admin)
        check("Super admin xem được tổng quan hệ thống",
              status == 200 and "members" in data, f"HTTP {status}")

        status, users = call("GET", "/admin/users", admin)
        check("Super admin thấy toàn bộ tài khoản mọi vai trò",
              status == 200 and users.get("total", 0) >= 3, f"{users.get('total')} tài khoản")

        # --- manager deletes a record ---------------------------------------
        event_id = seed_event(member_id, location_id)
        status, _ = call("DELETE", f"/manager/attendance/{event_id}?reason=nham%20ca", manager)
        check("Manager xoá được bản ghi của thành viên mình", status == 200, f"HTTP {status}")

        status, listing = call("GET", "/manager/attendance", manager)
        ids = {row["id"] for row in listing.get("items", [])}
        check("Bản ghi đã xoá biến khỏi danh sách của manager", event_id not in ids)

        status, own = call("GET", "/attendance/me", member)
        member_ids = {row["id"] for row in own} if isinstance(own, list) else set()
        check("Thành viên cũng không còn thấy bản ghi đã xoá", event_id not in member_ids)

        with psycopg.connect(DATABASE_URL) as connection:
            audited = connection.execute(
                "SELECT reason FROM audit_logs WHERE action = 'ATTENDANCE_DELETED' AND entity_id = %s",
                (event_id,),
            ).fetchone()
        check("Việc xoá được ghi vào nhật ký kèm lý do",
              audited is not None and "nham ca" in (audited[0] or ""), audited[0] if audited else "")

        status, _ = call("DELETE", f"/manager/attendance/{event_id}?reason=lan%20hai", manager)
        check("Không xoá lại được bản ghi đã xoá", status == 409, f"HTTP {status}")

        status, _ = call("DELETE", f"/manager/attendance/{uuid.uuid4()}?reason=thu%20nghiem", manager)
        check("Manager không xoá được bản ghi ngoài phạm vi", status == 404, f"HTTP {status}")

        # --- manager cannot purge, admin can ---------------------------------
        status, _ = call("DELETE", f"/admin/attendance/{event_id}?reason=thu", manager)
        check("Manager không xoá vĩnh viễn được", status == 403, f"HTTP {status}")

        status, admin_list = call("GET", "/admin/attendance?include_deleted=true", admin)
        admin_ids = {row["id"] for row in admin_list.get("items", [])}
        check("Super admin vẫn thấy bản ghi đã xoá mềm", event_id in admin_ids)

        status, _ = call("POST", f"/admin/attendance/{event_id}/restore", admin)
        check("Super admin khôi phục được bản ghi", status == 200, f"HTTP {status}")

        status, listing = call("GET", "/manager/attendance", manager)
        check("Sau khôi phục, manager lại thấy bản ghi",
              event_id in {row["id"] for row in listing.get("items", [])})

        status, _ = call("DELETE", f"/admin/attendance/{event_id}?reason=xoa%20han", admin)
        check("Super admin xoá vĩnh viễn được", status == 200, f"HTTP {status}")
        with psycopg.connect(DATABASE_URL) as connection:
            gone = connection.execute(
                "SELECT 1 FROM attendance_events WHERE id = %s", (event_id,)
            ).fetchone()
        check("Bản ghi thực sự biến mất khỏi cơ sở dữ liệu", gone is None)

        # --- admin manages accounts ------------------------------------------
        status, _ = call("PUT", f"/admin/users/{member_id}", admin, {"status": "SUSPENDED"})
        check("Super admin khoá được tài khoản", status == 200, f"HTTP {status}")
        status, _ = call("GET", "/auth/me", member)
        check("Tài khoản bị khoá mất phiên ngay lập tức", status == 401, f"HTTP {status}")

        status, _ = call("PUT", f"/admin/users/{member_id}", admin, {"status": "ACTIVE", "role": "MANAGER"})
        check("Super admin đổi được vai trò", status == 200, f"HTTP {status}")

        with psycopg.connect(DATABASE_URL) as connection:
            admin_id = connection.execute(
                "SELECT id FROM users WHERE email = %s", (admin_email,)
            ).fetchone()[0]
        status, payload = call("PUT", f"/admin/users/{admin_id}", admin, {"role": "MEMBER"})
        detail = payload.get("detail") if isinstance(payload, dict) else ""
        check("Không tự hạ quyền chính mình được", status == 409, f"HTTP {status} {detail}")

        status, _ = call("DELETE", f"/admin/users/{admin_id}?reason=thu", admin)
        check("Không tự xoá chính mình được", status == 409, f"HTTP {status}")

        return 0 if all(passed for passed, _, _ in results) else 1
    finally:
        if created:
            cleanup(created)
        print()
        passed = sum(1 for ok, _, _ in results if ok)
        print(f"{passed}/{len(results)} passed")


if __name__ == "__main__":
    sys.exit(main())
