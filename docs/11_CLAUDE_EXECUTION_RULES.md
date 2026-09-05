# Claude Implementation Rules

## 1. Execution behavior
Claude must work phase-by-phase according to `10_IMPLEMENTATION_PHASES.md`.

For every phase:
1. Inspect current code.
2. Implement only the current phase and required prerequisites.
3. Run lint/typecheck/unit/integration tests relevant to the phase.
4. Run the application if possible.
5. Record changed files.
6. Report acceptance criteria as PASS/FAIL.
7. Do not mark a phase complete if an acceptance criterion is unverified.

## 2. Do not fake AI behavior
During early phases, AI adapters may use a stub interface, but the production face service must not claim real recognition when it is a mock.

Use interfaces:
```python
class FaceRecognitionService:
    async def enroll(...): ...
    async def verify(...): ...
```

Keep model-specific code isolated behind the interface.

## 3. Keep business logic out of route handlers
Use:
```text
router -> service -> repository -> database
```
AI orchestration should be in services/workers.

## 4. API contract first
Implement schemas and error codes before UI depends heavily on them.

## 5. Database migrations only
Never manually mutate production schema as a substitute for migration files.

## 6. Security rule
Never trust:
- member_id from client when it conflicts with authenticated user for member self-actions
- location validity calculated only in browser
- face score supplied by client
- role supplied by client
- image URLs supplied by client for sensitive evidence access

## 7. Final report format
After each phase:
```text
PHASE: X
STATUS: PASS / PARTIAL / FAIL
Implemented:
- ...
Tests:
- ...
Acceptance:
- PASS ...
- FAIL ...
Changed files:
- ...
Known issues:
- ...
```
