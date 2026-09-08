"""
Screen permissions, login history, evidence photos and the row editor.
Runs against a LIVE stack.

    docker compose run --rm -v "<repo>/api:/src:ro" -w /src \
      -e PROBE_BASE_URL=http://api:8000/api/v1 api python -m tests.rbac_probe
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
    email = f"probe-rbac-{uuid.uuid4().hex[:10]}@example.com"
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


def grant(admin: str, role: str, screen: str, can_view: bool) -> int:
    status, _ = call("PUT", "/admin/permissions", admin,
                     {"role": role, "screen": screen, "can_view": can_view})
    return status


def seed_event(member_id: str, location_id: str) -> str:
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            """
            INSERT INTO attendance_events
                (member_id, location_id, event_type, status, server_time, latitude, longitude,
                 gps_accuracy_meters, distance_meters, idempotency_key)
            VALUES (%s, %s, 'CHECK_IN', 'SUCCESS', now(), 21, 105.8, 5, 10, %s)
            RETURNING id
            """,
            (member_id, location_id, "rbac-" + uuid.uuid4().hex),
        ).fetchone()
        connection.commit()
    return str(row[0])


def main() -> int:
    created: list[str] = []
    restore: list[tuple[str, str, bool]] = []
    try:
        admin_email, admin = make_admin(created)
        manager_email, manager = register("MANAGER", created)
        member_email, member = register("MEMBER", created)
        other_email, other_member = register("MEMBER", created)
        call("POST", "/manager/members/add-by-email", manager, {"email": member_email})
        call("POST", "/manager/members/add-by-email", manager, {"email": other_email})

        status, roster = call("GET", "/manager/members", manager)
        ids = {row["email"]: row["user_id"] for row in roster} if isinstance(roster, list) else {}
        member_id, other_id = ids.get(member_email), ids.get(other_email)

        status, location = call("POST", "/manager/locations", manager, {
            "name": "RBAC probe", "address": None, "latitude": 21.0, "longitude": 105.8,
            "allow_radius_meters": 500, "warning_radius_meters": 900, "is_active": True,
        })
        location_id = location.get("id") if status == 201 else None
        if not (member_id and other_id and location_id):
            print("cannot set up fixtures", status, location, ids)
            return 1

        # --- 1. The sidebar comes from the permission table -------------------
        status, screens = call("GET", "/auth/me/screens", member)
        member_screens = set(screens.get("screens", []))
        check("Thành viên nhận đúng danh sách màn hình mặc định",
              status == 200 and "history" in member_screens and "records" not in member_screens,
              f"{len(member_screens)} màn hình")

        status, screens = call("GET", "/auth/me/screens", manager)
        check("Người quản lý thấy thêm các màn hình quản lý",
              "records" in screens.get("screens", []) and "admin-users" not in screens.get("screens", []))

        status, screens = call("GET", "/auth/me/screens", admin)
        check("Quản trị hệ thống thấy mọi màn hình", len(screens.get("screens", [])) == 18,
              f"{len(screens.get('screens', []))} màn hình")

        # --- 2. A screen nobody granted stays shut ----------------------------
        status, payload = call("GET", "/manager/attendance", member)
        check("Thành viên chưa được cấp thì không mở được màn hình bản ghi",
              status == 403 and payload.get("detail") == "SCREEN_NOT_ALLOWED", f"HTTP {status}")

        # --- 3. Granting really opens it, and data stays scoped ---------------
        own_event = seed_event(member_id, location_id)
        other_event = seed_event(other_id, location_id)
        restore.append(("MEMBER", "records", False))
        check("Admin cấp được quyền xem bản ghi cho thành viên",
              grant(admin, "MEMBER", "records", True) == 200)

        status, listing = call("GET", "/manager/attendance", member)
        seen = {row["id"] for row in listing.get("items", [])} if isinstance(listing, dict) else set()
        check("Được cấp quyền thì vào được màn hình bản ghi", status == 200, f"HTTP {status}")
        check("Nhưng chỉ thấy bản ghi của chính mình",
              own_event in seen and other_event not in seen, f"{len(seen)} bản ghi")

        status, _ = call("GET", f"/manager/attendance/{other_event}", member)
        check("Mở thẳng bản ghi người khác bằng id vẫn bị chặn", status == 404, f"HTTP {status}")

        status, calendar = call("GET", "/manager/attendance/calendar?month=" + _this_month(), member)
        people = [p for day in calendar.get("days", []) for p in day.get("people", [])]
        check("Lịch của thành viên cũng chỉ có mình họ",
              status == 200 and all(str(p["member_id"]) == member_id for p in people),
              f"{len(people)} dòng")

        # --- 4. Revoking closes it again --------------------------------------
        restore.append(("MANAGER", "audit", True))
        grant(admin, "MANAGER", "audit", False)
        status, payload = call("GET", "/manager/audit-logs", manager)
        check("Bỏ tick là người quản lý mất luôn màn hình nhật ký",
              status == 403 and payload.get("detail") == "SCREEN_NOT_ALLOWED", f"HTTP {status}")
        grant(admin, "MANAGER", "audit", True)
        status, _ = call("GET", "/manager/audit-logs", manager)
        check("Tick lại thì vào được ngay", status == 200, f"HTTP {status}")

        # --- 5. Admin cannot lock itself out ----------------------------------
        status, payload = call("PUT", "/admin/permissions", admin,
                               {"role": "SUPER_ADMIN", "screen": "admin-roles", "can_view": False})
        check("Không tự khoá mình khỏi trang phân quyền được",
              status == 409 and payload.get("detail") == "SCREEN_LOCKED_FOR_SUPER_ADMIN", f"HTTP {status}")

        status, _ = call("PUT", "/admin/permissions", admin,
                         {"role": "MANAGER", "screen": "khong-co-that", "can_view": True})
        check("Màn hình không tồn tại bị từ chối", status == 422, f"HTTP {status}")

        status, _ = call("GET", "/admin/permissions", manager)
        check("Người quản lý không sửa được bảng phân quyền", status == 403, f"HTTP {status}")

        # --- 6. Login history --------------------------------------------------
        call("POST", "/auth/login", body={"email": member_email, "password": "SaiMatKhau123!"})
        status, history = call("GET", f"/manager/members/{member_id}/login-history", manager)
        outcomes = [row["outcome"] for row in history.get("items", [])]
        check("Người quản lý xem được lịch sử đăng nhập của thành viên",
              status == 200 and "BAD_PASSWORD" in outcomes and "SUCCESS" in outcomes,
              ", ".join(outcomes[:4]))
        check("Lịch sử không lộ mật khẩu hay token",
              all(not any(key in str(row) for key in ("password", "token", "hash"))
                  for row in history.get("items", [])))

        status, _ = call("GET", f"/manager/members/{other_id}/login-history", member)
        check("Thành viên không xem được lịch sử đăng nhập của người khác", status == 404, f"HTTP {status}")

        # --- 7. Evidence photos -------------------------------------------------
        status, payload = call("GET", f"/manager/members/{member_id}/face-photo", manager)
        check("Chưa đăng ký khuôn mặt thì báo thiếu ảnh, không vỡ",
              status == 404 and payload.get("detail") == "ENROLLMENT_PHOTO_MISSING", f"HTTP {status}")

        status, _ = call("GET", f"/manager/members/{other_id}/face-photo", member)
        check("Không lấy được ảnh khuôn mặt của người ngoài phạm vi", status == 404, f"HTTP {status}")

        # --- 8. A manager checks in like anybody else --------------------------
        status, _ = call("POST", "/faces/enrollment/start", manager)
        check("Người quản lý đăng ký được khuôn mặt để tự chấm công", status == 201, f"HTTP {status}")

        status, _ = call("POST", "/faces/enrollment/start", admin)
        check("Tài khoản quản trị hệ thống không đăng ký khuôn mặt", status == 403, f"HTTP {status}")

        manager_id = _user_id(manager_email)
        status, _ = call("POST", f"/manager/members/{manager_id}/locations", manager,
                         {"location_id": location_id, "is_default": True})
        check("Người quản lý tự gắn mình vào địa điểm của chính mình", status == 200, f"HTTP {status}")

        manager_event = seed_event(manager_id, location_id)
        status, listing = call("GET", "/manager/attendance", manager)
        seen = {row["id"] for row in listing.get("items", [])} if isinstance(listing, dict) else set()
        check("Bản ghi của chính người quản lý nằm trong danh sách của họ", manager_event in seen)

        # --- 9. The row editor --------------------------------------------------
        status, tables = call("GET", "/admin/data", admin)
        names = {row["name"] for row in tables.get("tables", [])}
        check("Liệt kê được các bảng sửa được", status == 200 and "users" in names, f"{len(names)} bảng")

        status, browsed = call("GET", "/admin/data/users?limit=5", admin)
        columns = {column["name"] for column in browsed.get("columns", [])}
        check("Duyệt được dòng trong bảng", status == 200 and len(browsed.get("items", [])) > 0)
        check("Không bao giờ trả hash mật khẩu ra ngoài", "password_hash" not in columns,
              ", ".join(sorted(columns)))

        status, _ = call("GET", "/admin/data/alembic_version", admin)
        check("Bảng ngoài danh sách cho phép bị từ chối", status == 404, f"HTTP {status}")

        status, _ = call("GET", "/admin/data/users", manager)
        check("Người quản lý không chạm được vào trình duyệt dữ liệu", status == 403, f"HTTP {status}")

        status, created_row = call("POST", "/admin/data/notifications", admin, {"values": {
            "user_id": member_id, "category": "SYSTEM", "title": "Probe", "body": "rbac probe",
        }})
        row_id = created_row.get("id") if status == 201 else None
        check("Thêm được dòng mới", status == 201 and row_id is not None, f"HTTP {status} {created_row}")

        if row_id:
            status, updated = call("PUT", f"/admin/data/notifications/{row_id}", admin,
                                   {"values": {"title": "Probe đã sửa"}})
            check("Sửa được dòng", status == 200 and updated.get("title") == "Probe đã sửa", f"HTTP {status}")

            status, _ = call("PUT", f"/admin/data/notifications/{row_id}", admin,
                             {"values": {"id": str(uuid.uuid4())}})
            check("Không sửa được cột chỉ đọc", status == 422, f"HTTP {status}")

            status, _ = call("DELETE", f"/admin/data/notifications/{row_id}", admin)
            check("Xoá được dòng", status == 200, f"HTTP {status}")

        status, payload = call("DELETE", f"/admin/data/users/{member_id}", admin)
        check("Xoá tài khoản qua trình duyệt bảng bị chặn, phải dùng đường có dọn dẹp",
              status == 409 and payload.get("detail") == "USE_USER_DELETE_INSTEAD", f"HTTP {status}")

        status, payload = call("PUT", f"/admin/data/users/{member_id}", admin,
                               {"values": {"email": manager_email}})
        check("Ràng buộc của cơ sở dữ liệu được nói lại thành lời, không vỡ 500",
              status == 422 and "duplicate" in str(payload.get("detail", "")).lower(),
              f"HTTP {status} {payload.get('detail')}")

        # A manager's audit screen only shows their own actions, so the admin's
        # row edits are checked where the admin can actually see them.
        status, logs = call("GET", "/admin/data/audit_logs?limit=20", admin)
        actions = {row.get("action") for row in logs.get("items", [])}
        check("Mọi thao tác sửa dòng đều vào nhật ký",
              status == 200 and {"ROW_INSERTED", "ROW_UPDATED", "ROW_DELETED"} <= actions,
              ", ".join(sorted(a for a in actions if a and a.startswith("ROW"))) or "không thấy")

        status, logs = call("GET", "/manager/audit-logs", manager)
        foreign = [row for row in logs.get("items", []) if row.get("action", "").startswith("ROW_")]
        check("Nhật ký của người quản lý không lẫn thao tác của quản trị hệ thống",
              status == 200 and not foreign, f"{len(foreign)} dòng lạ")

        # --- 10. Deleting an account still works now that two new tables ------
        #         point at users. A missed foreign key here means the delete
        #         path breaks for everybody, not just this probe.
        spare_email, spare_token = register("MEMBER", created)
        spare_id = _user_id(spare_email)
        call("POST", "/auth/login", body={"email": spare_email, "password": PASSWORD})
        grant(admin, "MANAGER", "audit", True)  # writes role_permissions.updated_by = admin

        status, _ = call("DELETE", f"/admin/users/{spare_id}?reason=probe+cleanup", admin)
        check("Xoá tài khoản có lịch sử đăng nhập vẫn chạy", status == 200, f"HTTP {status}")

        status, permissions = call("GET", "/admin/permissions", admin)
        check("Bảng phân quyền không bị mất dòng nào sau khi xoá tài khoản",
              status == 200 and len(permissions.get("roles", {}).get("MANAGER", {})) == 18,
              f"{len(permissions.get('roles', {}).get('MANAGER', {}))} dòng")

        call("DELETE", f"/manager/locations/{location_id}/permanent", manager)
    finally:
        for role, screen, value in restore:
            try:
                grant(admin, role, screen, value)
            except Exception:
                pass
        cleanup(created)

    passed = sum(1 for ok, _, _ in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


def _this_month() -> str:
    from datetime import date
    return date.today().strftime("%Y-%m")


def _user_id(email: str) -> str:
    with psycopg.connect(DATABASE_URL) as connection:
        return str(connection.execute("SELECT id FROM users WHERE email = %s", (email,)).fetchone()[0])


if __name__ == "__main__":
    sys.exit(main())
