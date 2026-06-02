import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  buildSimulationPrepMirrorCameraFrameKey,
  buildSimulationPrepMirrorCameraFrame,
  buildSimulationPrepSymmetryCameraDirection,
  resolveSimulationPrepSymmetryCameraDistance,
} from "@/features/viewer/symmetryCameraFrame";
import {
  SIMULATION_PREP_SYMMETRY_CAMERA_MIN_DISTANCE_METERS,
  SIMULATION_PREP_SYMMETRY_CAMERA_MIN_FOCUS_RADIUS_METERS,
} from "@/features/viewer/symmetryVisualizationParams";

describe("symmetryCameraFrame", () => {
  it("biases the symmetry camera downward while keeping a small forward component", () => {
    const direction = buildSimulationPrepSymmetryCameraDirection({
      forwardWorld: new THREE.Vector3(1, 0, 0),
      upWorld: new THREE.Vector3(0, 0, 1),
    });

    expect(direction.z).toBeLessThan(-0.9);
    expect(direction.x).toBeGreaterThan(0);
    expect(direction.length()).toBeCloseTo(1, 6);
  });

  it("respects minimum focus radius and distance floors", () => {
    const tinyDistance = resolveSimulationPrepSymmetryCameraDistance({
      aspect: 1,
      fovDegrees: 50,
      focusRadiusMeters: 0,
    });

    const minimumExpectedDistance = resolveSimulationPrepSymmetryCameraDistance({
      aspect: 1,
      fovDegrees: 50,
      focusRadiusMeters: SIMULATION_PREP_SYMMETRY_CAMERA_MIN_FOCUS_RADIUS_METERS,
    });

    expect(tinyDistance).toBeGreaterThanOrEqual(SIMULATION_PREP_SYMMETRY_CAMERA_MIN_DISTANCE_METERS);
    expect(tinyDistance).toBeCloseTo(minimumExpectedDistance, 6);
  });

  it("keeps the mirror camera on the front side while viewing mostly along the plane", () => {
    const frame = buildSimulationPrepMirrorCameraFrame({
      planeNormalWorld: new THREE.Vector3(1, 0, 0),
      frontWorld: new THREE.Vector3(1, 0, 0),
      upWorld: new THREE.Vector3(0, 0, 1),
    });

    expect(frame.directionWorld.x).toBeGreaterThan(0.2);
    expect(frame.directionWorld.x).toBeLessThan(0.4);
    expect(Math.abs(frame.directionWorld.y)).toBeGreaterThan(0.9);
    expect(frame.directionWorld.length()).toBeCloseTo(1, 6);
    expect(frame.upWorld.z).toBeGreaterThan(0.99);
    expect(frame.upWorld.dot(frame.directionWorld)).toBeCloseTo(0, 6);
  });

  it("keeps the viewing direction mostly in-plane when world up matches the plane normal", () => {
    const frame = buildSimulationPrepMirrorCameraFrame({
      planeNormalWorld: new THREE.Vector3(0, 0, 1),
      frontWorld: new THREE.Vector3(1, 0, 0),
      upWorld: new THREE.Vector3(0, 0, 1),
    });

    expect(frame.directionWorld.x).toBeGreaterThan(0.9);
    expect(frame.directionWorld.z).toBeGreaterThan(0.2);
    expect(frame.directionWorld.z).toBeLessThan(0.4);
    expect(Math.abs(frame.upWorld.x)).toBeGreaterThan(0.2);
    expect(frame.upWorld.z).toBeGreaterThan(0.9);
    expect(frame.upWorld.y).toBeCloseTo(0, 6);
    expect(frame.upWorld.dot(frame.directionWorld)).toBeCloseTo(0, 6);
  });

  it("changes the mirror camera cache key when the target changes on the same plane", () => {
    const baseKey = buildSimulationPrepMirrorCameraFrameKey({
      planeLabel: "robot-mirror:xz",
      originMeters: [0, 0, 0],
      planeNormalWorld: [1, 0, 0],
      focusLinkNames: ["camera_mount", "camera_mount"],
      focusRadiusMeters: 0.5,
      frontWorld: new THREE.Vector3(1, 0, 0),
    });
    const movedTargetKey = buildSimulationPrepMirrorCameraFrameKey({
      planeLabel: "robot-mirror:xz",
      originMeters: [0.02, 0, 0],
      planeNormalWorld: [1, 0, 0],
      focusLinkNames: ["camera_mount"],
      focusRadiusMeters: 0.5,
      frontWorld: new THREE.Vector3(1, 0, 0),
    });
    const rotatedFrontKey = buildSimulationPrepMirrorCameraFrameKey({
      planeLabel: "robot-mirror:xz",
      originMeters: [0, 0, 0],
      planeNormalWorld: [1, 0, 0],
      focusLinkNames: ["camera_mount"],
      focusRadiusMeters: 0.5,
      frontWorld: new THREE.Vector3(0, 1, 0),
    });

    expect(baseKey).not.toBe(movedTargetKey);
    expect(baseKey).not.toBe(rotatedFrontKey);
  });
});
