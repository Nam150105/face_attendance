# Face Attendance

Hệ thống chấm công bằng nhận diện khuôn mặt và geofence GPS, được xây dựng theo từng
phase từ spec trong [`docs`](docs/README.md).
Quy ước làm việc trên repo nằm ở [CLAUDE.md](CLAUDE.md).

## Chạy local

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

Mọi thứ đi qua reverse proxy Caddy trên một origin duy nhất:

| Địa chỉ | Nội dung |
|---|---|
| `http://localhost` | Frontend (dev, không có camera) |
| `https://localhost` | Frontend qua HTTPS — camera và GPS hoạt động |
| `http://localhost/api/v1` | API |
| `http://localhost:9001` | MinIO console |
| `http://127.0.0.1:8080` | Adminer |

Face AI **không** expose ra host: nó chỉ nằm trên network `backend` (internal) và
chỉ được API gọi nội bộ. Kiểm tra bằng:

```powershell
docker compose exec -T api python -c "import urllib.request; print(urllib.request.urlopen('http://face-ai:8001/ready').read().decode())"
```

Migration `002_seed_local_demo` tạo hai tài khoản demo `manager@example.com` và
`member@example.com` với mật khẩu mặc định **chỉ dành cho máy local**. Bất kỳ
deployment nào mở ra Internet đều **bắt buộc** đổi mật khẩu ngay sau khi migrate:

```powershell
docker compose exec -T postgres psql -U face_attendance -d face_attendance -c "UPDATE users SET password_hash = crypt('<mat-khau-moi>', gen_salt('bf')) WHERE email = 'member@example.com';"
```

Migration revision hiện tại: `007_face_enrollment_challenges`.

```powershell
docker compose exec -T postgres psql -U face_attendance -d face_attendance -c "select version_num from alembic_version;"
```

## Test trên iPhone

Safari trên iOS **chỉ** cho phép `getUserMedia` và định vị chính xác trên
secure context, nên bắt buộc phải dùng HTTPS. Có hai đường:

### Cách 1 — Caddy trên mạng LAN (không lộ ra Internet)

1. Lấy IP LAN của máy: `ipconfig` → ví dụ `192.168.1.37`.
2. Đặt vào `.env`, dùng hostname `sslip.io` để Safari gửi được SNI:

   ```
   HTTPS_HOSTS=localhost, 192-168-1-37.sslip.io
   ```

   `192-168-1-37.sslip.io` là DNS công khai trỏ về `192.168.1.37`; truy cập vẫn
   đi thẳng trong LAN, không qua Internet.
3. `docker compose up -d proxy`
4. Cài root CA của Caddy lên iPhone (bắt buộc — iOS không cấp quyền camera cho
   site có chứng chỉ không tin cậy):

   ```powershell
   docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt .\caddy-root.crt
   ```

   Gửi file sang iPhone (AirDrop/email) → mở → **Cài đặt → Đã tải profile** → cài →
   rồi bật tin cậy tại **Cài đặt → Cài đặt chung → Giới thiệu → Cài đặt tin cậy chứng chỉ**.
5. Mở `https://192-168-1-37.sslip.io` trên Safari.

### Cách 2 — Dùng thẳng bản deploy tại `https://namnangno.click`

Chứng chỉ thật của Cloudflare, không cần cài gì lên iPhone. Xem mục
Deployment bên dưới.

## Các phase đã hoàn thành

### Phase 0 — Hạ tầng
Docker Compose với frontend, API, Face AI, PostgreSQL (pgvector), Redis, MinIO,
Adminer, Caddy. Healthcheck cho mọi service. `.env.example` không chứa secret thật.

### Phase 1 — Database
7 migration tạo 14 bảng, extension `citext`/`vector`/`pgcrypto`, index và seed demo.

### Phase 2 — Auth và RBAC

```text
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
POST /api/v1/auth/forgot-password
POST /api/v1/auth/reset-password
GET  /api/v1/auth/me
```

Refresh token có rotation và revoke. Member không gọi được API của Manager.
Dùng tên miền hợp lệ như `example.com` khi test register — `email-validator`
từ chối `.local`.

### Phase 3 — Profile và membership

```text
GET    /api/v1/members/me
PUT    /api/v1/members/me
GET    /api/v1/members/me/locations
GET    /api/v1/manager/members
POST   /api/v1/manager/members/add-by-email
GET    /api/v1/manager/members/{member_id}
PUT    /api/v1/manager/members/{member_id}
DELETE /api/v1/manager/members/{member_id}
```

Manager chỉ thêm được email đã đăng ký. Trùng membership trả `409`, không tồn tại
trả `404`. Manager không truy cập được member ngoài phạm vi của mình. Mọi thay đổi
membership đều ghi audit log.

### Phase 4 — Location và geofence

