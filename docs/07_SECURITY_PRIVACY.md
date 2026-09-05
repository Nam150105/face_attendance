# Security, Privacy and Biometric Data

## 1. Sensitive data classification
Face images and face embeddings are biometric/sensitive personal data. Treat them as high-value private data.

## 2. Consent and transparency
Before enrollment, show a clear notice explaining:
- what biometric data is collected
- why it is collected
- where it is stored
- retention period
- who may access it
- how deletion/correction works
- contact for privacy requests

Production deployment must be reviewed against the laws applicable to the operating jurisdiction and the organization's policies.

## 3. Storage
- Private object storage bucket.
- Encryption at rest where available.
- TLS in transit.
- DB role least privilege.
- Never expose embedding or storage keys to frontend.

## 4. Authorization
Tenant and object-level checks are mandatory.
Example:
```text
Manager A -> Member A/B only
Manager B -> Member C/D only
```
Manager A must receive 403/404 for Member C resources.

## 5. Audit
Audit at minimum:
- add/remove member
- assign location
- change geofence policy
- face re-enrollment
- manual attendance modification
- attendance deletion/correction
- role/status changes

## 6. Retention
Make image/biometric retention configurable. Avoid indefinite retention by default.

## 7. Security testing checklist
- Auth bypass
- IDOR/BOLA
- privilege escalation
- SQL injection
- file upload abuse
- signed URL abuse
- rate limit bypass
- replay/double-submit
- JWT misuse
- CSRF where applicable
- XSS
- SSRF via upload/storage URLs
- path traversal
