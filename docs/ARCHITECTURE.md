# Kiến trúc hệ thống

Tài liệu cho người tiếp nhận, bảo trì hoặc nâng cấp. Mô tả hệ thống **đang chạy**, kèm lý do của những quyết định không hiển nhiên.

> Khác với `02_ARCHITECTURE.md` — tệp đó là đặc tả thiết kế ban đầu. Tệp này mô tả cái đang chạy thật; khi hai bên lệch nhau, tệp này đúng về hiện trạng.

Cập nhật: 2026-09-10 · migration `021_record_overrides`

---

## 1. Bức tranh chung

```
Trình duyệt
    │  HTTPS
    ▼
proxy (Caddy) ──── tunnel (cloudflared) ──── Internet
    │
    ├── frontend (Next.js, App Router)
    └── api (FastAPI)
            ├── postgres (+ pgvector)   dữ liệu nghiệp vụ và vector khuôn mặt
            ├── minio                   ảnh khuôn mặt, ảnh bằng chứng
            ├── redis                   giới hạn tần suất
            └── face-ai                 nhận diện khuôn mặt (mạng nội bộ)
```

**`face-ai` không bao giờ lộ ra ngoài.** Nó chỉ nhận yêu cầu từ `api` qua mạng `backend` nội bộ. Ai gọi thẳng được nó là gọi được cả việc trích đặc trưng khuôn mặt.

### Nguyên tắc xuyên suốt

| | |
|---|---|
| **Máy chủ quyết định** | Không tin `member_id`, khoảng cách GPS, điểm khuôn mặt hay vai trò do thiết bị gửi lên. Geofence và nhận diện luôn tính lại ở backend |
| **Chỉ đổi schema bằng migration** | Không sửa cấu trúc bằng SQL tay. Mỗi thay đổi là một tệp trong `api/migrations/versions/` |
| **Không giả lập AI** | Mô hình chưa sẵn sàng thì trả `FACE_MODEL_NOT_CONFIGURED`. Không sinh embedding giả, điểm giả |
| **Ảnh là riêng tư** | MinIO không public. Truy cập qua API proxy có kiểm tra phạm vi |

---

## 2. Luồng dữ liệu

### Router → Service → psycopg → PostgreSQL

Router chỉ phân tích đầu vào và gọi service. Nghiệp vụ nằm trong `api/app/services/`. SQL viết thô qua `psycopg`, không dùng ORM.

`api/app/domain/` chứa logic thuần (geofence) — kiểm thử đơn vị được, không chạm cơ sở dữ liệu.

### Nhận diện khuôn mặt

```
Ảnh tải lên
  ↓ cv2.imdecode                  OpenCV giải mã, từ chối thứ không phải ảnh
  ↓ cv2.Laplacian(...).var()      độ nét — ảnh nhoè bị loại tại đây
  ↓ mean(grayscale)               độ sáng
  ↓ cv2.createCLAHE               bù sáng khi phòng tối
  ↓ cv2.cvtColor BGR→RGB          face_recognition đọc RGB, OpenCV giải mã BGR
  ↓ face_recognition.face_locations(model="hog")
  ↓ face_recognition.face_landmarks()
  ↓ face_recognition.face_encodings()   → vector 128 chiều (dlib ResNet)
  ↓ face_recognition.face_distance()    → khoảng cách Euclid, ngưỡng 0.6
```

Loại ảnh hỏng ở bước OpenCV tốn vài mili giây; để lọt thì cái giá là nhận nhầm người.

**Vector của hai engine không bao giờ đem so với nhau.** 128 số của dlib và 512 số của ArcFace ở hai không gian khác nhau; so vẫn ra một điểm số trông hợp lý nhưng vô nghĩa. Mỗi vector lưu kèm `model_name`, và `/v1/verify` từ chối với `FACE_ENGINE_MISMATCH` nếu lệch.

Số đo thực tế (ba chân dung phạm vi công cộng): cùng một người **0.144**, hai người khác nhau **0.703**, ngưỡng **0.6**.

**Số đo hiện ra cho chính người bị đo.** Màn hình đăng ký khuôn mặt in ra độ nét, độ sáng, số khuôn mặt tìm thấy và số chiều của vector; màn hình chấm công in ra khoảng cách và ngưỡng đã dùng (`face_distance`, `face_threshold`, `face_engine` trong phản hồi check-in/check-out). Một hệ thống đọc khuôn mặt người ta mà không cho người ta xem con số đã quyết định thay mình thì không có gì để kiểm chứng.

---

## 3. Mô hình dữ liệu

### Người và quan hệ

