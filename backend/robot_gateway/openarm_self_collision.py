from __future__ import annotations

from dataclasses import dataclass
import math
from pathlib import Path
from typing import Mapping

from backend.models.robot_gateway import RobotGatewayJointJogRequest
from backend.robot_gateway.params import (
    ROBOT_GATEWAY_JOINT_JOG_SELF_COLLISION_LIMIT_REASON,
    ROBOT_GATEWAY_OPENARM_SELF_COLLISION_CHECKED_JOINT_NAMES,
    ROBOT_GATEWAY_OPENARM_SELF_COLLISION_DETAIL_PREFIX,
    ROBOT_GATEWAY_OPENARM_SELF_COLLISION_FINGER_NAME_TOKEN,
    ROBOT_GATEWAY_OPENARM_SELF_COLLISION_IGNORED_JOINT_GRAPH_DISTANCE,
    ROBOT_GATEWAY_OPENARM_SELF_COLLISION_MISSING_STATE_REASON_PREFIX,
    ROBOT_GATEWAY_OPENARM_SELF_COLLISION_NONFINITE_STATE_REASON_PREFIX,
    ROBOT_GATEWAY_OPENARM_SELF_COLLISION_PACKAGE_REPO_RELATIVE_PATH,
    ROBOT_GATEWAY_OPENARM_SELF_COLLISION_PAIR_SEPARATOR,
    ROBOT_GATEWAY_OPENARM_SELF_COLLISION_STOP_AT_FIRST_COLLISION,
    ROBOT_GATEWAY_OPENARM_SELF_COLLISION_UNAVAILABLE_REASON_PREFIX,
    ROBOT_GATEWAY_OPENARM_SELF_COLLISION_URDF_REPO_RELATIVE_PATH,
)


@dataclass(frozen=True)
class OpenArmSelfCollisionPair:
    first_geometry_name: str
    second_geometry_name: str

    def format(self) -> str:
        return (
            f"{self.first_geometry_name}"
            f"{ROBOT_GATEWAY_OPENARM_SELF_COLLISION_PAIR_SEPARATOR}"
            f"{self.second_geometry_name}"
        )


class RejectingOpenArmSelfCollisionPreflight:
    ready = False

    def __init__(self, reason: str) -> None:
        self._reason = reason

    def __call__(
        self,
        _target_positions_rad: Mapping[str, float],
        _request: RobotGatewayJointJogRequest,
    ) -> str:
        return self._reason


