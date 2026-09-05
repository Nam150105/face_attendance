# Implementation Roadmap — Claude Execution Phases

Claude must complete one phase at a time, run tests, report evidence, and only then proceed.

## Phase 0 — Repository audit and foundation
### Tasks
- Inspect existing repository.
- Preserve working code unless justified.
- Create architecture folders.
- Configure lint/typecheck/test.
- Docker baseline.
- `.env.example`.

### Goal
Project starts cleanly and has reproducible dev setup.

### Acceptance
- `docker compose up` works.
- Frontend starts.
- FastAPI health endpoint returns OK.
- Postgres/Redis/MinIO healthchecks pass.
- No secrets committed.

---

## Phase 1 — Database and migrations
### Tasks
Implement tables from `03_DATABASE_SCHEMA.md`, migrations, indexes, seeds.

### Goal
Database schema is stable and migration-driven.

### Acceptance
- Fresh DB migration succeeds.
- Rollback strategy documented/tested where supported.
- Seed creates demo Manager, Member, Location.
- Foreign keys/indexes exist.

---

## Phase 2 — Authentication and RBAC
### Tasks
- Register/login/logout/refresh/reset.
- Password hashing.
- Role middleware.
- Object-level authorization foundation.

### Goal
Two account types work securely.

### Acceptance
- Member cannot call manager APIs.
- Manager endpoints reject non-manager.
- Refresh rotation/logout behavior tested.

---

## Phase 3 — Member profile and Manager membership
### Tasks
- Member profile CRUD.
- Manager adds registered member by email.
- Membership status.
- Manager list/detail UI.

### Goal
Manager can create its working member list.

### Acceptance
- Existing email can be attached.
- Unknown email is rejected with clear message.
- Cross-manager data access is blocked.

---

## Phase 4 — Location and geofence
### Tasks
- Location CRUD.
- Member-location assignment.
- Distance service.
- Accuracy validation.
- 100/200m policy.

### Goal
Server reliably decides ALLOW/WARNING/BLOCK.

### Acceptance
Run automated boundary tests at 99m, 100m, 100.1m, 150m, 200m, 200.1m and invalid GPS cases.

---

## Phase 5 — Face enrollment
### Tasks
- Camera UX.
- Enrollment flow.
- Detection/quality/liveness/embedding service.
- pgvector persistence.

### Goal
Member can securely enroll one face.

### Acceptance
- Valid face succeeds.
- No face/multiple faces/poor quality/liveness failure are rejected.
- Model version stored.

---

## Phase 6 — Check-in/check-out engine
### Tasks
Implement attendance state machine:
```text
NOT_CHECKED_IN -> CHECKED_IN -> CHECKED_OUT
```
Add warning reason flow and idempotency.

### Goal
Core attendance works end-to-end.

### Acceptance
- Inside 100m succeeds.
- 100–200m requires reason.
- >200m blocked.
- Cannot double-check-in.
- Cannot checkout without check-in.
- Image evidence is stored privately.

---

## Phase 7 — Manager attendance management
### Tasks
- Daily/monthly table.
- Member detail.
- Image viewer.
- Filters.
- Manual adjustment.
- Audit logs.

### Goal
Manager can fully manage and verify attendance.

### Acceptance
- Filter by day/member/status works.
- Correct image opens.
- Manual change requires reason and audit entry.

---

## Phase 8 — Responsive/mobile hardening
### Tasks
- Mobile camera layout.
- Permission UX.
- Responsive tables → cards.
- Offline/intermittent-network handling.
- PWA considerations where useful.

### Goal
Core workflows are usable on desktop and mobile browsers.

### Acceptance
Test at 360px, 390px, 768px, 1280px and current supported Chrome/Safari/Edge mobile/desktop targets.

---

## Phase 9 — Security hardening
### Tasks
- IDOR/BOLA tests.
- Upload validation.
- Rate limits.
- Signed URLs.
- Audit completeness.
- Secret scanning.

### Goal
No obvious authorization/data exposure vulnerabilities.

### Acceptance
Security checklist in `07_SECURITY_PRIVACY.md` passes.

---

## Phase 10 — Observability, backup and production release
### Tasks
- Structured logs.
- Request IDs.
- Health/readiness endpoints.
- Metrics hooks.
- Backup/restore documentation.
- Production Docker configuration.

### Goal
Deployable and supportable MVP.

### Acceptance
- Restore test succeeds.
- Health checks detect dependency failure.
- Production env has no dev secrets/default credentials.
