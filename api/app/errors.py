"""
Failures the person in front of the screen did not cause.

A member who cannot check in needs one thing: a short code they can read out to
whoever runs the system. Showing them a stack trace, a SQL constraint name or an
English exception class tells them nothing they can act on, and hands an
attacker a map of the internals for free.

So: the detail is written here with a code attached, and only the code travels
back to the browser.
"""

from __future__ import annotations

import os
import secrets
import traceback

import psycopg
from fastapi import Request
from fastapi.responses import JSONResponse

from app.auth import DATABASE_URL


# No 0/O and no 1/I: these codes get read aloud and typed by hand.
ALPHABET = "ACDEFGHJKLMNPQRTUVWXY2346789"
CODE_LENGTH = 6

# Set to "true" in development to also return the exception text. Off in
# production, where the code is the whole contract.
INCLUDE_DETAIL = os.environ.get("ERROR_DETAIL_IN_RESPONSE", "false").lower() == "true"


def new_code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))


def record_failure(request: Request, exception: BaseException) -> str:
    """Write the failure down and hand back the code that finds it again."""
    code = new_code()
    user = getattr(request.state, "user", None)
    try:
        with psycopg.connect(DATABASE_URL) as connection:
            connection.execute(
                """
                INSERT INTO error_events
                    (code, request_id, method, path, status_code, kind, detail, traceback,
                     user_id, user_email)
                VALUES (%s, %s, %s, %s, 500, %s, %s, %s, %s, %s)
                """,
                (
                    code,
                    getattr(request.state, "request_id", None),
                    request.method,
                    request.url.path,
                    type(exception).__name__,
                    str(exception)[:2000],
                    "".join(traceback.format_exception(exception))[:20000],
                    getattr(user, "id", None),
                    getattr(user, "email", None),
                ),
            )
            connection.commit()
    except Exception:
        # The database may be the very thing that broke. A code with no row
        # behind it is still better than a page that renders nothing.
        pass
    return code


async def unhandled_exception(request: Request, exception: Exception) -> JSONResponse:
    code = record_failure(request, exception)
    body = {"detail": "SYSTEM_ERROR", "error_code": code}
    if INCLUDE_DETAIL:
        body["debug"] = f"{type(exception).__name__}: {exception}"
    return JSONResponse(status_code=500, content=body, headers={"X-Error-Code": code})
