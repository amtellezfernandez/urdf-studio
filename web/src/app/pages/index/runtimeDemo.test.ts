import { describe, expect, it } from "vitest";

import {
  buildRuntimeDemoScanPose,
  buildRuntimePoseFromPlanarPose,
  computeRuntimeDemoNavigatePose,
  normalizeAngle,
  readPlanarPose,
  resolveRuntimePreviewTargetPosition,
} from "@/app/pages/index/runtimeDemo";
import { RUNTIME_DEMO_OBJECT_SIZE_METERS } from "@/studio_ui/runtimeviz/runtimeRobotPreviewParams";

const DEMO_OBJECT_ELEVATION_METERS = RUNTIME_DEMO_OBJECT_SIZE_METERS * 0.5;

describe("runtimeDemo helpers", () => {
  it("normalizes angles into [-pi, pi]", () => {
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI);
  });

  it("builds scan poses across a full sweep", () => {
    const pose = buildRuntimeDemoScanPose(0.5);
    expect(pose.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(pose.quaternion.z).toBeCloseTo(1);
    expect(Math.abs(pose.quaternion.w)).toBeLessThan(1e-6);
  });

  it("reads planar poses and falls back to origin", () => {
    expect(readPlanarPose(null)).toEqual({ x: 0, y: 0, yawRad: 0 });
    const pose = buildRuntimePoseFromPlanarPose(1.5, -0.25, Math.PI / 4);
    const planar = readPlanarPose(pose);
    expect(planar.x).toBeCloseTo(1.5);
    expect(planar.y).toBeCloseTo(-0.25);
    expect(planar.yawRad).toBeCloseTo(Math.PI / 4);
  });

  it("rotates in place before translating toward the target", () => {
    const startPose = buildRuntimePoseFromPlanarPose(0, 0, 0);
    const rotateOnly = computeRuntimeDemoNavigatePose({
      startPose,
      targetPosition: [1, 1, 0],
      progress: 0.25,
    });
    const rotateOnlyPlanar = readPlanarPose(rotateOnly);
    expect(rotateOnlyPlanar.x).toBeCloseTo(0);
    expect(rotateOnlyPlanar.y).toBeCloseTo(0);
    expect(rotateOnlyPlanar.yawRad).toBeGreaterThan(0);
    expect(rotateOnlyPlanar.yawRad).toBeLessThan(Math.PI / 4);

    const translated = computeRuntimeDemoNavigatePose({
      startPose,
      targetPosition: [1, 1, 0],
      progress: 0.75,
    });
    const translatedPlanar = readPlanarPose(translated);
    expect(translatedPlanar.x).toBeGreaterThan(0);
    expect(translatedPlanar.y).toBeGreaterThan(0);
    expect(translatedPlanar.yawRad).toBeCloseTo(Math.PI / 4);
  });

  it("resolves preview targets from seeded demo labels", () => {
    expect(
      resolveRuntimePreviewTargetPosition({
        label: "mug",
        runtimeObjects: [],
      })
    ).toEqual([1.9, 0.15, DEMO_OBJECT_ELEVATION_METERS]);
  });

  it("resolves preview targets from live runtime detection objects", () => {
    expect(
      resolveRuntimePreviewTargetPosition({
        label: "crate box",
        runtimeObjects: [
          {
            id: "object-1",
            label: "crate box",
            type: "cube",
            position: { x: 2.4, y: -0.7, z: 0.3 },
            size: { x: 0.2, y: 0.2, z: 0.2 },
            color: "#ffffff",
            trackedJointName: null,
            source: "runtime-detection",
            isIkTarget: false,
          } as never,
        ],
      })
    ).toEqual([2.4, -0.7, 0.3]);
  });
});
