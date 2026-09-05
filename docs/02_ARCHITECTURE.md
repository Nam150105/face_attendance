# System Architecture

## 1. Logical architecture
```text
                 +----------------------+
                 | Next.js Web / PWA    |
                 | PC / Tablet / Mobile |
                 +----------+-----------+
                            |
                         HTTPS
                            |
                 +----------v-----------+
                 | FastAPI API Gateway   |
                 | Auth/RBAC/Business    |
                 +----+----+----+--------+
                      |    |    |
          +-----------+    |    +----------------+
          |                |                     |
+---------v------+ +-------v-------+    +--------v---------+
| PostgreSQL     | | Redis         |    | Object Storage   |
| + pgvector     | | cache/locks   |    | MinIO/S3         |
+----------------+ +---------------+    +------------------+
          |
          |
+---------v------------------------------+
| Face AI Service / Worker               |
| detection -> alignment -> embedding    |
| -> liveness -> similarity verification |
+----------------------------------------+
```

## 2. Service responsibilities
### Web
- Authentication UI.
- Dashboard.
- Camera/GPS interaction.
- Attendance UX.
- Admin/member views.

### API
- Auth.
- RBAC.
- Tenant/member management.
- Location and geofence policy.
- Attendance transaction orchestration.
- Signed image URL generation.
- Audit log.

### Face AI
- Face detection.
- Face quality assessment.
- Face alignment.
- Embedding generation.
- Similarity search request.
- Liveness/spoof detection.

### PostgreSQL
- Users and business data.
- Attendance.
- Geolocation policy.
- Audit logs.
- Face embeddings via pgvector.

### Redis
- Rate limiting.
- Short-lived challenge/state.
- Idempotency keys.
- Distributed locks where necessary.

### Object storage
- Enrollment/reference images if retained.
- Attendance evidence images.
- Private buckets only.

## 3. Request flow: check-in
```text
Browser
  -> POST /attendance/check-in (image + GPS + idempotency key)
  -> Auth/RBAC
  -> validate member state
  -> validate GPS accuracy
  -> calculate distance to selected location
  -> geofence status
  -> Face AI: detect/quality/liveness/embedding
  -> compare embedding against member reference
  -> transaction: write attendance event + evidence metadata
  -> return status + reason/warning
```

## 4. Geofence policy
```text
D = distance(client_location, required_location)

D <= 100m       => ALLOW
100m < D <=200m => WARNING + REASON REQUIRED
D > 200m        => BLOCK
```
Distance calculation should use Haversine or a geospatial DB function. Store `distance_meters` and GPS `accuracy_meters` for traceability.

## 5. Important architectural decision
Do not make the client decide whether a check-in is valid. The client may display a preliminary state for UX, but the server is authoritative.

## 6. Recommended deployment
Local/dev:
- Docker Compose
- Next.js
- FastAPI
- Postgres+pgvector
- Redis
- MinIO
- Face AI

Production MVP:
- Reverse proxy/TLS
- Web container
- API replicas
- Worker/Face AI replicas as resources permit
- Managed Postgres or durable Postgres
- S3-compatible storage
- Redis
