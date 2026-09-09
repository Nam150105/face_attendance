"""
Two managers over one place each — and units that carry their own places.

A person belongs to one manager at a time, but records of theirs can sit at a
site belonging to somebody else: they moved units, or checked in at a place
that was later handed over. What each manager may read is decided by the site,
not by who happens to be on their roster today.
Runs against a LIVE stack.

    docker compose run --rm -v "<repo>/api:/src:ro" -w /src \
      -e PROBE_BASE_URL=http://api:8000/api/v1 api python -m tests.isolation_probe
"""

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timezone

import psycopg

from tests.security_probe import DATABASE_URL, PASSWORD, call, cleanup, register

results: list[tuple[bool, str, str]] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    results.append((passed, name, detail))
    print(("PASS  " if passed else "FAIL  ") + name + ("  " + detail if detail else ""))


def make_location(token: str, name: str) -> str:
    status, row = call("POST", "/manager/locations", token, {
        "name": name, "address": None, "latitude": 21.0, "longitude": 105.8,
        "allow_radius_meters": 500, "warning_radius_meters": 900, "is_active": True,
    })
    if status != 201:
        raise SystemExit(f"cannot create location: {status} {row}")
    return row["id"]


def seed(member_id: str, location_id: str, event_type: str = "CHECK_IN") -> str:
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            """
            INSERT INTO attendance_events
                (member_id, location_id, event_type, status, server_time, latitude, longitude,
                 gps_accuracy_meters, distance_meters, idempotency_key)
            VALUES (%s, %s, %s, 'SUCCESS', now(), 21, 105.8, 5, 10, %s)
            RETURNING id
            """,
            (member_id, location_id, event_type, "iso-" + uuid.uuid4().hex),
        ).fetchone()
        connection.commit()
    return str(row[0])