```text
GET    /api/v1/manager/locations
POST   /api/v1/manager/locations
GET    /api/v1/manager/locations/{location_id}
PUT    /api/v1/manager/locations/{location_id}
DELETE /api/v1/manager/locations/{location_id}
POST   /api/v1/manager/members/{member_id}/locations
POST   /api/v1/locations/{location_id}/evaluate
```

Kết quả geofence: `ALLOW` trong bán kính cho phép, `WARNING_REASON_REQUIRED` giữa
bán kính cho phép và bán kính cảnh báo, `BLOCK` ngoài bán kính cảnh báo,
`GPS_ACCURACY_LOW` khi sai số GPS vượt ngưỡng. Có unit test biên tại 99/100/100.1/150/200/200.1m.

### Phase 5 — Face enrollment

```text
GET  /api/v1/faces/me
POST /api/v1/faces/enrollment/start
POST /api/v1/faces/enrollment/verify
```

Challenge enrollment là bản ghi server-side, ngắn hạn, dùng một lần. Face AI từ chối
ảnh không hợp lệ với các mã `IMAGE_INVALID`, `IMAGE_TOO_SMALL`, `FACE_NOT_FOUND`,
`MULTIPLE_FACES`, `FACE_QUALITY_LOW`.

### Phase 6 — Check-in/check-out

```text
POST /api/v1/attendance/check-in
POST /api/v1/attendance/check-out
GET  /api/v1/attendance/me
GET  /api/v1/attendance/me/state
```

Request dùng `multipart/form-data` với ảnh, toạ độ GPS và idempotency key. API khoá
row của member, kiểm tra trạng thái ca đang mở, tính lại geofence và sai số GPS ở
server, verify qua Face AI, rồi lưu ảnh bằng chứng vào MinIO private trước khi ghi
sự kiện.

### Phase 6.5 — Nối model ArcFace thật

Face AI dùng SCRFD để detect + 5-point alignment, ArcFace sinh embedding 512 chiều
đã chuẩn hoá L2. Enrollment lưu embedding vào `face_embeddings` (thu hồi bản cũ);
check-in/check-out so khớp cosine 1:1 với embedding tham chiếu của chính member đó.

### Phase 6.9 — Frontend thin slice

Next.js 15 + TypeScript strict, App Router, không dùng UI library ngoài.

| Đường dẫn | Màn hình |
|---|---|
| `/login` | Đăng nhập / đăng ký |
| `/` | Bảng điều khiển: trạng thái ca, dữ liệu khuôn mặt, địa điểm, lịch sử |
| `/enroll` | Chụp và đăng ký khuôn mặt |
| `/attendance` | Lấy GPS → xem trước geofence → chụp ảnh → check-in/check-out |

Luồng cảnh báo 100–200m yêu cầu nhập lý do ngay trên giao diện trước khi gửi.

### Phase 7 — Quản lý chấm công cho Manager

```text
GET  /api/v1/manager/dashboard
GET  /api/v1/manager/attendance
GET  /api/v1/manager/attendance/{event_id}
GET  /api/v1/manager/attendance/{event_id}/image
POST /api/v1/manager/attendance/{event_id}/manual-adjust
GET  /api/v1/manager/members/{member_id}/attendance
GET  /api/v1/manager/members/{member_id}/locations
DELETE /api/v1/manager/members/{member_id}/locations/{location_id}
GET  /api/v1/manager/audit-logs
```

Giao diện quản lý tại `/manager`:

| Đường dẫn | Màn hình |
|---|---|
| `/manager` | Tổng quan: số thành viên, đang trong ca, sự kiện hôm nay |
| `/manager/attendance` | Bảng chấm công, lọc theo thành viên/địa điểm/trạng thái/loại/khoảng ngày, xem ảnh bằng chứng, điều chỉnh thủ công |
| `/manager/members` | Thêm member bằng email, đổi trạng thái, gán và gỡ địa điểm |
| `/manager/locations` | CRUD địa điểm, có nút **Dùng vị trí hiện tại của tôi** để lấy thẳng toạ độ GPS |
| `/manager/audit-logs` | Nhật ký thao tác, lọc theo loại đối tượng |

Ảnh bằng chứng **không** dùng signed URL của MinIO mà đi qua API proxy
(`GET /manager/attendance/{id}/image`) vì MinIO chỉ bind `127.0.0.1`. API kiểm tra
phạm vi quản lý trước khi trả nội dung, kèm `Cache-Control: private, no-store`.

Điều chỉnh thủ công bắt buộc nhập lý do tối thiểu 3 ký tự và luôn ghi
`ATTENDANCE_MANUALLY_ADJUSTED` vào `audit_logs` kèm `before_json`/`after_json`.

Bảng dữ liệu tự chuyển thành thẻ khi màn hình hẹp hơn 720px.

