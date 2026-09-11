"""
A real working day end to end — enrol, check in, check out — and the numbers
OpenCV and face_recognition produced coming back to the person they were
produced about. Runs against a LIVE stack, with real portraits.

    docker compose run --rm -v "<repo>/api:/src:ro" -v "<faces>:/faces:ro" -w /src \
      -e PROBE_BASE_URL=http://api:8000/api/v1 api python -m tests.reading_probe

/faces needs einstein_a.jpg and einstein_b.jpg (the same person, two photos):
enrolment takes the first, the check-in is judged against it with the second.
"""

from __future__ import annotations

import os
import sys
import uuid

from tests.security_probe import PASSWORD, call, cleanup, multipart, register

FACES = os.environ.get("FACE_SAMPLES", "/faces")

results: list[tuple[bool, str, str]] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    results.append((passed, name, detail))
    print(("PASS  " if passed else "FAIL  ") + name + ("  " + detail if detail else ""))


def sample(name: str) -> bytes:
    with open(os.path.join(FACES, name), "rb") as handle:
        return handle.read()


def enroll(token: str, image: bytes) -> tuple[int, dict]:
    status, challenge = call("POST", "/faces/enrollment/start", token)
    if status != 201:
        return status, challenge
    body, content_type = multipart(
        {"challenge_id": str(challenge["challenge_id"]), "challenge": challenge["challenge"]},
        "image", "face.jpg", image, "image/jpeg",
    )
    return call("POST", "/faces/enrollment/verify", token, raw=body, content_type=content_type)


def check_in(token: str, location_id: str, image: bytes) -> tuple[int, dict]:
    body, content_type = multipart(
        {
            "location_id": location_id, "latitude": "21.0", "longitude": "105.8",
            "gps_accuracy_meters": "5", "idempotency_key": "read-" + uuid.uuid4().hex,
        },
        "image", "face.jpg", image, "image/jpeg",
    )
    return call("POST", "/attendance/check-in", token, raw=body, content_type=content_type)


def check_out(token: str, image: bytes, location_id: str | None = None,
              reason: str | None = None) -> tuple[int, dict]:
    fields = {
        "latitude": "21.0", "longitude": "105.8",
        "gps_accuracy_meters": "5", "idempotency_key": "read-" + uuid.uuid4().hex,
    }
    if location_id is not None:
        fields["location_id"] = location_id
    if reason is not None:
        fields["reason"] = reason
    body, content_type = multipart(fields, "image", "face.jpg", image, "image/jpeg")
    return call("POST", "/attendance/check-out", token, raw=body, content_type=content_type)


