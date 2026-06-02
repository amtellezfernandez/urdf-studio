from __future__ import annotations

from dataclasses import dataclass
import re

from backend.models.robot_gateway import RobotGatewayProfile


@dataclass(frozen=True)
class RobotGatewayDerivedTargetDescriptor:
    side: str
    token: str
    label: str


DERIVED_ARM_TARGETS: tuple[RobotGatewayDerivedTargetDescriptor, ...] = (
    RobotGatewayDerivedTargetDescriptor(side="left", token="left", label="left"),
    RobotGatewayDerivedTargetDescriptor(side="right", token="right", label="right"),
)
TARGET_ID_SEPARATOR = "_"
TARGET_HARDWARE_KEY_SEPARATOR = ":"
CONTROL_TARGET_GATEWAY_SUFFIX = " robot gateway"
PROFILE_LABEL_JOINT_JOG_SUFFIX = " joint jog"
NON_ALNUM_PATTERN = re.compile(r"[^a-z0-9]+")
CAMEL_CASE_BOUNDARY_PATTERN = re.compile(r"([a-z0-9])([A-Z])")


def build_robot_gateway_manifest_profiles(
    profile: RobotGatewayProfile,
) -> list[RobotGatewayProfile]:
    return [
        _with_control_target_side(profile),
        *_build_derived_arm_target_profiles(profile),
    ]


def _with_control_target_side(profile: RobotGatewayProfile) -> RobotGatewayProfile:
    side = _resolve_profile_control_target_side(profile.controlled_joint_names)
    if not side:
        return profile
    return profile.model_copy(update={"control_target_side": side})


def _build_derived_arm_target_profiles(
    profile: RobotGatewayProfile,
) -> list[RobotGatewayProfile]:
    if profile.control_target_side in {"left", "right"}:
        return []
    side_joint_names = {
        descriptor.side: _filter_joint_names_for_target(
            profile.controlled_joint_names,
            descriptor,
        )
        for descriptor in DERIVED_ARM_TARGETS
    }
    if not _should_split_arm_target(side_joint_names):
        return []
    base_target_label = _resolve_base_target_label(profile)
    return [
        _build_derived_arm_target_profile(
            profile=profile,
            descriptor=descriptor,
            base_target_label=base_target_label,
            controlled_joint_names=side_joint_names[descriptor.side],
        )
        for descriptor in DERIVED_ARM_TARGETS
    ]


def _should_split_arm_target(side_joint_names: dict[str, list[str]]) -> bool:
    return all(
        side_joint_names.get(descriptor.side)
        for descriptor in DERIVED_ARM_TARGETS
    )


def _build_derived_arm_target_profile(
    *,
    profile: RobotGatewayProfile,
    descriptor: RobotGatewayDerivedTargetDescriptor,
    base_target_label: str,
    controlled_joint_names: list[str],
) -> RobotGatewayProfile:
    target_label = f"{base_target_label} {descriptor.label} arm"
    return profile.model_copy(
        deep=True,
        update={
            "id": _join_target_id(profile.id, descriptor.side),
            "label": f"{target_label} joint jog",
            "control_target_label": target_label,
            "control_target_side": descriptor.side,
            "hardware_device_key": _join_hardware_key(
                profile.robot_id,
                f"{descriptor.side}_arm",
            ),
            "hardware_device_keys": _build_derived_hardware_device_keys(profile),
            "controlled_joint_names": controlled_joint_names,
        },
    )


def _filter_joint_names_for_target(
    joint_names: list[str],
    descriptor: RobotGatewayDerivedTargetDescriptor,
) -> list[str]:
    return [
        joint_name
        for joint_name in joint_names
        if descriptor.token in _normalize_joint_name_tokens(joint_name)
    ]


def _resolve_profile_control_target_side(joint_names: list[str]) -> str | None:
    matched_sides = [
        descriptor.side
        for descriptor in DERIVED_ARM_TARGETS
        if _filter_joint_names_for_target(joint_names, descriptor)
    ]
    if len(matched_sides) == 1:
        return matched_sides[0]
    if len(matched_sides) > 1:
        return "both"
    return None


def _resolve_base_target_label(profile: RobotGatewayProfile) -> str:
    label = (
        profile.control_target_label or profile.label or profile.robot_id
    ).strip()
    lowercase_label = label.lower()
    if lowercase_label.endswith(CONTROL_TARGET_GATEWAY_SUFFIX):
        return (
            label[: -len(CONTROL_TARGET_GATEWAY_SUFFIX)].strip()
            or profile.robot_id
        )
    if lowercase_label.endswith(PROFILE_LABEL_JOINT_JOG_SUFFIX):
        return (
            label[: -len(PROFILE_LABEL_JOINT_JOG_SUFFIX)].strip()
            or profile.robot_id
        )
    return label or profile.robot_id


def _join_target_id(profile_id: str, side: str) -> str:
    return TARGET_ID_SEPARATOR.join(
        part
        for part in (
            _sanitize_identifier(profile_id),
            _sanitize_identifier(side),
        )
        if part
    )


def _join_hardware_key(robot_id: str, target_id: str) -> str:
    return TARGET_HARDWARE_KEY_SEPARATOR.join(
        part
        for part in (
            _sanitize_identifier(robot_id),
            _sanitize_identifier(target_id),
        )
        if part
    )


def _sanitize_identifier(value: str) -> str:
    return NON_ALNUM_PATTERN.sub("_", value.strip().lower()).strip("_")


def _normalize_joint_name_tokens(joint_name: str) -> set[str]:
    token_source = CAMEL_CASE_BOUNDARY_PATTERN.sub(
        r"\1 \2",
        joint_name.strip(),
    ).lower()
    return {
        token
        for token in NON_ALNUM_PATTERN.split(token_source)
        if token
    }


def _build_derived_hardware_device_keys(profile: RobotGatewayProfile) -> list[str]:
    return list(
        dict.fromkeys(
            key.strip()
            for key in (
                profile.hardware_device_key,
                *profile.hardware_device_keys,
            )
            if key.strip()
        )
    )
