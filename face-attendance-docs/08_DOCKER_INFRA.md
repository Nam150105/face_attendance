# Docker and Infrastructure

## 1. Dev services
```text
frontend
api
face-ai
postgres
redis
minio
```

## 2. Compose expectations
- Separate networks where useful.
- Persistent volumes for Postgres and MinIO.
- Healthchecks for dependencies.
- `.env.example` committed; real `.env` ignored.
- Non-root containers where practical.
- Resource limits documented for AI service.

## 3. Environment variables
```text
DATABASE_URL
REDIS_URL
S3_ENDPOINT
S3_ACCESS_KEY
S3_SECRET_KEY
S3_BUCKET
JWT_SECRET
JWT_ACCESS_TTL
JWT_REFRESH_TTL
FACE_MODEL_NAME
FACE_MODEL_VERSION
FACE_MATCH_THRESHOLD
GPS_MIN_ACCURACY_METERS
DEFAULT_ALLOW_RADIUS_METERS=100
DEFAULT_WARNING_RADIUS_METERS=200
```

Do not commit secrets.

## 4. Production readiness
- TLS termination.
- Domain/reverse proxy.
- Database backups.
- Object storage backup policy.
- Monitoring and centralized logs.
- Alerting for API/AI/DB failures.
