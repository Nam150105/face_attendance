# Tài liệu Face Attendance

Tài liệu chia làm hai nhóm. Nhóm đầu mô tả **hệ thống đang chạy**; nhóm sau là **đặc tả thiết kế ban đầu**, giữ lại làm nguồn sự thật về ý định và tiêu chí nghiệm thu.

## Hệ thống đang chạy — đọc trước

| Tệp | Dành cho |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Người tiếp nhận, bảo trì, nâng cấp. Kiến trúc thật, mô hình quyền, lý do các quyết định |
| [`INSTALL.md`](INSTALL.md) | Dựng lại hệ thống trên máy khác, sao lưu, khôi phục |
| [`USER_GUIDE.md`](USER_GUIDE.md) | Người quản lý và thành viên |
| [`13_OPERATIONS_RUNBOOK.md`](13_OPERATIONS_RUNBOOK.md) | Vận hành hằng ngày |

> Khi đặc tả và `ARCHITECTURE.md` mâu thuẫn nhau: đặc tả nói hệ thống *nên* thế nào, `ARCHITECTURE.md` nói hệ thống *đang* thế nào. Sửa code thì cập nhật `ARCHITECTURE.md`; đổi ý định thì sửa đặc tả trước.

## Đặc tả thiết kế

Đọc theo thứ tự:

1. `00_MASTER_SPEC.md` — mục tiêu và nguyên tắc tổng thể
2. `01_PRODUCT_REQUIREMENTS.md` — nghiệp vụ
3. `02_ARCHITECTURE.md` — kiến trúc hệ thống
4. `03_DATABASE_SCHEMA.md` — database PostgreSQL + pgvector
5. `04_API_CONTRACT.md` — hợp đồng API FastAPI
6. `05_FACE_AI_AND_GEOFENCE.md` — nhận diện khuôn mặt + geofence
7. `06_FRONTEND_UX.md` — UX/UI responsive PC/mobile
8. `07_SECURITY_PRIVACY.md` — bảo mật và dữ liệu sinh trắc học
9. `08_DOCKER_INFRA.md` — Docker/infrastructure
10. `09_TEST_PLAN_AND_ACCEPTANCE.md` — test và nghiệm thu
11. `10_IMPLEMENTATION_PHASES.md` — kế hoạch triển khai theo phase
12. `11_CLAUDE_EXECUTION_RULES.md` — cách Claude phải thực thi
13. `12_RECOMMENDED_ADDITIONS.md` — các phần nên bổ sung

## Quy tắc quan trọng
Claude không được triển khai toàn bộ một lần. Phải hoàn thành từng phase, chạy test và báo PASS/FAIL theo acceptance criteria.

## MVP Definition
MVP tối thiểu gồm Phase 0 → Phase 8. Phase 9 → 10 là hardening/release.
