# CLAUDE.md

Hướng dẫn làm việc trên repo này. Đọc file này trước khi bắt đầu bất kỳ phase nào.

## 1. Nguồn sự thật

Spec nằm trong [`docs/`](docs/) và **luôn thắng** khi mâu thuẫn với code:

| File | Dùng khi |
|---|---|
| `ARCHITECTURE.md` | **Đọc trước tiên.** Kiến trúc hiện tại, mô hình quyền, quyết định thiết kế |
| `INSTALL.md` | Dựng lại hệ thống trên máy khác |
| `USER_GUIDE.md` | Người quản lý và thành viên dùng thế nào |
| `00_MASTER_SPEC.md` | Definition of Done tổng thể, nguyên tắc bảo mật |
| `03_DATABASE_SCHEMA.md` | Trước khi viết migration |
| `04_API_CONTRACT.md` | Trước khi thêm/sửa endpoint hoặc error code |
| `10_IMPLEMENTATION_PHASES.md` | Xác định phase hiện tại và acceptance criteria |
| `11_CLAUDE_EXECUTION_RULES.md` | Quy trình thực thi và format báo cáo |

Không sửa file spec trừ khi người dùng yêu cầu rõ ràng.

## 2. Quy trình mỗi phase

1. Đọc code hiện tại trước khi sửa.
2. Chỉ làm phase hiện tại và những thứ bắt buộc phải có để phase đó chạy được.
3. Chạy test/lint/typecheck liên quan.
4. Chạy thật ứng dụng, không chỉ đọc code.
5. Báo cáo theo format ở `11_CLAUDE_EXECUTION_RULES.md` (PHASE / STATUS / Implemented / Tests / Acceptance / Changed files / Known issues).
6. **Không đánh dấu PASS cho acceptance chưa được kiểm chứng bằng chạy thật.**
7. Một phase = một commit.

## 3. Nguyên tắc không thể phá vỡ

- **Không giả lập AI.** Nếu model chưa sẵn sàng, trả `FACE_MODEL_NOT_CONFIGURED`. Tuyệt đối không sinh embedding giả, score giả, hay liveness giả.
- **Không so vector giữa hai engine.** 128 số của dlib và 512 số của ArcFace ở hai không gian khác nhau; so vẫn ra điểm số nhưng là nhiễu. Lệch engine thì trả `FACE_ENGINE_MISMATCH`.
- **Phân quyền và phạm vi dữ liệu là hai câu hỏi tách rời.** `require_screen`/`require_action` quyết định mở được màn hình nào; `_scope()`/`owner_filter()` quyết định thấy dữ liệu của ai. Cấp quyền không bao giờ mở rộng phạm vi.
- **Server quyết định.** Không tin dữ liệu từ client: `member_id`, khoảng cách GPS, face score, role, URL ảnh. Geofence và face verify luôn tính lại ở backend.
- **Migration-only.** Không sửa schema bằng SQL tay; luôn thêm file trong `api/migrations/versions/` với số thứ tự kế tiếp.
- **Không commit secret.** `.env` bị gitignore. Model `.onnx` nằm ngoài Git (`D:\face-attendance-models`), mount read-only.
- **Ảnh bằng chứng là private.** MinIO không public; truy cập qua signed URL hoặc API proxy.

## 4. Kiến trúc

```
router  ->  service  ->  psycopg  ->  PostgreSQL
```

- Route handler chỉ parse input và gọi service. Business logic nằm ở `api/app/services/`.
- Face AI là service riêng (`face-ai/`), chỉ gọi được từ API qua network `backend` (internal). Không expose ra host.
- `api/app/domain/` chứa logic thuần (geofence) — dễ unit test, không chạm DB.

## 5. Style code

**Python (api, face-ai)**
- Không viết comment giải thích code hiển nhiên; chỉ comment khi lý do không đọc được từ code.
- Tên biến đầy đủ: `gps_accuracy_meters`, không phải `acc`.
- SQL raw qua `psycopg`, không dùng SQLAlchemy ORM models.
- Migration viết bằng `op.execute("""...""")` với SQL thuần.
- Error code là chuỗi UPPER_SNAKE trả trong `detail` (ví dụ `WARNING_REASON_REQUIRED`), không phải câu văn.

**TypeScript (frontend)**
- Next.js App Router, TypeScript strict, không dùng `any`.
- Không dùng UI library ngoài; component tự viết trong `frontend/components/`, style bằng class trong `frontend/app/globals.css`.
- Design token định nghĩa một lần ở `:root` trong `globals.css` — dùng `var(--...)`, không hard-code màu/khoảng cách.
- Text hiển thị bằng tiếng Việt. Map error code sang câu tiếng Việt trong `frontend/lib/messages.ts`.

## 6. Design system

Theo skill `design-system` (dark cloud-platform aesthetic):

- Font: IBM Plex Sans. Type scale: 12/14/16/20/24/32.
- Màu: primary `#0c5cab`, success `#10b981`, warning `#f59e0b`, danger `#ef4444`, surface `#09090b`, text `#fafafa`.
- Spacing: lưới 8pt.
- Touch target tối thiểu 44px, focus-visible luôn hiện, tôn trọng `prefers-reduced-motion`, WCAG 2.2 AA.
- Mọi màn hình phải xử lý đủ 4 trạng thái: empty / loading / error / success.

## 7. Vận hành

Xem `docs/13_OPERATIONS_RUNBOOK.md`. Tóm tắt:

