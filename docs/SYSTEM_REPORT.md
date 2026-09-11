# Báo cáo tổng hợp hệ thống chấm công bằng nhận diện khuôn mặt

Đề tài: *Nghiên cứu nhận diện khuôn mặt sử dụng thư viện OpenCV và face_recognition, ứng dụng vào hệ thống chấm công.*

Bản triển khai đang chạy: https://namnangno.click · Cập nhật: 2026-09-11 · Migration `026_drop_my_locations`.

Tài liệu này là **bức tranh toàn cảnh** — use case, cách vận hành, và phần nhận diện khuôn mặt nằm ở đâu trong mã nguồn. Chi tiết kỹ thuật sâu hơn ở [`ARCHITECTURE.md`](ARCHITECTURE.md), thao tác từng màn hình ở [`USER_GUIDE.md`](USER_GUIDE.md), dựng lại hệ thống ở [`INSTALL.md`](INSTALL.md).

---

## 1. Bài toán và phạm vi

Một tổ chức cần biết **ai có mặt, ở đâu, lúc nào** mà không cần máy chấm công, thẻ từ hay ứng dụng cài đặt. Người dùng mở trang web trên điện thoại, chụp một tấm ảnh; hệ thống trả lời hai câu hỏi:

1. **Đây có đúng là người đó không?** — nhận diện khuôn mặt (OpenCV + face_recognition).
2. **Người đó có đứng đúng nơi không?** — định vị GPS so với bán kính của địa điểm.

Cả hai đều do **máy chủ** quyết định. Trình duyệt chỉ gửi ảnh và toạ độ; mọi phép so sánh, mọi ngưỡng, mọi trạng thái đều tính ở phía sau. Đây là nguyên tắc xuyên suốt: không tin dữ liệu từ thiết bị, không bịa số đo nào.

Ba vai trò:

| Vai trò | Việc chính |
|---|---|
| **Thành viên** | Đăng ký khuôn mặt, chấm vào/ra, xem bảng công của mình, xin chỉnh công, xin đổi ảnh khuôn mặt |
| **Người quản lý** | Lập nhóm và địa điểm, duyệt người, theo dõi ngày công, sửa bản ghi, duyệt các yêu cầu |
| **Quản trị hệ thống** | Phân quyền, tài khoản, chính sách thiết bị, khôi phục dữ liệu, tra cứu sự cố |

Một giao diện duy nhất cho cả ba: vai trò quyết định màn hình nào hiện trong menu. Cấp quyền chỉ mở cửa màn hình; **dữ liệu ai thấy của ai** là câu hỏi riêng, tính theo địa điểm người đó quản lý.

---

## 2. Use case tổng quát

```
                 ┌──────────────────────────────────────────────────────┐
                 │                  HỆ THỐNG CHẤM CÔNG                  │
                 │                                                      │
 Thành viên ────►│  UC1  Tạo tài khoản, xin vào nhóm bằng mã            │
            ────►│  UC2  Đăng ký khuôn mặt (OpenCV + face_recognition)  │
            ────►│  UC3  Chấm vào / chấm ra bằng khuôn mặt + GPS        │
            ────►│  UC4  Xem bảng công, gửi yêu cầu chỉnh công          │
            ────►│  UC5  Xin đổi ảnh khuôn mặt                          │
                 │                                                      │
 Người quản lý ─►│  UC6  Tạo nhóm, phát mã, gắn địa điểm cho nhóm        │
            ────►│  UC7  Duyệt / từ chối người xin vào nhóm             │
            ────►│  UC8  Theo dõi ngày công theo lịch và theo ngày      │
            ────►│  UC9  Xem chi tiết một lượt: ảnh đăng ký / vào / ra  │
            ────►│  UC10 Sửa bản ghi, xoá ngày công                     │
            ────►│  UC11 Duyệt chỉnh công, duyệt đổi khuôn mặt          │
                 │                                                      │
 Quản trị ──────►│  UC12 Phân quyền theo màn hình × hành động           │
            ────►│  UC13 Chính sách thiết bị (một / nhiều thiết bị)     │
            ────►│  UC14 Quản lý tài khoản, khôi phục bản ghi đã xoá    │
            ────►│  UC15 Tra cứu sự cố bằng mã lỗi                      │
                 └──────────────────────────────────────────────────────┘
```

