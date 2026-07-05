from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path
from threading import Lock
from typing import Protocol

from backend.models.collaboration import CollaborationJournalDetails

from backend.services.collaboration_params import (
    COLLABORATION_JOURNAL_PATH_ENV,
    COLLABORATION_JOURNAL_SCHEMA_VERSION,
    COLLABORATION_JOURNAL_TOKEN_DIGEST_PREFIX,
    COLLABORATION_JOURNAL_WRITE_FILE_MODE,
)

_LOGGER = logging.getLogger(__name__)


class CollaborationJournal(Protocol):
    def append(
        self,
        *,
        event_type: str,
        session_id: str,
        occurred_at: str,
        details: CollaborationJournalDetails,
    ) -> None:
        ...


class NoopCollaborationJournal:
    def append(
        self,
        *,
        event_type: str,
        session_id: str,
        occurred_at: str,
        details: CollaborationJournalDetails,
    ) -> None:
        return


class CollaborationFileJournal:
    def __init__(self, path: str | Path) -> None:
        self._path = Path(path).expanduser()
        self._lock = Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def append(
        self,
        *,
        event_type: str,
        session_id: str,
        occurred_at: str,
        details: CollaborationJournalDetails,
    ) -> None:
        record = {
            "schema_version": COLLABORATION_JOURNAL_SCHEMA_VERSION,
            "event_type": event_type,
            "session_id": session_id,
            "occurred_at": occurred_at,
            "details": details,
        }
        try:
            encoded = json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n"
        except (TypeError, ValueError):
            _LOGGER.exception("collaboration journal record is not JSON serializable")
            return

        try:
            with self._lock:
                descriptor = os.open(
                    self._path,
                    os.O_APPEND | os.O_CREAT | os.O_WRONLY,
                    COLLABORATION_JOURNAL_WRITE_FILE_MODE,
                )
                with os.fdopen(descriptor, "a", encoding="utf-8") as output_file:
                    output_file.write(encoded)
        except OSError:
            _LOGGER.exception("failed to append collaboration journal record")


def collaboration_token_digest(token: str) -> str:
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return f"{COLLABORATION_JOURNAL_TOKEN_DIGEST_PREFIX}{digest}"


def build_collaboration_journal_from_env() -> CollaborationJournal:
    raw_path = os.getenv(COLLABORATION_JOURNAL_PATH_ENV)
    journal_path = raw_path.strip() if isinstance(raw_path, str) else ""
    if not journal_path:
        return NoopCollaborationJournal()
    return CollaborationFileJournal(journal_path)
