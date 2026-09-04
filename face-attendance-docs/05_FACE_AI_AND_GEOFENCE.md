# Face AI + Location Verification Specification

## 1. Face pipeline
```text
image
 -> decode/size validation
 -> face detection
 -> exactly one face required
 -> image quality checks
 -> alignment
 -> liveness / anti-spoofing
 -> embedding extraction
 -> similarity verification
```

## 2. Enrollment requirements
- Require exactly one face.
- Face occupies sufficient pixels.
- Reject severe blur, darkness/overexposure, extreme pose.
- Require liveness where supported.
- Generate embedding from approved model.
- Store model name/version with every embedding.
- Consider multiple enrollment samples and aggregate/store a representative embedding if evaluation proves it improves robustness.

## 3. Verification
For self check-in, compare against the current authenticated member's enrolled embedding first. This is faster and reduces accidental cross-person matches.

Optional manager/camera mode can perform 1:N identification through pgvector.

## 4. Thresholds
Do not invent a universal threshold. Determine threshold experimentally using a validation set representative of expected users, lighting, devices and cameras. Track:
- false accept rate
- false reject rate
- ROC/DET or equivalent evaluation
- score distribution

Store `model_version` and threshold/policy version with results so decisions remain auditable.

## 5. Location verification
Inputs:
- latitude
- longitude
- GPS accuracy meters
- selected location coordinates
- allowed radius
- warning radius

Recommended rule:
```text
if accuracy is unacceptable:
    request better GPS / retry
elif distance <= allow_radius:
    ALLOW
elif distance <= warning_radius:
    WARNING_REASON_REQUIRED
else:
    BLOCK
```

Do not treat GPS accuracy as perfect. The UI should show accuracy and backend should define a minimum accepted accuracy policy.

## 6. Anti-abuse
Recommended controls:
- server timestamp authoritative
- idempotency key
- rate limit attendance attempts
- detect repeated identical images when practical
- record coarse device/session metadata needed for security
- evaluate mock-location indicators where browser/device capabilities allow
- do not rely on client JavaScript alone for security

## 7. Evidence image
The stored image should be the exact image used in the successful/attempted event according to policy. Keep private. Generate short-lived signed access URLs for Manager.

## 8. Failure codes
```text
FACE_NOT_FOUND
MULTIPLE_FACES
FACE_QUALITY_LOW
LIVENESS_FAILED
FACE_NOT_MATCHED
GPS_PERMISSION_DENIED
GPS_UNAVAILABLE
GPS_ACCURACY_LOW
OUTSIDE_WARNING_ZONE
OUTSIDE_ALLOWED_ZONE
CHECK_IN_ALREADY_EXISTS
CHECK_OUT_WITHOUT_CHECK_IN
MEMBER_SUSPENDED
```