def main() -> int:
    created: list[str] = []
    try:
        alice_email, alice = register("MANAGER", created)
        bob_email, bob = register("MANAGER", created)
        member_email, member = register("MEMBER", created)

        call("POST", "/manager/members/add-by-email", alice, {"email": member_email})
        status, refused = call("POST", "/manager/members/add-by-email", bob, {"email": member_email})
        check("Người quản lý thứ hai không nhận được cùng một người",
              status == 409 and refused.get("detail") == "ALREADY_HAS_MANAGER",
              f"HTTP {status} {refused.get('detail')}")
        member_id = call("GET", "/manager/members", alice)[1][0]["user_id"]

        alice_place = make_location(alice, "Nơi của Alice")
        bob_place = make_location(bob, "Nơi của Bob")
        at_alice = seed(member_id, alice_place)
        at_bob = seed(member_id, bob_place)

        # --- 1. Each manager sees only their own site's records ---------------
        status, listing = call("GET", "/manager/attendance?include_invalid=true", alice)
        seen = {row["id"] for row in listing.get("items", [])}
        check("Người quản lý thấy lượt chấm tại địa điểm của mình",
              status == 200 and at_alice in seen, f"{len(seen)} bản ghi")
        check("Nhưng không thấy lượt tại địa điểm của người quản lý khác",
              at_bob not in seen, "vẫn thấy" if at_bob in seen else "")

        status, _ = call("GET", f"/manager/attendance/{at_bob}", alice)
        check("Mở thẳng bằng id cũng không được", status == 404, f"HTTP {status}")

        status, mirror = call("GET", "/manager/attendance?include_invalid=true", bob)
        mirror_ids = {row["id"] for row in mirror.get("items", [])}
        check("Chiều ngược lại cũng vậy",
              at_bob in mirror_ids and at_alice not in mirror_ids, f"{len(mirror_ids)} bản ghi")

        status, sessions = call(
            "GET", "/manager/attendance/sessions?include_invalid=true", alice
        )
        check("Bảng ngày công cũng chỉ tính phần của mình",
              status == 200 and sessions.get("total", 0) >= 1, str(sessions.get("total")))

        month = datetime.now(timezone.utc).strftime("%Y-%m")
        status, calendar = call(
            "GET", f"/manager/attendance/calendar?month={month}&include_invalid=true", bob
        )
        people = [p for day in calendar.get("days", []) for p in day.get("people", [])]
        check("Lịch của người quản lý không lẫn dữ liệu nơi khác",
              status == 200 and len(people) >= 1, f"{len(people)} dòng")

        # --- 2. The record is visible to the site owner, the person is not ----
        status, roster = call("GET", "/manager/members", bob)
        check("Chủ địa điểm không vì thế mà có người trong danh sách của mình",
              all(row["email"] != member_email for row in roster), f"{len(roster)} người")

        status, contacts = call("GET", "/members/me/managers", member)
        check("Thành viên chỉ có đúng một người quản lý",
              status == 200 and len(contacts) == 1, f"{len(contacts)} người")

        # --- 3. A unit carries its own places ---------------------------------
        status, team = call("POST", "/manager/teams", alice, {"name": "Ca sáng"})
        team_id = team["id"]
        status, attached = call("POST", f"/manager/teams/{team_id}/locations", alice,
                                {"location_id": alice_place, "is_default": True})
        check("Gắn được địa điểm vào nhóm", status == 200, f"HTTP {status}")

        status, places = call("GET", f"/manager/teams/{team_id}/locations", alice)
        check("Đọc lại thấy địa điểm của nhóm",
              status == 200 and len(places) == 1 and places[0]["is_default"], str(places))

        status, _ = call("GET", f"/manager/teams/{team_id}/locations", bob)
        check("Người quản lý khác không xem được địa điểm nhóm này", status == 404, f"HTTP {status}")

        # Somebody who joins the unit afterwards gets the place without anybody
        # assigning it to them.
        joiner_email = f"probe-iso-{uuid.uuid4().hex[:8]}@example.com"
        created.append(joiner_email)
        status, tokens = call("POST", "/auth/register", body={
            "email": joiner_email, "password": PASSWORD, "role": "MEMBER",
            "team_code": team["code"],
        })
        joiner = tokens["access_token"]
        joiner_id = next(
            (row["member_id"] for row in call("GET", "/manager/join-requests", alice)[1]
             if row["email"] == joiner_email), None
        )
        status, mine = call("GET", "/members/me/locations", joiner)
        check("Chưa được duyệt thì chưa có địa điểm nào", status == 200 and mine == [],
              f"{len(mine)} địa điểm")

        call("POST", f"/manager/join-requests/{joiner_id}", alice, {"approve": True})
        status, mine = call("GET", "/members/me/locations", joiner)
        check("Duyệt vào nhóm là có ngay địa điểm của nhóm, không phải gán tay",
              status == 200 and len(mine) == 1 and mine[0]["id"] == alice_place,
              f"{len(mine)} địa điểm")

        # --- 4. Leaving the unit takes the place with it ----------------------
        call("PUT", f"/manager/members/{joiner_id}", alice, {"status": "REMOVED"})
        status, mine = call("GET", "/members/me/locations", joiner)
        check("Gỡ khỏi nhóm là mất quyền chấm công ở đó", status == 200 and mine == [],
              f"{len(mine)} địa điểm")

        status, _ = call("DELETE", f"/manager/teams/{team_id}/locations/{alice_place}", alice)
        check("Gỡ được địa điểm khỏi nhóm", status == 200, f"HTTP {status}")

        # --- 5. Individual grants still work alongside ------------------------
        status, _ = call("POST", f"/manager/members/{member_id}/locations", alice,
                         {"location_id": alice_place, "is_default": False})
        status, mine = call("GET", "/members/me/locations", member)
        check("Gán riêng cho một người vẫn dùng được",
              status == 200 and any(row["id"] == alice_place for row in mine),
              f"{len(mine)} địa điểm")

        call("DELETE", f"/manager/locations/{alice_place}/permanent", alice)
        call("DELETE", f"/manager/locations/{bob_place}/permanent", bob)
    finally:
        cleanup(created)

    passed = sum(1 for ok, _, _ in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
