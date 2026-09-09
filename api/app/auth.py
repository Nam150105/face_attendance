from __future__ import annotations

import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

import jwt
import psycopg
from fastapi import Depends, HTTPException, status
from fastapi.security import APIKeyHeader, OAuth2PasswordBearer
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field


DATABASE_URL = os.environ.get("DATABASE_URL", "").replace("postgresql+psycopg://", "postgresql://", 1)
JWT_SECRET = os.environ.get("JWT_SECRET", "change-me-local-only")
ACCESS_TTL_MINUTES = int(os.environ.get("JWT_ACCESS_TTL_MINUTES", "15"))
REFRESH_TTL_DAYS = int(os.environ.get("JWT_REFRESH_TTL_DAYS", "30"))
AUTH_DEBUG_RETURN_RESET_TOKEN = os.environ.get("AUTH_DEBUG_RETURN_RESET_TOKEN", "false").lower() == "true"
ALGORITHM = "HS256"
# Which roles are held to one device is now a setting the system administrator
# changes on screen (session_policies). The environment variable is kept only
# as the answer for a database that has not been migrated yet.
SINGLE_SESSION_ROLES = {
    role.strip().upper()
    for role in os.environ.get("SINGLE_SESSION_ROLES", "MEMBER").split(",")
    if role.strip()
}
# last_active_at is a heartbeat, not an audit trail; writing it on every request
# would add a write to every authenticated call for no extra information.
ACTIVITY_WRITE_INTERVAL_SECONDS = 60
password_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)
api_key_scheme = APIKeyHeader(name="X-API-Key", auto_error=False)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    role: str = Field(default="MEMBER", pattern="^(MANAGER|MEMBER)$")
    # The unit a person belongs to, typed off a whiteboard. Optional: somebody
    # can sign up first and ask to join later.
    team_code: str | None = Field(default=None, max_length=24)
    # Opaque value the client generates once and keeps; never an IP address.
    device_id: str | None = Field(default=None, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    device_id: str | None = Field(default=None, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ForgotPasswordResponse(BaseModel):
    message: str
    debug_token: str | None = None


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class CurrentUser(BaseModel):
    id: uuid.UUID
    email: EmailStr
    role: str
    status: str
    # Present for tokens issued after the single-session migration; logout uses
    # it to close exactly the caller's own session.
    session_id: uuid.UUID | None = None


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def digest_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_access_token(user_id: str, role: str, session_id: str | None = None) -> str:
    now = utc_now()
    payload = {
        "sub": user_id,
        "role": role,
        "type": "access",
        # sid ties the token to a server-side session so revoking that session
        # takes effect on the next request instead of when the token expires.
        "sid": session_id,
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TTL_MINUTES),
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGORITHM)


def create_refresh_token(user_id: str, role: str, session_id: str) -> tuple[str, datetime]:
    now = utc_now()
    expires_at = now + timedelta(days=REFRESH_TTL_DAYS)
    token = jwt.encode(
        {
            "sub": user_id,
            "role": role,
            "type": "refresh",
            "sid": session_id,
            "iat": now,
            "exp": expires_at,
            "jti": str(uuid.uuid4()),
        },
        JWT_SECRET,
        algorithm=ALGORITHM,
    )
    return token, expires_at


SESSION_REVOKED = "SESSION_REVOKED"


def revoke_user_sessions(
    connection: psycopg.Connection,
    user_id: uuid.UUID,
    reason: str,
    keep_session_id: uuid.UUID | None = None,
) -> int:
    """Close every active session of one user. Used by login, password reset and
    account suspension; never touches another user's rows."""
    clauses = ["user_id = %s", "revoked_at IS NULL"]
    parameters: list = [user_id]
    if keep_session_id is not None:
        clauses.append("id <> %s")
        parameters.append(keep_session_id)
    return connection.execute(
        f"UPDATE refresh_sessions SET revoked_at = now(), revoked_reason = %s WHERE {' AND '.join(clauses)}",
        [reason, *parameters],
    ).rowcount


def _holds_one_device(connection: psycopg.Connection, role: str) -> bool:
    """
    Is this role limited to one device right now?

    Read per login rather than cached: the administrator flipping the switch
    expects the next login to obey it, and one indexed lookup on a three-row
    table is cheaper than any cache that can go stale.
    """
    try:
        row = connection.execute(
            "SELECT allow_multiple_devices FROM session_policies WHERE role = %s",
            (role.upper(),),
        ).fetchone()
    except psycopg.errors.UndefinedTable:
        connection.rollback()
        return role.upper() in SINGLE_SESSION_ROLES
    if row is None:
        return role.upper() in SINGLE_SESSION_ROLES
    return not row[0]


def issue_tokens(
    connection: psycopg.Connection,
    user_id: uuid.UUID,
    role: str,
    device_id: str | None = None,
    user_agent: str | None = None,
) -> TokenResponse:
    """
    Start a session and hand back the pair for it.

    For roles under the single-device rule the caller must already hold the row
    lock on the user (see lock_user), so two logins racing each other are
    serialised; the partial unique index is the backstop if they are not.
    """
    enforce = _holds_one_device(connection, role)
    if enforce:
        revoke_user_sessions(connection, user_id, "NEW_DEVICE_LOGIN")

    session_id = uuid.uuid4()
    access_token = create_access_token(str(user_id), role, str(session_id))
    refresh_token, expires_at = create_refresh_token(str(user_id), role, str(session_id))
    connection.execute(
        """
        INSERT INTO refresh_sessions
            (id, user_id, token_hash, expires_at, device_id, user_agent,
             enforce_single_session, last_active_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, now())
        """,
        (
            session_id,
            user_id,
            digest_token(refresh_token),
            expires_at,
            device_id,
            (user_agent or "")[:400] or None,
            enforce,
        ),
    )
    connection.commit()
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


def lock_user(connection: psycopg.Connection, user_id: uuid.UUID) -> None:
    """Serialise concurrent logins for the same account."""
    connection.execute("SELECT id FROM users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()


def unauthorized(message: str = "Invalid or expired credentials") -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=message)


def decode_access_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
    except jwt.PyJWTError as error:
        raise unauthorized() from error
    if payload.get("type") != "access" or not payload.get("sub"):
        raise unauthorized()
    return payload


def decode_refresh_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
    except jwt.PyJWTError as error:
        raise unauthorized() from error
    if payload.get("type") != "refresh" or not payload.get("sub"):
        raise unauthorized()
    return payload


def access_token(
    api_key: Annotated[str | None, Depends(api_key_scheme)],
    bearer: Annotated[str | None, Depends(oauth2_scheme)],
) -> str:
    """X-API-Key carries the access token. Bearer stays accepted for existing clients."""
    token = api_key or bearer
    if not token:
        raise unauthorized("Missing X-API-Key header")
    return token


def get_current_user(token: Annotated[str, Depends(access_token)]) -> CurrentUser:
    payload = decode_access_token(token)
    session_id = payload.get("sid")
    if not session_id:
        # Pre-session tokens cannot be checked against a session, so they are no
        # longer honoured. Requirement: never trust signature and expiry alone.
        raise unauthorized(SESSION_REVOKED)

    try:
        with psycopg.connect(DATABASE_URL) as connection:
            # One round trip answers both "is the account usable" and "is this
            # session still the active one".
            row = connection.execute(
                """
                SELECT u.id, u.email, u.role::text, u.status::text,
                       s.id, s.revoked_at IS NULL AND s.expires_at > now() AS session_active,
                       s.last_active_at
                FROM users u
                LEFT JOIN refresh_sessions s ON s.id = %s AND s.user_id = u.id
                WHERE u.id = %s
                """,
                (session_id, payload["sub"]),
            ).fetchone()

            if row is None or row[3] != "ACTIVE":
                raise unauthorized("User is not active")
            if row[4] is None or not row[5]:
                raise unauthorized(SESSION_REVOKED)

            last_active = row[6]
            if last_active is None or (utc_now() - last_active).total_seconds() > ACTIVITY_WRITE_INTERVAL_SECONDS:
                connection.execute(
                    "UPDATE refresh_sessions SET last_active_at = now() WHERE id = %s", (session_id,)
                )
                connection.commit()
    except psycopg.Error as error:
        raise HTTPException(status_code=503, detail="Database unavailable") from error

    return CurrentUser(id=row[0], email=row[1], role=row[2], status=row[3], session_id=row[4])


def require_roles(*roles: str):
    """For actions two roles share — a manager acting on their group and a super
    admin acting anywhere both adjust the same record."""
    def dependency(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user

    return dependency


def require_role(role: str):
    def dependency(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
        if user.role != role:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user

    return dependency


def validate_password(password: str) -> None:
    if len(password) < 8 or not any(character.isalpha() for character in password) or not any(character.isdigit() for character in password):
        raise HTTPException(status_code=422, detail="Password must contain at least 8 characters, letters, and numbers")


def random_request_id() -> str:
    return secrets.token_hex(16)
