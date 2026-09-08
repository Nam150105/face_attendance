"""
What an end user can actually do for themselves — runs against a LIVE stack.

    docker compose run --rm -v "<repo>/api:/src:ro" -w /src \
      -e PROBE_BASE_URL=http://api:8000/api/v1 api python -m tests.portal_probe
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


def make_admin(created: list[str]) -> str:
    email = f"probe-portal-{uuid.uuid4().hex[:8]}@example.com"
    created.append(email)
    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute(
            "INSERT INTO users (email, password_hash, role, status, email_verified_at)"
            " VALUES (%s, %s, 'SUPER_ADMIN', 'ACTIVE', now())",
            (email, CryptContext(schemes=["bcrypt"]).hash(PASSWORD)),
        )
        connection.commit()
    return call("POST", "/auth/login", body={"email": email, "password": PASSWORD})[1]["access_token"]


def main() -> int:
    created: list[str] = []
    try:
        admin = make_admin(created)
        manager_email, manager = register("MANAGER", created)
        member_email, member = register("MEMBER", created)
        call("POST", "/manager/members/add-by-email", manager, {"email": member_email})

        # --- 1. A member can find out who to ask ------------------------------
        call("PUT", "/members/me", manager, {
            "full_name": "Trần Quản Lý", "phone": "0900111222",
            "position": "Trưởng nhóm", "department": "Vận hành",
        })
        status, contacts = call("GET", "/members/me/managers", member)
        check("Thành viên xem được người quản lý của mình",
              status == 200 and len(contacts) == 1, f"HTTP {status} {len(contacts) if isinstance(contacts, list) else contacts}")
        if isinstance(contacts, list) and contacts:
            person = contacts[0]
            check("Có tên, email và số điện thoại để liên hệ",
                  person.get("full_name") == "Trần Quản Lý" and person.get("email") == manager_email
                  and person.get("phone") == "0900111222",
                  f"{person.get('full_name')} · {person.get('phone')}")
            check("Có chức danh và đơn vị",
                  person.get("position") == "Trưởng nhóm" and person.get("department") == "Vận hành")

        status, none_yet = call("GET", "/members/me/managers", manager)
        check("Người chưa có quản lý thì nhận danh sách rỗng, không lỗi",
              status == 200 and none_yet == [], f"HTTP {status}")

        # --- 2. Changing a password -------------------------------------------
        status, _ = call("POST", "/auth/change-password", member,
                         {"current_password": "SaiMatKhau123!", "new_password": "MatKhauMoi123!"})
        check("Sai mật khẩu hiện tại thì không đổi được", status == 403, f"HTTP {status}")

        status, _ = call("POST", "/auth/change-password", member,
                         {"current_password": PASSWORD, "new_password": PASSWORD})
        check("Mật khẩu mới trùng mật khẩu cũ bị từ chối", status == 422, f"HTTP {status}")

        status, _ = call("POST", "/auth/change-password", member,
                         {"current_password": PASSWORD, "new_password": "abc"})
        check("Mật khẩu mới quá yếu bị từ chối", status == 422, f"HTTP {status}")

        status, _ = call("POST", "/auth/change-password", member,
                         {"current_password": PASSWORD, "new_password": "MatKhauMoi123!"})
        check("Đổi được mật khẩu khi nhập đúng mật khẩu cũ", status == 204, f"HTTP {status}")

        status, _ = call("GET", "/members/me", member)
        check("Đổi mật khẩu xong thì phiên cũ hết hiệu lực ngay", status == 401, f"HTTP {status}")

        status, fresh = call("POST", "/auth/login",
                             body={"email": member_email, "password": "MatKhauMoi123!"})
        check("Đăng nhập lại được bằng mật khẩu mới", status == 200, f"HTTP {status}")
        member = fresh.get("access_token", "")

        status, _ = call("POST", "/auth/login", body={"email": member_email, "password": PASSWORD})
        check("Mật khẩu cũ không còn dùng được", status == 401, f"HTTP {status}")

        # --- 3. Failures come back as a code, not as internals -----------------
        status, payload = call("GET", "/manager/attendance/calendar?month=2026-13", manager)
        check("Tham số sai vẫn là lỗi người dùng, không sinh mã sự cố",
              status == 422 and "error_code" not in payload, f"HTTP {status}")

        status, errors = call("GET", "/admin/errors", admin)
        check("Quản trị mở được danh sách sự cố", status == 200, f"HTTP {status}")

        status, _ = call("GET", "/admin/errors", manager)
        check("Người quản lý không xem được danh sách sự cố", status == 403, f"HTTP {status}")

        # A code that does not exist must come back empty, not error.
        status, empty = call("GET", "/admin/errors?search=KHONGCO", admin)
        check("Tìm mã không tồn tại thì trả rỗng", status == 200 and empty.get("total") == 0,
              f"HTTP {status} {empty.get('total')}")

        # --- 4. A member never sees somebody else's contact list --------------
        status, _ = call("GET", f"/manager/members/{uuid.uuid4()}", member)
        check("Thành viên không đọc được hồ sơ người khác qua đường quản lý",
              status in (403, 404), f"HTTP {status}")
    finally:
        cleanup(created)

    passed = sum(1 for ok, _, _ in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
