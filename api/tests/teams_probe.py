"""
Joining a unit by code, and the manager's decision — runs against a LIVE stack.

    docker compose run --rm -v "<repo>/api:/src:ro" -w /src \
      -e PROBE_BASE_URL=http://api:8000/api/v1 api python -m tests.teams_probe
"""

from __future__ import annotations

import sys
import uuid

from tests.security_probe import PASSWORD, call, cleanup, register

results: list[tuple[bool, str, str]] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    results.append((passed, name, detail))
    print(("PASS  " if passed else "FAIL  ") + name + ("  " + detail if detail else ""))


def sign_up(role: str, created: list[str], team_code: str | None = None) -> tuple[str, str]:
    email = f"probe-team-{uuid.uuid4().hex[:10]}@example.com"
    created.append(email)
    body = {"email": email, "password": PASSWORD, "role": role}
    if team_code:
        body["team_code"] = team_code
    status, payload = call("POST", "/auth/register", body=body)
    if status != 201:
        raise SystemExit(f"cannot register: {status} {payload}")
    return email, payload["access_token"]


def main() -> int:
    created: list[str] = []
    try:
        boss_email, boss = register("MANAGER", created)
        outsider_email, outsider = register("MANAGER", created)

        # --- 1. A unit and its code -------------------------------------------
        status, team = call("POST", "/manager/teams", boss, {"name": "Chi nhánh Hà Nội"})
        code = team.get("code", "")
        check("Tạo được đơn vị và hệ thống sinh mã", status == 201 and len(code) == 6, f"HTTP {status} {code}")
        check("Mã không chứa ký tự dễ đọc nhầm",
              all(character not in code for character in "OI01"), code)

        status, taken = call("POST", "/manager/teams", boss, {"name": "Trùng mã", "code": code})
        check("Không tạo được đơn vị trùng mã", status == 409, f"HTTP {status}")

        status, custom = call("POST", "/manager/teams", boss, {"name": "Kho", "code": "kho-hn"})
        check("Đặt được mã tự chọn", status == 201 and custom.get("code") == "KHO-HN", str(custom.get("code")))

        status, _ = call("POST", "/manager/teams", boss, {"name": "Ngắn quá", "code": "ab"})
        check("Mã quá ngắn bị từ chối", status == 422, f"HTTP {status}")

        # --- 2. Signing up with the code puts you in the queue, not in the team
        member_email, member = sign_up("MEMBER", created, team_code=code)
        status, roster = call("GET", "/manager/members", boss)
        check("Người vừa xin vào chưa nằm trong danh sách thành viên",
              status == 200 and all(row["email"] != member_email for row in roster),
              f"{len(roster)} thành viên")

        status, pending = call("GET", "/manager/join-requests", boss)
        check("Nhưng đã nằm trong danh sách chờ duyệt",
              status == 200 and any(row["email"] == member_email for row in pending),
              f"{len(pending)} yêu cầu")
        if pending:
            check("Yêu cầu nói rõ xin vào đơn vị nào",
                  pending[0].get("team_code") == code and pending[0].get("team_name") == "Chi nhánh Hà Nội",
                  f"{pending[0].get('team_name')} · {pending[0].get('team_code')}")

        status, mine = call("GET", "/teams/my-requests", member)
        check("Người xin vào tự theo dõi được trạng thái",
              status == 200 and mine and mine[0]["status"] == "PENDING", str(mine))

        # --- 3. Nobody else can see or decide it ------------------------------
        status, foreign = call("GET", "/manager/join-requests", outsider)
        check("Người quản lý khác không thấy yêu cầu của đơn vị này",
              status == 200 and foreign == [], f"{len(foreign)} yêu cầu")

        member_id = pending[0]["member_id"] if pending else str(uuid.uuid4())
        status, _ = call("POST", f"/manager/join-requests/{member_id}", outsider, {"approve": True})
        check("Người quản lý khác không duyệt hộ được", status == 404, f"HTTP {status}")

        status, _ = call("GET", "/manager/join-requests", member)
        check("Thành viên không mở được màn hình duyệt", status == 403, f"HTTP {status}")

        # --- 4. Approving ------------------------------------------------------
        status, decided = call("POST", f"/manager/join-requests/{member_id}", boss, {"approve": True})
        check("Duyệt được yêu cầu", status == 200 and decided.get("status") == "ACTIVE", f"HTTP {status}")

        status, roster = call("GET", "/manager/members", boss)
        check("Duyệt xong thì vào danh sách thành viên",
              any(row["email"] == member_email for row in roster), f"{len(roster)} thành viên")

        status, profile = call("GET", "/members/me", member)
        check("Đơn vị của người được duyệt lấy theo tên nhóm, không phải chữ tự khai",
              profile.get("department") == "Chi nhánh Hà Nội", str(profile.get("department")))

        status, notes = call("GET", "/notifications", member)
        titles = [row["title"] for row in notes.get("items", [])]
        check("Người được duyệt nhận thông báo",
              any("duyệt vào nhóm" in title for title in titles), " | ".join(titles[:2]))

        status, _ = call("POST", "/teams/join", member, {"code": code})
        check("Đã ở trong nhóm thì không xin vào lại được", status == 409, f"HTTP {status}")

        # --- 5. Rejecting ------------------------------------------------------
        second_email, second = sign_up("MEMBER", created, team_code=code)
        status, pending = call("GET", "/manager/join-requests", boss)
        second_id = next((row["member_id"] for row in pending if row["email"] == second_email), None)
        check("Yêu cầu thứ hai vào hàng chờ", second_id is not None, f"{len(pending)} yêu cầu")

        status, decided = call("POST", f"/manager/join-requests/{second_id}", boss,
                               {"approve": False, "note": "Bạn thuộc chi nhánh khác."})
        check("Từ chối được yêu cầu", status == 200 and decided.get("status") == "REJECTED", f"HTTP {status}")

        status, refused = call("GET", "/members/me", second)
        check("Người bị từ chối không được gán đơn vị nào",
              refused.get("department") in (None, ""), str(refused.get("department")))

        status, roster = call("GET", "/manager/members", boss)
        check("Người bị từ chối không lọt vào danh sách thành viên",
              all(row["email"] != second_email for row in roster), f"{len(roster)} thành viên")

        status, mine = call("GET", "/teams/my-requests", second)
        check("Người bị từ chối thấy lý do",
              status == 200 and mine and mine[0]["note"] == "Bạn thuộc chi nhánh khác.", str(mine[:1]))

        status, _ = call("POST", "/teams/join", second, {"code": code})
        check("Bị từ chối vẫn xin lại được", status == 200, f"HTTP {status}")

        # --- 6. Codes are not a directory to be crawled ------------------------
        status, _ = call("GET", "/teams/lookup/KHONGCO", member)
        check("Mã không tồn tại trả 404, không lộ gì thêm", status == 404, f"HTTP {status}")

        call("PUT", f"/manager/teams/{team['id']}", boss, {"is_open": False})
        status, _ = call("GET", f"/teams/lookup/{code}", member)
        check("Đơn vị đã đóng thì tra cứu cũng như không tồn tại", status == 404, f"HTTP {status}")
        third_email, third = sign_up("MEMBER", created)
        status, _ = call("POST", "/teams/join", third, {"code": code})
        check("Đơn vị đã đóng thì không ai xin vào được", status == 404, f"HTTP {status}")
        call("PUT", f"/manager/teams/{team['id']}", boss, {"is_open": True})

        # The sign-up form calls this before anybody has a session, so it has
        # to answer without one.
        status, anon = call("GET", f"/teams/lookup/{code}")
        check("Tra mã được ngay ở màn hình đăng ký, chưa cần đăng nhập",
              status == 200 and anon.get("name") == "Chi nhánh Hà Nội", f"HTTP {status}")

        status, preview = call("GET", f"/teams/lookup/{code}", third)
        check("Tra mã đúng thì thấy tên đơn vị và người quản lý",
              status == 200 and preview.get("name") == "Chi nhánh Hà Nội" and preview.get("manager_name"),
              f"{preview.get('name')} · {preview.get('manager_name')}")

        status, _ = call("POST", "/teams/join", boss, {"code": code})
        check("Không tự xin vào nhóm của chính mình", status == 409, f"HTTP {status}")

        # --- 7. A manager can belong to another manager's unit -----------------
        sub_email, sub = sign_up("MANAGER", created, team_code=code)
        status, pending = call("GET", "/manager/join-requests", boss)
        sub_id = next((row["member_id"] for row in pending if row["email"] == sub_email), None)
        check("Người quản lý cũng xin vào nhóm khác được", sub_id is not None, f"{len(pending)} yêu cầu")
        if sub_id:
            call("POST", f"/manager/join-requests/{sub_id}", boss, {"approve": True})
            status, roster = call("GET", "/manager/members", boss)
            check("Người quản lý cấp dưới nằm trong danh sách của cấp trên",
                  any(row["email"] == sub_email for row in roster), f"{len(roster)} thành viên")

            status, contacts = call("GET", "/members/me/managers", sub)
            check("Người quản lý cấp dưới cũng biết ai quản lý mình",
                  status == 200 and any(row["email"] == boss_email for row in contacts),
                  f"{len(contacts)} người")

            status, own = call("GET", "/manager/teams", sub)
            check("Nhưng vẫn giữ đơn vị của riêng mình", status == 200 and own == [], f"{len(own)} đơn vị")

        # --- 8. Deleting a unit that still has people --------------------------
        status, _ = call("DELETE", f"/manager/teams/{team['id']}", boss)
        check("Không xoá được đơn vị còn người trong đó", status == 409, f"HTTP {status}")

        status, _ = call("DELETE", f"/manager/teams/{custom['id']}", boss)
        check("Xoá được đơn vị chưa ai vào", status == 200, f"HTTP {status}")
    finally:
        cleanup(created)

    passed = sum(1 for ok, _, _ in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
