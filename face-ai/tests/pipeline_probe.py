"""
OpenCV + face_recognition pipeline probe — runs against the LIVE face-ai service.

    docker compose run --rm -v "<repo>/face-ai:/src:ro" -v "<faces>:/faces:ro" \
      -w /src -e FACE_AI_URL=http://face-ai:8001 face-ai python -m tests.pipeline_probe

Needs three portraits in /faces: two of the same person (einstein_a.jpg,
einstein_b.jpg) and one of somebody else (curie.jpg). Without a real pair there
is no way to show that the encoder separates identities rather than merely
returning numbers.
"""

from __future__ import annotations

import io
import json
import os
import sys
import urllib.request
import uuid

import cv2
import numpy as np


BASE = os.environ.get("FACE_AI_URL", "http://face-ai:8001")
FACES = os.environ.get("FACE_SAMPLES", "/faces")

results: list[tuple[bool, str, str]] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    results.append((passed, name, detail))
    print(("PASS  " if passed else "FAIL  ") + name + ("  " + detail if detail else ""))


def post(path: str, image: bytes, fields: dict[str, str] | None = None) -> dict:
    boundary = "----probe" + uuid.uuid4().hex
    buffer = io.BytesIO()
    for key, value in (fields or {}).items():
        buffer.write(f"--{boundary}\r\n".encode())
        buffer.write(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode())
        buffer.write(f"{value}\r\n".encode())
    buffer.write(f"--{boundary}\r\n".encode())
    buffer.write(b'Content-Disposition: form-data; name="image"; filename="probe.jpg"\r\n')
    buffer.write(b"Content-Type: image/jpeg\r\n\r\n")
    buffer.write(image)
    buffer.write(f"\r\n--{boundary}--\r\n".encode())

    request = urllib.request.Request(
        BASE + path, data=buffer.getvalue(),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            body = response.read()
            if response.headers.get("Content-Type", "").startswith("image/"):
                return {"status": "IMAGE", "bytes": len(body)}
            return json.loads(body)
    except urllib.error.HTTPError as error:
        return {"status": "HTTP_ERROR", "code": error.code, "body": error.read().decode(errors="replace")}


def sample(name: str) -> bytes:
    with open(os.path.join(FACES, name), "rb") as handle:
        return handle.read()


def jpeg(image: np.ndarray) -> bytes:
    return cv2.imencode(".jpg", image)[1].tobytes()


def main() -> int:
    with urllib.request.urlopen(BASE + "/v1/engine", timeout=30) as response:
        info = json.loads(response.read())

    # --- 1. The engine really is the one the project is about ----------------
    check("Engine đang chạy là face_recognition", info.get("engine") == "face_recognition", str(info.get("engine")))
    check("Thư viện face_recognition nạp được", info.get("available") is True, info.get("error", ""))
    check("Bộ phát hiện là dlib HOG", "HOG" in info.get("detector", ""), info.get("detector", ""))
    check("Bộ mã hoá là dlib ResNet 128 chiều",
          info.get("dimension") == 128 and "ResNet" in info.get("encoder", ""),
          f"{info.get('dimension')}D · {info.get('encoder')}")
    versions = info.get("versions", {})
    check("Có đủ phiên bản OpenCV, dlib, face_recognition",
          all(versions.get(key, "unavailable") != "unavailable" for key in ("opencv", "dlib", "face_recognition")),
          f"opencv {versions.get('opencv')} · dlib {versions.get('dlib')} · face_recognition {versions.get('face_recognition')}")
    check("Các bước tiền xử lý bằng OpenCV được nêu rõ",
          any("Laplacian" in step for step in info.get("preprocessing", []))
          and any("CLAHE" in step for step in info.get("preprocessing", [])),
          " → ".join(info.get("preprocessing", [])))

    # --- 2. OpenCV rejects frames before anyone is identified ----------------
    tiny = jpeg(np.full((100, 100, 3), 128, dtype=np.uint8))
    check("Ảnh quá nhỏ bị loại ngay ở bước giải mã",
          post("/v1/analyze", tiny).get("code") == "IMAGE_TOO_SMALL")

    blank = post("/v1/analyze", jpeg(np.full((400, 400, 3), 128, dtype=np.uint8)))
    check("Ảnh không có mặt thì đếm được 0 khuôn mặt",
          blank.get("face_count") == 0, str(blank.get("face_count")))
    check("OpenCV trả về độ nét và độ sáng",
          isinstance(blank.get("blur_score"), (int, float)) and isinstance(blank.get("brightness_score"), (int, float)),
          f"nét {blank.get('blur_score'):.1f} · sáng {blank.get('brightness_score'):.1f}")

    dark = post("/v1/analyze", jpeg(np.full((400, 400, 3), 20, dtype=np.uint8)))
    check("Ảnh tối được CLAHE bù sáng", dark.get("contrast_boosted") is True,
          f"sáng {dark.get('brightness_score'):.1f}")

    original = cv2.imdecode(np.frombuffer(sample("einstein_a.jpg"), np.uint8), cv2.IMREAD_COLOR)
    blurred = post("/v1/enroll", jpeg(cv2.GaussianBlur(original, (31, 31), 0)))
    check("Ảnh nhoè bị từ chối khi đăng ký", blurred.get("code") == "FACE_TOO_BLURRY", str(blurred.get("code")))

    # --- 3. Detection and encoding on real faces -----------------------------
    enrolled = post("/v1/enroll", sample("einstein_a.jpg"))
    check("Phát hiện và mã hoá được khuôn mặt thật",
          enrolled.get("status") == "ENROLLED", str(enrolled.get("code") or enrolled.get("status")))
    encoding = enrolled.get("embedding") or []
    check("Vector đặc trưng đúng 128 chiều", len(encoding) == 128, f"{len(encoding)} chiều")
    check("dlib đặt đủ điểm mốc (mô hình 68 điểm, đếm theo nhóm ra 72)",
          enrolled.get("landmark_count", 0) >= 60, f"{enrolled.get('landmark_count')} điểm")
    check("Có khung khuôn mặt để vẽ lại", enrolled.get("face_box") is not None, str(enrolled.get("face_box")))

    preview = post("/v1/preview", sample("einstein_a.jpg"))
    check("Xuất được ảnh có khung khuôn mặt vẽ bằng OpenCV",
          preview.get("status") == "IMAGE" and preview.get("bytes", 0) > 1000, f"{preview.get('bytes')} byte")

    if len(encoding) != 128:
        return _finish()

    # --- 4. The encoding actually separates identities ------------------------
    same = post("/v1/verify", sample("einstein_b.jpg"),
                {"member_id": "probe", "reference_embedding": json.dumps(encoding),
                 "reference_model": "face_recognition"})
    check("Cùng một người thì khớp",
          same.get("status") == "VERIFIED",
          f"khoảng cách {same.get('face_distance'):.3f} / ngưỡng {same.get('threshold')}"
          if same.get("face_distance") is not None else str(same))

    different = post("/v1/verify", sample("curie.jpg"),
                     {"member_id": "probe", "reference_embedding": json.dumps(encoding),
                      "reference_model": "face_recognition"})
    check("Người khác thì không khớp",
          different.get("status") == "REJECTED" and different.get("code") == "FACE_NOT_MATCHED",
          f"khoảng cách {different.get('face_distance'):.3f} / ngưỡng {different.get('threshold')}"
          if different.get("face_distance") is not None else str(different))

    if same.get("face_distance") is not None and different.get("face_distance") is not None:
        check("Khoảng cách người lạ lớn hơn hẳn khoảng cách chính chủ",
              different["face_distance"] > same["face_distance"] + 0.15,
              f"{same['face_distance']:.3f} so với {different['face_distance']:.3f}")

    check("Kết quả nói rõ dùng thước đo nào", same.get("metric") == "euclidean_distance", str(same.get("metric")))
    check("Kết quả ghi tên engine đã chấm", same.get("model_name") == "face_recognition", str(same.get("model_name")))

    # --- 5. Encodings from another engine are refused, not scored ------------
    foreign = post("/v1/verify", sample("einstein_a.jpg"),
                   {"member_id": "probe", "reference_embedding": json.dumps([0.1] * 512),
                    "reference_model": "arcface"})
    check("Vector của engine khác bị từ chối chứ không chấm bừa",
          foreign.get("code") == "FACE_ENGINE_MISMATCH", str(foreign.get("code")))

    mislabelled = post("/v1/verify", sample("einstein_a.jpg"),
                       {"member_id": "probe", "reference_embedding": json.dumps([0.1] * 512),
                        "reference_model": "face_recognition"})
    check("Sai số chiều cũng bị chặn dù nhãn engine đúng",
          mislabelled.get("code") == "FACE_ENGINE_MISMATCH", str(mislabelled.get("code")))

    missing = post("/v1/verify", sample("einstein_a.jpg"), {"member_id": "probe"})
    check("Không có vector tham chiếu thì báo thiếu, không đoán",
          missing.get("code") == "FACE_REFERENCE_NOT_FOUND", str(missing.get("code")))

    return _finish()


def _finish() -> int:
    passed = sum(1 for ok, _, _ in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
