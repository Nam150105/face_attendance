"""Upload validation, rate limiting and request-level hardening.

Kept separate from auth.py: auth answers "who is this", this module answers
"is this request allowed to cost us anything".
"""

from __future__ import annotations

import os
import time

import redis
from fastapi import HTTPException, Request, status


# ---------------------------------------------------------------- image uploads

MAX_IMAGE_BYTES = 10 * 1024 * 1024

# Content type is decided here from the bytes, never from the client. A stored
# "text/html" would be echoed back by the evidence endpoint on the API origin.
_MAGIC = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
)

ALLOWED_IMAGE_TYPES = frozenset({"image/jpeg", "image/png"})


def sniff_image_type(content: bytes) -> str | None:
    """Return the real media type of an image, or None when it is not one."""
    for signature, media_type in _MAGIC:
        if content.startswith(signature):
            return media_type
    # WebP is RIFF....WEBP; the size field in between is not fixed.
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    return None


def validate_image_upload(content: bytes) -> str:
    """Enforce size and real format. Returns the media type to store."""
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="IMAGE_INVALID")
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds 10 MB limit")
    media_type = sniff_image_type(content)
    if media_type is None or media_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="UNSUPPORTED_IMAGE_TYPE")
    return media_type


def safe_image_content_type(stored: str | None) -> str:
    """Never hand a browser a media type that came from an uploader."""
    return stored if stored in ALLOWED_IMAGE_TYPES else "application/octet-stream"


# ------------------------------------------------------------------ rate limits

REDIS_URL = os.environ.get("REDIS_URL", "")
RATE_LIMIT_ENABLED = os.environ.get("RATE_LIMIT_ENABLED", "true").lower() == "true"

_client: redis.Redis | None = None


def _redis() -> redis.Redis | None:
    global _client
    if not RATE_LIMIT_ENABLED or not REDIS_URL:
        return None
    if _client is None:
        _client = redis.Redis.from_url(REDIS_URL, socket_timeout=0.25, socket_connect_timeout=0.25)
    return _client


def client_ip(request: Request) -> str:
    """
    The API only listens on loopback and is reached through Caddy, so the last
    X-Forwarded-For hop is the proxy's view of the caller. Anything further left
    in the header is caller-supplied and must not be trusted.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def enforce_rate_limit(bucket: str, identity: str, limit: int, window_seconds: int) -> None:
    """
    Fixed-window counter. Fails open: a Redis outage must not lock every user
    out of attendance, and the limiter is a brute-force brake, not an authz gate.
    """
    connection = _redis()
    if connection is None:
        return
    window = int(time.time()) // window_seconds
    key = f"rl:{bucket}:{identity}:{window}"
    try:
        count = connection.incr(key)
        if count == 1:
            connection.expire(key, window_seconds)
    except redis.RedisError:
        return
    if count > limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="RATE_LIMIT_EXCEEDED",
            headers={"Retry-After": str(window_seconds)},
        )


def clear_rate_limit(bucket: str, identity: str, window_seconds: int) -> None:
    """Drop the counter after a success so one good login resets the brake."""
    connection = _redis()
    if connection is None:
        return
    window = int(time.time()) // window_seconds
    try:
        connection.delete(f"rl:{bucket}:{identity}:{window}")
    except redis.RedisError:
        return
