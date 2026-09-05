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
password_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)
api_key_scheme = APIKeyHeader(name="X-API-Key", auto_error=False)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    role: str = Field(default="MEMBER", pattern="^(MANAGER|MEMBER)$")


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


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


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def digest_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_access_token(user_id: str, role: str) -> str:
    now = utc_now()
    payload = {
        "sub": user_id,
        "role": role,
        "type": "access",
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TTL_MINUTES),
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGORITHM)


def create_refresh_token(user_id: str, role: str) -> tuple[str, str, datetime]:
    now = utc_now()
    expires_at = now + timedelta(days=REFRESH_TTL_DAYS)
    token = jwt.encode(
        {"sub": user_id, "role": role, "type": "refresh", "iat": now, "exp": expires_at, "jti": str(uuid.uuid4())},
        JWT_SECRET,
        algorithm=ALGORITHM,
    )
    return token, str(uuid.uuid4()), expires_at


def issue_tokens(connection: psycopg.Connection, user_id: uuid.UUID, role: str) -> TokenResponse:
    access_token = create_access_token(str(user_id), role)
    refresh_token, session_id, expires_at = create_refresh_token(str(user_id), role)
    connection.execute(
        "INSERT INTO refresh_sessions (id, user_id, token_hash, expires_at) VALUES (%s, %s, %s, %s)",
        (session_id, user_id, digest_token(refresh_token), expires_at),
    )
    connection.commit()
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


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
    try:
        with psycopg.connect(DATABASE_URL) as connection:
            row = connection.execute(
                "SELECT id, email, role::text, status::text FROM users WHERE id = %s", (payload["sub"],)
            ).fetchone()
    except psycopg.Error as error:
        raise HTTPException(status_code=503, detail="Database unavailable") from error
    if row is None or row[3] != "ACTIVE":
        raise unauthorized("User is not active")
    return CurrentUser(id=row[0], email=row[1], role=row[2], status=row[3])


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
