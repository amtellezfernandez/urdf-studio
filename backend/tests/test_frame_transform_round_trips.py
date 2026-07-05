"""Round-trip and semantic tests for coordinate-frame transforms.

These tests exist to surface bugs in the Y-up→Z-up world-layout transform and in
the camera-convention chain.  Two failure categories:

  - Semantic failures  – the matrix maps a physically-meaningful axis to the
    wrong direction (e.g. "up" going sideways in the simulator).
  - Round-trip failures – forward(inverse(x)) ≠ x for non-trivial inputs,
    meaning position/rotation information is silently destroyed.
"""
from __future__ import annotations

import math

import numpy as np
import pytest
from scipy.spatial.transform import Rotation

from backend.services.simulator_adapters.camera_conventions import (
    OPENGL_CAMERA_FORWARD_LOCAL_XYZ,
    OPENGL_CAMERA_UP_LOCAL_XYZ,
    ROS_CAMERA_FORWARD_LOCAL_XYZ,
    ROS_CAMERA_UP_LOCAL_XYZ,
    WORLD_CAMERA_FORWARD_LOCAL_XYZ,
    WORLD_CAMERA_UP_LOCAL_XYZ,
    camera_frame_conversion_rotation,
)
from backend.services.simulator_adapters.camera_transfer import (
    RENDER_CAMERA_FORWARD_LOCAL_XYZ,
    RENDER_CAMERA_UP_LOCAL_XYZ,
    STUDIO_CAMERA_FORWARD_LOCAL_XYZ,
    STUDIO_CAMERA_UP_LOCAL_XYZ,
    camera_render_transform_from_studio_transform,
    studio_camera_to_render_view_rotation,
)
from backend.services.simulator_adapters.camera_transfer import Transform as CameraTransform
from backend.services.world_layout_static_transfer import (
    STUDIO_Y_UP_TO_Z_UP,
    inverse_transform_position,
    inverse_transform_quat_wxyz,
    inverse_transform_size,
    _transform_position,
    _transform_quat_wxyz,
    _transform_size,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _approx3(expected):
    """Return a pytest.approx for a 3-tuple."""
    return pytest.approx(expected, abs=1e-9)


def _approx4(expected):
    """Return a pytest.approx for a 4-tuple."""
    return pytest.approx(expected, abs=1e-9)


def _quat_from_rpy(roll, pitch, yaw):
    """Return (w, x, y, z) quaternion for given roll-pitch-yaw (radians)."""
    r = Rotation.from_euler("xyz", [roll, pitch, yaw])
    xyzw = r.as_quat()
    return (float(xyzw[3]), float(xyzw[0]), float(xyzw[1]), float(xyzw[2]))


# ---------------------------------------------------------------------------
# 1. STUDIO_Y_UP_TO_Z_UP – semantic axis mapping
#
# Studio uses Three.js Y-up convention:
#   +X = right in viewport (also robot forward)
#   +Y = up (away from floor)
#   +Z = toward viewer (robot's right side faces viewer)
#
# Simulator uses ROS REP-103 Z-up:
#   +X = robot forward
#   +Y = robot left
#   +Z = up
# ---------------------------------------------------------------------------

class TestStudioYUpToZUpSemantics:
    """Verify that each studio axis maps to the expected simulator axis."""

    def test_up_axis_y_maps_to_z(self):
        # An object at 1 m above the studio floor (+Y) must be 1 m above the
        # simulator floor (+Z).  This is the most critical physical invariant.
        studio_up = (0.0, 1.0, 0.0)
        sim_pos = _transform_position(studio_up, "studio-y-up-to-z-up")
        assert sim_pos[2] == pytest.approx(1.0, abs=1e-9), (
            "Studio +Y (up) must map to simulator +Z (up). "
            f"Got {sim_pos}; expected z=1.0"
        )
        assert sim_pos[0] == pytest.approx(0.0, abs=1e-9)
        assert sim_pos[1] == pytest.approx(0.0, abs=1e-9)

    def test_forward_axis_x_is_unchanged(self):
        # Robot forward (+X) is shared between studio and simulator.
        studio_fwd = (1.0, 0.0, 0.0)
        sim_pos = _transform_position(studio_fwd, "studio-y-up-to-z-up")
        assert sim_pos == _approx3((1.0, 0.0, 0.0)), (
            "Studio +X (robot forward) must remain +X in simulator. "
            f"Got {sim_pos}"
        )

    def test_viewer_axis_z_maps_to_negative_y(self):
        # In Three.js Y-up the viewer stands on the +Z side and looks in -Z.
        # +Z therefore points toward the viewer, which is the robot's right
        # side (+Z → -Y in ROS, because +Y is the robot's LEFT).
        studio_viewer = (0.0, 0.0, 1.0)
        sim_pos = _transform_position(studio_viewer, "studio-y-up-to-z-up")
        assert sim_pos == _approx3((0.0, -1.0, 0.0)), (
            "Studio +Z (toward viewer / robot right) must map to -Y in simulator. "
            f"Got {sim_pos}"
        )

    def test_matrix_is_orthogonal(self):
        # STUDIO_Y_UP_TO_Z_UP must be a pure rotation (orthogonal, det=+1).
        m = STUDIO_Y_UP_TO_Z_UP
        assert np.allclose(m @ m.T, np.eye(3), atol=1e-12), "Matrix is not orthogonal"
        assert pytest.approx(np.linalg.det(m), abs=1e-12) == 1.0, "Matrix det != 1"

    def test_size_transform_uses_absolute_values(self):
        # Sizes must be non-negative after transform.  The implementation uses
        # abs(matrix) so negative signs in the matrix do not flip dimensions.
        size = (0.2, 0.4, 0.8)
        sim_size = _transform_size(size, "studio-y-up-to-z-up")
        assert all(v >= 0 for v in sim_size), (
            f"Transformed size has negative components: {sim_size}"
        )
        # Specific expected mapping: (x, y, z) → (x, z, y) with abs.
        # Studio y-dim (0.4) becomes sim z-dim, studio z-dim (0.8) becomes sim y-dim.
        assert sim_size == _approx3((0.2, 0.8, 0.4)), (
            f"Size transform wrong. Got {sim_size}, expected (0.2, 0.8, 0.4)"
        )

    def test_identity_frame_map_is_noop_for_position(self):
        pos = (1.1, -2.3, 0.77)
        assert _transform_position(pos, "identity") == _approx3(pos)

    def test_identity_frame_map_is_noop_for_size(self):
        size = (0.1, 0.3, 0.7)
        assert _transform_size(size, "identity") == _approx3(size)

    def test_identity_frame_map_is_noop_for_rotation(self):
        rpy = (0.3, -0.5, 1.1)
        q = _transform_quat_wxyz(rpy, "identity")
        expected = _quat_from_rpy(*rpy)
        # quaternions can differ by overall sign and still represent the same rotation
        dot = abs(sum(a * b for a, b in zip(q, expected)))
        assert dot == pytest.approx(1.0, abs=1e-9), (
            f"Identity frame map should not change rotation. "
            f"Got {q}, expected ≈{expected}"
        )


# ---------------------------------------------------------------------------
# 2. Mathematical round-trips – forward × inverse = identity
#    Covers both "studio-y-up-to-z-up" and "identity".
# ---------------------------------------------------------------------------

ROUND_TRIP_POSITIONS = [
    (0.0, 0.0, 0.0),
    (1.0, 0.0, 0.0),
    (0.0, 1.0, 0.0),
    (0.0, 0.0, 1.0),
    (-1.0, 0.0, 0.0),
    (0.35, 0.22, -0.15),
    (-0.35, 0.4, 0.25),
    (1.23, -0.45, 0.67),
]

ROUND_TRIP_SIZES = [
    (0.1, 0.1, 0.1),
    (0.2, 0.4, 0.8),
    (1.0, 0.1, 0.6),
    (0.18, 0.8, 0.18),
    (0.5, 0.3, 0.7),
]

ROUND_TRIP_RPY = [
    (0.0, 0.0, 0.0),
    (math.pi / 6, 0.0, 0.0),
    (0.0, math.pi / 4, 0.0),
    (0.0, 0.0, math.pi / 3),
    (0.25, -0.35, 0.45),
    (-0.2, 0.4, -0.3),
    (math.pi / 2, 0.0, 0.0),
    (0.0, math.pi / 2, 0.0),
    (0.0, 0.0, math.pi / 2),
    (math.pi, 0.0, 0.0),
    (1.1, -0.7, 2.3),
]

FRAME_MAPS = ["identity", "studio-y-up-to-z-up"]


@pytest.mark.parametrize("frame_map", FRAME_MAPS)
@pytest.mark.parametrize("pos", ROUND_TRIP_POSITIONS)
def test_position_round_trip(frame_map, pos):
    """inverse_transform_position(transform_position(p)) must equal p."""
    sim_pos = _transform_position(pos, frame_map)
    recovered = inverse_transform_position(sim_pos, frame_map)
    assert recovered == _approx3(pos), (
        f"Position round-trip failed for frame_map={frame_map!r}, pos={pos}. "
        f"After forward+inverse: {recovered}"
    )


@pytest.mark.parametrize("frame_map", FRAME_MAPS)
@pytest.mark.parametrize("size", ROUND_TRIP_SIZES)
def test_size_round_trip(frame_map, size):
    """inverse_transform_size(transform_size(s)) must equal s."""
    sim_size = _transform_size(size, frame_map)
    recovered = inverse_transform_size(sim_size, frame_map)
    assert recovered == _approx3(size), (
        f"Size round-trip failed for frame_map={frame_map!r}, size={size}. "
        f"After forward+inverse: {recovered}"
    )


@pytest.mark.parametrize("frame_map", FRAME_MAPS)
@pytest.mark.parametrize("rpy", ROUND_TRIP_RPY)
def test_rotation_round_trip(frame_map, rpy):
    """inverse_transform_quat_wxyz(transform_quat_wxyz(rpy)) must equal original."""
    q_sim = _transform_quat_wxyz(rpy, frame_map)
    q_back = inverse_transform_quat_wxyz(q_sim, frame_map)
    q_expected = _quat_from_rpy(*rpy)
    # Two quaternions represent the same rotation if they are equal or negatives.
    dot = abs(sum(a * b for a, b in zip(q_back, q_expected)))
    assert dot == pytest.approx(1.0, abs=1e-9), (
        f"Rotation round-trip failed for frame_map={frame_map!r}, rpy={rpy}. "
        f"Recovered quaternion {q_back} vs expected {q_expected} (dot={dot:.6f})"
    )


def test_rotation_round_trip_90deg_rotations_all_axes():
    """Axis-aligned 90° rotations round-trip through y-up-to-z-up."""
    frame_map = "studio-y-up-to-z-up"
    for axis_rpy in [
        (math.pi / 2, 0, 0),
        (0, math.pi / 2, 0),
        (0, 0, math.pi / 2),
        (-math.pi / 2, 0, 0),
        (0, -math.pi / 2, 0),
        (0, 0, -math.pi / 2),
    ]:
        q_sim = _transform_quat_wxyz(axis_rpy, frame_map)
        q_back = inverse_transform_quat_wxyz(q_sim, frame_map)
        q_exp = _quat_from_rpy(*axis_rpy)
        dot = abs(sum(a * b for a, b in zip(q_back, q_exp)))
        assert dot == pytest.approx(1.0, abs=1e-9), (
            f"90° rotation round-trip failed for rpy={axis_rpy}. dot={dot:.6f}"
        )


# ---------------------------------------------------------------------------
# 3. Camera convention round-trips and chain consistency
#
# The chain is: studio/world  ←→  opengl  ←→  ros
#
# Invariants:
#   A → B → A = identity  (each edge is its own inverse)
#   world → ros = world → opengl → ros  (path-independent)
# ---------------------------------------------------------------------------

CAMERA_CONVENTIONS = ["world", "opengl", "ros"]


@pytest.mark.parametrize("convention", CAMERA_CONVENTIONS)
def test_camera_convention_self_inverse(convention):
    """A → A must be identity."""
    r = camera_frame_conversion_rotation(convention, convention)
    assert np.allclose(r.as_matrix(), np.eye(3), atol=1e-12), (
        f"camera_frame_conversion_rotation({convention!r}, {convention!r}) "
        f"is not identity"
    )


def test_camera_convention_rejects_unsupported_self_identity_shortcut():
    with pytest.raises(ValueError, match="Unsupported camera frame convention: bogus"):
        camera_frame_conversion_rotation("bogus", "bogus")  # type: ignore[arg-type]


@pytest.mark.parametrize(("a", "b"), [
    ("world", "opengl"),
    ("opengl", "ros"),
    ("world", "ros"),
])
def test_camera_convention_round_trip(a, b):
    """Convention A → B → A must equal identity."""
    r_forward = camera_frame_conversion_rotation(a, b)
    r_backward = camera_frame_conversion_rotation(b, a)
    composed = r_forward * r_backward
    assert np.allclose(composed.as_matrix(), np.eye(3), atol=1e-9), (
        f"Camera convention round-trip {a}→{b}→{a} is not identity. "
        f"Max deviation: {np.max(np.abs(composed.as_matrix() - np.eye(3))):.2e}"
    )


def test_camera_convention_chain_world_to_ros_via_opengl():
    """world→ros must equal world→opengl→ros (path-independent)."""
    direct = camera_frame_conversion_rotation("world", "ros")
    via_opengl = (
        camera_frame_conversion_rotation("world", "opengl")
        * camera_frame_conversion_rotation("opengl", "ros")
    )
    diff = direct * via_opengl.inv()
    assert np.allclose(diff.as_matrix(), np.eye(3), atol=1e-9), (
        "world→ros and world→opengl→ros give different results. "
        f"Max deviation: {np.max(np.abs(diff.as_matrix() - np.eye(3))):.2e}"
    )


def test_camera_convention_chain_ros_to_world_via_opengl():
    """ros→world must equal ros→opengl→world (path-independent)."""
    direct = camera_frame_conversion_rotation("ros", "world")
    via_opengl = (
        camera_frame_conversion_rotation("ros", "opengl")
        * camera_frame_conversion_rotation("opengl", "world")
    )
    diff = direct * via_opengl.inv()
    assert np.allclose(diff.as_matrix(), np.eye(3), atol=1e-9), (
        "ros→world and ros→opengl→world give different results. "
        f"Max deviation: {np.max(np.abs(diff.as_matrix() - np.eye(3))):.2e}"
    )


# ---------------------------------------------------------------------------
# 4. Camera frame semantics – each convention's local axes must be consistent
# ---------------------------------------------------------------------------

class TestCameraConventionSemantics:
    """Verify that each convention's forward/up constants agree with what the
    conversion rotation actually produces when applied to another convention's
    local axes."""

    def test_world_to_opengl_maps_forward_correctly(self):
        # Applying world→opengl to OpenGL's local forward (-Z) should yield
        # the world/studio forward (+X).
        r = camera_frame_conversion_rotation("world", "opengl")
        fwd_in_world = r.apply(OPENGL_CAMERA_FORWARD_LOCAL_XYZ)
        assert fwd_in_world == _approx3(WORLD_CAMERA_FORWARD_LOCAL_XYZ), (
            f"world→opengl: OpenGL fwd {OPENGL_CAMERA_FORWARD_LOCAL_XYZ} "
            f"mapped to {tuple(fwd_in_world)}, expected {WORLD_CAMERA_FORWARD_LOCAL_XYZ}"
        )

    def test_world_to_opengl_maps_up_correctly(self):
        r = camera_frame_conversion_rotation("world", "opengl")
        up_in_world = r.apply(OPENGL_CAMERA_UP_LOCAL_XYZ)
        assert up_in_world == _approx3(WORLD_CAMERA_UP_LOCAL_XYZ), (
            f"world→opengl: OpenGL up {OPENGL_CAMERA_UP_LOCAL_XYZ} "
            f"mapped to {tuple(up_in_world)}, expected {WORLD_CAMERA_UP_LOCAL_XYZ}"
        )

    def test_opengl_to_ros_maps_forward_correctly(self):
        # ROS camera forward (+Z) → OpenGL forward (-Z).
        r = camera_frame_conversion_rotation("opengl", "ros")
        fwd_in_opengl = r.apply(ROS_CAMERA_FORWARD_LOCAL_XYZ)
        assert fwd_in_opengl == _approx3(OPENGL_CAMERA_FORWARD_LOCAL_XYZ), (
            f"opengl→ros: ROS fwd {ROS_CAMERA_FORWARD_LOCAL_XYZ} "
            f"mapped to {tuple(fwd_in_opengl)}, expected {OPENGL_CAMERA_FORWARD_LOCAL_XYZ}"
        )

    def test_opengl_to_ros_maps_up_correctly(self):
        # ROS camera up (-Y) → OpenGL up (+Y).
        r = camera_frame_conversion_rotation("opengl", "ros")
        up_in_opengl = r.apply(ROS_CAMERA_UP_LOCAL_XYZ)
        assert up_in_opengl == _approx3(OPENGL_CAMERA_UP_LOCAL_XYZ), (
            f"opengl→ros: ROS up {ROS_CAMERA_UP_LOCAL_XYZ} "
            f"mapped to {tuple(up_in_opengl)}, expected {OPENGL_CAMERA_UP_LOCAL_XYZ}"
        )

    def test_world_to_ros_maps_forward_correctly(self):
        r = camera_frame_conversion_rotation("world", "ros")
        fwd_in_world = r.apply(ROS_CAMERA_FORWARD_LOCAL_XYZ)
        assert fwd_in_world == _approx3(WORLD_CAMERA_FORWARD_LOCAL_XYZ), (
            f"world→ros: ROS fwd {ROS_CAMERA_FORWARD_LOCAL_XYZ} "
            f"mapped to {tuple(fwd_in_world)}, expected {WORLD_CAMERA_FORWARD_LOCAL_XYZ}"
        )

    def test_world_to_ros_maps_up_correctly(self):
        r = camera_frame_conversion_rotation("world", "ros")
        up_in_world = r.apply(ROS_CAMERA_UP_LOCAL_XYZ)
        assert up_in_world == _approx3(WORLD_CAMERA_UP_LOCAL_XYZ), (
            f"world→ros: ROS up {ROS_CAMERA_UP_LOCAL_XYZ} "
            f"mapped to {tuple(up_in_world)}, expected {WORLD_CAMERA_UP_LOCAL_XYZ}"
        )


# ---------------------------------------------------------------------------
# 5. Studio→render camera transform semantics and round-trip
# ---------------------------------------------------------------------------

class TestStudioToRenderCameraTransform:
    """Verify that camera_render_transform_from_studio_transform is consistent."""

    def test_identity_studio_pose_forward_is_studio_forward_in_world(self):
        # A camera at identity (xyz=0, rpy=0) with studio convention (+X fwd, +Z up)
        # must have its render forward vector pointing in the world +X direction.
        studio = CameraTransform(
            position_xyz=(0.0, 0.0, 0.0),
            rotation=Rotation.identity(),
        )
        render = camera_render_transform_from_studio_transform(studio)
        world_fwd = render.rotation.apply(RENDER_CAMERA_FORWARD_LOCAL_XYZ)
        assert world_fwd == _approx3(STUDIO_CAMERA_FORWARD_LOCAL_XYZ), (
            f"Identity studio camera render forward should be {STUDIO_CAMERA_FORWARD_LOCAL_XYZ}, "
            f"got {tuple(world_fwd)}"
        )

    def test_identity_studio_pose_up_is_studio_up_in_world(self):
        studio = CameraTransform(
            position_xyz=(0.0, 0.0, 0.0),
            rotation=Rotation.identity(),
        )
        render = camera_render_transform_from_studio_transform(studio)
        world_up = render.rotation.apply(RENDER_CAMERA_UP_LOCAL_XYZ)
        assert world_up == _approx3(STUDIO_CAMERA_UP_LOCAL_XYZ), (
            f"Identity studio camera render up should be {STUDIO_CAMERA_UP_LOCAL_XYZ}, "
            f"got {tuple(world_up)}"
        )

    def test_rotated_studio_pose_forward_follows_rotation(self):
        # A studio camera rotated 90° around Z faces +Y in world space.
        studio = CameraTransform(
            position_xyz=(0.0, 0.0, 0.0),
            rotation=Rotation.from_euler("z", math.pi / 2),
        )
        render = camera_render_transform_from_studio_transform(studio)
        world_fwd = render.rotation.apply(RENDER_CAMERA_FORWARD_LOCAL_XYZ)
        # Studio forward (+X) rotated 90° around Z → world +Y.
        assert world_fwd == _approx3((0.0, 1.0, 0.0)), (
            f"90°-Z studio camera render forward should be +Y, got {tuple(world_fwd)}"
        )

    def test_render_forward_and_up_are_perpendicular(self):
        studio = CameraTransform(
            position_xyz=(0.1, 0.2, 0.3),
            rotation=Rotation.from_euler("xyz", [0.3, -0.5, 0.7]),
        )
        render = camera_render_transform_from_studio_transform(studio)
        fwd = render.rotation.apply(RENDER_CAMERA_FORWARD_LOCAL_XYZ)
        up = render.rotation.apply(RENDER_CAMERA_UP_LOCAL_XYZ)
        dot = float(np.dot(fwd, up))
        assert dot == pytest.approx(0.0, abs=1e-9), (
            f"Render forward and up should be perpendicular, dot={dot:.6f}"
        )

    def test_studio_to_render_rotation_is_invertible(self):
        """Applying the inverse render rotation should recover the studio rotation."""
        r_conv = studio_camera_to_render_view_rotation()
        # The conversion and its inverse must compose to identity.
        assert np.allclose(
            (r_conv * r_conv.inv()).as_matrix(),
            np.eye(3),
            atol=1e-12,
        )

    @pytest.mark.parametrize("rpy", [
        (0.0, 0.0, 0.0),
        (0.3, -0.5, 0.7),
        (math.pi / 2, 0.0, 0.0),
        (0.0, math.pi / 2, 0.0),
        (0.0, 0.0, math.pi / 2),
    ])
    def test_render_to_studio_round_trip(self, rpy):
        """Converting studio→render then back with the inverse rotation returns
        the original studio rotation."""
        r_studio = Rotation.from_euler("xyz", rpy)
        r_conv = studio_camera_to_render_view_rotation()
        r_render = r_studio * r_conv
        r_studio_back = r_render * r_conv.inv()
        diff = r_studio * r_studio_back.inv()
        assert np.allclose(diff.as_matrix(), np.eye(3), atol=1e-9), (
            f"studio→render→studio round-trip failed for rpy={rpy}. "
            f"Max deviation: {np.max(np.abs(diff.as_matrix() - np.eye(3))):.2e}"
        )


# ---------------------------------------------------------------------------
# 6. Studio camera and world camera convention constants are consistent
# ---------------------------------------------------------------------------

def test_studio_camera_forward_matches_world_camera_forward():
    """STUDIO_CAMERA_FORWARD_LOCAL_XYZ must equal WORLD_CAMERA_FORWARD_LOCAL_XYZ."""
    assert STUDIO_CAMERA_FORWARD_LOCAL_XYZ == WORLD_CAMERA_FORWARD_LOCAL_XYZ, (
        f"Studio forward {STUDIO_CAMERA_FORWARD_LOCAL_XYZ} != "
        f"world forward {WORLD_CAMERA_FORWARD_LOCAL_XYZ}"
    )


def test_studio_camera_up_matches_world_camera_up():
    """STUDIO_CAMERA_UP_LOCAL_XYZ must equal WORLD_CAMERA_UP_LOCAL_XYZ."""
    assert STUDIO_CAMERA_UP_LOCAL_XYZ == WORLD_CAMERA_UP_LOCAL_XYZ, (
        f"Studio up {STUDIO_CAMERA_UP_LOCAL_XYZ} != "
        f"world up {WORLD_CAMERA_UP_LOCAL_XYZ}"
    )


def test_render_forward_matches_opengl_forward():
    """RENDER_CAMERA_FORWARD_LOCAL_XYZ must equal OPENGL_CAMERA_FORWARD_LOCAL_XYZ."""
    assert RENDER_CAMERA_FORWARD_LOCAL_XYZ == OPENGL_CAMERA_FORWARD_LOCAL_XYZ, (
        f"Render forward {RENDER_CAMERA_FORWARD_LOCAL_XYZ} != "
        f"OpenGL forward {OPENGL_CAMERA_FORWARD_LOCAL_XYZ}"
    )


def test_render_up_matches_opengl_up():
    """RENDER_CAMERA_UP_LOCAL_XYZ must equal OPENGL_CAMERA_UP_LOCAL_XYZ."""
    assert RENDER_CAMERA_UP_LOCAL_XYZ == OPENGL_CAMERA_UP_LOCAL_XYZ, (
        f"Render up {RENDER_CAMERA_UP_LOCAL_XYZ} != "
        f"OpenGL up {OPENGL_CAMERA_UP_LOCAL_XYZ}"
    )
