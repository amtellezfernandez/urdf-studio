from __future__ import annotations

import os
from urllib.parse import urlparse

from backend.models.live_transport import LiveTrackDescriptor, LiveTransportDescriptor
from backend.models.robot_gateway import RobotGatewayCameraStream
from backend.robot_gateway.params import (
    ROBOT_GATEWAY_MOQ_DEFAULT_RELAY_URL,
    ROBOT_GATEWAY_MOQ_NAMESPACE_PREFIX,
    ROBOT_GATEWAY_MOQ_RELAY_URL_ENV,
    ROBOT_GATEWAY_MOQ_TRACK_CAMERA_DEPTH_SUFFIX,
    ROBOT_GATEWAY_MOQ_TRACK_CAMERA_METADATA_SUFFIX,
    ROBOT_GATEWAY_MOQ_TRACK_CAMERA_POINT_CLOUD_SUFFIX,
    ROBOT_GATEWAY_MOQ_TRACK_CAMERA_VIDEO_SUFFIX,
    ROBOT_GATEWAY_MOQ_TRACK_CAN_LEFT_ARM,
    ROBOT_GATEWAY_MOQ_TRACK_CAN_RIGHT_ARM,
    ROBOT_GATEWAY_MOQ_TRACK_ENCODING_DEPTH16,
    ROBOT_GATEWAY_MOQ_TRACK_ENCODING_H264,
    ROBOT_GATEWAY_MOQ_TRACK_ENCODING_JSON,
    ROBOT_GATEWAY_MOQ_TRACK_ENCODING_POINT_CLOUD_F32_RGB_F32,
    ROBOT_GATEWAY_MOQ_TRACK_ENCODING_SOCKETCAN_BATCH,
    ROBOT_GATEWAY_MOQ_TRACK_JOINT_TELEMETRY,
    ROBOT_GATEWAY_MOQ_TRACK_ROBOT_STATE,
    ROBOT_GATEWAY_OPENARM_CAN_LEFT_LOGICAL_BUS,
    ROBOT_GATEWAY_OPENARM_CAN_RIGHT_LOGICAL_BUS,
    ROBOT_GATEWAY_PUBLIC_ANONYMOUS_MOQ_PATH_PREFIX,
    ROBOT_GATEWAY_PUBLIC_ANONYMOUS_MOQ_RELAY_HOSTS,
)


def _parse_relay_host_and_path_segments(relay_url: str) -> tuple[str, list[str]]:
    parsed = urlparse(relay_url)
    host = (parsed.hostname or "").strip().lower()
    path = parsed.path
    if not parsed.scheme and not parsed.netloc:
        host_candidate, separator, path_candidate = relay_url.strip().partition("/")
        if separator:
            host = host_candidate.split(":", 1)[0].strip().lower()
            path = path_candidate
    return host, [segment for segment in path.split("/") if segment]


def _is_public_anonymous_moq_relay_url(relay_url: str) -> bool:
    host, path_segments = _parse_relay_host_and_path_segments(relay_url)
    return host in ROBOT_GATEWAY_PUBLIC_ANONYMOUS_MOQ_RELAY_HOSTS or (
        bool(path_segments)
        and path_segments[0].lower() == ROBOT_GATEWAY_PUBLIC_ANONYMOUS_MOQ_PATH_PREFIX
    )


def validate_robot_gateway_live_relay_url(relay_url: str) -> str:
    normalized = relay_url.strip()
    if _is_public_anonymous_moq_relay_url(normalized):
        raise ValueError(
            "Robot gateway live transport cannot use a public anonymous MoQ relay. "
            "Use a private authenticated relay or a loopback relay for robot telemetry."
        )
    return normalized


def _read_live_relay_url_from_env() -> str:
    relay_url = (
        os.getenv(
            ROBOT_GATEWAY_MOQ_RELAY_URL_ENV,
            ROBOT_GATEWAY_MOQ_DEFAULT_RELAY_URL,
        ).strip()
        or ROBOT_GATEWAY_MOQ_DEFAULT_RELAY_URL
    )
    return validate_robot_gateway_live_relay_url(relay_url)


