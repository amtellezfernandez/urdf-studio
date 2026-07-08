"""Content-addressed scenario packs: publish a scenario as one digest, pull it back.

A scenario is a folder (scenario.yaml + world package + waypoints + robot URDF
+ assets). To make task suites distributable instead of repo-bound, a pack is
that folder frozen into a **deterministic** zip archive with a sha256 digest,
addressable by ``package_id@version``. The archive is byte-reproducible for
identical content (sorted entries, fixed timestamps/permissions), so the same
scenario always yields the same digest and a pulled pack can be verified
against it.

Publish validates the scenario with the runtime loader first, so a pack is
always runnable; pull verifies the digest and extracts into the writable user
scenario library, where it shows up in the Scenarios panel and runs across
simulators with no extra steps.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import threading
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from backend.models.scenario_service import ScenarioPackSummary
from backend.services.scenario_library import (
    is_valid_scenario_id,
    scenario_directory,
    user_scenario_library_root,
)
from backend.services.scenario_loader import (
    ScenarioLoadError,
    load_scenario,
    load_scenario_world,
    resolve_instruction,
    validate_scenario_against_world,
)

SCENARIO_PACKS_ENV_VAR = "URDF_SCENARIO_PACKS_ROOT"
_PACK_INDEX_FILENAME = "index.json"
_MAX_PACK_BYTES = 128 * 1024 * 1024
_FIXED_ZIP_TIME = (1980, 1, 1, 0, 0, 0)
_VERSION_MAX_LENGTH = 64


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def scenario_packs_root() -> Path:
    override = os.environ.get(SCENARIO_PACKS_ENV_VAR, "").strip()
    return Path(override) if override else Path.home() / ".urdf-studio" / "scenario-packs"


class ScenarioPackError(ValueError):
    ...


def _is_valid_version(version: str) -> bool:
    if not version or len(version) > _VERSION_MAX_LENGTH:
        return False
    return all(ch.isalnum() or ch in "._-" for ch in version) and version[0].isalnum()


def build_deterministic_archive(scenario_dir: Path) -> bytes:
    """Zip a scenario directory reproducibly (stable bytes -> stable digest)."""
    files = sorted(
        (path for path in scenario_dir.rglob("*") if path.is_file()),
        key=lambda path: path.relative_to(scenario_dir).as_posix(),
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            relative = path.relative_to(scenario_dir).as_posix()
            if relative.startswith("_") or "/_" in relative:
                continue  # skip scratch dirs like a stray _run/ from local runs
            info = zipfile.ZipInfo(filename=relative, date_time=_FIXED_ZIP_TIME)
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes())
    return buffer.getvalue()


class ScenarioPackService:
    def __init__(self, *, packs_root: Path | None = None) -> None:
        self._root = packs_root or scenario_packs_root()
        self._lock = threading.Lock()

    def _index_path(self) -> Path:
        return self._root / _PACK_INDEX_FILENAME

    def _load_index(self) -> dict:
        path = self._index_path()
        if not path.is_file():
            return {"packs": {}}
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {"packs": {}}

    def _save_index(self, index: dict) -> None:
        self._root.mkdir(parents=True, exist_ok=True)
        self._index_path().write_text(json.dumps(index, indent=2), encoding="utf-8")

    def publish(self, scenario_id: str, version: str) -> ScenarioPackSummary:
        if not is_valid_scenario_id(scenario_id):
            raise ScenarioPackError(f"Invalid scenario id: {scenario_id!r}")
        if not _is_valid_version(version):
            raise ScenarioPackError(f"Invalid version: {version!r}")
        try:
            scenario_dir = scenario_directory(scenario_id)
            scenario = load_scenario(scenario_dir)
            world = load_scenario_world(scenario_dir, scenario)
            cross_errors = validate_scenario_against_world(scenario, world)
        except ScenarioLoadError as exc:
            raise ScenarioPackError(str(exc)) from exc
        if cross_errors:
            raise ScenarioPackError("; ".join(cross_errors))

        archive = build_deterministic_archive(scenario_dir)
        if len(archive) > _MAX_PACK_BYTES:
            raise ScenarioPackError(
                f"Scenario pack exceeds the size limit ({len(archive)} > {_MAX_PACK_BYTES} bytes)."
            )
        digest = hashlib.sha256(archive).hexdigest()

        with self._lock:
            index = self._load_index()
            packs = index.setdefault("packs", {})
            versions = packs.setdefault(scenario.scenario_id, {})
            if version in versions:
                raise ScenarioPackError(
                    f"Pack {scenario.scenario_id}@{version} already exists."
                )
            archive_dir = self._root / scenario.scenario_id
            archive_dir.mkdir(parents=True, exist_ok=True)
            (archive_dir / f"{version}.zip").write_bytes(archive)
            summary = {
                "package_id": scenario.scenario_id,
                "version": version,
                "digest_sha256": digest,
                "title": scenario.title,
                "instruction": resolve_instruction(scenario),
                "task_family": scenario.task.family,
                "size_bytes": len(archive),
                "published_at": _utc_now(),
            }
            versions[version] = summary
            self._save_index(index)
        return ScenarioPackSummary(**summary)

    def list_packs(self) -> list[ScenarioPackSummary]:
        with self._lock:
            index = self._load_index()
        summaries: list[ScenarioPackSummary] = []
        for versions in index.get("packs", {}).values():
            for summary in versions.values():
                summaries.append(ScenarioPackSummary(**summary))
        summaries.sort(key=lambda pack: pack.published_at, reverse=True)
        return summaries

    def pull(self, package_id: str, version: str) -> ScenarioPackSummary:
        with self._lock:
            index = self._load_index()
            summary = index.get("packs", {}).get(package_id, {}).get(version)
            if summary is None:
                raise ScenarioPackError(f"Pack was not found: {package_id}@{version}")
            archive_path = self._root / package_id / f"{version}.zip"
            if not archive_path.is_file():
                raise ScenarioPackError(f"Pack archive is missing: {package_id}@{version}")
            archive = archive_path.read_bytes()

        digest = hashlib.sha256(archive).hexdigest()
        if digest != summary["digest_sha256"]:
            raise ScenarioPackError(
                f"Pack digest mismatch for {package_id}@{version} "
                "(archive does not match its recorded digest)."
            )

        dest = user_scenario_library_root() / package_id
        if dest.exists():
            raise ScenarioPackError(
                f"A scenario named {package_id!r} already exists in the user library; "
                "remove it before pulling."
            )
        dest.mkdir(parents=True, exist_ok=True)
        try:
            self._extract_archive(archive, dest)
            scenario = load_scenario(dest)  # verify the pulled pack is runnable
        except (ScenarioLoadError, ScenarioPackError) as exc:
            shutil.rmtree(dest, ignore_errors=True)
            raise ScenarioPackError(f"Pulled pack failed validation: {exc}") from exc
        del scenario
        return ScenarioPackSummary(**summary)

    @staticmethod
    def _extract_archive(archive: bytes, dest: Path) -> None:
        dest_root = dest.resolve()
        with zipfile.ZipFile(io.BytesIO(archive)) as zf:
            for name in zf.namelist():
                target = (dest / name).resolve()
                if not target.is_relative_to(dest_root):
                    raise ScenarioPackError(f"Pack contains an unsafe path: {name}")
            zf.extractall(dest)


scenario_pack_service = ScenarioPackService()