---

## 3. Use case chi tiết — Thành viên

### UC1 · Tạo tài khoản và xin vào nhóm

**Tác nhân**: người mới. **Tiền điều kiện**: có mã nhóm 6 ký tự do người quản lý phát (ví dụ `L6CGEL`).

1. Vào `/login` → *Tạo tài khoản* → nhập email, mật khẩu, mã nhóm. Gõ mã xong màn hình hiện tên nhóm để xác nhận đúng chỗ (`GET /teams/lookup`, công khai, giới hạn theo IP).
2. Hệ thống tạo tài khoản và một yêu cầu vào nhóm ở trạng thái `PENDING`.
3. Chưa duyệt thì nút chấm công **tắt** và màn hình nói rõ *"Bạn chưa được duyệt vào nhóm nào"*.

**Quy tắc**: một người chỉ thuộc **một người quản lý** tại một thời điểm (chỉ số duy nhất từng phần trong CSDL). Muốn chuyển nhóm, quản lý cũ gỡ ra trước.

### UC2 · Đăng ký khuôn mặt

**Tiền điều kiện**: đã được duyệt. **Đây là use case cốt lõi của đề tài.**

1. Vào *Chấm công → Đăng ký khuôn mặt*, bấm **Mở camera**.
2. Trong lúc camera mở, cứ 0,7 giây trình duyệt gửi một khung nhỏ (400 px) tới `POST /faces/guide`. Khung đi qua **đúng bộ đo OpenCV và bộ phát hiện dlib** như ảnh thật, và trả về một lời khuyên: *quá tối · quá chói · chưa thấy khuôn mặt · chỉ một người · quá xa · quá gần · vào giữa khung · giữ yên máy · sẵn sàng*. Vòng ngắm xanh lá và nút **Chụp ảnh** chỉ sáng lên khi sẵn sàng.
3. Chụp → xem lại → **Dùng ảnh này**. Ảnh gửi lên `POST /faces/enrollment/verify` kèm một challenge ngắn hạn (chống gửi ảnh có sẵn).
4. face-ai chạy chuỗi xử lý (mục 6) và trả về vector 128 chiều. API lưu vector vào `face_embeddings` (pgvector) kèm tên engine, và lưu ảnh gốc vào MinIO riêng tư.
5. Màn hình in ra **đúng số máy đo được** trên ảnh: độ nét, độ sáng, số khuôn mặt, 128 chiều.

**Ngoại lệ**: đã có khuôn mặt trên hồ sơ → đây là *xin đổi ảnh* (UC5), phải có lý do và chờ duyệt.

### UC3 · Chấm vào / chấm ra

**Tiền điều kiện**: đã duyệt, đã có địa điểm, đã đăng ký khuôn mặt (máy chủ trả `can_check_in`; thiếu gì nút tắt và nói rõ).

1. Vào *Chấm công*. Nếu được gán nhiều nơi, chọn địa điểm. Lúc chấm ra, ô địa điểm để sẵn nơi đã chấm vào; chọn nơi khác thì **phải nêu lý do** và bản ghi mang trạng thái *Hợp lệ có lý do*.
2. Camera dẫn hướng như UC2; **Chụp để chấm vào** / **Chụp để chấm ra**.
3. Trình duyệt gửi ảnh + toạ độ + sai số GPS + khoá idempotency tới `POST /attendance/check-in` (hoặc `/check-out`).
4. Máy chủ, theo thứ tự: giới hạn tần suất → xác thực ảnh bằng magic byte → **geofence** (khoảng cách haversine tới địa điểm; trong bán kính cho phép thì được, giữa hai vòng thì phải nêu lý do, ngoài vòng cảnh báo thì `OUTSIDE_ALLOWED_ZONE`) → gọi face-ai `/v1/verify` với vector tham chiếu → **so khớp** (khoảng cách Euclid ≤ 0,6) → tính đi muộn / về sớm theo giờ quy định của địa điểm → ghi `attendance_events`.
5. Kết quả hiện ngay: giờ, khoảng cách tới địa điểm, và **khoảng cách khuôn mặt / ngưỡng** mà bộ nhận diện đã dùng để quyết định.

