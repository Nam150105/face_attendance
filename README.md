# Face Attendance

This repository is implemented phase-by-phase from the specifications in
[`face-attendance-docs`](face-attendance-docs/README.md).

## Local foundation

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Phase 0 exposes the frontend at `http://localhost:3000`, API health at
`http://localhost:8000/health`, MinIO at `http://localhost:9001`, and the
Face AI health endpoint at `http://localhost:8001/health`.

Local migration seed credentials are `manager@example.com` and
`member@example.com`, both using `ChangeMe123!`. They are for development
only and must not be used in production.

The Face AI container is intentionally a health-only skeleton until the model,
embedding dimension, threshold evaluation, and liveness implementation are
selected and verified in Phase 5.

## Phase 2 authentication checks

The API now supports register, login, current-user lookup, refresh-token
rotation, logout revocation, and manager role protection. After the stack is
running, check the API and migration:

```powershell
Invoke-WebRequest http://localhost:8000/health -UseBasicParsing
docker compose exec -T postgres psql -U face_attendance -d face_attendance -c "select version_num from alembic_version;"
```

Expected migration revision: `003_refresh_sessions`.

Use a valid email domain such as `example.com` for register testing. Domains
such as `.local` are rejected by `email-validator`.
