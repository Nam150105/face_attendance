"""
Đăng nhập rồi thì ở lại: một trang bắn năm request cùng lúc đúng lúc access
token hết hạn không được biến thành một lần đăng xuất. Chạy trên LIVE stack.

    docker compose run --rm -v "<repo>/api:/src:ro" -w /src \
      -e PROBE_BASE_URL=http://api:8000/api/v1 api python -m tests.stay_signed_in_probe
"""

from __future__ import annotations

import sys
from concurrent.futures import ThreadPoolExecutor

import psycopg

from tests.security_probe import DATABASE_URL, PASSWORD, call, cleanup, register

results: list[tuple[bool, str, str]] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    results.append((passed, name, detail))
    print(("PASS  " if passed else "FAIL  ") + name + ("  " + detail if detail else ""))


def main() -> int:
    created: list[str] = []
    try:
        email, _ = register("MEMBER", created)
        status, tokens = call("POST", "/auth/login", body={"email": email, "password": PASSWORD})
        refresh = tokens["refresh_token"]

        # --- 1. Five refreshes at once, all with the same secret --------------
        # Exactly what a page does the instant its access token lapses: the
        # shell, the page, the avatar and two more all get a 401 and all reach
        # for the refresh endpoint together.
        with ThreadPoolExecutor(max_workers=5) as pool:
            outcomes = list(pool.map(
                lambda _: call("POST", "/auth/refresh", body={"refresh_token": refresh}), range(5)
            ))
        statuses = [status for status, _ in outcomes]
        check("Năm refresh song song cùng một secret đều được nhận",
              statuses.count(200) == 5, str(statuses))

        with psycopg.connect(DATABASE_URL) as connection:
            sessions = connection.execute(
                "SELECT count(*) FROM refresh_sessions s JOIN users u ON u.id = s.user_id"
                " WHERE u.email = %s AND s.revoked_at IS NULL",
                (email,),
            ).fetchone()[0]
        check("Vẫn đúng một phiên, không nhân bản", sessions == 1, f"{sessions} phiên")

        # Every pair handed back is usable, whichever one the browser ends up
        # storing last.
        usable = 0
        for status, pair in outcomes:
            if status == 200:
                me_status, _ = call("GET", "/auth/me", pair["access_token"])
                usable += me_status == 200
        check("Mọi access token trả về đều dùng được", usable == 5, f"{usable}/5")

        # --- 2. The last pair issued keeps working afterwards -------------------
        latest = outcomes[-1][1]
        status, again = call("POST", "/auth/refresh", body={"refresh_token": latest["refresh_token"]})
        check("Refresh tiếp bằng cặp mới nhất vẫn thành công", status == 200, f"HTTP {status}")

        # --- 3. A genuinely dead secret is still dead ----------------------------
        with psycopg.connect(DATABASE_URL) as connection:
            connection.execute(
                "UPDATE refresh_sessions SET rotated_at = now() - interval '10 minutes'"
                " WHERE user_id = (SELECT id FROM users WHERE email = %s)",
                (email,),
            )
            connection.commit()
        status, payload = call("POST", "/auth/refresh", body={"refresh_token": refresh})
        check("Secret đã xoay từ lâu bị từ chối như thường",
              status == 401 and payload.get("detail") == "SESSION_REVOKED",
              f"HTTP {status} {payload.get('detail')}")

        # --- 4. Logging out ends it for real -------------------------------------
        status, _ = call("POST", "/auth/logout", again["access_token"], {"refresh_token": again["refresh_token"]})
        status, payload = call("POST", "/auth/refresh", body={"refresh_token": again["refresh_token"]})
        check("Đăng xuất rồi thì refresh không sống lại", status == 401, f"HTTP {status}")
    finally:
        cleanup(created)

    passed = sum(1 for ok, _, _ in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
