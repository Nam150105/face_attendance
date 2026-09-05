# Face Attendance Management System — Master Specification

## 1. Mục tiêu sản phẩm
Xây dựng một hệ thống web quản lý nhân sự và chấm công bằng nhận diện khuôn mặt, responsive cho PC/tablet/mobile.

Hệ thống có 2 vai trò:
- `MANAGER`: quản lý thành viên, vị trí check-in, lịch sử chấm công, ảnh bằng chứng, chỉnh sửa chấm công có audit log.
- `MEMBER`: đăng ký tài khoản, nhập thông tin cá nhân, đăng ký dữ liệu khuôn mặt lần đầu; các lần sau đăng nhập và thực hiện check-in/check-out.

## 2. Luồng nghiệp vụ chính
1. Member đăng ký tài khoản.
2. Member hoàn thiện thông tin cá nhân.
3. Member thực hiện face enrollment lần đầu.
4. Manager đăng nhập và mời/thêm Member theo email đã đăng ký.
5. Manager gán member vào danh sách quản lý.
6. Manager tạo/chọn location check-in cho member.
7. Member đăng nhập → bật camera → xác thực khuôn mặt + vị trí → check-in/check-out.
8. Nếu khoảng cách tới vị trí yêu cầu <= 100m: cho phép bình thường.
9. Nếu >100m và <=200m: cảnh báo, cho nhập lý do giải trình; chỉ ghi nhận khi member xác nhận.
10. Nếu >200m: disable check-in/check-out.
11. Hệ thống lưu thời gian, vị trí, face score, liveness score, ảnh bằng chứng và kết quả kiểm tra.
12. Manager xem lịch sử theo ngày/member, xem ảnh check-in/check-out và audit log.

## 3. Quy tắc vị trí mặc định
- `0–100m`: VALID — cho phép.
- `>100–200m`: WARNING — cảnh báo + bắt buộc reason.
- `>200m`: BLOCKED — không cho thao tác.

Các ngưỡng phải cấu hình được theo location/tenant trong tương lai, không hard-code toàn bộ trong UI.

## 4. Nguyên tắc kỹ thuật
- Frontend: Next.js + TypeScript, responsive/PWA-friendly.
- Backend: FastAPI + Python.
- Primary DB: PostgreSQL.
- Vector search: pgvector.
- Object storage: S3-compatible (khuyến nghị MinIO local/dev, S3-compatible production).
- Cache/session/rate limit: Redis.
- Background jobs: Celery/RQ/Arq hoặc worker riêng; lựa chọn cụ thể ở phase implementation.
- Face AI nên tách thành service/worker riêng thay vì chạy nặng trong API process.
- Docker Compose cho local/dev; có thể tiến tới Kubernetes/VPS sau.

## 5. Các nguyên tắc bảo mật
- Password phải hash bằng Argon2id hoặc bcrypt mạnh.
- Access token ngắn hạn + refresh token rotation.
- RBAC bắt buộc ở backend.
- Manager chỉ được xem member thuộc tenant/workspace của mình.
- File ảnh không public trực tiếp; dùng signed URL hoặc API proxy.
- Ghi audit log cho sửa/xóa attendance và thay đổi quyền/cấu hình.
- Rate-limit login, enrollment, verification.
- Không log raw biometric embedding, ảnh nhạy cảm hoặc access token.
- Xác định chính sách retention/xóa dữ liệu khuôn mặt trước khi production.

## 6. Definition of Done tổng thể
Hệ thống chỉ được coi là đạt khi:
- Member có thể dùng PC và mobile browser.
- Enrollment khuôn mặt hoạt động và có quality/liveness gate.
- Face verification nhận diện đúng account/member.
- Geofence 100/200m hoạt động đúng 3 trạng thái.
- Check-in/check-out có ảnh bằng chứng.
- Manager quản lý member, location và lịch sử.
- Không thể truy cập dữ liệu tenant khác.
- Có audit log cho thao tác quản trị quan trọng.
- Có test backend, test nghiệp vụ chính và smoke test frontend.
- Có Docker setup, `.env.example`, migration và seed dữ liệu demo.