### Phase 7.1 — Sửa lỗi UI và hoàn thiện

- **Auth dùng `X-API-Key`.** Access token gửi qua header `X-API-Key`;
  `Authorization: Bearer` vẫn được chấp nhận cho client cũ.
- **Sửa lỗi bàn phím mobile tự đóng.** `Dialog` chạy lại effect focus mỗi lần
  render nên cướp focus khỏi ô đang gõ; effect nay chỉ chạy một lần khi mount.
- **Chọn vị trí không cần có mặt tại chỗ.** `POST /manager/locations/resolve-place`
  nhận địa chỉ, link Google Maps (kể cả link rút gọn, được mở server-side), hoặc
  cặp toạ độ. Kết hợp bản đồ Leaflet kéo pin và nút lấy GPS thiết bị.
  Geocoder dùng Photon, dự phòng Nominatim.
- **Hiệu ứng xác minh khuôn mặt.** Đếm ngược 3 giây, khung dẫn hướng đổi màu theo
  trạng thái, hiệu ứng quét khi đang xác minh, hiển thị số đo chất lượng trả về
  từ Face AI.
- **Sửa tràn layout.** `min-width: 0` toàn cục, ô nhập không còn vượt khỏi thẻ cha
  trên màn hình hẹp.
- Nút bấm, badge, alert và bảng được làm lại; text rút gọn theo hướng kỹ thuật.

## Face AI và model

Model để ngoài Git, mount read-only vào container:

```text
D:\face-attendance-models\detector\face_detector.onnx
D:\face-attendance-models\embedding\arcface.onnx
```

`.env.example` mặc định `FACE_AI_ENABLE_EMBEDDINGS=false`; không có model thì Face AI
báo `not_configured` và không bao giờ sinh embedding giả. Máy local bật bộ
SCRFD/ArcFace (`insightface-buffalo_l-arcface` / `w600k_r50`) bằng
`FACE_AI_ENABLE_EMBEDDINGS=true`.

**`FACE_MATCH_THRESHOLD=0.35` là giá trị tạm (provisional).** Đây là mức thường dùng
cho cosine similarity của `w600k_r50`, **chưa** được đánh giá FAR/FRR trên tập ảnh có
đồng thuận. Phải đo lại trước khi đưa vào production.

## Deployment

Bản public chạy tại **https://namnangno.click**, phục vụ từ chính máy dev qua
Cloudflare Tunnel — không mở port nào trên router.

```text
Internet -> Cloudflare edge (TLS that) -> tunnel container -> proxy (Caddy) -> frontend / api
```

- Service `tunnel` trong `docker-compose.yml` chạy named tunnel
  `namnangno-tunnel`, ingress khai báo ở [proxy/cloudflared.yml](proxy/cloudflared.yml).
- Credentials của tunnel nằm ngoài repo, đường dẫn khai báo qua
  `CLOUDFLARED_CREDENTIALS_FILE` trong `.env`.
- Cloudflare kết nối tới Caddy qua network Docker nội bộ; không service nào của
  stack cần publish ra host để site chạy.
- API, MinIO và Adminer chỉ bind `127.0.0.1`. Face AI không bind gì cả.

Khởi động lại bản deploy:

```powershell
docker compose up -d
docker compose logs tunnel --tail 20
```

Cấu hình tunnel trước đây (site tĩnh trong `D:\Projects\namnangno`) được lưu tại
`config.yml.before-face-attendance` trong thư mục `.cloudflared` nếu cần khôi phục.

### Bắt buộc trước khi cho người thật dùng

- [ ] Bật **Cloudflare Access** cho `namnangno.click` để chỉ email được duyệt mới vào được.
- [ ] Đổi toàn bộ secret trong `.env` (đã làm khi deploy lần đầu, phải lặp lại nếu clone sang máy khác).
- [ ] Đổi mật khẩu tài khoản demo do migration `002` tạo ra.
- [ ] Thêm rate limit cho `/auth/login` (Phase 9).
- [ ] Thêm liveness/anti-spoofing (chưa có provider).

## Known issues

Những mục dưới đây **chưa** được làm — đừng giả định là đã có:

- **Không có liveness / anti-spoofing.** Chụp lại ảnh trên màn hình vẫn qua được
  xác thực. Đang chờ chọn provider thương mại. `liveness_score` luôn `NULL`.
- **Chưa rate-limit.** Redis đã chạy nhưng chưa dùng cho login/enrollment/verify.
- **Chỉ điều chỉnh thủ công mới ghi audit log cho attendance**; sự kiện check-in/check-out do member tạo thì không.
- **Test tự động mới chỉ phủ geofence** (`api/tests/test_geofence.py`).
- `S3_SERVER_SIDE_ENCRYPTION=false` cho MinIO local; production phải bật lại.
