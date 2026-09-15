# Cài đặt và chạy trên máy khác

Hướng dẫn từ một máy trống tới hệ thống chạy được. Làm đúng thứ tự, mỗi bước đều có cách kiểm tra xem đã xong chưa.

Thời gian: khoảng 30 phút, trong đó phần lớn là chờ tải.

---

## 1. Chuẩn bị máy

| Cần | Ghi chú |
|---|---|
| Docker Desktop | [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop) — Windows cần bật WSL 2 |
| RAM | Tối thiểu 8 GB, nên có 16 GB |
| Đĩa trống | 10 GB |
| Git | Để lấy mã nguồn |

Kiểm tra Docker đã sẵn sàng:

```bash
docker --version
docker compose version
```

### Riêng Windows: giới hạn RAM cho WSL

Không đặt giới hạn thì WSL sẽ nở tới hết RAM máy và **rất chậm trả lại**, khiến cả máy ì. Tạo tệp `C:\Users\<tên bạn>\.wslconfig`:

```ini
[wsl2]
memory=8GB
processors=4
autoMemoryReclaim=gradual
```

Rồi chạy `wsl --shutdown` một lần. Docker Desktop sẽ tự khởi động lại.

**`vmmem` ăn CPU khi máy đang rảnh** thì nhìn ba chỗ, theo thứ tự hay gặp:

1. **Healthcheck**: mỗi lần kiểm là một tiến trình mới (Python, `mc`, `redis-cli`). Đã đặt 30 giây thay vì 5–10 giây; đo trên máy dev, `vmmem` lúc rảnh giảm từ ~30% xuống ~12% của một nhân.
2. **Vòng dẫn hướng camera**: mỗi khung 400 px tốn ~170 ms CPU của `face-ai`, cứ 0,7 giây một khung khi người dùng đang ở màn camera. Bốn người cùng mở là kín một nhân (dlib chạy một luồng). Đã giảm còn 2 giây khi bốn mục đã đạt, tắt hẳn khi tab ẩn, và `face-ai` bị chặn ở `cpus: 4`.
3. **`docker compose build`** dùng mọi nhân trong 1–2 phút — bình thường, chỉ xảy ra khi deploy.

Ảnh `vmmem` giữ RAM (3–4 GB) là bộ nhớ đệm của WSL; `autoMemoryReclaim=gradual` ở trên trả dần khi rảnh.

---

## 2. Lấy mã nguồn

```bash
git clone <địa chỉ kho mã> face-attendance
cd face-attendance
```

---

## 3. Tạo tệp cấu hình

Sao chép mẫu rồi sửa:

```bash
cp .env.example .env
```

Những giá trị **bắt buộc phải đổi** trước khi chạy thật:

| Biến | Ý nghĩa | Gợi ý |
|---|---|---|
| `POSTGRES_PASSWORD` | Mật khẩu cơ sở dữ liệu | Chuỗi ngẫu nhiên ≥ 24 ký tự |
| `JWT_SECRET` | Khoá ký phiên đăng nhập | Chuỗi ngẫu nhiên ≥ 48 ký tự |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Tài khoản kho ảnh | Chuỗi ngẫu nhiên |
| `APP_TIMEZONE` | Múi giờ tổ chức | `Asia/Ho_Chi_Minh` |

Sinh chuỗi ngẫu nhiên:

```bash
# macOS / Linux
openssl rand -base64 48

# Windows PowerShell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Max 256 }))
```

> **Không bao giờ đưa tệp `.env` lên Git.** Tệp này đã nằm trong `.gitignore`.

---

## 4. Đặt mô hình nhận diện

Hệ thống dùng thư viện `face_recognition` (dlib) — mô hình đi kèm thư viện, **không cần tải riêng**. Ảnh Docker tự cài khi dựng.

Nếu bạn muốn dùng bộ ONNX thay thế, đặt tệp mô hình ngoài kho mã (ví dụ `D:\face-attendance-models`) và trỏ đường dẫn trong `.env`. Mô hình không bao giờ nằm trong Git.

---

## 5. Khởi động

```bash
docker compose up -d --build
```

Lần đầu mất 10–20 phút vì phải tải và biên dịch. Những lần sau dưới một phút.

Kiểm tra:

```bash
docker compose ps
```

Tất cả dòng phải ở trạng thái `Up`, các dịch vụ có kiểm tra sức khoẻ phải là `healthy`.

```bash
curl http://localhost:8000/ready
```

Trả về `{"status":"ready"}` là xong. Nếu trả `503`, xem mục Xử lý sự cố bên dưới.

---

## 6. Tạo tài khoản quản trị đầu tiên

Cơ sở dữ liệu lúc này trống. Tạo tài khoản quản trị:

```bash
docker compose exec api python - <<'EOF'
import os, secrets, string
import psycopg
from passlib.context import CryptContext

url = os.environ["DATABASE_URL"].replace("postgresql+psycopg://", "postgresql://", 1)
email = input("Email quản trị: ").strip().lower()
password = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(20))

with psycopg.connect(url) as connection:
    connection.execute(
        "INSERT INTO users (email, password_hash, role, status, email_verified_at)"
        " VALUES (%s, %s, 'SUPER_ADMIN', 'ACTIVE', now())",
        (email, CryptContext(schemes=["bcrypt"]).hash(password)),
    )
    connection.commit()

print(f"Đã tạo {email}")
print(f"Mật khẩu: {password}")
print("Ghi lại ngay, mật khẩu này không hiện lại lần nữa.")
EOF
```