def main() -> int:
    created: list[str] = []
    try:
        manager_email, manager = register("MANAGER", created)
        member_email, member = register("MEMBER", created)
        call("POST", "/manager/members/add-by-email", manager, {"email": member_email})
        member_id = call("GET", "/manager/members", manager)[1][0]["user_id"]

        # --- 1. Enrolment reports what it measured ----------------------------
        status, enrolled = enroll(member, sample("einstein_a.jpg"))
        check("Đăng ký khuôn mặt thành công",
              status == 200 and enrolled.get("status") == "ENROLLED",
              f"HTTP {status} {enrolled.get('status')}")
        check("Trả về số đo của OpenCV để người dùng nhìn thấy",
              isinstance(enrolled.get("blur_score"), (int, float))
              and isinstance(enrolled.get("brightness_score"), (int, float)),
              f"nét {enrolled.get('blur_score')} sáng {enrolled.get('brightness_score')}")
        check("Nói rõ thư viện nào đọc khuôn mặt",
              bool(enrolled.get("detector")) and bool(enrolled.get("encoder")),
              f"{enrolled.get('detector')} · {enrolled.get('encoder')}")
        check("Nói rõ vector đặc trưng dài bao nhiêu chiều",
              enrolled.get("dimension") == 128, str(enrolled.get("dimension")))

        # --- 2. A real check-in reports the comparison ------------------------
        status, location = call("POST", "/manager/locations", manager, {
            "name": "Reading probe", "address": None, "latitude": 21.0, "longitude": 105.8,
            "allow_radius_meters": 500, "warning_radius_meters": 900, "is_active": True,
            "expected_check_in": "08:00", "expected_check_out": "17:00",
        })
        location_id = location["id"]
        call("POST", f"/manager/members/{member_id}/locations", manager,
             {"location_id": location_id, "is_default": True})

        status, event = check_in(member, location_id, sample("einstein_b.jpg"))
        check("Chấm công bằng ảnh thứ hai của cùng một người",
              status == 200, f"HTTP {status} {event.get('detail')}")
        distance = event.get("face_distance")
        threshold = event.get("face_threshold")
        check("Kết quả trả về khoảng cách khuôn mặt đã đo",
              isinstance(distance, (int, float)), str(distance))
        check("Và ngưỡng dùng để quyết định",
              isinstance(threshold, (int, float)), str(threshold))
        check("Khoảng cách nằm dưới ngưỡng thì mới được ghi nhận",
              isinstance(distance, (int, float)) and isinstance(threshold, (int, float))
              and distance < threshold,
              f"{distance} < {threshold}")
        check("Ghi tên bộ nhận diện đã đo, không phải chuỗi chung chung",
              "dlib" in str(event.get("face_engine", "")).lower()
              or "face_recognition" in str(event.get("face_engine", "")).lower(),
              str(event.get("face_engine")))

        # The same numbers must reach the manager's record view.
        status, detail = call("GET", f"/manager/attendance/{event['event_id']}", manager)
        check("Người quản lý đọc lại đúng con số đó",
              status == 200 and detail.get("face_distance") is not None
              and abs(float(detail["face_distance"]) - float(distance)) < 1e-6,
              f"HTTP {status} {detail.get('face_distance')}")

        # --- 3. Leaving from another site of the same organisation ------------
        status, second = call("POST", "/manager/locations", manager, {
            "name": "Reading probe 2", "address": None, "latitude": 21.0, "longitude": 105.8,
            "allow_radius_meters": 500, "warning_radius_meters": 900, "is_active": True,
            "expected_check_in": "08:00", "expected_check_out": "17:00",
        })
        second_id = second["id"]
        call("POST", f"/manager/members/{member_id}/locations", manager,
             {"location_id": second_id, "is_default": False})

        status, refused = check_out(member, sample("einstein_b.jpg"), second_id)
        check("Chấm ra ở nơi khác mà không giải trình thì bị từ chối",
              status == 422 and refused.get("detail") == "CHECKOUT_LOCATION_REASON_REQUIRED",
              f"HTTP {status} {refused.get('detail')}")

        status, stranger = check_out(member, sample("einstein_b.jpg"), str(uuid.uuid4()),
                                     "Địa điểm không được gán cho tôi")
        check("Nơi không được gán thì có giải trình cũng không chấm ra được",
              status == 404, f"HTTP {status}")

        status, done = check_out(member, sample("einstein_b.jpg"), second_id,
                                 "Cuối ca tôi đang ở chi nhánh thứ hai.")
        check("Có giải trình thì chấm ra ở nơi khác được",
              status == 200, f"HTTP {status} {done.get('detail')}")

        status, detail = call("GET", f"/manager/attendance/{done.get('event_id')}", manager)
        check("Bản ghi ghi đúng nơi chấm ra, không phải nơi chấm vào",
              status == 200 and detail.get("location_id") == second_id,
              str(detail.get("location_name")))
        check("Và giữ nguyên lời giải trình cho người quản lý đọc",
              detail.get("reason") == "Cuối ca tôi đang ở chi nhánh thứ hai.",
              str(detail.get("reason")))
        check("Đánh dấu là hợp lệ có lý do, không phải hợp lệ trơn",
              detail.get("status") == "WARNING_CONFIRMED", str(detail.get("status")))

        call("DELETE", f"/manager/locations/{second_id}/permanent", manager)
        call("DELETE", f"/manager/locations/{location_id}/permanent", manager)
    finally:
        cleanup(created)

    passed = sum(1 for ok, _, _ in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
