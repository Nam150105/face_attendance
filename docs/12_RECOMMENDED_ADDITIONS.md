# Recommended Additions Beyond the Initial Request

These should be considered part of the product design even if some are implemented after MVP.

## 1. Email verification
Required before a member can complete biometric enrollment.

## 2. Consent record
Store versioned consent/notice acceptance for biometric enrollment.

## 3. Schedule rules
Attendance should know expected working windows to support late/early/overtime reporting later.

## 4. Attendance state machine
Avoid deriving state only from arbitrary timestamps. Keep event history and derive current state consistently.

## 5. Manual correction workflow
Manager corrections require reason and audit. Optionally add approval by higher-level admin later.

## 6. Image retention policy
Automatic deletion after configurable number of days is safer than indefinite evidence retention.

## 7. Multi-tenant readiness
Even if MVP has one manager/company, structure authorization so a later company/team entity can isolate data.

## 8. Device/browser compatibility page
Camera + geolocation permissions vary by browser. Provide a readiness check before attendance.

## 9. Reliability
Use idempotency keys, transaction boundaries and retry-safe storage flows to avoid duplicate attendance records.

## 10. Privacy by design
Prefer storing embeddings rather than raw reference photos for matching; retain raw photos only when there is a clear business reason and policy.