```
users ──1:1── member_profiles
  │
  ├──< manager_memberships >── users        ai quản ai, kèm trạng thái duyệt
  │         │
  │         └── teams                       đơn vị người đó xin vào
  │
  ├──< face_embeddings                      vector khuôn mặt đang dùng + đã thu hồi
  ├──< face_change_requests                 yêu cầu đổi ảnh, chờ duyệt
  ├──< attendance_events                    từng lượt vào/ra
  ├──< login_attempts                       lịch sử đăng nhập
  └──< refresh_sessions                     phiên đăng nhập (một phiên/tài khoản)
```

`manager_memberships.status`: `PENDING` → `ACTIVE` / `REJECTED`, hoặc `SUSPENDED` / `REMOVED`.

**Một người, một người quản lý.** Chỉ số duy nhất từng phần `idx_membership_one_manager` (`member_user_id WHERE status = 'ACTIVE'`) là chốt cuối; ba lối vào — xin vào nhóm, duyệt yêu cầu, thêm bằng email — kiểm trước và trả `ALREADY_HAS_MANAGER` để người dùng đọc được câu tiếng Việt thay vì lỗi CSDL. Chuyển người sang nhóm khác thì người quản lý cũ gỡ ra trước; như vậy không ai mất người mà không biết.

Bản ghi thì vẫn có thể nằm ở địa điểm của người khác (đổi nhóm, bàn giao địa điểm). Quyền đọc bản ghi tính theo **địa điểm**, không theo danh sách người đang quản.

### Nơi chấm công

```
locations ──< member_locations >── users     gán riêng cho một người
locations ──< team_locations  >── teams      gán cho cả nhóm (quy tắc)
```

**Nơi một người chấm công được = hợp của hai nguồn**, tính bằng truy vấn chứ không sao chép:

```sql
SELECT location_id FROM member_locations WHERE member_id = ?
UNION
SELECT tl.location_id FROM team_locations tl
JOIN manager_memberships mm ON mm.team_id = tl.team_id
WHERE mm.member_user_id = ? AND mm.status = 'ACTIVE'
```

Nếu sao chép địa điểm của nhóm vào `member_locations` lúc duyệt, thì mọi thay đổi sau đó cần một lượt quét đồng bộ, và rời nhóm sẽ để lại quyền truy cập. Tính bằng truy vấn thì không có gì để lệch.

### Phân quyền

`role_permissions (role, screen, can_view, can_create, can_edit, can_delete)` — 20 màn hình × 3 vai trò.

Ràng buộc trong CSDL: không cấp được thêm/sửa/xoá khi chưa cấp xem. Được xoá thứ mình không nhìn thấy là cái bẫy, không phải quyền.

---

## 4. Mô hình quyền — hai câu hỏi tách rời

Nhầm lẫn hai câu hỏi này là cách hệ thống trao quyền xoá cho người chỉ cần đọc.

### Câu hỏi 1: mở được màn hình nào?

`require_screen(screen)` / `require_action(screen, action)` đọc `role_permissions`. Quản trị hệ thống sửa được lưới này tại `/admin/roles`, có nút khôi phục mặc định.

### Câu hỏi 2: thấy dữ liệu của ai?

Tách hẳn, nằm ở `api/app/services/permissions.py` và `_scope()`:

| Vai trò | Thấy lượt chấm công nào |
|---|---|
| `SUPER_ADMIN` | Tất cả |
| `MANAGER` | Lượt tại **địa điểm mình sở hữu**, cộng lượt của chính mình ở bất cứ đâu |
| Khác | Chỉ của chính mình |

> **Vì sao theo địa điểm chứ không theo "ai quản ai".** Hai người quản lý có thể cùng quản một người. Nếu lọc theo "người tôi quản", mỗi bên đọc được dữ liệu cơ sở của bên kia thông qua người chung đó. Lọc theo "chuyện này xảy ra ở nơi của ai" mới đúng ý nghĩa.

Hồ sơ (tên, điện thoại, ảnh khuôn mặt) **vẫn dùng chung** vì cả hai người quản lý đều cần liên hệ và đối chiếu.

Cấp quyền chỉ mở cửa màn hình, không mở rộng phạm vi dữ liệu. Cho một thành viên quyền xem "Bản ghi" thì họ thấy bản ghi của chính mình.

---

## 5. Những quyết định không hiển nhiên

### Đổi khuôn mặt phải qua duyệt

Khuôn mặt đã đăng ký là thứ mọi lượt chấm công đối chiếu vào. Nếu chính tài khoản đó thay được, phép kiểm không chứng minh gì: đổi bản đối chiếu là mặt ai cũng qua.

