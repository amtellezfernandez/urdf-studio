import type { URDFRobot } from "urdf-loader";

import { isFiniteRobotBasePose } from "@/shared/lib/robotBasePose";
import { URDF_ROBOT_BASE_POSE_PARAMS } from "@/shared/lib/urdfRobotBasePoseParams";
import type { RobotBasePose } from "@/shared/types/feature";

export const extractRobotBasePose = (robot: URDFRobot | null): RobotBasePose | null => {
  if (!robot) return null;
  const { position, quaternion } = robot;
  const basePose: RobotBasePose = {
    position: {
      x: position.x,
      y: position.y,
      z: position.z,
    },
    quaternion: {
      x: quaternion.x,
      y: quaternion.y,
      z: quaternion.z,
      w: quaternion.w,
    },
  };
  return isFiniteRobotBasePose(basePose) ? basePose : null;
};

export const applyRobotBasePose = (
  robot: URDFRobot | null,
  basePose: RobotBasePose | null | undefined
) => {
  if (!robot || !isFiniteRobotBasePose(basePose)) return false;
  const { position, quaternion } = basePose;

  let changed = false;
  const applyEpsilon = URDF_ROBOT_BASE_POSE_PARAMS.applyEpsilon;
  if (Math.abs(robot.position.x - position.x) > applyEpsilon) {
    robot.position.x = position.x;
    changed = true;
  }
  if (Math.abs(robot.position.y - position.y) > applyEpsilon) {
    robot.position.y = position.y;
    changed = true;
  }
  if (Math.abs(robot.position.z - position.z) > applyEpsilon) {
    robot.position.z = position.z;
    changed = true;
  }
  if (Math.abs(robot.quaternion.x - quaternion.x) > applyEpsilon) {
    robot.quaternion.x = quaternion.x;
    changed = true;
  }
  if (Math.abs(robot.quaternion.y - quaternion.y) > applyEpsilon) {
    robot.quaternion.y = quaternion.y;
    changed = true;
  }
  if (Math.abs(robot.quaternion.z - quaternion.z) > applyEpsilon) {
    robot.quaternion.z = quaternion.z;
    changed = true;
  }
  if (Math.abs(robot.quaternion.w - quaternion.w) > applyEpsilon) {
    robot.quaternion.w = quaternion.w;
    changed = true;
  }

  if (changed) {
    robot.updateMatrixWorld?.(true);
  }
  return changed;
};