Mở `http://localhost` và đăng nhập. Đổi mật khẩu ngay trong mục **Hồ sơ → Đổi mật khẩu**.

---

## 7. Chuyển dữ liệu từ máy cũ sang (nếu có)

**Trên máy cũ** — sao lưu:

```bash
./scripts/backup.sh ./backups
```

Thư mục `backups/` chứa cơ sở dữ liệu và toàn bộ ảnh khuôn mặt. **Mã hoá trước khi mang đi**:

```bash
# macOS / Linux
tar czf - backups/2026-09-09 | openssl enc -aes-256-cbc -pbkdf2 -out backup.tar.gz.enc
```

**Trên máy mới** — giải mã và khôi phục:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -in backup.tar.gz.enc | tar xzf -
./scripts/restore.sh ./backups/2026-09-09
```

Diễn tập khôi phục mà không đụng dữ liệu đang chạy:

```bash
./scripts/restore.sh ./backups/2026-09-09 --into face_attendance_restore_test --database-only
```

---

## 8. Đưa ra Internet (tuỳ chọn)

Hệ thống cần **HTTPS** thì camera và định vị mới hoạt động — trình duyệt chặn cả hai trên kết nối không mã hoá.

Cách đơn giản nhất không cần mở cổng router: dùng Cloudflare Tunnel.

1. Tạo tunnel trong bảng điều khiển Cloudflare, tải tệp credentials về
2. Trỏ đường dẫn tệp đó vào `CLOUDFLARED_CREDENTIALS_FILE` trong `.env`
3. Sửa tên miền trong `proxy/cloudflared.yml`
4. Chạy lại: `docker compose up -d`

Chạy bản production (bỏ công cụ quản trị cơ sở dữ liệu, không mở cổng nào ra ngoài trừ proxy):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

---

## 9. Vận hành hằng ngày

```bash
# Xem nhật ký
docker compose logs api --tail 50
docker compose logs -f api

# Khởi động lại một dịch vụ
docker compose restart api

# Dừng toàn bộ (dữ liệu vẫn còn)
docker compose down

# Dừng và XOÁ SẠCH dữ liệu — không hoàn tác được
docker compose down -v
```

Sau khi tắt máy và bật lại, Docker Desktop tự khởi động các container nếu bạn để chế độ mặc định. Kiểm tra bằng `docker compose ps`.

---

## Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `/ready` trả 503 | Postgres hoặc kho ảnh chưa lên | `docker compose logs postgres minio` |
| Trang trắng, không đăng nhập được | Frontend chưa dựng xong | `docker compose logs frontend` |
| Camera không mở | Đang truy cập bằng `http://` chứ không phải `https://` | Dùng `localhost` hoặc bật HTTPS |
| Máy ì, RAM đầy | WSL chưa giới hạn bộ nhớ | Xem mục 1, tạo `.wslconfig` |
| Người dùng báo một mã sáu ký tự | Hệ thống gặp lỗi và đã ghi lại | Vào **Sự cố hệ thống**, dán mã vào ô tìm |
| Quên mật khẩu quản trị | | Chạy lại đoạn ở mục 6 với email khác, rồi dùng tài khoản mới đặt lại mật khẩu cho tài khoản cũ |
| Bản đồ chỉ có nền trống | Trình duyệt không tới được `tiles.openfreemap.org`, hoặc image frontend thiếu `public/maplibre/` | Kiểm tra mạng ra ngoài; dựng lại `docker compose build frontend` (Dockerfile chép worker của MapLibre vào đó) |

---

## Kiểm tra hệ thống hoạt động đúng

Bộ kiểm chạy trên hệ thống thật, không phải giả lập:

```bash
# Kiểm thử đơn vị
docker run --rm -v "$(pwd)/api:/src:ro" -w /src face-attendance-api \
  python -m unittest discover -s tests -t .

# Kiểm tra bảo mật, phân quyền, luồng nghiệp vụ
docker compose run --rm -v "$(pwd)/api:/src:ro" -w /src \
  -e PROBE_BASE_URL=http://api:8000/api/v1 api python -m tests.security_probe
```

Thay `security_probe` bằng tên khác để chạy bộ tương ứng: `rbac_probe`, `teams_probe`, `isolation_probe`, `rules_probe`, `sessions_probe`, `portal_probe`, `hours_probe`, `calendar_probe`, `session_probe`, `admin_probe`.

Hai bộ cần ảnh chân dung thật (`einstein_a.jpg`, `einstein_b.jpg` cùng một người, `curie.jpg` người khác) nên phải gắn thêm thư mục ảnh — thư mục này **không nằm trong kho mã**:

```powershell
docker compose run --rm -v "${PWD}/api:/src:ro" -v "D:/duong-dan/faces:/faces:ro" -w /src `
  -e PROBE_BASE_URL=http://api:8000/api/v1 api python -m tests.face_change_probe
```

`face_change_probe` kiểm luồng duyệt đổi khuôn mặt, `reading_probe` kiểm các số đo OpenCV/face_recognition trả về đúng cho người dùng và cho người quản lý.

`guide_probe` kiểm dẫn hướng camera và cần thêm thư mục `faces/guide/` gồm các khung tối, chói, xa, nhoè dựng từ chân dung gốc. Dựng một lần bằng image `face-ai` (image `api` cố tình không có OpenCV):

```powershell
docker compose run --rm -v "D:/duong-dan/faces:/faces" -v "${PWD}/api/tests/fixtures:/src:ro" `
  --entrypoint python face-ai /src/make_guide_frames.py /faces/einstein_a.jpg /faces/curie.jpg /faces/guide
```