**Quy tắc phiên** (mục 5): một phiên mỗi ngày công tính theo lượt vào; phiên khép khi hết ngày công của ca (ca ngày: 00:00; ca đêm 22:00–06:00: 14:00 hôm sau) — chưa ra thì ngày đó chỉ có lượt vào (*Chưa chấm ra*), không bịa lượt ra, ngày công sau chấm vào bình thường; đã ra thì nút chấm vào tắt tới ngày công mới (`DONE_FOR_TODAY`).

### UC4 · Xem bảng công và xin chỉnh công

*Lịch sử của tôi*: mỗi ngày một dòng — vào → ra, tổng giờ, nhãn *Đúng giờ / Đi muộn / Quên bấm giờ ra / Quên bấm giờ vào / Không hợp lệ*. Bấm dòng để xem từng lượt và lý do bị từ chối. Bốn ô tổng: số ngày đi làm, tổng giờ, số buổi muộn, số ngày quên ra.

*Yêu cầu chỉnh công*: chọn ngày, loại (thiếu lượt vào / thiếu lượt ra / sai giờ / khác), giờ đề nghị, lý do. Mỗi ngày tối đa một yêu cầu đang chờ. **Duyệt là bảng công đổi ngay** (UC11).

### UC5 · Xin đổi ảnh khuôn mặt

Không ai tự thay được ảnh của mình. Chụp ảnh mới + lý do → yêu cầu chờ; trong lúc chờ vẫn chấm công bằng ảnh cũ. Người quản lý thấy ảnh cũ và ảnh mới cạnh nhau rồi mới quyết.

---

## 4. Use case chi tiết — Người quản lý

Người quản lý cũng là một thành viên đầy đủ (có hồ sơ, có thể chấm công, có thể thuộc nhóm của người khác). Menu chỉ có **bốn mục**: Tổng quan nhóm · Bản ghi · Quản lý nhóm · Nhật ký.

### UC6 · Tạo nhóm và gắn địa điểm

1. *Quản lý nhóm* → gõ tên → **Tạo nhóm**. Hệ thống sinh mã 6 ký tự (bảng chữ bỏ `O/0`, `I/1` vì mã được đọc qua điện thoại). Bấm mã để sao chép.
2. Bấm tên nhóm để mở tại chỗ: địa điểm của nhóm, người đang chờ, người trong nhóm.
3. Trang *Địa điểm* mở đầu bằng bản đồ ghim mọi nơi chấm công (bấm ghim hoặc bấm dòng trong danh sách → thẻ thao tác: sửa, gán người, bật tắt, xoá; danh sách chỉ để xem). Tạo địa điểm mới thì ghim tự đặt ở vị trí GPS của người tạo. *Địa điểm* có thể tạo bằng cách tìm địa chỉ, dán liên kết Google Maps (chỉ chấp nhận host trong danh sách cho phép, chống SSRF) hoặc kéo ghim trên bản đồ MapLibre. Mỗi địa điểm có hai bán kính (cho phép / cảnh báo), **ca làm việc** — *Ca ngày* (vào < ra) hoặc *Ca đêm* vắt qua nửa đêm (ví dụ 22:00 – 06:00) — với giờ vào / giờ ra **bắt buộc**, số phút muộn chấp nhận.
4. **Gắn địa điểm cho nhóm là một quy tắc**, tính bằng truy vấn: ai vào nhóm là chấm được ở đó ngay, rời nhóm là mất ngay. Không sao chép, nên không bao giờ lệch.
5. Thêm người đã có tài khoản: dán danh sách email, **mỗi email một dòng**; kết quả nêu rõ từng email chưa thêm được và vì sao.

