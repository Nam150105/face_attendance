# Database Architecture — PostgreSQL + pgvector

## 1. Design principles
- UUID primary keys.
- `created_at`, `updated_at` on mutable entities.
- Soft-delete where audit/history matters.
- Foreign keys and indexes defined explicitly.
- PostgreSQL is source of truth.
- pgvector stores biometric embeddings, not raw photos.

## 2. Core entities
### users
```text
id UUID PK
email CITEXT UNIQUE
password_hash TEXT
role ENUM(MANAGER, MEMBER)
status ENUM(ACTIVE, SUSPENDED, PENDING_VERIFICATION)
email_verified_at TIMESTAMPTZ NULL
last_login_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

### member_profiles
```text
id UUID PK
user_id UUID FK users
full_name TEXT
phone TEXT
birth_date DATE NULL
employee_code TEXT NULL
position TEXT NULL
department TEXT NULL
avatar_object_key TEXT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

### manager_memberships
Maps which manager/workspace controls which member.
```text
id UUID PK
manager_user_id UUID FK users
member_user_id UUID FK users
status ENUM(INVITED, ACTIVE, SUSPENDED, REMOVED)
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
UNIQUE(manager_user_id, member_user_id)
```

### locations
```text
id UUID PK
name TEXT
address TEXT NULL
latitude DECIMAL(10,7)
longitude DECIMAL(10,7)
allow_radius_meters INT DEFAULT 100
warning_radius_meters INT DEFAULT 200
is_active BOOLEAN
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

### member_locations
```text
id UUID PK
member_id UUID FK users
location_id UUID FK locations
is_default BOOLEAN
created_at TIMESTAMPTZ
```

### face_embeddings
```text
id UUID PK
member_id UUID FK users
embedding VECTOR(512) -- change dimension according to chosen model
model_name TEXT
model_version TEXT
quality_score NUMERIC NULL
created_at TIMESTAMPTZ
revoked_at TIMESTAMPTZ NULL
```
Never hard-code 512 if the selected model has another dimension. Migration must match the exact production model.

### attendance_events
One row per physical check action.
```text
id UUID PK
member_id UUID FK users
location_id UUID FK locations
event_type ENUM(CHECK_IN, CHECK_OUT)
status ENUM(SUCCESS, WARNING_CONFIRMED, BLOCKED, FAILED)
server_time TIMESTAMPTZ
latitude DECIMAL(10,7)
longitude DECIMAL(10,7)
gps_accuracy_meters NUMERIC
distance_meters NUMERIC
face_match_score NUMERIC NULL
liveness_score NUMERIC NULL
image_object_key TEXT NULL
reason TEXT NULL
idempotency_key TEXT UNIQUE NULL
created_at TIMESTAMPTZ
```

### attendance_summary (optional projection)
For fast calendar/month views. Source of truth remains events.
```text
id UUID PK
member_id UUID
work_date DATE
first_check_in TIMESTAMPTZ
last_check_out TIMESTAMPTZ
worked_minutes INT NULL
status TEXT
```

### schedules
```text
id UUID PK
member_id UUID
weekday SMALLINT NULL
work_date DATE NULL
start_time TIME
end_time TIME
timezone TEXT
is_active BOOLEAN
```

### audit_logs
```text
id UUID PK
actor_user_id UUID
action TEXT
entity_type TEXT
entity_id UUID
before_json JSONB NULL
after_json JSONB NULL
reason TEXT NULL
created_at TIMESTAMPTZ
ip_address INET NULL
user_agent TEXT NULL
```

## 3. Indexes
- users(email)
- manager_memberships(manager_user_id, status)
- manager_memberships(member_user_id, status)
- attendance_events(member_id, server_time DESC)
- attendance_events(location_id, server_time DESC)
- attendance_events(event_type, server_time DESC)
- audit_logs(entity_type, entity_id, created_at DESC)
- pgvector index according to expected dataset/model and benchmark.

## 4. Data retention
Define configurable policies before production:
- attendance event retention
- evidence image retention
- raw enrollment image retention
- embedding retention after account deletion
- audit log retention

Deletion of member account must not silently leave orphaned biometric data.
