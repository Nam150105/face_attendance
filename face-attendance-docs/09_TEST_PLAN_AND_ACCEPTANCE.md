# Test Plan and Acceptance Criteria

## Phase-level acceptance
### Auth
PASS when Manager and Member can register/login/logout and access only permitted screens.

### Enrollment
PASS when valid enrollment succeeds and invalid conditions show deterministic error states.

### Geofence
PASS when:
- 50m -> check-in allowed.
- 100m -> check-in allowed.
- 150m -> reason required.
- 200m -> reason required.
- 201m -> blocked.
- GPS denied -> no silent success.

### Attendance
PASS when a successful event has server time, member, event type, location, distance, face/liveness scores where supported, and private image evidence.

### Manager
PASS when manager can add registered member by email, assign location, browse attendance by date/member and open evidence image.

### Audit
PASS when every manual adjustment records actor, before/after, timestamp, and reason.

## Security acceptance
- Member cannot read another member's attendance.
- Manager cannot read an unmanaged member.
- Evidence object cannot be downloaded by guessing a URL.
- Rate limits work for login and verification.

## Suggested automated tests
- Unit: Haversine/geofence service.
- Unit: attendance state machine.
- Unit: permission policy.
- Unit: request validation.
- Integration: Postgres + pgvector.
- Integration: object storage signed URL.
- API: all auth and attendance endpoints.
- E2E: registration → enrollment → manager assignment → check-in → warning → checkout → manager review.
