from __future__ import annotations

from backend.core.paths import BASE_DIR
from backend.services.simulator_adapters.urdf_collision_proxy_repair import (
    BoxCollisionProxy,
    UrdfCollisionProxyRepairProfile,
)


GENESIS_URDF_REPAIR_CACHE_DIR = BASE_DIR / ".cache" / "genesis-urdf"
GENESIS_COMPATIBILITY_PATCH_SO101_GRIPPER_PROXY_COLLISIONS = (
    "so101_gripper_proxy_collisions"
)

SO101_FIXED_GRIPPER_PAD_NAME = "fixed_gripper_pad_collision"
SO101_FIXED_GRIPPER_BODY_NAME = "fixed_gripper_body_collision"
SO101_MOVING_GRIPPER_PAD_NAME = "moving_gripper_pad_collision"


SO101_GENESIS_GRIPPER_PROXY_COLLISION_PROFILE = UrdfCollisionProxyRepairProfile(
    repair_id="so101-genesis-gripper-proxy-collisions-v3",
    cache_dir=GENESIS_URDF_REPAIR_CACHE_DIR,
    robot_name_pattern=r"(^|[_\-.])so101([_\-.]|$)",
    mesh_filename_pattern=r"(^|[_\-.])so101([_\-.]|$)",
    required_link_names=("gripper_link", "moving_jaw_so101_v1_link"),
    box_collisions=(
        BoxCollisionProxy(
            link_name="gripper_link",
            collision_name=SO101_FIXED_GRIPPER_PAD_NAME,
            xyz="-0.0026 -0.0020 -0.0770",
            rpy="0 0 0",
            size="0.070 0.056 0.060",
        ),
        BoxCollisionProxy(
            link_name="gripper_link",
            collision_name=SO101_FIXED_GRIPPER_BODY_NAME,
            xyz="-0.0026 -0.0020 -0.0517",
            rpy="0 0 0",
            size="0.068 0.056 0.108",
        ),
        BoxCollisionProxy(
            link_name="moving_jaw_so101_v1_link",
            collision_name=SO101_MOVING_GRIPPER_PAD_NAME,
            xyz="-0.0012 -0.0360 0.0189",
            rpy="0 0 0",
            size="0.030 0.095 0.052",
        ),
    ),
)