Nên: lần đầu áp dụng ngay (không có gì để so, và cửa vào đã chặn ở bước duyệt nhóm), lần sau vào bảng `face_change_requests` chờ người khác duyệt. Chỉ mục unit một phần đảm bảo mỗi người chỉ một yêu cầu treo. Không ai tự duyệt cho mình.

### Một thiết bị hay nhiều thiết bị, do quản trị hệ thống chọn

Bảng `session_policies (role, allow_multiple_devices)` quyết định từng vai trò có bị giữ ở một thiết bị hay không; màn hình **Phân quyền** là nơi bật tắt. Trước đây quy tắc nằm trong biến môi trường `SINGLE_SESSION_ROLES`, tức là muốn đổi phải sửa tệp và khởi động lại — đó là quyết định vận hành, không phải quyết định triển khai.

Cột `refresh_sessions.enforce_single_session` vẫn là thứ chỉ số duy nhất từng phần dựa vào, nên tắt bật không đụng gì tới ràng buộc cũ. Bật giới hạn có hiệu lực **ngay**: mỗi người giữ phiên mới nhất, các phiên còn lại đóng với lý do `DEVICE_POLICY_CHANGED`. Tắt thì không ai bị đăng xuất.

### Một phiên đăng nhập mỗi tài khoản

`refresh_sessions` có chỉ mục unit một phần trên phiên đang hoạt động. Mọi request đều kiểm tra trạng thái phiên trong CSDL, không chỉ chữ ký JWT — nếu chỉ tin chữ ký thì thu hồi phiên không có tác dụng cho tới khi token hết hạn.

### Một phiên mỗi ngày

Đã có một cặp vào–ra trong ngày (cắt theo `APP_TIMEZONE`) thì lượt vào tiếp theo bị từ chối với `ALREADY_WORKED_TODAY`. Không có ràng buộc này thì chấm ra lúc 17:00 rồi chấm vào lúc 17:01 sinh ra hai ngày công cho cùng một ngày. Phiên còn mở vẫn bị chặn như cũ bằng `CHECK_IN_ALREADY_EXISTS`, và phiên quên chấm ra tự đóng sau 24 giờ.

### Chấm ra ở nơi khác nơi chấm vào

Mặc định giờ ra ghi vào đúng địa điểm đã mở phiên. Chọn nơi khác thì nơi đó phải nằm trong danh sách được gán, và phải có lời giải trình (`CHECKOUT_LOCATION_REASON_REQUIRED` nếu thiếu). Bản ghi khi đó mang trạng thái `WARNING_CONFIRMED` — vẫn hợp lệ, vẫn tính công, nhưng người quản lý nhìn là thấy ngay có chuyện cần đọc. Geofence tính lại theo nơi được chọn, không phải nơi chấm vào.

### Ngày cắt theo múi giờ tổ chức

`APP_TIMEZONE`, mặc định `Asia/Ho_Chi_Minh`. Gộp theo UTC thì một lượt vào lúc 6 giờ sáng bị tính sang ngày hôm trước, và số liệu hai màn hình sẽ khác nhau cho cùng một ngày.

### Lỗi trả về mã, không trả nội dung

Lỗi không lường trước sinh một mã sáu ký tự (bảng chữ không có `O/0`, `I/1` vì mã được đọc qua điện thoại), ghi vào `error_events` kèm traceback. Người dùng chỉ thấy mã; quản trị viên tra tại `/admin/errors`.

Thông báo do **ứng dụng tự viết** (ví dụ "Bạn đã từ chối quyền truy cập vị trí") vẫn hiện nguyên văn — chúng được viết cho người đọc. Đánh dấu bằng cờ `userFacing`.

### Menu ngắn, màn hình gộp

Người quản lý có bốn mục: Tổng quan nhóm, Bản ghi, Quản lý nhóm, Nhật ký. Bốn màn hình cũ — yêu cầu vào nhóm, đổi khuôn mặt, duyệt chỉnh công, địa điểm — vẫn còn khoá quyền riêng ở phía máy chủ nhưng không nằm trong menu nữa (`hidden: true` trong `screens.ts`); nội dung của chúng nằm trong **Quản lý nhóm**. Duyệt người và giao việc cho người là một việc; tách ra bốn màn hình là cách để quên mất một trong bốn.

### Một dòng một người, phần còn lại nằm sau cú chạm