### UC7 · Duyệt người vào nhóm

Ba ô ở đầu *Quản lý nhóm* đếm việc chờ: *Yêu cầu vào nhóm · Đổi khuôn mặt · Chỉnh công*. Bấm ô để mở danh sách tại chỗ, duyệt hoặc từ chối kèm lý do. Yêu cầu vào nhóm còn hiện bên trong từng nhóm. Duyệt xong hệ thống ghi tên nhóm vào hồ sơ thành viên và gửi thông báo.

### UC8 · Theo dõi ngày công

*Bản ghi* có một thanh công cụ — tháng, bốn con số (*lượt · người đi làm · chưa ra ca · đi muộn*), ô tìm, ba cách xem, làm mới — và ba cách xem:

- **Lịch**: tấm lịch cả chiều ngang; mỗi ngày ghi *N lượt*, dòng "*N người · N muộn · N chưa ra ca*" và một chấm màu cho mỗi người (xanh đúng giờ, vàng chưa ra ca, đỏ muộn, xám bị từ chối). Hôm nay có vòng tròn xanh.
- **Bảng**: cả tháng thành dòng — ngày, người, vào, ra, có mặt, nơi, tình trạng — để đối chiếu một lời khai.
- **Điểm danh**: hôm nay, đi từ **danh sách nhóm**: ai chưa chấm công đứng đầu, rồi muộn, đang làm, đủ vào ra.

Bấm một ngày → **ngăn kéo bên phải** mở (không che lịch): *Thứ Sáu · N lượt · N người · N muộn · N chưa ra ca*, rồi mỗi người một dòng với ảnh đại diện, "Vào 08:00 · chưa ra ca", nhãn. Bật *Hiện cả lượt không hợp lệ* thì từng lần thử bị từ chối hiện thành dòng phụ. Xuất CSV đúng ngày đang xem.

**Phạm vi dữ liệu**: người quản lý chỉ thấy bản ghi phát sinh **tại địa điểm của mình**. Hai người quản lý từng chung một người không thấy dữ liệu tại nơi của nhau.

### UC9 · Xem chi tiết một lượt

Bấm dòng → ngăn kéo chuyển sang trang người (mũi tên quay lại ở đầu): tên, email, nhãn; **thẻ ngày** với hai giờ to *Vào 08:43 ——— Ra Chưa ra ca* và tổng thời gian ở giữa; ba ảnh **xếp ngang** — ảnh đã đăng ký, ảnh lúc vào, ảnh lúc ra — để đối chiếu bằng mắt; **bản đồ vị trí chấm công** (MapLibre) với hai vòng geofence của địa điểm và ghim nơi người đó đứng lúc vào (xanh) / lúc ra (cam), kèm địa chỉ và khoảng cách; thông tin cốt lõi; mục *Thông tin kỹ thuật* gập lại (toạ độ, sai số GPS, thư viện nhận diện, mã bản ghi, nguồn bản ghi: thiết bị / chỉnh công / người nhập).

### UC10 · Sửa và xoá

