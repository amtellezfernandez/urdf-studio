from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Any, TypeAlias, TypedDict

import numpy as np

from backend.services.simulator_adapters.camera_artifacts import camera_artifact_path
from backend.services.simulator_adapters.camera_transfer import (
    CAMERA_MARKER_RGBA,
    CAMERA_MARKER_SIZE_XYZ,
    SimCameraSpec,
    Transform,
)
from backend.services.simulator_adapters.numeric import is_finite_number
from backend.services.simulator_adapters.params import GENESIS_SCENE_PARAMS

GenesisVector3: TypeAlias = tuple[float, float, float]
GenesisCameraViewerPose: TypeAlias = tuple[GenesisVector3, GenesisVector3, GenesisVector3, float]


class GenesisObservationCameraSensorKwargs(TypedDict):
    res: tuple[int, int]
    pos: GenesisVector3
    lookat: GenesisVector3
    up: GenesisVector3
    fov: float
    near: float
    far: float
    offset_T: np.ndarray
    entity_idx: int
    link_idx_local: int


def add_camera_marker_entity(gs: Any, scene: Any, camera: SimCameraSpec) -> None:
    scene.add_entity(
        gs.morphs.Box(
            size=CAMERA_MARKER_SIZE_XYZ,
            pos=camera.position_xyz,
            quat=camera.quat_wxyz,
            fixed=True,
            collision=False,
        ),
        surface=gs.surfaces.Default(color=CAMERA_MARKER_RGBA[:3], opacity=CAMERA_MARKER_RGBA[3]),
        name=f"{camera.sim_name}_marker",
    )


def camera_viewer_pose(camera: SimCameraSpec) -> GenesisCameraViewerPose:
    return camera.position_xyz, _camera_lookat(camera), camera.render_up_xyz, camera.fov_deg


def _camera_gui_resolution(camera: SimCameraSpec) -> tuple[int, int]:
    max_width = GENESIS_SCENE_PARAMS.camera_sensor.gui_max_width_px
    max_height = GENESIS_SCENE_PARAMS.camera_sensor.gui_max_height_px
    scale = min(1.0, max_width / camera.width, max_height / camera.height)
    return max(1, int(round(camera.width * scale))), max(1, int(round(camera.height * scale)))


def add_scene_camera(gs: Any, scene: Any, camera: SimCameraSpec, *, visible: bool) -> Any:
    position, lookat, up, fov = camera_viewer_pose(camera)
    resolution = _camera_gui_resolution(camera) if visible else (camera.width, camera.height)
    return scene.add_camera(
        res=resolution,
        pos=position,
        lookat=lookat,
        up=up,
        fov=fov,
        GUI=visible,
        debug=True,
    )


def transform_matrix(transform: Transform) -> np.ndarray:
    matrix = np.eye(4, dtype=float)
    matrix[:3, :3] = transform.rotation.as_matrix()
    matrix[:3, 3] = transform.position_xyz
    return matrix


def robot_links_by_name(robot_entity: Any) -> dict[str, object]:
    return {
        getattr(link, "name", ""): link
        for link in getattr(robot_entity, "links", [])
        if getattr(link, "name", "")
    }


def attach_scene_camera_to_robot_link(
    scene_camera: Any,
    robot_entity: Any,
    camera: SimCameraSpec,
) -> bool:
    parent_link = _robot_parent_link(robot_entity, camera)
    if parent_link is None or not hasattr(scene_camera, "attach"):
        return False
    scene_camera.attach(parent_link, transform_matrix(camera.render_local_pose))
    return True


