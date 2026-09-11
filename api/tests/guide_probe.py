"""
Dẫn hướng trước khi bấm chụp: cùng một bộ đo với lúc chấm công thật.
Chạy trên LIVE stack, cần các khung hình do fixtures/make_guide_frames.py dựng
sẵn trong /faces/guide (xem hướng dẫn ở đầu tệp đó).

    docker compose run --rm -v "<repo>/api:/src:ro" -v "<faces>:/faces:ro" -w /src \
      -e PROBE_BASE_URL=http://api:8000/api/v1 api python -m tests.guide_probe
"""

from __future__ import annotations

import os
import sys

from tests.security_probe import call, cleanup, multipart, register

FRAMES = os.path.join(os.environ.get("FACE_SAMPLES", "/faces"), "guide")

results: list[tuple[bool, str, str]] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    results.append((passed, name, detail))
    print(("PASS  " if passed else "FAIL  ") + name + ("  " + detail if detail else ""))


def frame(name: str) -> bytes:
    with open(os.path.join(FRAMES, name), "rb") as handle:
        return handle.read()


def guide(token: str | None, image: bytes) -> tuple[int, dict]:
    body, content_type = multipart({}, "image", "frame.jpg", image, "image/jpeg")
    return call("POST", "/faces/guide", token, raw=body, content_type=content_type)


def main() -> int:
    created: list[str] = []
    try:
        _, member = register("MEMBER", created)

        # --- 1. A good frame is good --------------------------------------------
        status, good = guide(member, frame("good.jpg"))
        check("Ảnh chân dung tốt được báo sẵn sàng",
              status == 200 and good.get("hint") == "OK" and good.get("ready") is True,
              f"HTTP {status} {good.get('hint')}")
        check("Trả về khung mặt để vẽ lên màn hình",
              isinstance(good.get("box"), dict) and 0 < good["box"]["w"] < 1, str(good.get("box")))

        # --- 2. Each bad condition is named for what it is ----------------------
        expectations = [
            ("blank.jpg", {"NO_FACE"}, "Khung trống → chưa thấy khuôn mặt"),
            ("dark.jpg", {"TOO_DARK"}, "Ảnh tối → chọn nơi sáng hơn"),
            ("bright.jpg", {"TOO_BRIGHT", "NO_FACE"}, "Ảnh chói → quay lưng lại nguồn sáng"),
            ("far_corner.jpg", {"TOO_FAR"}, "Mặt nhỏ trong góc khung lớn → quá xa"),
            ("far_centred.jpg", {"TOO_FAR"}, "Ở giữa nhưng nhỏ → vẫn là quá xa"),
            ("blurred.jpg", {"BLURRY", "NO_FACE"}, "Ảnh nhoè → giữ yên máy"),
            ("two_people.jpg", {"MULTIPLE_FACES"}, "Hai người → chỉ một người trong khung"),
        ]
        for name, accepted, label in expectations:
            status, verdict = guide(member, frame(name))
            check(label, status == 200 and verdict.get("hint") in accepted,
                  f"HTTP {status} {verdict.get('hint')}")
            check(f"  …và không mở nút chụp ({name})", verdict.get("ready") is False, str(verdict.get("ready")))

        # --- 3. Nothing about the frame is kept --------------------------------
        status, me = call("GET", "/faces/me", member)
        check("Dẫn hướng không đăng ký gì cả", status == 200 and me.get("enrolled") is False, str(me.get("enrolled")))

        # --- 4. Guarded like every upload --------------------------------------
        status, _ = guide(member, b"<html>not an image</html>")
        check("Tệp không phải ảnh bị từ chối", status == 400, f"HTTP {status}")

        status, _ = guide(None, frame("good.jpg"))
        check("Không đăng nhập thì không dùng được", status == 401, f"HTTP {status}")
    finally:
        cleanup(created)

    passed = sum(1 for ok, _, _ in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