- Công tắc **Lượt vào / Lượt ra** chọn nửa cần sửa.
- Sửa được: thời điểm (giờ máy báo lần đầu vẫn giữ), địa điểm (chỉ trong số nơi mình sở hữu), **Trạng thái bản ghi** với bốn lựa chọn *Hợp lệ · Hợp lệ có lý do · Khuôn mặt không khớp · Địa điểm không khớp*, giải trình của thành viên.
- Sửa giờ → tính lại đi muộn / về sớm; đổi địa điểm → tính lại khoảng cách từ toạ độ đã lưu. **Điểm khuôn mặt không bao giờ sửa được** — đó là số máy đo.
- Người quản lý bắt buộc nêu lý do; quản trị hệ thống thì không. Bản ghi mang dòng *"Đã được sửa"* kèm tên và lý do; nhật ký giữ cả trước và sau.
- **Xoá cả ngày công**: xoá lượt vào, lượt ra và mọi lần bị từ chối trong ngày, xoá mềm, quản trị khôi phục được từng lượt.

### UC11 · Duyệt chỉnh công và đổi khuôn mặt

- *Chỉnh công*: duyệt là hệ thống **tạo hoặc dời lượt** đúng giờ đề nghị. Bản ghi sinh ra không có toạ độ, không có khoảng cách, không có điểm khuôn mặt — vì không ai đo gì — và ghi nguồn `CORRECTION`. Từ chối thì bảng công giữ nguyên.
- *Đổi khuôn mặt*: ảnh cũ và ảnh mới cạnh nhau, lý do họ nêu; duyệt thì vector mới thay vector cũ (vector cũ được thu hồi chứ không xoá).

---

## 5. Cách vận hành của hệ thống

### 5.1 Kiến trúc

```
Điện thoại / máy tính
        │  HTTPS (Cloudflare Tunnel → Caddy)
        ▼
   frontend (Next.js + MapLibre GL, tile OpenFreeMap)
        │
        ▼
   api (FastAPI)  ──►  PostgreSQL 16 + pgvector
        │                 (tài khoản, nhóm, địa điểm, bản ghi, vector khuôn mặt)
        ├──►  face-ai (FastAPI + OpenCV + face_recognition)   mạng nội bộ, không lộ ra ngoài
        ├──►  MinIO (ảnh đăng ký, ảnh chấm công)              riêng tư, truy cập qua API
        └──►  Redis (giới hạn tần suất, cửa sổ làm mới token)
```

Mọi dịch vụ chạy bằng Docker Compose; migration Alembic chạy lúc container API khởi động.

### 5.2 Vòng đời một ngày công

```
CHECK_IN (SUCCESS)  ── cùng ngày công ──►  CHECK_OUT (SUCCESS | WARNING_CONFIRMED)
     │                                            │
     │  hết ngày công, không có lượt ra           │  hôm nay xong: nút chấm vào tắt
     │  (ca ngày 00:00 · ca đêm giữa giờ nghỉ)    ▼   tới ngày công mới (DONE_FOR_TODAY)
     ▼
 ngày = "Chưa chấm ra"                        ngày = Đúng giờ / Đi muộn
 trạng thái người = "chưa mở phiên"
 → chỉnh công hoặc quản lý sửa
```

Trạng thái ngày được tính **một lần** trong `api/app/services/attendance_days.py` và dùng cho cả ba màn hình (bảng của quản lý, lịch tháng, bảng công cá nhân). Bộ trạng thái: `ON_TIME · LATE · OPEN · NO_CHECK_IN · REJECTED_FACE · REJECTED_PLACE`. Chưa chấm ra ưu tiên hơn đi muộn (số phút muộn vẫn đi kèm).

Không có job nền nào: "đang trong phiên" là thứ **tính ra từ ngày công hiện tại**, không phải bản ghi ai đó viết thêm. Ngày công cắt theo ca của địa điểm: ca ngày lúc 00:00; ca đêm ở giữa khoảng nghỉ (22:00–06:00 → 14:00), nên vào 23:00 – ra 06:30 là một ngày công của ngày bắt đầu ca, và chấm vào 00:30 tính muộn so với 22:00 hôm trước. Hệ thống từng bịa một lượt ra ở toạ độ 0,0 sau 24 giờ; cơ chế đó đã bỏ và các dòng nó để lại được xoá mềm (migration 024).

### 5.3 Bản ghi và trạng thái

