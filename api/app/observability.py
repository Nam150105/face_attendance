"""Structured logging, request correlation, dependency checks and metrics.

Everything an operator needs to answer "is it up, what broke, how slow" without
attaching a debugger to a running container.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import sys
import time
import uuid
from collections import Counter
from threading import Lock

import httpx
import psycopg
import redis

from app.security import REDIS_URL


SERVICE_NAME = os.environ.get("SERVICE_NAME", "api")
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
DATABASE_URL = os.environ.get("DATABASE_URL", "").replace("postgresql+psycopg://", "postgresql://", 1)
FACE_AI_URL = os.environ.get("FACE_AI_URL", "http://face-ai:8001")
DEPENDENCY_TIMEOUT_SECONDS = float(os.environ.get("DEPENDENCY_TIMEOUT_SECONDS", "2"))

# Set per request so every log line emitted while handling it carries the id.
request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


class JsonFormatter(logging.Formatter):
    """One JSON object per line: greppable by a human, parseable by a collector."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
            + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "service": SERVICE_NAME,
            "logger": record.name,
            "request_id": request_id_var.get(),
            "message": record.getMessage(),
        }
        for key, value in getattr(record, "context", {}).items():
            payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(LOG_LEVEL)

    # uvicorn installs its own handlers; replace them so nothing bypasses JSON.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers = [handler]
        logger.propagate = False
    # The access log duplicates our own request log, with less detail.
    logging.getLogger("uvicorn.access").disabled = True


def new_request_id(inbound: str | None) -> str:
    """Reuse an upstream id when it looks sane so one trace spans the proxy."""
    if inbound and 8 <= len(inbound) <= 200 and all(c.isalnum() or c in "-_" for c in inbound):
        return inbound
    return uuid.uuid4().hex


# ---------------------------------------------------------------------- metrics

class Metrics:
    """
    Small in-process counters. Not a replacement for a real TSDB — this is the
    hook a scraper reads, deliberately dependency-free so it cannot break the API.
    """

    _BUCKETS_MS = (25, 50, 100, 250, 500, 1000, 2500, 5000)

    def __init__(self) -> None:
        self._lock = Lock()
        self.requests: Counter = Counter()
        self.latency_buckets: Counter = Counter()
        self.latency_sum_ms = 0.0
        self.latency_count = 0
        self.started_at = time.time()

    def observe(self, method: str, path: str, status_code: int, duration_ms: float) -> None:
        with self._lock:
            self.requests[(method, path, status_code)] += 1
            self.latency_sum_ms += duration_ms
            self.latency_count += 1
            for bucket in self._BUCKETS_MS:
                if duration_ms <= bucket:
                    self.latency_buckets[bucket] += 1

    def render(self) -> str:
        with self._lock:
            lines = [
                "# HELP face_attendance_uptime_seconds Seconds since the process started.",
                "# TYPE face_attendance_uptime_seconds gauge",
                f"face_attendance_uptime_seconds {time.time() - self.started_at:.0f}",
                "# HELP face_attendance_requests_total Handled HTTP requests.",
                "# TYPE face_attendance_requests_total counter",
            ]
            for (method, path, status_code), count in sorted(self.requests.items()):
                lines.append(
                    f'face_attendance_requests_total{{method="{method}",path="{path}",'
                    f'status="{status_code}"}} {count}'
                )
            lines += [
                "# HELP face_attendance_request_duration_ms Request latency.",
                "# TYPE face_attendance_request_duration_ms histogram",
            ]
            cumulative = 0
            for bucket in self._BUCKETS_MS:
                cumulative = self.latency_buckets.get(bucket, 0)
                lines.append(f'face_attendance_request_duration_ms_bucket{{le="{bucket}"}} {cumulative}')
            lines.append(
                f'face_attendance_request_duration_ms_bucket{{le="+Inf"}} {self.latency_count}'
            )
            lines.append(f"face_attendance_request_duration_ms_sum {self.latency_sum_ms:.1f}")
            lines.append(f"face_attendance_request_duration_ms_count {self.latency_count}")
            return "\n".join(lines) + "\n"


metrics = Metrics()


# ----------------------------------------------------------------- readiness

def _check_postgres() -> tuple[bool, str]:
    try:
        with psycopg.connect(DATABASE_URL, connect_timeout=int(DEPENDENCY_TIMEOUT_SECONDS) or 1) as connection:
            connection.execute("SELECT 1").fetchone()
        return True, "ok"
    except Exception as error:  # noqa: BLE001 - readiness must report, never raise
        return False, type(error).__name__


def _check_redis() -> tuple[bool, str]:
    if not REDIS_URL:
        return True, "not configured"
    try:
        client = redis.Redis.from_url(
            REDIS_URL,
            socket_timeout=DEPENDENCY_TIMEOUT_SECONDS,
            socket_connect_timeout=DEPENDENCY_TIMEOUT_SECONDS,
        )
        client.ping()
        return True, "ok"
    except Exception as error:  # noqa: BLE001
        return False, type(error).__name__


def _check_object_storage() -> tuple[bool, str]:
    try:
        from app.services.storage import PrivateObjectStorage

        storage = PrivateObjectStorage()
        storage.client.head_bucket(Bucket=storage.bucket)
        return True, "ok"
    except Exception as error:  # noqa: BLE001
        return False, type(error).__name__


def _check_face_ai() -> tuple[bool, str]:
    try:
        with httpx.Client(timeout=DEPENDENCY_TIMEOUT_SECONDS) as client:
            response = client.get(f"{FACE_AI_URL}/health")
            return response.status_code == 200, f"HTTP {response.status_code}"
    except Exception as error:  # noqa: BLE001
        return False, type(error).__name__


# face-ai is reported but not required: attendance fails cleanly with
# FACE_MODEL_NOT_CONFIGURED, while a dead database means nothing works at all.
DEPENDENCIES = (
    ("postgres", _check_postgres, True),
    ("redis", _check_redis, False),
    ("object_storage", _check_object_storage, True),
    ("face_ai", _check_face_ai, False),
)


def readiness() -> tuple[bool, dict]:
    checks: dict[str, dict] = {}
    ready = True
    for name, probe, required in DEPENDENCIES:
        started = time.perf_counter()
        healthy, detail = probe()
        checks[name] = {
            "status": "up" if healthy else "down",
            "required": required,
            "detail": detail,
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
        }
        if required and not healthy:
            ready = False
    return ready, checks
