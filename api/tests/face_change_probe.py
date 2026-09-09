"""
Changing a registered face needs somebody else's agreement.
Runs against a LIVE stack, with real portraits.

    docker compose run --rm -v "<repo>/api:/src:ro" -v "<faces>:/faces:ro" -w /src \
      -e PROBE_BASE_URL=http://api:8000/api/v1 api python -m tests.face_change_probe

/faces needs einstein_a.jpg, einstein_b.jpg (same person) and curie.jpg
(somebody else). Without a real second face there is no way to show that an
unapproved swap leaves the old face in charge.
"""

from __future__ import annotations

import os
import sys
import uuid

import psycopg

from tests.security_probe import DATABASE_URL, PASSWORD, call, cleanup, multipart, register

FACES = os.environ.get("FACE_SAMPLES", "/faces")

results: list[tuple[bool, str, str]] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    results.append((passed, name, detail))
    print(("PASS  " if passed else "FAIL  ") + name + ("  " + detail if detail else ""))


def sample(name: str) -> bytes:
    with open(os.path.join(FACES, name), "rb") as handle:
        return handle.read()


def enroll(token: str, image: bytes, reason: str | None = None) -> tuple[int, dict]:
    status, challenge = call("POST", "/faces/enrollment/start", token)
    if status != 201:
        return status, challenge
    fields = {"challenge_id": str(challenge["challenge_id"]), "challenge": challenge["challenge"]}
    if reason is not None:
        fields["reason"] = reason
    body, content_type = multipart(fields, "image", "face.jpg", image, "image/jpeg")
    return call("POST", "/faces/enrollment/verify", token, raw=body, content_type=content_type)


def active_face(member_id: str) -> str | None:
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            "SELECT id::text FROM face_embeddings WHERE member_id = %s AND revoked_at IS NULL",
            (member_id,),
        ).fetchone()
    return row[0] if row else None