Mỗi lượt là một dòng `attendance_events`: loại (vào/ra), trạng thái (`SUCCESS · WARNING_CONFIRMED · FAILED · BLOCKED`), mã lý do khi bị từ chối, toạ độ và khoảng cách đo được, điểm khuôn mặt (`face_distance`, `face_match_score`, `face_engine`), số phút muộn/sớm, ảnh, nguồn (`DEVICE · CORRECTION · MANUAL`), dấu vết sửa/xoá. Bốn cột số đo là nullable vì bản ghi do người nhập không đo gì cả.

### 5.4 Bảo mật và quyền riêng tư

- Ảnh khuôn mặt và ảnh chấm công nằm trong MinIO riêng tư; mọi truy cập qua API có kiểm quyền và kiểm loại tệp bằng magic byte.
- Vector khuôn mặt lưu kèm tên engine; hai engine khác nhau **không bao giờ so với nhau** (`FACE_ENGINE_MISMATCH`).
- Giới hạn tần suất bằng Redis cho đăng nhập (theo IP và email), đăng ký, chấm công, nhận diện, dẫn hướng camera.
- Mỗi tài khoản: quản trị chọn *một thiết bị* hay *nhiều thiết bị* cho từng vai trò. Phiên đăng nhập 90 ngày, trượt theo mỗi lần dùng, tối đa 10 thiết bị một tài khoản (thiết bị ít dùng nhất bị đăng xuất khi thêm máy thứ 11); làm mới token có cửa sổ 60 giây để nhiều thẻ của cùng trình duyệt không đá nhau ra.
- Mọi sửa/xoá/phân quyền vào `audit_logs` kèm người thực hiện, giá trị trước và sau, lý do.
- Lỗi không lường trước sinh một mã 6 ký tự cho người dùng đọc lại; quản trị tra tại *Sự cố hệ thống* để thấy traceback.

### 5.5 Kiểm thử

Không có mock. 20 bộ probe chạy trên hệ thống thật (kể cả với ảnh chân dung thật cho phần nhận diện) cộng 39 unit test. Giao diện kiểm bằng Playwright điều khiển Chrome hệ thống, kể cả camera giả bơm video từ ảnh thật. Danh sách và cách chạy ở `INSTALL.md`.

---

## 6. OpenCV và face_recognition làm gì trong dự án này

Đây là phần trả lời câu hỏi nghiên cứu. Hai thư viện chia việc rất rõ: **OpenCV đọc và đánh giá ảnh; face_recognition (trên dlib) tìm, mã hoá và so khớp khuôn mặt.** Không có bước nào khác chen vào giữa.

### 6.1 Chuỗi xử lý, và đoạn code tương ứng

Mọi ảnh — đăng ký, chấm công, dẫn hướng camera — đi qua **cùng một chuỗi** trong dịch vụ `face-ai/`:

