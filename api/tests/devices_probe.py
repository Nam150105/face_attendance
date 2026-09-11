"""
One device or many, per role, decided by the system administrator.

    docker compose run --rm -v "<repo>/api:/src:ro" -w /src \
      -e PROBE_BASE_URL=http://api:8000/api/v1 api python -m tests.devices_probe

The probe puts every policy back the way it found it, including when an
assertion fails, so running it never changes how the deployment behaves.
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
    email = f"probe-admin-{uuid.uuid4().hex[:10]}@example.com"
    created.append(email)
    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute(
            "INSERT INTO users (email, password_hash, role, status, email_verified_at)"
            " VALUES (%s, %s, 'SUPER_ADMIN', 'ACTIVE', now())",
            (email, CryptContext(schemes=["bcrypt"]).hash(PASSWORD)),
        )
        connection.commit()
    return call("POST", "/auth/login", body={"email": email, "password": PASSWORD})[1]["access_token"]


def sign_in(email: str) -> str:
    status, payload = call("POST", "/auth/login", body={"email": email, "password": PASSWORD})
    if status != 200:
        raise SystemExit(f"cannot sign in as {email}: {status} {payload}")
    return payload["access_token"]


def policy_of(rows: list[dict], role: str) -> bool:
    return next(row["allow_multiple_devices"] for row in rows if row["role"] == role)


def main() -> int:
    created: list[str] = []
    admin = make_admin(created)
    before = call("GET", "/admin/session-policy", admin)[1]
    try:
        member_email, _ = register("MEMBER", created)

        # --- 1. Reading the policy ---------------------------------------------
        status, rows = call("GET", "/admin/session-policy", admin)
        check("Quản trị hệ thống đọc được chính sách của cả ba vai trò",
              status == 200 and {row["role"] for row in rows} == {"MEMBER", "MANAGER", "SUPER_ADMIN"},
              f"HTTP {status}")

        status, refused = call("GET", "/admin/session-policy", sign_in(member_email))
        check("Thành viên không đọc được", status == 403, f"HTTP {status}")

        # --- 2. One device: the second login pushes the first out --------------
        status, _ = call("PUT", "/admin/session-policy", admin,
                         {"role": "MEMBER", "allow_multiple_devices": False})
        check("Bật giới hạn một thiết bị cho thành viên", status == 200, f"HTTP {status}")

        first = sign_in(member_email)
        status, _ = call("GET", "/members/me", first)
        check("Phiên đầu dùng được", status == 200, f"HTTP {status}")

        second = sign_in(member_email)
        status, _ = call("GET", "/members/me", first)
        check("Đăng nhập máy thứ hai thì máy thứ nhất bị đẩy ra", status == 401, f"HTTP {status}")
        status, _ = call("GET", "/members/me", second)
        check("Máy thứ hai vẫn dùng bình thường", status == 200, f"HTTP {status}")

        # --- 3. Many devices: both stay signed in ------------------------------
        status, _ = call("PUT", "/admin/session-policy", admin,
                         {"role": "MEMBER", "allow_multiple_devices": True})
        check("Chuyển sang cho phép nhiều thiết bị", status == 200, f"HTTP {status}")

        third = sign_in(member_email)
        fourth = sign_in(member_email)
        status_third, _ = call("GET", "/members/me", third)
        status_fourth, _ = call("GET", "/members/me", fourth)
        check("Hai phiên cùng sống được",
              status_third == 200 and status_fourth == 200,
              f"HTTP {status_third} / {status_fourth}")

        # --- 3b. Many is not unlimited: the stalest device is retired ----------
        # Ten more logins on top of the two above: the oldest ones must go, the
        # newest ten stay, and the count never exceeds the ceiling.
        for _ in range(10):
            sign_in(member_email)
        with psycopg.connect(DATABASE_URL) as connection:
            open_sessions = connection.execute(
                "SELECT count(*) FROM refresh_sessions s JOIN users u ON u.id = s.user_id"
                " WHERE u.email = %s AND s.revoked_at IS NULL",
                (member_email,),
            ).fetchone()[0]
            retired = connection.execute(
                "SELECT count(*) FROM refresh_sessions s JOIN users u ON u.id = s.user_id"
                " WHERE u.email = %s AND s.revoked_reason = 'DEVICE_LIMIT'",
                (member_email,),
            ).fetchone()[0]
        check("Nhiều thiết bị vẫn có trần: giữ đúng 10 phiên mới nhất",
              open_sessions == 10, f"{open_sessions} phiên đang mở")
        status_third, _ = call("GET", "/members/me", third)
        check("Phiên cũ nhất bị thu hồi, không phải phiên đang dùng",
              status_third == 401 and retired >= 2, f"HTTP {status_third}, {retired} phiên thu hồi")
        fourth = sign_in(member_email)

        # --- 4. Turning it back on closes the extra session now ----------------
        status, summary = call("PUT", "/admin/session-policy", admin,
                               {"role": "MEMBER", "allow_multiple_devices": False})
        check("Bật lại thì đóng luôn phiên thừa, không đợi lần đăng nhập sau",
              status == 200 and summary.get("sessions_closed", 0) >= 1,
              f"{summary.get('sessions_closed')} phiên")
        status_third, _ = call("GET", "/members/me", third)
        status_fourth, _ = call("GET", "/members/me", fourth)
        check("Phiên cũ mất, phiên mới nhất được giữ lại",
              status_third == 401 and status_fourth == 200,
              f"HTTP {status_third} / {status_fourth}")

        # --- 5. The database is the backstop -----------------------------------
        with psycopg.connect(DATABASE_URL) as connection:
            member_id = connection.execute(
                "SELECT id FROM users WHERE email = %s", (member_email,)
            ).fetchone()[0]
            try:
                connection.execute(
                    "INSERT INTO refresh_sessions (id, user_id, token_hash, expires_at,"
                    " enforce_single_session) VALUES (%s, %s, %s, now() + interval '1 day', true)",
                    (uuid.uuid4(), member_id, "probe-" + uuid.uuid4().hex),
                )
                connection.commit()
                refused_by_db = False
            except psycopg.errors.UniqueViolation:
                connection.rollback()
                refused_by_db = True
        check("Cơ sở dữ liệu chặn phiên thứ hai, không chỉ dựa vào kiểm ở ứng dụng", refused_by_db)

        status, _ = call("PUT", "/admin/session-policy", admin, {"role": "NOBODY", "allow_multiple_devices": True})
        check("Vai trò lạ bị từ chối", status == 422, f"HTTP {status}")
    finally:
        # Put every policy back, whatever happened above.
        for row in before:
            call("PUT", "/admin/session-policy", admin,
                 {"role": row["role"], "allow_multiple_devices": row["allow_multiple_devices"]})
        cleanup(created)

    passed = sum(1 for ok, _, _ in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
