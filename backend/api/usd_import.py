"""Remote OpenUSD preview imports for the URDF Studio entry screen."""

from __future__ import annotations

import json
import re
import shutil
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from backend.core.simulator_security import require_simulator_operator_access_async
from backend.services.world_usd_interchange import WorldUsdInterchangeError, import_usd_to_world

router = APIRouter(prefix="/usd", tags=["usd-import"])
_HF_HOSTS = {"huggingface.co", "www.huggingface.co", "hf.co"}
_REVISION_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
_USD_SUFFIXES = {".usd", ".usda", ".usdc", ".usdz"}
_PACKAGE_SUFFIXES = _USD_SUFFIXES | {".json", ".png", ".jpg", ".jpeg", ".exr", ".mtl", ".obj", ".stl", ".ply"}
_MAX_FILE_BYTES = 256 * 1024 * 1024
_MAX_PACKAGE_FILES = 512


class UsdImportRequest(BaseModel):
    source_url: str = Field(min_length=1, max_length=2048)


@dataclass(frozen=True)
class HuggingFaceSource:
    dataset: str
    revision: str
    root_path: str
    usd_path: str
    source_url: str


@dataclass(frozen=True)
class UsdImportRecord:
    root: Path
    world_path: Path
    metadata: dict[str, Any]


_IMPORTS: dict[str, UsdImportRecord] = {}


def parse_huggingface_source(source_url: str) -> HuggingFaceSource:
    parsed = urllib.parse.urlparse(source_url.strip())
    if parsed.scheme != "https" or (parsed.hostname or "").lower() not in _HF_HOSTS:
        raise ValueError("OpenUSD sources must be HTTPS Hugging Face dataset links.")
    segments = [urllib.parse.unquote(part) for part in parsed.path.split("/") if part]
    if len(segments) < 6 or segments[0] != "datasets":
        raise ValueError("Expected a Hugging Face dataset /blob/<revision>/<path> or /tree/<revision>/<path> URL.")
    dataset = "/".join(segments[1:3])
    kind = segments[3]
    if kind not in {"blob", "tree", "resolve"}:
        raise ValueError("Hugging Face URL must use blob, tree, or resolve.")
    revision = segments[4]
    if not _REVISION_RE.fullmatch(revision):
        raise ValueError("Hugging Face revision is invalid.")
    path = "/".join(segment for segment in segments[5:] if segment)
    suffix = Path(path).suffix.lower()
    if not path or (kind != "tree" and suffix not in _USD_SUFFIXES):
        raise ValueError("The selected Hugging Face path must identify an OpenUSD file or folder.")
    root_path = path if kind == "tree" else str(Path(path).parent)
    if root_path == ".":
        root_path = ""
    return HuggingFaceSource(dataset, revision, root_path.strip("/"), path if kind != "tree" else "", source_url.strip())


def _api_tree_url(source: HuggingFaceSource) -> str:
    path = "/".join(urllib.parse.quote(part, safe="") for part in source.root_path.split("/") if part)
    suffix = f"/{path}" if path else ""
    return f"https://huggingface.co/api/datasets/{urllib.parse.quote(source.dataset, safe='/')}/tree/{urllib.parse.quote(source.revision, safe='')}{suffix}?recursive=true"


