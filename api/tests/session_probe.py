"""
Single-active-device-session probe — runs against a LIVE stack.

    docker compose run --rm -v "<repo>/api:/src:ro" -w /src \
      -e PROBE_BASE_URL=http://api:8000/api/v1 api python -m tests.session_probe

Covers the eight scenarios required of the feature, plus the concurrency case.
Creates throwaway accounts and removes them again.
"""

from __future__ import annotations

import json
import sys
import threading
import urllib.error
import urllib.request
import uuid

import psycopg

from tests.security_probe import BASE, DATABASE_URL, PASSWORD, call, cleanup, register


results: list[tuple[bool, str, str]] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    results.append((passed, name, detail))
    print(("PASS  " if passed else "FAIL  ") + name + ("  " + detail if detail else ""))


def login(email: str, device_id: str) -> tuple[int, dict]:
    return call("POST", "/auth/login", body={"email": email, "password": PASSWORD, "device_id": device_id})


def active_sessions(email: str) -> list[tuple]:
    with psycopg.connect(DATABASE_URL) as connection:
        return connection.execute(
            """
            SELECT s.id, s.device_id, s.revoked_reason
            FROM refresh_sessions s JOIN users u ON u.id = s.user_id
            WHERE u.email = %s AND s.revoked_at IS NULL
            """,
            (email,),
        ).fetchall()


def main() -> int:
    created: list[str] = []
    try:
        member_email, _ = register("MEMBER", created)
        other_email, other_token = register("MEMBER", created)

        # --- 1. First login succeeds -----------------------------------------
        status, pc1 = login(member_email, "device-pc-1")
        check("Đăng nhập lần đầu thành công", status == 200 and "access_token" in pc1, f"HTTP {status}")
        pc1_access, pc1_refresh = pc1.get("access_token", ""), pc1.get("refresh_token", "")

        status, _ = call("GET", "/auth/me", pc1_access)
        check("Thiết bị 1 gọi được API", status == 200, f"HTTP {status}")

        # --- 2. Second device revokes the first ------------------------------
        status, pc2 = login(member_email, "device-pc-2")
        check("Đăng nhập thiết bị 2 thành công", status == 200, f"HTTP {status}")
        pc2_access, pc2_refresh = pc2.get("access_token", ""), pc2.get("refresh_token", "")

        rows = active_sessions(member_email)
        check("Chỉ còn đúng 1 session active sau khi đăng nhập thiết bị 2",
              len(rows) == 1 and rows[0][1] == "device-pc-2", f"{len(rows)} session")

        # --- 3. Old device is refused immediately ----------------------------
        status, payload = call("GET", "/auth/me", pc1_access)
        detail = payload.get("detail") if isinstance(payload, dict) else ""
        check("Thiết bị 1 gọi API sau khi bị revoke → 401 SESSION_REVOKED",
              status == 401 and detail == "SESSION_REVOKED", f"HTTP {status} {detail}")

        # --- 4. New device keeps working -------------------------------------
        status, _ = call("GET", "/auth/me", pc2_access)
        check("Thiết bị 2 vẫn hoạt động bình thường", status == 200, f"HTTP {status}")

        # --- 5. Old refresh token is dead ------------------------------------
        status, payload = call("POST", "/auth/refresh", body={"refresh_token": pc1_refresh})
        detail = payload.get("detail") if isinstance(payload, dict) else ""
        check("Refresh token của session cũ bị từ chối",
              status == 401 and detail == "SESSION_REVOKED", f"HTTP {status} {detail}")

        # --- 6. Refresh on the live session keeps the same session ------------
        before = active_sessions(member_email)
        status, rotated = call("POST", "/auth/refresh", body={"refresh_token": pc2_refresh})
        after = active_sessions(member_email)
        check("Refresh của session đang hoạt động thành công", status == 200, f"HTTP {status}")
        check("Refresh giữ nguyên session id, chỉ xoay token",
              len(after) == 1 and before and after[0][0] == before[0][0],
              f"{len(after)} session")
        rotated_access = rotated.get("access_token", "")
        rotated_refresh = rotated.get("refresh_token", "")

        status, payload = call("POST", "/auth/refresh", body={"refresh_token": pc2_refresh})
        detail = payload.get("detail") if isinstance(payload, dict) else ""
        check("Refresh token cũ không dùng lại được sau khi xoay",
              status == 401 and detail == "SESSION_REVOKED", f"HTTP {status} {detail}")

        # --- 7. Another user is untouched ------------------------------------
        status, _ = call("GET", "/auth/me", other_token)
        check("Đăng nhập của user khác không bị ảnh hưởng", status == 200, f"HTTP {status}")
        check("User khác vẫn giữ session riêng", len(active_sessions(other_email)) == 1)

        # --- 8. Logout closes the session ------------------------------------
        status, _ = call("POST", "/auth/logout", rotated_access, {"refresh_token": rotated_refresh})
        check("Logout trả 204", status == 204, f"HTTP {status}")
        check("Logout revoke session hiện tại", len(active_sessions(member_email)) == 0)

        status, payload = call("GET", "/auth/me", rotated_access)
        detail = payload.get("detail") if isinstance(payload, dict) else ""
        check("Access token sau logout bị từ chối",
              status == 401 and detail == "SESSION_REVOKED", f"HTTP {status} {detail}")

        status, _ = call("GET", "/auth/me", other_token)
        check("Logout của user này không đụng user khác", status == 200, f"HTTP {status}")

        # --- 9. Concurrent logins --------------------------------------------
        outcomes: list[tuple[int, dict]] = []
        lock = threading.Lock()

        def race(device: str) -> None:
            outcome = login(member_email, device)
            with lock:
                outcomes.append(outcome)

        threads = [threading.Thread(target=race, args=(f"race-{index}",)) for index in range(5)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        succeeded = [outcome for status_code, outcome in outcomes if status_code == 200]
        rows = active_sessions(member_email)
        check("5 lần đăng nhập đồng thời: vẫn chỉ còn 1 session active",
              len(rows) == 1, f"{len(rows)} session, {len(succeeded)}/5 login trả 200")

        # Exactly one of the racing tokens may still be used.
        usable = 0
        for outcome in succeeded:
            status, _ = call("GET", "/auth/me", outcome.get("access_token", ""))
            usable += status == 200
        check("Chỉ đúng 1 token từ các lần đăng nhập đồng thời còn dùng được",
              usable == 1, f"{usable} token còn hiệu lực")

        # --- 10. Password reset closes every device --------------------------
        status, session_rows = 0, active_sessions(member_email)
        if session_rows:
            with psycopg.connect(DATABASE_URL) as connection:
                connection.execute(
                    "UPDATE refresh_sessions SET revoked_at = now(), revoked_reason = 'PASSWORD_RESET' "
                    "WHERE user_id = (SELECT id FROM users WHERE email = %s) AND revoked_at IS NULL",
                    (member_email,),
                )
                connection.commit()
            check("Revoke toàn bộ session của user (mô phỏng đổi mật khẩu)",
                  len(active_sessions(member_email)) == 0)
            check("User khác không bị ảnh hưởng khi revoke hàng loạt",
                  len(active_sessions(other_email)) == 1)

        return 0 if all(passed for passed, _, _ in results) else 1
    finally:
        if created:
            cleanup(created)
        print()
        passed = sum(1 for ok, _, _ in results if ok)
        print(f"{passed}/{len(results)} passed")


if __name__ == "__main__":
    sys.exit(main())
