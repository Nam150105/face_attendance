# Face Attendance

Chấm công bằng nhận diện khuôn mặt và vị trí, dùng chung cho doanh nghiệp, trường học và trung tâm đào tạo.

Người dùng mở web trên điện thoại, chụp một tấm ảnh, hệ thống đối chiếu khuôn mặt và kiểm tra họ có đứng đúng nơi hay không. Không cần máy chấm công, không cần thẻ từ, không cài ứng dụng.

---

## Dành cho ai

| | Việc chính |
|---|---|
| **Thành viên** | Chấm công vào/ra bằng khuôn mặt, xem lịch sử của mình, gửi yêu cầu chỉnh công khi có sai sót |
| **Người quản lý** | Lập nhóm và địa điểm, duyệt người xin vào, theo dõi ai có mặt, xử lý ngoại lệ |
| **Quản trị hệ thống** | Cấu hình phân quyền, quản lý toàn bộ tài khoản và dữ liệu, tra cứu sự cố |

---

## Tính năng

**Chấm công**
- Nhận diện khuôn mặt trên ảnh chụp tại chỗ, không dùng ảnh có sẵn trong máy
- Kiểm tra vị trí theo bán kính quanh địa điểm; ngoài vùng cho phép thì không ghi nhận
- Giờ làm việc theo từng địa điểm, có mức cho phép đến muộn
- Một ngày một phiên: đã đủ cặp vào–ra thì không mở phiên mới trong ngày
- Tự đóng phiên sau 24 giờ nếu quên chấm ra
- Người chấm công nhìn thấy đúng số đo mà bộ nhận diện đã dùng để quyết định

**Quản lý**
- Một màn hình cho cả việc: nhóm, người trong nhóm, địa điểm và mọi việc chờ duyệt
- Nhóm có mã riêng; người mới nhập mã khi đăng ký, người quản lý duyệt hoặc từ chối
- Mỗi người thuộc về một người quản lý — không có chuyện hai nơi cùng nhận một người
- Gắn địa điểm cho cả nhóm: ai vào nhóm là chấm công được ở đó, kể cả người vào sau
- Lịch tháng; bấm vào một ngày là ra bảng ngày công gộp sẵn giờ vào – giờ ra
- Duyệt yêu cầu đổi ảnh khuôn mặt, có ảnh cũ và ảnh mới đặt cạnh nhau
- Duyệt yêu cầu chỉnh công, nhật ký mọi thao tác

**Quản trị**
- Phân quyền theo màn hình và theo hành động: xem, thêm, sửa, xoá
- Quản lý tài khoản, khôi phục hoặc xoá vĩnh viễn bản ghi
- Tra cứu sự cố bằng mã lỗi người dùng đọc lại

---

## Bảo mật và quyền riêng tư

- Ảnh khuôn mặt và ảnh chấm công nằm trong kho lưu trữ riêng tư, không có đường dẫn công khai
- Mọi quyết định về vị trí và khuôn mặt do máy chủ tính, không tin dữ liệu do thiết bị gửi lên
- Mỗi tài khoản chỉ một phiên đăng nhập; đăng nhập máy mới là máy cũ bị đẩy ra
- Đổi ảnh khuôn mặt phải được người khác duyệt, không ai tự thay được
- Quyền đọc bản ghi tính theo địa điểm: người quản lý khác không xem được dữ liệu tại nơi của bạn
- Mọi thao tác sửa, xoá, phân quyền đều vào nhật ký kèm người thực hiện và lý do

---

## Cài đặt

Xem [`docs/INSTALL.md`](docs/INSTALL.md) — hướng dẫn từng bước từ máy trống, chạy được trên Windows, macOS và Linux.

Yêu cầu tối thiểu: Docker Desktop, 8 GB RAM, 10 GB đĩa trống.

## Hướng dẫn sử dụng

Xem [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) — dành cho người quản lý và thành viên, không cần biết kỹ thuật.

## Tài liệu kỹ thuật

Xem [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — kiến trúc, mô hình dữ liệu, phân quyền và các quyết định thiết kế, dành cho người tiếp nhận hoặc nâng cấp hệ thống.

---

## Giới hạn đã biết

- **Chưa có chống giả mạo (liveness).** Ảnh chụp lại màn hình vẫn có thể qua được. Đang chờ chọn nhà cung cấp.
- **Chưa có hàng đợi ngoại tuyến.** Mọi lượt chấm công đều cần mạng, vì máy chủ mới là nơi xác thực.
- **Ca qua đêm** (ví dụ 22:00 – 06:00) chưa cấu hình được.
- **Ngưỡng nhận diện** đang dùng giá trị mặc định của thư viện, chưa đánh giá trên tập dữ liệu thực tế của từng tổ chức.

---

## Giấy phép

Bản quyền thuộc về chủ sở hữu dự án. Liên hệ chủ sở hữu trước khi sử dụng cho mục đích thương mại.
