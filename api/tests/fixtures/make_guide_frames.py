"""
Dựng các khung hình xấu từ một chân dung tốt, để guide_probe kiểm bộ dẫn hướng.

Chạy trong image face-ai vì cần OpenCV; image api cố tình không có:

    docker compose run --rm -v "<faces>:/faces" -v "<repo>/api/tests/fixtures:/src:ro" \
      face-ai python /src/make_guide_frames.py /faces/einstein_a.jpg /faces/curie.jpg /faces/guide

Mỗi khung chỉ khác chân dung gốc đúng một điều — tối, chói, nhỏ, nhoè, hai
người — nên khi probe nói "TOO_DARK" thì đó là vì bộ đo nhận ra đúng cái đã
làm hỏng ảnh, không phải vì ảnh xấu sẵn.
"""

import os
import sys

import cv2
import numpy as np

portrait_path, other_path, out_dir = sys.argv[1:4]
os.makedirs(out_dir, exist_ok=True)
portrait = cv2.imread(portrait_path, cv2.IMREAD_COLOR)
other = cv2.imread(other_path, cv2.IMREAD_COLOR)
height, width = portrait.shape[:2]


def save(name: str, image: np.ndarray) -> None:
    cv2.imwrite(os.path.join(out_dir, name), image, [cv2.IMWRITE_JPEG_QUALITY, 85])


save("good.jpg", portrait)
save("blank.jpg", np.full((480, 640, 3), 128, dtype=np.uint8))
save("dark.jpg", np.clip(portrait.astype(np.int16) - 140, 0, 255).astype(np.uint8))
save("bright.jpg", np.clip(portrait.astype(np.int16) + 150, 0, 255).astype(np.uint8))

far = np.full((height * 3, width * 3, 3), 90, dtype=np.uint8)
far[0:height, 0:width] = portrait
save("far_corner.jpg", far)

centred = np.full((height * 3, width * 3, 3), 90, dtype=np.uint8)
centred[height:2 * height, width:2 * width] = portrait
save("far_centred.jpg", centred)

save("blurred.jpg", cv2.GaussianBlur(portrait, (31, 31), 0))

second = cv2.resize(other, (width, height))
save("two_people.jpg", np.concatenate([portrait, second], axis=1))
print("wrote 8 frames to", out_dir)
