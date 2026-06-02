from __future__ import annotations

import os
import re

BYTES_PER_KIB = 1024
BYTES_PER_MIB = 1024 * BYTES_PER_KIB


def _read_int_env(key: str, fallback: int) -> int:
    raw = os.getenv(key)
    if raw is None:
        return fallback
    try:
        return int(raw)
    except ValueError:
        return fallback


RUNTIME_SESSION_ID_MAX_CHARS = 64
RUNTIME_SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")
RUNTIME_PROVIDER_ID_MAX_CHARS = 64
RUNTIME_PROVIDER_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")
RUNTIME_PROVIDER_DISPLAY_NAME_MAX_CHARS = 120
RUNTIME_PROVIDER_ROBOT_ID_MAX_CHARS = 128
RUNTIME_PROVIDER_ROBOT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")
RUNTIME_PROVIDER_LABEL_MAX_CHARS = 120
RUNTIME_SESSIONS_MAX_ACTIVE = _read_int_env("URDF_RUNTIME_SESSIONS_MAX_ACTIVE", 64)
RUNTIME_SESSIONS_MAX_CHANNELS = _read_int_env("URDF_RUNTIME_SESSIONS_MAX_CHANNELS", 128)
RUNTIME_SESSIONS_MAX_VIDEO_REFS = _read_int_env("URDF_RUNTIME_SESSIONS_MAX_VIDEO_REFS", 32)
RUNTIME_SESSIONS_MAX_BUFFERED_FRAMES = _read_int_env("URDF_RUNTIME_SESSIONS_MAX_BUFFERED_FRAMES", 256)
RUNTIME_PROVIDER_AUDIT_MAX_EVENTS = _read_int_env("URDF_RUNTIME_PROVIDER_AUDIT_MAX_EVENTS", 64)
RUNTIME_PROVIDER_SESSION_TOKEN_BYTES = _read_int_env("URDF_RUNTIME_PROVIDER_SESSION_TOKEN_BYTES", 24)
RUNTIME_SESSION_MAX_FRAME_BYTES = _read_int_env("URDF_RUNTIME_SESSION_MAX_FRAME_BYTES", 256 * BYTES_PER_KIB)
RUNTIME_SESSION_MAX_BUFFERED_BYTES = _read_int_env(
    "URDF_RUNTIME_SESSION_MAX_BUFFERED_BYTES",
    8 * BYTES_PER_MIB,
)
RUNTIME_PROVIDER_ALLOWED_CAPABILITIES = frozenset(
    {
        "observe",
        "record",
        "replay",
        "video",
        "logs",
        "frames",
        "commands",
    }
)
RUNTIME_PROVIDER_ALLOWED_STREAM_FORMATS = frozenset({"json", "arrow_ipc"})
RUNTIME_VIDEO_REF_INSECURE_QUERY_KEYS = frozenset(
    {
        "token",
        "access_token",
        "auth",
        "authorization",
        "signature",
        "sig",
    }
)
RUNTIME_VIDEO_REF_INSECURE_TOKEN_SCHEME = "query"
RUNTIME_VIDEO_REF_SECURITY_WARNING_KEY = "security_warning"
RUNTIME_VIDEO_REF_STREAM_BASE_URL_KEY = "stream_base_url"
RUNTIME_VIDEO_REF_TOKEN_SCHEME_KEY = "token_scheme"
