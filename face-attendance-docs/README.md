# Face Attendance System — Claude Documentation Pack

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