Danh sách chấm công theo ngày, ngày công trong hồ sơ thành viên và bảng công cá nhân đều là **một dòng một bản ghi** (`.day-line`, `.line`), không phải bảng. Bảng HTML trên điện thoại tự xếp thành bảy cặp nhãn–giá trị cho mỗi người, nên mười người là một trang không ai đọc nổi. Ô lịch trên màn hình hẹp cũng chỉ hiện số lượt thay vì xếp chồng ảnh đại diện, để mọi tuần cao bằng nhau.

### Không quyền thì không thấy

Màn hình không được cấp thì không có trong menu, và gõ thẳng URL sẽ bị chuyển hướng lặng lẽ về màn hình dùng được. Báo cho ai đó rằng họ thiếu một quyền họ không tự cấp được là một ngõ cụt.

### Sửa bản ghi: ý kiến người nằm cạnh số máy đo

`manual_adjust` sửa được giờ, địa điểm, trạng thái, giải trình và hai phán quyết — vị trí có hợp lệ không, khuôn mặt có khớp không. Cái nó **không** sửa là `face_match_score`, `face_distance` và `distance_meters`: đó là những gì máy đo được, và một bản ghi đã sửa mà lặng lẽ mang điểm số bịa ra thì tệ hơn là không sửa.

Vì vậy phán quyết của người nằm ở cột riêng: `face_verdict_override`, `location_verdict_override` (NULL = chưa ai ghi đè, đọc theo máy). Giờ thì sửa thẳng — đó là số đọc từ đồng hồ, không phải phép đo con người — nhưng `original_server_time` giữ lại giá trị đầu tiên. `edited_at` / `edited_by` / `edit_reason` trả lời câu "ai sửa, lúc nào, vì sao", và nhật ký giữ cả trước lẫn sau.

Sửa theo **từng lượt**: một ngày công là hai bản ghi, màn hình cho chọn lượt vào hay lượt ra rồi nạp form theo lượt đó.

### Xoá mềm và xoá vĩnh viễn

Người quản lý chỉ xoá mềm (`deleted_at`, `deleted_by`, `delete_reason`) — bản ghi biến khỏi danh sách nhưng ảnh bằng chứng còn nguyên và quản trị viên khôi phục được. Xoá vĩnh viễn là quyền của quản trị hệ thống.

**Đơn vị để xoá là ngày công, không phải sự kiện.** Cái người quản lý nhìn thấy trên màn hình là một *phiên* — lượt vào và lượt ra gộp thành một dòng — nên `DELETE /manager/attendance/day` xoá cả ngày của người đó: vào, ra, và mọi lần bị từ chối trong ngày. Xoá lẻ một sự kiện để lại nửa kia, và lần vẽ lại kế tiếp đem ảnh lúc ra đặt vào ô ảnh lúc vào: một bản ghi không ai tạo ra, ráp từ phần còn sót của bản ghi vừa bị xoá. Nhật ký vẫn ghi từng sự kiện một để khôi phục lẻ được.

---

## 6. Bảo mật đã có — đừng gỡ khi refactor

| Cơ chế | Ở đâu | Gỡ ra thì sao |
|---|---|---|
| Giới hạn tần suất qua Redis | `api/app/security.py` | Mở lại brute-force. Fail-open khi Redis lỗi — đây là phanh, không phải cổng phân quyền |
| Kiểm tra magic byte của ảnh | `validate_image_upload` | Tệp HTML tải lên sẽ được phục vụ lại từ origin của API → stored XSS |
| `safe_image_content_type()` | Mọi endpoint trả ảnh | Như trên |
| Allowlist host cho liên kết bản đồ | `places.py` | Mở lại SSRF vào mạng nội bộ |
| Idempotency key lọc kèm `member_id` | `attendance.py` | Cột unique toàn cục; không lọc thì trả bản ghi của người khác |
| Không ghi log token | `errors.py`, `auth.py` | |

---

## 7. Cấu trúc mã nguồn

```
api/
  app/
    routers/      chỉ parse đầu vào và gọi service
    services/     nghiệp vụ
      permissions.py   phân quyền và phạm vi dữ liệu — đọc trước khi sửa
      attendance.py    check-in/out, quy tắc giờ
      teams.py         nhóm, mã, duyệt vào nhóm, địa điểm của nhóm
      face_requests.py duyệt đổi khuôn mặt
    domain/       logic thuần, không chạm CSDL
    errors.py     bắt lỗi không lường trước → mã tra cứu
  migrations/versions/   chỉ thêm, không sửa tệp đã chạy
  tests/        probe chạy trên hệ thống thật

face-ai/
  app/recognition.py    OpenCV + face_recognition
  app/face_pipeline.py  điều phối, có engine ONNX thay thế

frontend/
  app/          Next.js App Router, một thư mục một màn hình
  components/
    Shell.tsx           khung dùng chung cho mọi vai trò
    SelectableTable.tsx bảng chọn nhiều dòng + thao tác hàng loạt
    AttendanceCalendar.tsx lịch tháng; trả ngày được chọn về cho trang
  lib/
    screens.ts    danh sách màn hình, nhóm menu, thứ tự theo vai trò
    permissions.ts ẩn nút theo quyền (chỉ là phép lịch sự — backend mới là chốt)
```

