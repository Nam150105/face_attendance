# Product Requirements Document (PRD)

## 1. Actors
### Manager
- Đăng nhập/đăng xuất.
- Quản lý danh sách member được mình quản lý.
- Thêm member bằng email đã tồn tại.
- Xem trạng thái enrollment khuôn mặt.
- Tạo/sửa/xóa location check-in trong phạm vi quyền.
- Gán location mặc định cho member hoặc nhóm member.
- Xem attendance theo ngày/tháng/member.
- Xem ảnh check-in/check-out.
- Duyệt/ghi nhận giải trình vùng cảnh báo theo policy.
- Sửa attendance thủ công khi cần; bắt buộc lý do và audit log.
- Xem dashboard tổng quan.

### Member
- Đăng ký bằng email + password.
- Xác minh email (khuyến nghị).
- Nhập hồ sơ cá nhân: họ tên, ngày sinh, số điện thoại, mã nhân viên (nếu có), chức vụ/phòng ban tùy doanh nghiệp.
- Face enrollment lần đầu.
- Đăng nhập.
- Check-in/check-out.
- Xem lịch sử chấm công của chính mình.
- Xem ảnh bằng chứng của các lần chấm công của chính mình.
- Khi 100–200m: nhập lý do giải trình.
- Không thể check-in/out khi >200m.

## 2. Functional requirements
### Authentication
- Email unique.
- Password policy tối thiểu 8 ký tự, khuyến nghị có chữ hoa, chữ thường, số và ký tự đặc biệt.
- Forgot/reset password.
- Session invalidation khi logout.

### Member management
- Manager không tự ý thêm email chưa đăng ký.
- Nếu email đã đăng ký nhưng chưa được manager quản lý → tạo membership.
- Có trạng thái membership: `INVITED`, `ACTIVE`, `SUSPENDED`, `REMOVED`.
- Một member có thể thuộc nhiều workspace/manager policy nếu hệ thống hỗ trợ multi-tenant.

### Face enrollment
- Cần camera permission.
- Chỉ chấp nhận đúng số lượng mặt theo policy, mặc định 1 mặt.
- Kiểm tra blur, brightness, face size, angle.
- Liveness check.
- Tạo embedding và lưu vector.
- Cho phép re-enrollment có xác thực và audit log.

### Check-in/out
- Browser lấy GPS với permission.
- Browser chụp ảnh.
- Backend xác thực JWT + ownership.
- Face verification.
- Liveness.
- Geofence.
- Idempotency: chống double click tạo nhiều record.
- Không cho check-in 2 lần liên tiếp nếu chưa checkout, theo policy.
- Check-out chỉ hợp lệ khi đang ở trạng thái checked-in, trừ override của Manager.

### Attendance evidence
Mỗi event nên chứa:
- event id
- member id
- type (`CHECK_IN`, `CHECK_OUT`)
- server timestamp
- client timestamp (optional)
- timezone
- latitude/longitude
- location accuracy (GPS accuracy meters)
- distance to required location
- face match score
- liveness score
- image object key
- result/status
- reason nếu thuộc vùng cảnh báo
- device/session metadata tối thiểu cần thiết

## 3. Non-functional requirements
- Responsive UI từ 360px trở lên.
- API versioning (`/api/v1`).
- Health check endpoint.
- Structured logs.
- Error schema nhất quán.
- DB migration versioned.
- Backup/restore strategy.
- Monitoring hooks.
- UTC trong DB; hiển thị timezone theo tenant/user.

## 4. Edge cases bắt buộc
- GPS permission denied.
- GPS unavailable.
- GPS accuracy quá thấp.
- Fake/mock location indicators khi có thể phát hiện.
- Không có mặt / nhiều mặt.
- Mặt quá nhỏ / quá nghiêng / ảnh mờ.
- Face mismatch.
- Liveness fail.
- Member chưa enrollment.
- Member bị suspend.
- Ngoài vùng >200m.
- 100–200m nhưng không nhập reason.
- Network timeout giữa client và server.
- Double submit.
- Check-out khi chưa check-in.
- Hai thiết bị check-in gần như cùng lúc.