class OpenArmSelfCollisionPreflight:
    ready = True

    def __init__(
        self,
        *,
        urdf_path: Path,
        package_dir: Path,
        checked_joint_names: tuple[str, ...] = (
            ROBOT_GATEWAY_OPENARM_SELF_COLLISION_CHECKED_JOINT_NAMES
        ),
    ) -> None:
        self._pinocchio = _load_pinocchio()
        if not urdf_path.is_file():
            raise FileNotFoundError(f"OpenArm URDF not found at {urdf_path}")
        if not package_dir.is_dir():
            raise FileNotFoundError(
                f"OpenArm package directory not found at {package_dir}"
            )

        model, collision_model, _visual_model = self._pinocchio.buildModelsFromUrdf(
            str(urdf_path),
            package_dirs=[str(package_dir)],
        )
        collision_model.addAllCollisionPairs()
        self._model = model
        self._collision_model = collision_model
        self._remove_ignored_collision_pairs()
        self._neutral_configuration = self._pinocchio.neutral(self._model)
        self._joint_q_indices = self._build_joint_q_indices(checked_joint_names)

    def __call__(
        self,
        target_positions_rad: Mapping[str, float],
        _request: RobotGatewayJointJogRequest,
    ) -> str | None:
        configuration, invalid_reason = self._build_target_configuration(
            target_positions_rad
        )
        if invalid_reason is not None:
            return invalid_reason
        try:
            collision_pair = self._first_collision_pair(configuration)
        except Exception as exc:  # pragma: no cover - native geometry boundary
            return _format_unavailable_reason(exc)
        if collision_pair is None:
            return None
        return (
            f"{ROBOT_GATEWAY_JOINT_JOG_SELF_COLLISION_LIMIT_REASON}"
            f"{ROBOT_GATEWAY_OPENARM_SELF_COLLISION_DETAIL_PREFIX}"
            f"{collision_pair.format()}"
        )

    def _build_target_configuration(
        self,
        target_positions_rad: Mapping[str, float],
    ) -> tuple[object | None, str | None]:
        configuration = self._neutral_configuration.copy()
        missing_joint_names: list[str] = []
        for joint_name, q_index in self._joint_q_indices.items():
            target_position_rad = target_positions_rad.get(joint_name)
            if target_position_rad is None:
                missing_joint_names.append(joint_name)
                continue
            target_position_float = float(target_position_rad)
            if not math.isfinite(target_position_float):
                return (
                    None,
                    (
                        f"{ROBOT_GATEWAY_OPENARM_SELF_COLLISION_NONFINITE_STATE_REASON_PREFIX} "
                        f"{joint_name}"
                    ),
                )
            configuration[q_index] = target_position_float

        if missing_joint_names:
            return (
                None,
                (
                    f"{ROBOT_GATEWAY_OPENARM_SELF_COLLISION_MISSING_STATE_REASON_PREFIX} "
                    f"{', '.join(missing_joint_names)}"
                ),
            )
        return configuration, None

    def _first_collision_pair(
        self,
        configuration: object,
    ) -> OpenArmSelfCollisionPair | None:
        model_data = self._pinocchio.Data(self._model)
        collision_data = self._pinocchio.GeometryData(self._collision_model)
        self._pinocchio.computeCollisions(
            self._model,
            model_data,
            self._collision_model,
            collision_data,
            configuration,
            ROBOT_GATEWAY_OPENARM_SELF_COLLISION_STOP_AT_FIRST_COLLISION,
        )
        for pair_index, collision_result in enumerate(collision_data.collisionResults):
            if not collision_result.isCollision():
                continue
            collision_pair = self._collision_model.collisionPairs[pair_index]
            return OpenArmSelfCollisionPair(
                first_geometry_name=self._collision_model.geometryObjects[
                    collision_pair.first
                ].name,
                second_geometry_name=self._collision_model.geometryObjects[
                    collision_pair.second
                ].name,
            )
        return None

    def _build_joint_q_indices(self, joint_names: tuple[str, ...]) -> dict[str, int]:
        q_indices: dict[str, int] = {}
        missing_joint_names: list[str] = []
        for joint_name in joint_names:
            joint_id = self._model.getJointId(joint_name)
            if joint_id >= len(self._model.joints):
                missing_joint_names.append(joint_name)
                continue
            q_index = self._model.joints[joint_id].idx_q
            if q_index < 0:
                missing_joint_names.append(joint_name)
                continue
            q_indices[joint_name] = q_index
        if missing_joint_names:
            raise ValueError(
                "OpenArm URDF missing self-collision joints: "
                + ", ".join(missing_joint_names)
            )
        return q_indices

    def _remove_ignored_collision_pairs(self) -> None:
        collision_pairs = list(self._collision_model.collisionPairs)
        self._collision_model.removeAllCollisionPairs()
        for collision_pair in collision_pairs:
            if self._is_ignored_collision_pair(collision_pair):
                continue
            self._collision_model.addCollisionPair(collision_pair)

    def _is_ignored_collision_pair(self, collision_pair: object) -> bool:
        first_geometry = self._collision_model.geometryObjects[collision_pair.first]
        second_geometry = self._collision_model.geometryObjects[collision_pair.second]
        first_joint_id = int(first_geometry.parentJoint)
        second_joint_id = int(second_geometry.parentJoint)
        if (
            self._joint_graph_distance(first_joint_id, second_joint_id)
            <= ROBOT_GATEWAY_OPENARM_SELF_COLLISION_IGNORED_JOINT_GRAPH_DISTANCE
        ):
            return True
        return self._is_same_parent_finger_pair(
            first_geometry.name,
            second_geometry.name,
            first_joint_id,
            second_joint_id,
        )

    def _is_same_parent_finger_pair(
        self,
        first_geometry_name: str,
        second_geometry_name: str,
        first_joint_id: int,
        second_joint_id: int,
    ) -> bool:
        return (
            ROBOT_GATEWAY_OPENARM_SELF_COLLISION_FINGER_NAME_TOKEN
            in first_geometry_name
            and ROBOT_GATEWAY_OPENARM_SELF_COLLISION_FINGER_NAME_TOKEN
            in second_geometry_name
            and self._model.parents[first_joint_id]
            == self._model.parents[second_joint_id]
        )

    def _joint_graph_distance(self, first_joint_id: int, second_joint_id: int) -> int:
        first_ancestors = _joint_ancestor_distances(self._model, first_joint_id)
        current_joint_id = second_joint_id
        second_distance = 0
        while True:
            first_distance = first_ancestors.get(current_joint_id)
            if first_distance is not None:
                return first_distance + second_distance
            if current_joint_id == 0:
                return first_ancestors[current_joint_id] + second_distance
            current_joint_id = int(self._model.parents[current_joint_id])
            second_distance += 1


def build_default_openarm_self_collision_preflight() -> (
    OpenArmSelfCollisionPreflight | RejectingOpenArmSelfCollisionPreflight
):
    return build_openarm_self_collision_preflight(
        repo_root=_default_repo_root(),
    )


def build_openarm_self_collision_preflight(
    *,
    repo_root: Path,
    urdf_path: Path | None = None,
    package_dir: Path | None = None,
) -> OpenArmSelfCollisionPreflight | RejectingOpenArmSelfCollisionPreflight:
    resolved_urdf_path = urdf_path or repo_root.joinpath(
        *ROBOT_GATEWAY_OPENARM_SELF_COLLISION_URDF_REPO_RELATIVE_PATH
    )
    resolved_package_dir = package_dir or repo_root.joinpath(
        *ROBOT_GATEWAY_OPENARM_SELF_COLLISION_PACKAGE_REPO_RELATIVE_PATH
    )
    try:
        return OpenArmSelfCollisionPreflight(
            urdf_path=resolved_urdf_path,
            package_dir=resolved_package_dir,
        )
    except Exception as exc:
        return RejectingOpenArmSelfCollisionPreflight(
            _format_unavailable_reason(exc)
        )


def _default_repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _joint_ancestor_distances(model: object, joint_id: int) -> dict[int, int]:
    distances: dict[int, int] = {}
    current_joint_id = joint_id
    distance = 0
    while True:
        distances[current_joint_id] = distance
        if current_joint_id == 0:
            return distances
        current_joint_id = int(model.parents[current_joint_id])
        distance += 1


def _load_pinocchio() -> object:
    try:
        import pinocchio
    except Exception as exc:
        raise RuntimeError("Pinocchio Python bindings are not installed") from exc
    return pinocchio


def _format_unavailable_reason(error: BaseException) -> str:
    return f"{ROBOT_GATEWAY_OPENARM_SELF_COLLISION_UNAVAILABLE_REASON_PREFIX} {error}"