| # | Bước | Thư viện | Hàm | Tệp và dòng |
|---|---|---|---|---|
| 1 | Giải mã bytes thành ma trận BGR; từ chối thứ không phải ảnh, ảnh dưới 160 px | OpenCV | `cv2.imdecode` | [`face-ai/app/face_pipeline.py`](../face-ai/app/face_pipeline.py) `FacePipeline.decode`, dòng 51–62 |
| 2 | Chuyển xám, đo **độ nét** bằng phương sai Laplacian, đo **độ sáng** bằng mức xám trung bình | OpenCV | `cv2.cvtColor`, `cv2.Laplacian(...).var()`, `np.mean` | [`face-ai/app/recognition.py`](../face-ai/app/recognition.py) `measure_quality`, dòng 81–102 |
| 3 | Ảnh tối (< 80) → **bù sáng cục bộ CLAHE** trên kênh L của không gian LAB, để mặt ngược sáng không bị ép trắng | OpenCV | `cv2.createCLAHE`, `cv2.cvtColor BGR↔LAB`, `cv2.split/merge` | cùng hàm trên, dòng 93–100 |
| 4 | Chuyển BGR → RGB vì face_recognition đọc RGB | OpenCV | `cv2.cvtColor(..., COLOR_BGR2RGB)` | `recognition.py` `to_rgb`, dòng 76–78 |
| 5 | **Tìm khuôn mặt** bằng bộ phát hiện HOG của dlib | face_recognition | `face_recognition.face_locations(img, model="hog")` | `recognition.py` `locate_faces`, dòng 105–114 |
| 6 | Đặt **điểm mốc** (68 điểm) để đánh giá mặt có đọc rõ không; dưới 60 điểm là `FACE_NOT_CLEAR` khi đăng ký | face_recognition | `face_recognition.face_landmarks` | `recognition.py` `landmark_count`, dòng 117–129 |
| 7 | **Mã hoá** khuôn mặt thành vector 128 chiều bằng ResNet của dlib | face_recognition | `face_recognition.face_encodings(..., num_jitters=1)` | `recognition.py` `encode`, dòng 132–142 |
| 8 | **So khớp**: khoảng cách Euclid giữa hai vector; ≤ 0,6 là cùng người | face_recognition | `face_recognition.face_distance` | `recognition.py` `compare`, dòng 145–156 |
| 9 | Vẽ khung mặt lên ảnh xem trước (cho người quản lý xem máy thấy gì) | OpenCV | `cv2.rectangle`, `cv2.imencode` | `recognition.py` `annotate`, dòng 159–166 |

Các ngưỡng nằm ở đầu `face_pipeline.py` (dòng 21–28): độ nét tối thiểu 40, độ sáng 35–220, số điểm mốc tối thiểu 60; và `TOLERANCE = 0.6` ở `recognition.py` dòng 52. Tất cả đọc từ biến môi trường, ghi rõ trong `.env.example`.

Điều phối chuỗi trên: `FacePipeline.analyze` (bước 1–6, dòng 86–100), `FacePipeline.validate` (áp ngưỡng, dòng 161–178; đăng ký khắt khe hơn chấm công), `FacePipeline.encode` (bước 7), `FacePipeline.compare` (bước 8). Bốn endpoint HTTP của dịch vụ ở [`face-ai/app/main.py`](../face-ai/app/main.py): `/v1/analyze` (dẫn hướng), `/v1/preview` (ảnh có khung), `/v1/enroll`, `/v1/verify`.

### 6.2 Dẫn hướng camera cũng là OpenCV

`FacePipeline.guide` (`face_pipeline.py` dòng 102–159) biến các số đo thành một lời khuyên. Độ sáng ở đây đo **trong vùng mặt** (hoặc vùng giữa khung khi chưa thấy mặt) bằng `cv2.cvtColor` + `np.mean` trên vùng cắt; khoảng cách (quá xa/gần) là bề rộng khung mặt chia bề rộng ảnh; lệch khung là toạ độ tâm mặt. Ánh sáng xét **trước** phát hiện, vì trong khung tối HOG không thấy gì và "chưa thấy khuôn mặt" sẽ chỉ sai hướng.

### 6.3 Phía API: gọi face-ai, lưu vector, quyết định