- `GET /health` = liveness (không chạm dependency). `GET /ready` = readiness, trả **503** khi Postgres hoặc object storage chết. Redis và face-ai được báo cáo nhưng không bắt buộc.
- Log là JSON một dòng một sự kiện, có `request_id`; mỗi response trả kèm header `X-Request-ID`.
- `GET /metrics` theo định dạng Prometheus, **không route ra ngoài** qua Caddy.
- Sao lưu: `./scripts/backup.sh ./backups`. Diễn tập khôi phục: `./scripts/restore.sh <thư mục> --into face_attendance_restore_test --database-only`.
- **Thư mục `backups/` chứa ảnh khuôn mặt và hash mật khẩu** — đã gitignore, phải mã hoá khi mang đi.
- Chạy production: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` (bỏ Adminer, không publish port nào trừ proxy).

## 8. Bảo mật đã có (đừng gỡ khi refactor)

- **Rate limit** qua Redis ở `api/app/security.py`. Login giới hạn theo cả IP lẫn email; đăng ký/quên mật khẩu theo IP; chấm công và nhận diện theo user. Fail-open khi Redis lỗi — đây là phanh chống brute-force, không phải cổng phân quyền.
- **Upload ảnh** xác thực bằng magic byte, không tin `Content-Type` của client. Ảnh trả về luôn qua `safe_image_content_type()`; nếu bỏ bước này thì một tệp HTML tải lên sẽ được phục vụ lại từ origin của API và thành stored XSS.
- **Link bản đồ** chỉ được fetch nếu host nằm trong allowlist ở `places.py`, kiểm lại từng bước redirect. Bỏ ra là mở lại SSRF vào mạng nội bộ.
- **Idempotency key** phải lọc kèm `member_id`; cột này unique toàn cục nên truy vấn không lọc sẽ trả bản ghi của người khác.
- Chạy lại bộ kiểm bảo mật:
  ```powershell
  docker compose run --rm -v "D:ace-attendancepi:/src:ro" -w /src -e PROBE_BASE_URL=http://api:8000/api/v1 api python -m tests.security_probe
  ```

## 9. Lệnh hay dùng

```powershell
docker compose up -d --build
docker compose ps
docker compose logs api --tail 50

# Migration hiện tại
docker compose exec -T postgres psql -U face_attendance -d face_attendance -c "select version_num from alembic_version;"

# Unit test backend (image production không chứa tests, mount source vào)
docker run --rm -v "${PWD}/api:/src:ro" -w /src face-attendance-api python -m unittest discover -s tests -t .

# Typecheck frontend (next build đã chạy tsc; chạy riêng thì cần npm install)
docker compose build frontend
```

Tài khoản demo do migration `002_seed_local_demo` tạo ra chỉ dùng cho máy local. Mật khẩu trên môi trường public đã được đổi và **không được ghi vào repo** — hỏi người dùng nếu cần.

## 10. Trạng thái hiện tại

- **Xong:** Phase 0–10, cộng các đợt mở rộng sau roadmap: nhận diện bằng OpenCV + face_recognition, phân quyền theo màn hình và hành động, nhóm có mã cho người mới xin vào, duyệt đổi khuôn mặt, mã lỗi tra cứu được, cách ly dữ liệu theo địa điểm, một người một quản lý, một phiên mỗi ngày, và màn hình **Quản lý nhóm** gộp cả duyệt người / địa điểm / chỉnh công / đổi khuôn mặt.
- **Migration hiện tại:** `020_session_policy`.
- **Tiếp theo:** xem mục 9 và 10 trong `docs/ARCHITECTURE.md`.
- **Đã deploy:** https://namnangno.click, chạy từ máy dev qua Cloudflare Tunnel (service `tunnel` trong compose).
- **Nợ kỹ thuật đã biết:** xem mục "Known issues" trong [README.md](README.md).

## 11. Những thứ CHƯA có — đừng giả định là đã có

- Liveness / anti-spoofing: **không có**. Ảnh chụp lại màn hình vẫn qua được. Đang chờ chọn provider thương mại.
- Ca qua đêm (22:00–06:00): **không lưu được**, do ràng buộc `expected_check_in < expected_check_out`.
- `face-ai` nạp **cả hai** engine dù chỉ dùng `face_recognition` — tốn khoảng 250 MB thường trực.
- Lịch sao lưu tự động: **chưa có**. Script đã có nhưng phải chạy tay, chưa gắn cron.
- Tài khoản demo `manager@example.com` / `member@example.com` từ migration 002 **vẫn tồn tại và đang ACTIVE** trên bản deploy công khai (manager@example.com đang quản lý 3 thành viên). Cân nhắc đổi mật khẩu hoặc chuyển sang SUSPENDED.
- Retention dữ liệu sinh trắc học: **chưa có**. `07_SECURITY_PRIVACY.md` §6 yêu cầu thời hạn lưu cấu hình được và không giữ vô hạn — hiện ảnh bằng chứng và embedding được giữ mãi, chưa có job dọn.
- Test tự động: `api/tests/` có geofence + kiểm tra ảnh tải lên (unit) và `security_probe.py` (chạy trên stack thật). Frontend chưa có test trong repo — kiểm chứng giao diện đang làm thủ công bằng Playwright ngoài repo.
- Service worker (`frontend/public/sw.js`) chỉ cache app shell và asset tĩnh. **Không cache `/api/*`** — dữ liệu chấm công và ảnh bằng chứng không bao giờ được ghi xuống cache trình duyệt. Đổi chiến lược thì phải tăng `CACHE_VERSION`.
- Offline chỉ mở được app và báo lỗi tử tế; **không có hàng đợi chấm công offline** — mọi lượt check-in/check-out đều cần mạng vì server mới là nơi xác thực.
- `FACE_MATCH_THRESHOLD` hiện là **giá trị tạm** chưa qua đánh giá FAR/FRR.
