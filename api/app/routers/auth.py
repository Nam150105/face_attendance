import secrets
import uuid

from fastapi import APIRouter, HTTPException, Request, status
import psycopg

from app.auth import (
    AUTH_DEBUG_RETURN_RESET_TOKEN,
    SESSION_REVOKED,
    CurrentUser,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
    decode_access_token,
    decode_refresh_token,
    digest_token,
    get_current_user,
    create_access_token,
    create_refresh_token,
    issue_tokens,
    lock_user,
    password_context,
    revoke_user_sessions,
    unauthorized,
    validate_password,
    DATABASE_URL,
)
from app.security import clear_rate_limit, client_ip, enforce_rate_limit
from fastapi import Depends


router = APIRouter(prefix="/auth", tags=["auth"])

# Login is limited per address *and* per account: per-IP alone lets a botnet
# spray one password across many accounts, per-account alone lets one host walk
# a password list against many accounts.
LOGIN_WINDOW_SECONDS = 300


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(request: RegisterRequest, http_request: Request) -> TokenResponse:
    # 30/hour/IP: an organisation onboarding a class or a shift all sit behind
    # one NAT address, so a tighter cap would block legitimate sign-ups.
    enforce_rate_limit("register-ip", client_ip(http_request), limit=30, window_seconds=3600)
    validate_password(request.password)
    try:
        with psycopg.connect(DATABASE_URL) as connection:
            row = connection.execute(
                "INSERT INTO users (email, password_hash, role, status, email_verified_at) VALUES (%s, %s, %s::user_role, 'ACTIVE', now()) RETURNING id, role::text",
                (str(request.email).lower(), password_context.hash(request.password), request.role),
            ).fetchone()
            return issue_tokens(
                connection, row[0], row[1], request.device_id, http_request.headers.get("user-agent")
            )
    except psycopg.errors.UniqueViolation as error:
        raise HTTPException(status_code=409, detail="Email is already registered") from error


@router.post("/login", response_model=TokenResponse)
def login(request: LoginRequest, http_request: Request) -> TokenResponse:
    email = str(request.email).lower()
    address = client_ip(http_request)
    enforce_rate_limit("login-ip", address, limit=20, window_seconds=LOGIN_WINDOW_SECONDS)
    enforce_rate_limit("login-account", email, limit=10, window_seconds=LOGIN_WINDOW_SECONDS)
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            "SELECT id, password_hash, role::text, status::text FROM users WHERE email = %s", (email,)
        ).fetchone()
        if row is None or row[3] != "ACTIVE" or not password_context.verify(request.password, row[1]):
            raise unauthorized("Invalid email or password")
        # Hold the account row for the rest of the transaction: two logins racing
        # each other are serialised, so the loser revokes and re-inserts cleanly
        # instead of both believing they created the only active session.
        lock_user(connection, row[0])
        connection.execute("UPDATE users SET last_login_at = now() WHERE id = %s", (row[0],))
        # A correct password clears the brake so one typo streak does not lock
        # out a legitimate user for the rest of the window.
        clear_rate_limit("login-account", email, LOGIN_WINDOW_SECONDS)
        clear_rate_limit("login-ip", address, LOGIN_WINDOW_SECONDS)
        return issue_tokens(
            connection, row[0], row[2], request.device_id, http_request.headers.get("user-agent")
        )


@router.post("/refresh", response_model=TokenResponse)
def refresh(request: RefreshRequest, http_request: Request) -> TokenResponse:
    enforce_rate_limit("refresh-ip", client_ip(http_request), limit=60, window_seconds=300)
    payload = decode_refresh_token(request.refresh_token)
    session_id = payload.get("sid")
    if not session_id:
        raise unauthorized(SESSION_REVOKED)
    with psycopg.connect(DATABASE_URL) as connection:
        # FOR UPDATE stops two parallel refreshes from both rotating the same
        # token; the loser finds the hash already changed and is refused.
        row = connection.execute(
            """
            SELECT id, user_id FROM refresh_sessions
            WHERE id = %s AND token_hash = %s AND revoked_at IS NULL AND expires_at > now()
            FOR UPDATE
            """,
            (session_id, digest_token(request.refresh_token)),
        ).fetchone()
        if row is None:
            raise unauthorized(SESSION_REVOKED)
        user = connection.execute("SELECT role::text, status::text FROM users WHERE id = %s", (row[1],)).fetchone()
        if user is None or user[1] != "ACTIVE":
            raise unauthorized("User is not active")

        # Rotate the secret but keep the session: the device stays the same one.
        new_refresh_token, expires_at = create_refresh_token(str(row[1]), user[0], str(row[0]))
        connection.execute(
            """
            UPDATE refresh_sessions
            SET token_hash = %s, expires_at = %s, last_used_at = now(), last_active_at = now()
            WHERE id = %s
            """,
            (digest_token(new_refresh_token), expires_at, row[0]),
        )
        connection.commit()
        return TokenResponse(
            access_token=create_access_token(str(row[1]), user[0], str(row[0])),
            refresh_token=new_refresh_token,
        )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: LogoutRequest) -> None:
    with psycopg.connect(DATABASE_URL) as connection:
        # Scoped by the token hash, so a logout can only ever end the session
        # whose refresh token the caller actually holds.
        connection.execute(
            "UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, now()), "
            "revoked_reason = COALESCE(revoked_reason, 'LOGOUT') WHERE token_hash = %s",
            (digest_token(request.refresh_token),),
        )
        connection.commit()


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
def forgot_password(request: ForgotPasswordRequest, http_request: Request) -> ForgotPasswordResponse:
    enforce_rate_limit("forgot-ip", client_ip(http_request), limit=10, window_seconds=3600)
    enforce_rate_limit("forgot-account", str(request.email).lower(), limit=5, window_seconds=3600)
    raw_token = secrets.token_urlsafe(32)
    with psycopg.connect(DATABASE_URL) as connection:
        user = connection.execute("SELECT id FROM users WHERE email = %s", (str(request.email).lower(),)).fetchone()
        if user is not None:
            connection.execute(
                "UPDATE password_reset_tokens SET used_at = COALESCE(used_at, now()) WHERE user_id = %s AND used_at IS NULL",
                (user[0],),
            )
            connection.execute(
                "INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (%s, %s, %s, now() + interval '15 minutes')",
                (uuid.uuid4(), user[0], digest_token(raw_token)),
            )
            connection.commit()
    response = ForgotPasswordResponse(message="If the account exists, password reset instructions have been sent.")
    if AUTH_DEBUG_RETURN_RESET_TOKEN:
        response.debug_token = raw_token
    return response


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(request: ResetPasswordRequest, http_request: Request) -> None:
    enforce_rate_limit("reset-ip", client_ip(http_request), limit=20, window_seconds=3600)
    validate_password(request.new_password)
    with psycopg.connect(DATABASE_URL) as connection:
        token = connection.execute(
            "SELECT id, user_id FROM password_reset_tokens WHERE token_hash = %s AND used_at IS NULL AND expires_at > now()",
            (digest_token(request.token),),
        ).fetchone()
        if token is None:
            raise HTTPException(status_code=400, detail="Invalid or expired password reset token")
        connection.execute(
            "UPDATE users SET password_hash = %s, updated_at = now() WHERE id = %s",
            (password_context.hash(request.new_password), token[1]),
        )
        connection.execute("UPDATE password_reset_tokens SET used_at = now() WHERE id = %s", (token[0],))
        # A password change invalidates every device, not just this one.
        revoke_user_sessions(connection, token[1], "PASSWORD_RESET")
        connection.commit()


@router.get("/me", response_model=CurrentUser)
def me(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    return user
