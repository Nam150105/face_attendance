# Operations Runbook — Backup, Restore and Monitoring

Vận hành hệ thống đang chạy. Không phải spec — spec nằm ở các file 00–12.

## 1. Dữ liệu cần bảo vệ

| Nơi lưu | Nội dung | Mất thì sao |
|---|---|---|
| Postgres | Tài khoản, phân công, bản ghi chấm công, nhật ký, **embedding khuôn mặt** | Mất toàn bộ lịch sử và hồ sơ sinh trắc học |
| MinIO (bucket riêng tư) | **Ảnh chụp lúc chấm công** | Mất bằng chứng đối chiếu |
| `.env` | Secret: `JWT_SECRET`, khoá S3, mật khẩu DB | Không giải mã được backup cũ, mọi phiên đăng nhập hỏng |

`.env` **không nằm trong Git**. Phải cất riêng, ở nơi khác với bản backup dữ liệu.

> Bản backup chứa ảnh khuôn mặt và hash mật khẩu. Nó nhạy cảm ngang hệ thống đang chạy: mã hoá trước khi mang đi, và đừng để cùng một máy với bản gốc. Thư mục `backups/` đã được gitignore.

## 2. Sao lưu

```sh
./scripts/backup.sh ./backups
```

Tạo `backups/<UTC timestamp>/` gồm:

- `database.dump` — `pg_dump -Fc`, khôi phục được từng bảng
- `objects.tar` — toàn bộ ảnh trong bucket riêng tư
- `alembic_version.txt` — phiên bản migration lúc sao lưu
- `manifest.txt` — thời điểm, phiên bản schema, dung lượng

Kiểm nhanh một bản backup còn dùng được:

```sh
cat backups/<stamp>/manifest.txt
tar -tf backups/<stamp>/objects.tar | head
```

**Nhịp đề xuất:** hằng ngày, giữ 7 bản gần nhất + 1 bản mỗi tháng. Chưa có cron — hiện phải chạy tay hoặc tự đặt lịch ngoài hệ thống.

## 3. Khôi phục

### 3.1 Diễn tập (an toàn, không đụng dữ liệu thật)

Đây là cách kiểm chứng bản backup dùng được. Nên chạy sau mỗi lần đổi schema.

```sh
./scripts/restore.sh backups/<stamp> --into face_attendance_restore_test --database-only
```

Script in ra `alembic=`, `users=`, `attendance_events=` của DB vừa phục hồi — **so với DB thật**:

```sh
docker compose exec -T postgres psql -U face_attendance -d face_attendance -tAc \
  "select 'users='||count(*) from users; select 'attendance_events='||count(*) from attendance_events;"
```

Ảnh thì phục hồi vào bucket khác:

```sh
docker compose exec -T api sh -c 'cat > /tmp/objects.tar' < backups/<stamp>/objects.tar
docker compose exec -T api python - load --bucket restore-test < ./scripts/object_store.py
docker compose exec -T api python - count --bucket restore-test < ./scripts/object_store.py
```

Dọn sau khi diễn tập xong:

```sh
docker compose exec -T postgres psql -U face_attendance -d postgres \
  -c "DROP DATABASE IF EXISTS face_attendance_restore_test WITH (FORCE)"
docker compose exec -T api sh -c 'rm -f /tmp/objects.tar'
```

### 3.2 Khôi phục thật (khi đã mất dữ liệu)

```sh
docker compose stop api            # ngừng ghi mới trước
./scripts/restore.sh backups/<stamp>
docker compose start api
docker compose exec -T api sh -c 'python -c "import urllib.request;print(urllib.request.urlopen(\"http://localhost:8000/ready\").read())"'
```

Script **hỏi xác nhận** bằng cách bắt gõ đúng tên database, vì thao tác này xoá sạch DB hiện tại.

Nếu bản backup cũ hơn code đang chạy, `alembic upgrade head` sẽ chạy khi api khởi động lại và đưa schema lên phiên bản mới.

## 4. Theo dõi

### Health vs Ready

| Endpoint | Trả lời câu hỏi | Dùng cho |
|---|---|---|
| `GET /health` | Tiến trình còn sống không? | Liveness. **Không** chạm dependency, nên Postgres chập chờn không làm orchestrator restart API |
| `GET /ready` | Có phục vụ được ngay bây giờ không? | Readiness. Kiểm Postgres, Redis, MinIO, face-ai |

`/ready` trả **503** khi một dependency **bắt buộc** chết (Postgres, object storage). Redis và face-ai được báo cáo nhưng không bắt buộc: rate limit fail-open, còn face-ai chết thì chấm công lỗi có mã rõ ràng chứ cả hệ thống không sập.

```sh
docker compose exec -T api python -c "import urllib.request,json;print(json.dumps(json.loads(urllib.request.urlopen('http://localhost:8000/ready').read()),indent=2))"
```

### Logs

Log là JSON một dòng một sự kiện, có `request_id`:

```sh
docker compose logs api --tail 100
docker compose logs api --since 15m | grep '"level": "ERROR"'
docker compose logs api | grep '"status": 5'          # lỗi phía server
docker compose logs api | grep '<request-id>'         # lần theo một request cụ thể
```

Mỗi response đều có header `X-Request-ID`. Người dùng báo lỗi thì xin họ giá trị này để tra đúng dòng log.

Chỉnh độ chi tiết bằng `LOG_LEVEL` (mặc định `INFO`).

### Metrics

`GET /metrics` theo định dạng Prometheus: số request theo route/status, histogram độ trễ, uptime.

**Không route ra ngoài** — Caddy chỉ đẩy `/api/*` và `/health` sang API, nên `/metrics` chỉ gọi được từ trong mạng nội bộ:

```sh
docker compose exec -T api python -c "import urllib.request;print(urllib.request.urlopen('http://localhost:8000/metrics').read().decode())"
```

Label dùng route template (`/api/v1/manager/attendance/{event_id}`) chứ không dùng path thật, để không sinh một series cho mỗi UUID.

## 5. Chạy ở production

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Overlay này:

- **bỏ hẳn Adminer** (là client database đầy đủ, không được chạy ở production)
- **không publish port nào ra host trừ proxy** — Postgres, Redis, MinIO, API, frontend chỉ nghe trong mạng docker
- đổi healthcheck của API sang `/ready`
- ép `AUTH_DEBUG_RETURN_RESET_TOKEN=false`

Trước khi mở cho người dùng thật, kiểm lại:

```sh
docker compose exec -T api python -c "
import os
print('JWT_SECRET default?', os.environ['JWT_SECRET'] in {'change-me-local-only','change-me'})
print('debug reset token:', os.environ.get('AUTH_DEBUG_RETURN_RESET_TOKEN'))
print('CORS:', os.environ.get('CORS_ALLOW_ORIGINS'))"
```

Và xoá tài khoản demo do migration `002_seed_local_demo` tạo ra nếu môi trường này công khai:

```sh
docker compose exec -T postgres psql -U face_attendance -d face_attendance \
  -c "select email, role, status from users where email like '%@example.com'"
```