---

## 8. Kiểm thử

Không có mock. Mọi probe chạy trên hệ thống thật đang chạy.

| Bộ | Kiểm gì |
|---|---|
| `unittest` (36) | Geofence, quy tắc giờ, trạng thái ngày, kiểm tra ảnh tải lên |
| `security_probe` (37) | Phân tách dữ liệu, SSRF, replay, XSS, rate limit |
| `rbac_probe` (50) | Phân quyền màn hình và hành động, trình duyệt dữ liệu |
| `isolation_probe` (17) | Phạm vi đọc theo địa điểm; địa điểm theo nhóm |
| `rules_probe` (11) | Một người một quản lý; một phiên mỗi ngày |
| `devices_probe` (12) | Bật tắt một/nhiều thiết bị theo vai trò |
| `delete_day_probe` (12) | Xoá ngày công xoá trọn ngày, đúng phạm vi, xoá mềm |
| `edit_record_probe` (16) | Sửa từng lượt; số máy đo không bị viết đè; phạm vi và nhật ký |
| `reading_probe` (16) | Một ngày thật: đăng ký → chấm vào → chấm ra; số đo OpenCV/face_recognition và chấm ra ở nơi khác |
| `teams_probe` (35) | Mã đơn vị, duyệt/từ chối vào nhóm |
| `face_change_probe` (27) | Duyệt đổi khuôn mặt, dùng ảnh chân dung thật |
| `sessions_probe` (10) | Gộp cặp vào/ra theo ngày |
| `session_probe` (20) | Một phiên mỗi tài khoản |
| `portal_probe` (16) | Đổi mật khẩu, liên hệ người quản lý, mã lỗi |
| `hours_probe` (8) | Quy tắc giờ vào/ra |
| `calendar_probe` (13) | Lịch tháng, múi giờ |
| `admin_probe` (21) | Quyền quản trị, xoá mềm |
| `pipeline_probe` (24) | OpenCV + face_recognition trên ảnh thật |

Giao diện kiểm bằng Playwright chạy Chrome hệ thống, ngoài kho mã.

---

## 9. Nợ kỹ thuật đã biết

| | Ảnh hưởng |
|---|---|
| Chưa có chống giả mạo | Ảnh chụp lại màn hình vẫn qua được |
| Chưa có retention dữ liệu sinh trắc | Ảnh và vector giữ vô hạn; `07_SECURITY_PRIVACY.md` §6 yêu cầu có thời hạn |
| Chưa có sao lưu tự động | Script có sẵn nhưng phải chạy tay |
| `FACE_MATCH_TOLERANCE` chưa đánh giá FAR/FRR | Đang dùng 0.6, mặc định của thư viện |
| Ca qua đêm | Ràng buộc `expected_check_in < expected_check_out` chặn ca 22:00–06:00 |
| Frontend chưa có test trong kho mã | Kiểm bằng Playwright ngoài kho |
| `face-ai` nạp cả hai engine | ONNX vẫn nạp dù không dùng, tốn ~250 MB |

---

## 10. Khi cần nâng cấp

**Thêm một màn hình mới**
1. Thêm vào `SCREENS` trong `api/app/services/permissions.py` và `frontend/lib/screens.ts`
2. Migration chèn dòng vào `role_permissions` cho cả ba vai trò
3. Router dùng `require_screen` / `require_action`
4. Service lọc dữ liệu qua `_scope()` hoặc `owner_filter()`

**Đổi engine nhận diện**
Viết module mới theo hình dạng của `face-ai/app/recognition.py`, khai báo `ENGINE_NAME` và số chiều riêng. Vector cũ tự động bị từ chối bằng `FACE_ENGINE_MISMATCH`; người dùng được nhắc đăng ký lại. Không cần migration dữ liệu.

**Thêm một vai trò**
Nặng hơn đáng kể: `user_role` là enum trong CSDL, và `permissions.py` giả định ba vai trò. Cần migration đổi enum, seed `role_permissions`, và xem lại `managed_by()` cùng `_scope()`.