def _read_url(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "URDF-Studio/OpenUSD-import"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            if int(response.headers.get("Content-Length") or 0) > _MAX_FILE_BYTES:
                raise ValueError("Remote OpenUSD asset exceeds the 256 MiB import limit.")
            data = response.read(_MAX_FILE_BYTES + 1)
    except urllib.error.URLError as exc:
        raise ValueError(f"Could not fetch Hugging Face asset: {exc.reason}") from exc
    if len(data) > _MAX_FILE_BYTES:
        raise ValueError("Remote OpenUSD asset exceeds the 256 MiB import limit.")
    return data


def _download_package(source: HuggingFaceSource, destination: Path) -> tuple[Path, int]:
    payload = json.loads(_read_url(_api_tree_url(source)))
    if not isinstance(payload, list):
        raise ValueError("Hugging Face returned an invalid dataset tree.")
    files = [entry for entry in payload if isinstance(entry, dict) and entry.get("type") == "file"]
    files = [entry for entry in files if Path(str(entry.get("path", ""))).suffix.lower() in _PACKAGE_SUFFIXES]
    if len(files) > _MAX_PACKAGE_FILES:
        raise ValueError("The Hugging Face folder contains too many package files.")
    if not files:
        raise ValueError("No downloadable files were found in the Hugging Face asset folder.")
    selected = source.usd_path or next((str(entry["path"]) for entry in files if Path(str(entry.get("path", ""))).suffix.lower() in _USD_SUFFIXES), "")
    if not selected:
        raise ValueError("The Hugging Face folder does not contain an OpenUSD file.")
    prefix = f"{source.root_path.rstrip('/')}/" if source.root_path else ""
    for entry in files:
        relative = str(entry.get("path", ""))
        if prefix and not relative.startswith(prefix):
            continue
        relative_to_root = relative[len(prefix):] if prefix else relative
        if not relative_to_root or ".." in Path(relative_to_root).parts:
            continue
        target = destination / relative_to_root
        target.parent.mkdir(parents=True, exist_ok=True)
        raw_url = f"https://huggingface.co/datasets/{urllib.parse.quote(source.dataset, safe='/')}/resolve/{urllib.parse.quote(source.revision, safe='')}/{urllib.parse.quote(relative, safe='/')}?download=true"
        target.write_bytes(_read_url(raw_url))
    selected_relative = selected[len(prefix):] if prefix and selected.startswith(prefix) else selected
    usd_file = destination / selected_relative
    if not usd_file.is_file():
        raise ValueError(f"Selected OpenUSD file was not downloaded: {selected}")
    return usd_file, len(files)


def _record_import(source: HuggingFaceSource) -> tuple[str, UsdImportRecord]:
    root = Path(tempfile.mkdtemp(prefix="urdf-studio-usd-"))
    try:
        usd_file, file_count = _download_package(source, root / "source")
        package_dir = root / "world"
        package_dir.mkdir(parents=True, exist_ok=True)
        world = import_usd_to_world(usd_file, package_id=Path(usd_file).stem, asset_output_dir=package_dir)
        provenance = world.get("provenance")
        if isinstance(provenance, dict):
            provenance.update({"source_url": source.source_url, "dataset": source.dataset, "revision": source.revision, "package_root": source.root_path, "downloaded_file_count": file_count, "preview_mode": "world-json-with-extracted-meshes"})
        world_path = package_dir / "world.json"
        world_path.write_text(json.dumps(world, indent=2), encoding="utf-8")
        import_id = uuid.uuid4().hex
        record = UsdImportRecord(root, world_path, {"import_id": import_id, "source_url": source.source_url, "dataset": source.dataset, "revision": source.revision, "root_path": source.root_path, "usd_file": source.usd_path or usd_file.name, "format": "openusd", "preview": True, "world_object_count": len(world.get("world", {}).get("objects", []))})
        _IMPORTS[import_id] = record
        return import_id, record
    except Exception:
        shutil.rmtree(root, ignore_errors=True)
        raise


@router.post("/import-url")
async def import_usd_url(request: UsdImportRequest, _access: None = Depends(require_simulator_operator_access_async)) -> dict[str, Any]:
    try:
        import_id, record = _record_import(parse_huggingface_source(request.source_url))
    except (ValueError, WorldUsdInterchangeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"OpenUSD import failed: {exc}") from exc
    return {**record.metadata, "world_url": f"/usd/imports/{import_id}/world.json", "asset_base_url": f"/usd/imports/{import_id}/assets/"}


@router.get("/imports/{import_id}/world.json")
async def get_imported_world(import_id: str, _access: None = Depends(require_simulator_operator_access_async)) -> JSONResponse:
    record = _IMPORTS.get(import_id)
    if record is None:
        raise HTTPException(status_code=404, detail="OpenUSD import has expired or does not exist.")
    return JSONResponse(content=json.loads(record.world_path.read_text(encoding="utf-8")))


@router.get("/imports/{import_id}/assets/{asset_path:path}")
async def get_imported_asset(import_id: str, asset_path: str, _access: None = Depends(require_simulator_operator_access_async)) -> FileResponse:
    record = _IMPORTS.get(import_id)
    if record is None:
        raise HTTPException(status_code=404, detail="OpenUSD import has expired or does not exist.")
    requested = (record.world_path.parent / asset_path).resolve()
    assets_root = (record.world_path.parent / "assets").resolve()
    if assets_root not in requested.parents or not requested.is_file():
        raise HTTPException(status_code=404, detail="OpenUSD preview asset was not found.")
    return FileResponse(requested)
