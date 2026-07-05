from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from backend.services.simulator_adapters.camera_artifacts import (
    camera_artifact_path,
    validate_visible_rgb_image,
)
from backend.services.simulator_adapters.workspace_report_validation import (
    ExpectedCameraReport,
)


@dataclass(frozen=True)
class WorkspaceImageArtifactExpectations:
    image_paths: tuple[Path, ...] = ()
    image_dirs: tuple[tuple[Path, int], ...] = ()
    camera_ids: tuple[str, ...] | None = None
    camera_contracts: Mapping[str, ExpectedCameraReport] | None = None


def validate_workspace_image_artifacts(
    expectations: WorkspaceImageArtifactExpectations,
) -> str | None:
    image_paths = list(expectations.image_paths)
    for directory, expected_count in expectations.image_dirs:
        directory_images = sorted(directory.glob("*.png")) if directory.exists() else []
        if len(directory_images) != expected_count:
            return f"expected {expected_count} PNG artifact(s) in {directory}, found {len(directory_images)}"
        expected_camera_images = _expected_camera_images(
            expectations,
            directory,
            expected_count,
        )
        if isinstance(expected_camera_images, str):
            return expected_camera_images
        if expected_camera_images is not None:
            error = _validate_expected_camera_images(
                directory_images=tuple(directory_images),
                expected_camera_images=expected_camera_images,
                directory=directory,
            )
            if error:
                return error
            continue
        image_paths.extend(directory_images)
    if not image_paths:
        return None

    return _validate_image_paths(tuple(image_paths))


def _expected_camera_images(
    expectations: WorkspaceImageArtifactExpectations,
    directory: Path,
    expected_count: int,
) -> tuple[tuple[Path, tuple[int, int]], ...] | str | None:
    contracts = expectations.camera_contracts or {}
    camera_ids = expectations.camera_ids
    if camera_ids is None:
        if not contracts:
            return None
        camera_ids = tuple(contracts)
    if len(camera_ids) != expected_count:
        return (
            f"camera image artifact contract count mismatch in {directory}: "
            f"{len(camera_ids)} camera id(s), expected {expected_count}"
        )
    contract_membership_error = _camera_contract_membership_error(
        camera_ids=camera_ids,
        contracts=contracts,
        directory=directory,
    )
    if contract_membership_error is not None:
        return contract_membership_error
    if expected_count == 0:
        return ()
    if not contracts:
        return None
    ordered_contracts = tuple(contracts[camera_id] for camera_id in camera_ids)
    return tuple(
        (
            camera_artifact_path(
                directory,
                index=index,
                camera_name=contract.sim_name,
            ),
            (contract.width, contract.height),
        )
        for index, contract in enumerate(ordered_contracts, start=1)
    )


def _validate_expected_camera_images(
    *,
    directory_images: tuple[Path, ...],
    expected_camera_images: tuple[tuple[Path, tuple[int, int]], ...],
    directory: Path,
) -> str | None:
    actual_names = tuple(path.name for path in directory_images)
    expected_names = tuple(path.name for path, _size in expected_camera_images)
    if actual_names != expected_names:
        return (
            f"camera image artifact names in {directory} are {actual_names!r}, "
            f"expected {expected_names!r}"
        )
    return _validate_sized_image_paths(expected_camera_images)


def _validate_sized_image_paths(
    image_paths: tuple[tuple[Path, tuple[int, int]], ...],
) -> str | None:
    for path, expected_size in image_paths:
        error = validate_visible_rgb_image(path, expected_size=expected_size)
        if error:
            return error
    return None


def _validate_image_paths(image_paths: tuple[Path, ...]) -> str | None:
    for path in image_paths:
        error = validate_visible_rgb_image(path)
        if error:
            return error
    return None


def _camera_contract_membership_error(
    *,
    camera_ids: tuple[str, ...],
    contracts: Mapping[str, ExpectedCameraReport],
    directory: Path,
) -> str | None:
    missing_contract_ids = tuple(
        camera_id for camera_id in camera_ids if camera_id not in contracts
    )
    if missing_contract_ids:
        return (
            f"camera image artifact contracts missing camera id(s) in {directory}: "
            f"{', '.join(missing_contract_ids)}"
        )
    extra_contract_ids = tuple(
        camera_id for camera_id in contracts if camera_id not in camera_ids
    )
    if extra_contract_ids:
        return (
            f"camera image artifact contracts contain unexpected camera id(s) in {directory}: "
            f"{', '.join(extra_contract_ids)}"
        )
    return None