| Việc | Tệp |
|---|---|
| Nhận ảnh đăng ký, kiểm challenge, gọi `/v1/enroll`, lưu vector vào `face_embeddings` (`%s::vector`, pgvector) và ảnh vào MinIO | [`api/app/routers/faces.py`](../api/app/routers/faces.py) `verify_enrollment`, dòng 66–147 |
| Dẫn hướng: nhận khung nhỏ, gọi `/v1/analyze`, trả lời khuyên, không lưu gì | `faces.py` `guide_face`, dòng 167–200 |
| Chấm công: geofence → gọi `/v1/verify` với vector tham chiếu → ghi bản ghi kèm `face_distance`, `face_match_score`, `face_engine` | [`api/app/services/attendance.py`](../api/app/services/attendance.py) `check_in` (dòng 354) và `check_out` (dòng 474), qua `_verify_face` dòng 39 |
| Kiểm tra engine của vector tham chiếu khớp engine đang chạy, nếu lệch → `FACE_NOT_ENROLLED`/`FACE_ENGINE_MISMATCH` | `attendance.py` `_reference_embedding`, dòng 27 |
| Duyệt đổi khuôn mặt: thu hồi vector cũ, kích hoạt vector mới | [`api/app/services/face_requests.py`](../api/app/services/face_requests.py) |
| Geofence thuần (haversine, ba vùng) — không chạm CSDL, có unit test | [`api/app/domain/geofence.py`](../api/app/domain/geofence.py) |

### 6.4 Phía giao diện: cho người dùng thấy máy đã đo gì

| Việc | Tệp |
|---|---|
| Camera, dẫn hướng trực tiếp, khung mặt bám theo, khoá nút chụp khi chưa đạt | [`frontend/components/CameraCapture.tsx`](../frontend/components/CameraCapture.tsx) |
| Sau khi đăng ký: in độ nét, độ sáng, số mặt, 128 chiều; mục gập giải thích chuỗi xử lý | [`frontend/app/enroll/page.tsx`](../frontend/app/enroll/page.tsx), [`frontend/components/RecognitionEnginePanel.tsx`](../frontend/components/RecognitionEnginePanel.tsx) |
| Sau khi chấm công: in khoảng cách khuôn mặt và ngưỡng | [`frontend/app/attendance/page.tsx`](../frontend/app/attendance/page.tsx) |
| Người quản lý: ba ảnh xếp ngang + khoảng cách khuôn mặt trên từng lượt | [`frontend/app/manager/attendance/page.tsx`](../frontend/app/manager/attendance/page.tsx) |
| Trang đăng nhập: nói rõ khuôn mặt được đọc bằng gì | [`frontend/app/login/page.tsx`](../frontend/app/login/page.tsx) |

### 6.5 Số đo thực tế

Trên ba chân dung phạm vi công cộng (probe `reading_probe`, `pipeline_probe`): cùng một người ở hai ảnh khác nhau **0,144**; hai người khác nhau **0,703**; ngưỡng **0,6**. Cả hai probe chạy lại được bất cứ lúc nào bằng lệnh trong `INSTALL.md`.

### 6.6 Điều dự án cố ý không làm

- **Không giả lập AI**: model chưa sẵn sàng thì trả `FACE_MODEL_NOT_CONFIGURED`; không sinh vector giả, điểm giả. Bản ghi do người tạo (chỉnh công) mang `face_match_score = NULL`.
- **Không chống giả mạo (liveness)**: ảnh chụp lại màn hình vẫn qua được. Là hạn chế đã biết của phương pháp 2D.
- **Không xử lý ảnh chói**: CLAHE hiện chỉ chạy cho ảnh tối. Ảnh cháy sáng mất thông tin từ lúc chụp; dẫn hướng camera chặn sớm bằng lời khuyên "quay lưng lại nguồn sáng" thay vì cố cứu ảnh.
- **Ngưỡng 0,6 là mặc định thư viện**, chưa đánh giá FAR/FRR trên tập dữ liệu của tổ chức.

---

## 7. Tồn đọng đã biết

| | Ảnh hưởng |
|---|---|
| Chưa có liveness | Ảnh chụp lại màn hình vẫn qua |
| Retention dữ liệu sinh trắc | Ảnh và vector giữ vô hạn, chưa có job dọn |
| Sao lưu tự động | Script có, chưa gắn lịch |
| Ngưỡng nhận diện | 0,6 chưa đánh giá trên dữ liệu thật |
| `rbac_probe` | Thi thoảng 49/50 khi chạy ngay sau khi deploy, chạy lại thì 50/50; chưa tìm ra nguyên nhân |