def _integer_attr(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if is_finite_number(value):
        int_value = int(value)
        if float(value) == float(int_value):
            return int_value
    return None


def observation_camera_sensor_kwargs(
    robot_entity: Any,
    camera: SimCameraSpec,
) -> GenesisObservationCameraSensorKwargs | None:
    parent_link = _robot_parent_link(robot_entity, camera)
    entity_idx = _integer_attr(getattr(robot_entity, "idx", None))
    link_idx_local = _integer_attr(getattr(parent_link, "idx_local", None))
    if parent_link is None or entity_idx is None or link_idx_local is None:
        return None
    return {
        "res": (camera.width, camera.height),
        "pos": camera.position_xyz,
        "lookat": _camera_lookat(camera),
        "up": camera.render_up_xyz,
        "fov": camera.fov_deg,
        "near": GENESIS_SCENE_PARAMS.camera_sensor.near_m,
        "far": GENESIS_SCENE_PARAMS.camera_sensor.far_m,
        "offset_T": transform_matrix(camera.render_local_pose),
        "entity_idx": entity_idx,
        "link_idx_local": link_idx_local,
    }


def _robot_parent_link(robot_entity: Any, camera: SimCameraSpec) -> object | None:
    return robot_links_by_name(robot_entity).get(camera.parent_link)


def _camera_lookat(camera: SimCameraSpec) -> GenesisVector3:
    return tuple(
        camera.position_xyz[axis] + camera.render_forward_xyz[axis]
        for axis in range(3)
    )


def add_observation_camera_sensor(gs: Any, scene: Any, robot_entity: Any, camera: SimCameraSpec) -> Any | None:
    kwargs = observation_camera_sensor_kwargs(robot_entity, camera)
    if kwargs is None:
        return None
    try:
        import genesis.engine.sensors.camera  # noqa: F401

        return scene.add_sensor(gs.options.sensors.RasterizerCameraOptions(**kwargs))
    except Exception as exc:
        print(
            "[genesis-workspace] warning: "
            f"failed to add observation camera sensor '{camera.sim_name}': {exc}",
            flush=True,
        )
        return None


def rgb_to_image_array(rgb: object) -> np.ndarray | None:
    if hasattr(rgb, "detach"):
        rgb = rgb.detach()
    if hasattr(rgb, "cpu"):
        rgb = rgb.cpu()
    if hasattr(rgb, "numpy"):
        rgb = rgb.numpy()
    try:
        image = np.asarray(rgb)
    except Exception:
        return None
    if image.ndim == 4 and image.shape[0] >= 1:
        image = image[0]
    if image.ndim != 3 or image.shape[-1] < 3:
        return None
    image = image[..., :3]
    if image.dtype == np.uint8:
        return image
    if np.issubdtype(image.dtype, np.floating) and image.size and float(np.nanmax(image)) <= 1.0:
        image = image * 255.0
    return np.clip(image, 0, 255).astype(np.uint8)


def read_observation_camera_sensor_images(
    sensor_entries: Sequence[tuple[SimCameraSpec, Any]],
) -> tuple[int, tuple[tuple[SimCameraSpec, np.ndarray], ...]]:
    successful_reads = 0
    images: list[tuple[SimCameraSpec, np.ndarray]] = []
    for camera_spec, sensor in sensor_entries:
        try:
            reading = sensor.read()
        except Exception as exc:
            print(
                "[genesis-workspace] warning: "
                f"failed to read observation camera sensor '{camera_spec.sim_name}': {exc}",
                flush=True,
            )
            continue
        rgb = getattr(reading, "rgb", None)
        if rgb is None:
            continue
        successful_reads += 1
        image = rgb_to_image_array(rgb)
        if image is None:
            print(
                "[genesis-workspace] warning: "
                f"observation camera sensor '{camera_spec.sim_name}' returned unsupported RGB shape.",
                flush=True,
            )
            continue
        images.append((camera_spec, image))
    return successful_reads, tuple(images)


def write_camera_screenshots(
    scene_cameras: Sequence[Any],
    cameras: Sequence[SimCameraSpec],
    output_dir: Path,
) -> int:
    output_dir.mkdir(parents=True, exist_ok=True)
    written_count = 0
    for index, (scene_camera, camera_spec) in enumerate(zip(scene_cameras, cameras), start=1):
        image = scene_camera.render(rgb=True, force_render=True)[0]
        _write_camera_image(
            image,
            output_dir=output_dir,
            index=index,
            camera_name=camera_spec.sim_name,
        )
        written_count += 1
    return written_count


def write_sensor_screenshots(
    sensor_images: Sequence[tuple[SimCameraSpec, np.ndarray]],
    output_dir: Path,
) -> int:
    output_dir.mkdir(parents=True, exist_ok=True)
    written_count = 0
    for index, (camera_spec, image) in enumerate(sensor_images, start=1):
        _write_camera_image(
            image,
            output_dir=output_dir,
            index=index,
            camera_name=camera_spec.sim_name,
            default_name="sensor",
        )
        written_count += 1
    return written_count


def _write_camera_image(
    image: np.ndarray,
    *,
    output_dir: Path,
    index: int,
    camera_name: str,
    default_name: str = "camera",
) -> None:
    from PIL import Image

    Image.fromarray(image).save(
        camera_artifact_path(
            output_dir,
            index=index,
            camera_name=camera_name,
            default_name=default_name,
        )
    )