def main() -> int:
    created: list[str] = []
    try:
        manager_email, manager = register("MANAGER", created)
        member_email, member = register("MEMBER", created)
        other_email, other = register("MANAGER", created)
        call("POST", "/manager/members/add-by-email", manager, {"email": member_email})
        member_id = call("GET", "/manager/members", manager)[1][0]["user_id"]

        # --- 1. The first face applies at once --------------------------------
        status, first = enroll(member, sample("einstein_a.jpg"))
        check("Đăng ký lần đầu áp dụng ngay, không phải chờ duyệt",
              status == 200 and first.get("status") == "ENROLLED", f"HTTP {status} {first.get('status')}")
        original = active_face(member_id)
        check("Có khuôn mặt đang dùng sau lần đăng ký đầu", original is not None)

        status, requests = call("GET", "/manager/face-requests", manager)
        check("Lần đầu không sinh yêu cầu nào", status == 200 and requests == [], f"{len(requests)} yêu cầu")

        # --- 2. Replacing it does not apply -----------------------------------
        status, refused = enroll(member, sample("curie.jpg"), reason="abc")
        check("Đổi khuôn mặt mà không nêu lý do thì bị từ chối",
              status == 422 and refused.get("detail") == "FACE_CHANGE_REASON_REQUIRED",
              f"HTTP {status} {refused.get('detail')}")

        status, pending = enroll(member, sample("curie.jpg"), reason="Tôi vừa cắt tóc và bỏ kính.")
        check("Đổi khuôn mặt chuyển thành yêu cầu chờ duyệt",
              status == 200 and pending.get("status") == "PENDING_APPROVAL",
              f"HTTP {status} {pending.get('status')}")
        check("Yêu cầu được gửi tới người quản lý", pending.get("reviewers") == 1,
              str(pending.get("reviewers")))
        check("Khuôn mặt đang dùng vẫn là khuôn mặt cũ", active_face(member_id) == original)

        status, again = enroll(member, sample("einstein_b.jpg"), reason="Xin đổi lần nữa.")
        check("Không xếp hàng nhiều yêu cầu đổi cùng lúc",
              status == 409 and again.get("detail") == "FACE_CHANGE_ALREADY_PENDING",
              f"HTTP {status} {again.get('detail')}")

        # --- 3. Only the right people can look at it ---------------------------
        status, queue = call("GET", "/manager/face-requests", manager)
        check("Người quản lý thấy yêu cầu trong hàng chờ",
              status == 200 and len(queue) == 1, f"{len(queue)} yêu cầu")
        request_id = queue[0]["id"] if queue else str(uuid.uuid4())
        check("Yêu cầu kèm lý do người đó nêu",
              queue and queue[0]["reason"] == "Tôi vừa cắt tóc và bỏ kính.",
              queue[0]["reason"] if queue else "")
        check("Có cả ảnh cũ và ảnh mới để so",
              queue and queue[0]["has_current_photo"] and queue[0]["has_new_photo"],
              f"cũ={queue[0]['has_current_photo']} mới={queue[0]['has_new_photo']}" if queue else "")

        status, _ = call("GET", "/manager/face-requests", other)
        check("Người quản lý ngoài phạm vi không thấy yêu cầu này",
              status == 200 and len(_) == 0, f"{len(_)} yêu cầu")

        status, _ = call("GET", "/manager/face-requests", member)
        check("Người xin đổi không mở được màn hình duyệt", status == 403, f"HTTP {status}")

        status, _ = call("POST", f"/manager/face-requests/{request_id}", other, {"approve": True})
        check("Người ngoài phạm vi không duyệt hộ được", status == 404, f"HTTP {status}")

        status, photo = call("GET", f"/manager/face-requests/{request_id}/photo", manager)
        check("Người quản lý xem được ảnh mới", status == 200, f"HTTP {status}")

        # --- 4. Rejecting leaves the old face in charge ------------------------
        status, decided = call("POST", f"/manager/face-requests/{request_id}", manager,
                               {"approve": False, "note": "Ảnh không giống người trong hồ sơ."})
        check("Từ chối được yêu cầu", status == 200 and decided.get("status") == "REJECTED", f"HTTP {status}")
        check("Từ chối xong khuôn mặt cũ vẫn nguyên", active_face(member_id) == original)

        status, mine = call("GET", "/faces/me/change-request", member)
        check("Người xin đổi đọc được lý do bị từ chối",
              mine.get("last", {}).get("note") == "Ảnh không giống người trong hồ sơ.",
              str(mine.get("last")))
        check("Không còn yêu cầu treo sau khi bị từ chối", mine.get("pending") is None)

        # --- 5. Approving swaps it ---------------------------------------------
        status, pending = enroll(member, sample("einstein_b.jpg"), reason="Ảnh cũ mờ, xin chụp lại.")
        check("Xin đổi lại được sau khi bị từ chối",
              status == 200 and pending.get("status") == "PENDING_APPROVAL", f"HTTP {status}")

        status, queue = call("GET", "/manager/face-requests", manager)
        request_id = queue[0]["id"]
        status, decided = call("POST", f"/manager/face-requests/{request_id}", manager, {"approve": True})
        check("Duyệt được yêu cầu", status == 200 and decided.get("status") == "APPROVED", f"HTTP {status}")

        replaced = active_face(member_id)
        check("Duyệt xong khuôn mặt đang dùng đã đổi", replaced is not None and replaced != original,
              f"{original} -> {replaced}")

        status, notes = call("GET", "/notifications", member)
        titles = [row["title"] for row in notes.get("items", [])]
        check("Người xin đổi nhận thông báo kết quả",
              any("đã được duyệt" in title for title in titles), " | ".join(titles[:2]))

        status, empty = call("GET", "/manager/face-requests", manager)
        check("Hàng chờ trống sau khi xử lý xong", empty == [], f"{len(empty)} yêu cầu")

        # --- 6. Nobody approves their own face ---------------------------------
        boss_email, boss = register("MANAGER", created)
        call("POST", "/manager/members/add-by-email", boss, {"email": manager_email})
        enroll(manager, sample("einstein_a.jpg"))
        status, pending = enroll(manager, sample("curie.jpg"), reason="Người quản lý tự đổi.")
        check("Người quản lý đổi khuôn mặt cũng phải xin duyệt",
              status == 200 and pending.get("status") == "PENDING_APPROVAL", f"HTTP {status}")

        status, own = call("GET", "/manager/face-requests", manager)
        mine_id = next((row["id"] for row in own if row["member_id"] == _user_id(manager_email)), None)
        if mine_id:
            status, _ = call("POST", f"/manager/face-requests/{mine_id}", manager, {"approve": True})
            check("Không tự duyệt yêu cầu đổi mặt của chính mình",
                  status == 409, f"HTTP {status}")
        else:
            check("Không tự duyệt yêu cầu đổi mặt của chính mình", False, "không thấy yêu cầu")

        status, byboss = call("GET", "/manager/face-requests", boss)
        check("Cấp trên duyệt hộ được", any(row["email"] == manager_email for row in byboss),
              f"{len(byboss)} yêu cầu")
    finally:
        cleanup(created)

    passed = sum(1 for ok, _, _ in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


def _user_id(email: str) -> str:
    with psycopg.connect(DATABASE_URL) as connection:
        return str(connection.execute("SELECT id FROM users WHERE email = %s", (email,)).fetchone()[0])


if __name__ == "__main__":
    sys.exit(main())
