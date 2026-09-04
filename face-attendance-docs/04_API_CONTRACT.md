# FastAPI API Contract

Base URL: `/api/v1`

## 1. Auth
```text
POST /auth/register
POST /auth/login
POST /auth/refresh
POST /auth/logout
POST /auth/forgot-password
POST /auth/reset-password
GET  /auth/me
```

## 2. Member profile
```text
GET  /members/me
PUT  /members/me
GET  /members/me/attendance
```

## 3. Face
```text
POST /faces/enrollment/start
POST /faces/enrollment/verify
DELETE /faces/me
POST /faces/re-enrollment/start
```

Enrollment should preferably be a short-lived server-side flow/challenge rather than a blind single upload.

## 4. Attendance
```text
POST /attendance/check-in
POST /attendance/check-out
GET  /attendance/me
GET  /attendance/me/{attendance_id}
```

### Check-in request
`multipart/form-data` or a pre-signed upload flow.

Fields:
```text
image
latitude
longitude
gps_accuracy_meters
idempotency_key
client_timestamp (optional)
```

### Response states
```json
{
  "status": "SUCCESS",
  "event_id": "uuid",
  "distance_meters": 42.7,
  "message": "Check-in successful"
}
```

Warning:
```json
{
  "status": "WARNING_REASON_REQUIRED",
  "event_id": null,
  "distance_meters": 143.2,
  "message": "You are outside the preferred area. A reason is required."
}
```

Confirm warning:
```text
POST /attendance/check-in/confirm-warning
```
Body:
```json
{
  "challenge_id": "uuid",
  "reason": "Client visit at another branch"
}
```

Blocked:
```json
{
  "status": "BLOCKED_OUTSIDE_GEOFENCE",
  "distance_meters": 247.1,
  "message": "Check-in is disabled because you are more than 200m from the required location."
}
```

## 5. Manager
```text
GET  /manager/dashboard
GET  /manager/members
POST /manager/members/add-by-email
PUT  /manager/members/{member_id}
DELETE /manager/members/{member_id}
GET  /manager/members/{member_id}
GET  /manager/members/{member_id}/attendance

GET  /manager/locations
POST /manager/locations
PUT  /manager/locations/{location_id}
DELETE /manager/locations/{location_id}
POST /manager/members/{member_id}/locations

GET  /manager/attendance
GET  /manager/attendance/{event_id}
POST /manager/attendance/{event_id}/manual-adjust
GET  /manager/audit-logs
```

## 6. Authorization rules
- MEMBER cannot access manager endpoints.
- Manager can only access resources within its managed membership scope.
- Server must enforce object-level authorization for every ID-based endpoint.

## 7. Error format
Use one schema:
```json
{
  "error": {
    "code": "FACE_NOT_MATCHED",
    "message": "Face verification failed",
    "details": {},
    "request_id": "uuid"
  }
}
```
