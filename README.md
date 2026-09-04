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

The Face AI service uses OpenCV CPU processing for image decoding, face-count
detection, blur scoring, and brightness checks. Embedding generation and
production liveness remain disabled until a model, license, threshold
evaluation set, and anti-spoofing provider are selected. Face AI is called
internally by the API through the Docker backend network.

## Phase 2 authentication checks

The API now supports register, login, current-user lookup, refresh-token
rotation, logout revocation, and manager role protection. After the stack is
running, check the API and migration:

```powershell
Invoke-WebRequest http://localhost:8000/health -UseBasicParsing
docker compose exec -T postgres psql -U face_attendance -d face_attendance -c "select version_num from alembic_version;"
```

Expected migration revision: `005_password_reset_tokens`.

Use a valid email domain such as `example.com` for register testing. Domains
such as `.local` are rejected by `email-validator`.

## Phase 3 membership checks

Phase 3 adds member profile management and Manager-scoped membership APIs:

```text
GET  /api/v1/members/me
PUT  /api/v1/members/me
GET  /api/v1/manager/members
POST /api/v1/manager/members/add-by-email
GET  /api/v1/manager/members/{member_id}
PUT  /api/v1/manager/members/{member_id}
DELETE /api/v1/manager/members/{member_id}
```

Expected behavior:

- A Member can read and update only their own profile.
- A Manager can add only an already registered Member email.
- Duplicate membership returns `409`.
- Unknown email returns `404`.
- A Manager cannot access a Member outside their membership scope.
- Membership add, status changes, and removal create audit log entries.

## Phase 4 location and geofence checks

Phase 4 adds Manager-owned locations, member assignment, and server-side GPS
evaluation:

```text
GET    /api/v1/manager/locations
POST   /api/v1/manager/locations
GET    /api/v1/manager/locations/{location_id}
PUT    /api/v1/manager/locations/{location_id}
DELETE /api/v1/manager/locations/{location_id}
POST   /api/v1/manager/members/{member_id}/locations
POST   /api/v1/locations/{location_id}/evaluate
```

Expected geofence results are `ALLOW` within the configured allow radius,
`WARNING_REASON_REQUIRED` between the allow and warning radii, `BLOCK` beyond
the warning radius, and `GPS_ACCURACY_LOW` when the reported accuracy is above
the configured minimum. Location access is restricted to its owning Manager or
an active Member assignment.

Expected migration revision: `006_location_ownership`.

## Phase 5 face enrollment foundation

Phase 5 adds:

```text
POST /api/v1/faces/enrollment/start
POST /api/v1/faces/enrollment/verify
```

Enrollment challenges are short-lived, server-side, single-use records. The
Face AI service rejects invalid images and reports `FACE_NOT_FOUND`,
`MULTIPLE_FACES`, or `FACE_QUALITY_LOW` from the OpenCV pipeline. Until a real
embedding model is configured, valid enrollment returns
`FACE_MODEL_NOT_CONFIGURED`; the system never stores a fake embedding.

Expected migration revision: `007_face_enrollment_challenges`.

## Face AI model storage

Model files are intentionally kept outside Git and mounted read-only into the
Face AI container:

```text
D:\face-attendance-models\detector\face_detector.onnx
D:\face-attendance-models\embedding\arcface.onnx
```

The current demo runs OpenCV and ONNX Runtime on CPU. With no model files and
`FACE_AI_ENABLE_EMBEDDINGS=false`, Face AI reports `not_configured` and never
creates a fake embedding. Enable embeddings only after the selected model's
license, preprocessing, output dimension, and verification threshold have
been validated.