def _build_camera_live_tracks(
    *,
    adapter_id: str,
    camera_stream: RobotGatewayCameraStream,
) -> list[LiveTrackDescriptor]:
    camera_track_prefix = f"camera/{camera_stream.id}"
    return [
        LiveTrackDescriptor(
            id=f"{camera_stream.id}-video",
            kind="video",
            track_name=f"{camera_track_prefix}/{ROBOT_GATEWAY_MOQ_TRACK_CAMERA_VIDEO_SUFFIX}",
            encoding=ROBOT_GATEWAY_MOQ_TRACK_ENCODING_H264,
            source_id=adapter_id,
            camera_id=camera_stream.id,
        ),
        LiveTrackDescriptor(
            id=f"{camera_stream.id}-depth",
            kind="depth",
            track_name=f"{camera_track_prefix}/{ROBOT_GATEWAY_MOQ_TRACK_CAMERA_DEPTH_SUFFIX}",
            encoding=ROBOT_GATEWAY_MOQ_TRACK_ENCODING_DEPTH16,
            source_id=adapter_id,
            camera_id=camera_stream.id,
        ),
        LiveTrackDescriptor(
            id=f"{camera_stream.id}-metadata",
            kind="metadata",
            track_name=f"{camera_track_prefix}/{ROBOT_GATEWAY_MOQ_TRACK_CAMERA_METADATA_SUFFIX}",
            encoding=ROBOT_GATEWAY_MOQ_TRACK_ENCODING_JSON,
            source_id=adapter_id,
            camera_id=camera_stream.id,
        ),
        LiveTrackDescriptor(
            id=f"{camera_stream.id}-point-cloud",
            kind="pointCloud",
            track_name=f"{camera_track_prefix}/{ROBOT_GATEWAY_MOQ_TRACK_CAMERA_POINT_CLOUD_SUFFIX}",
            encoding=ROBOT_GATEWAY_MOQ_TRACK_ENCODING_POINT_CLOUD_F32_RGB_F32,
            source_id=adapter_id,
            camera_id=camera_stream.id,
        ),
    ]


def _build_robot_telemetry_live_tracks(adapter_id: str) -> list[LiveTrackDescriptor]:
    return [
        LiveTrackDescriptor(
            id="robot-state",
            kind="robotState",
            track_name=ROBOT_GATEWAY_MOQ_TRACK_ROBOT_STATE,
            encoding=ROBOT_GATEWAY_MOQ_TRACK_ENCODING_JSON,
            source_id=adapter_id,
        ),
        LiveTrackDescriptor(
            id="joint-telemetry",
            kind="jointTelemetry",
            track_name=ROBOT_GATEWAY_MOQ_TRACK_JOINT_TELEMETRY,
            encoding=ROBOT_GATEWAY_MOQ_TRACK_ENCODING_JSON,
            source_id=adapter_id,
        ),
        LiveTrackDescriptor(
            id="can-left-arm",
            kind="canTelemetry",
            track_name=ROBOT_GATEWAY_MOQ_TRACK_CAN_LEFT_ARM,
            encoding=ROBOT_GATEWAY_MOQ_TRACK_ENCODING_SOCKETCAN_BATCH,
            source_id=adapter_id,
            bus_id=ROBOT_GATEWAY_OPENARM_CAN_LEFT_LOGICAL_BUS,
        ),
        LiveTrackDescriptor(
            id="can-right-arm",
            kind="canTelemetry",
            track_name=ROBOT_GATEWAY_MOQ_TRACK_CAN_RIGHT_ARM,
            encoding=ROBOT_GATEWAY_MOQ_TRACK_ENCODING_SOCKETCAN_BATCH,
            source_id=adapter_id,
            bus_id=ROBOT_GATEWAY_OPENARM_CAN_RIGHT_LOGICAL_BUS,
        ),
    ]


def build_robot_gateway_live_transport(
    *,
    adapter_id: str,
    robot_id: str,
    camera_streams: list[RobotGatewayCameraStream],
) -> LiveTransportDescriptor:
    tracks = _build_robot_telemetry_live_tracks(adapter_id)
    for camera_stream in camera_streams:
        tracks.extend(
            _build_camera_live_tracks(
                adapter_id=adapter_id,
                camera_stream=camera_stream,
            )
        )
    return LiveTransportDescriptor(
        relay_url=_read_live_relay_url_from_env(),
        namespace=f"{ROBOT_GATEWAY_MOQ_NAMESPACE_PREFIX}/{robot_id}",
        connect_module_path=None,
        tracks=tracks,
    )
