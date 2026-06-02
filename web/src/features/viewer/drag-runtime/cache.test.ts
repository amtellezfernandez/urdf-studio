import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import {
  createEmptyDragRuntimeCache,
  refreshRobotFrameCache,
  robotToWorldPosition,
  robotToWorldQuaternion,
  worldToRobotPosition,
  worldToRobotQuaternion,
} from "./cache";

const POSITION_EPSILON = 1e-8;
const QUATERNION_ALIGNMENT_MIN_DOT = 0.999999;

describe("drag-runtime/cache", () => {
  it("roundtrips robot/world pose conversions after frame refresh", () => {
    const robot = new THREE.Group();
    robot.position.set(0.8, -0.35, 0.2);
    robot.quaternion.setFromEuler(new THREE.Euler(0.15, -0.25, 0.55, "XYZ"));
    robot.updateMatrixWorld(true);

    const cache = createEmptyDragRuntimeCache();
    refreshRobotFrameCache(cache, robot as unknown as URDFRobot);

    const worldPosition = new THREE.Vector3(1.4, -0.1, 0.6);
    const localPosition = worldToRobotPosition(cache, worldPosition, new THREE.Vector3());
    const worldPositionRoundtrip = robotToWorldPosition(cache, localPosition, new THREE.Vector3());
    expect(worldPositionRoundtrip.distanceTo(worldPosition)).toBeLessThan(POSITION_EPSILON);

    const worldQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-0.4, 0.2, 0.9, "XYZ")
    );
    const localQuaternion = worldToRobotQuaternion(cache, worldQuaternion, new THREE.Quaternion());
    const worldQuaternionRoundtrip = robotToWorldQuaternion(
      cache,
      localQuaternion,
      new THREE.Quaternion()
    );
    const alignment = Math.abs(worldQuaternionRoundtrip.dot(worldQuaternion.normalize()));
    expect(alignment).toBeGreaterThan(QUATERNION_ALIGNMENT_MIN_DOT);
  });
});
