import { describe, expect, it } from "vitest";
import type { Camera } from "@/shared/types/camera";
import { normalizeCameraIntrinsics } from "@/shared/lib/cameraIntrinsics";
import { partitionFallbackDemoCameras } from "./cameraAutoCleanup";

const DEFAULT_POSE = {
  xyz: [0, 0, 0] as [number, number, number],
  rpy: [0, 0, 0] as [number, number, number],
};

const DEFAULT_INTRINSICS = normalizeCameraIntrinsics({
  width: 640,
  height: 480,
  fov_deg: 78,
});

const createCamera = (overrides: Partial<Camera> & Pick<Camera, "id" | "name" | "parent_joint">): Camera => ({
  id: overrides.id,
  name: overrides.name,
  parent_joint: overrides.parent_joint,
  pose: overrides.pose ?? DEFAULT_POSE,
  intrinsics: overrides.intrinsics ?? DEFAULT_INTRINSICS,
});

describe("partitionFallbackDemoCameras", () => {
  it("removes fallback demo entries", () => {
    const fallback = createCamera({ id: "fallback", name: "Gripper Top", parent_joint: "joint_a" });
    const manual = createCamera({ id: "manual", name: "Manual Cam", parent_joint: "joint_b" });

    const result = partitionFallbackDemoCameras([fallback, manual]);

    expect(result.cameraIdsToRemove).toEqual(["fallback"]);
    expect(result.retainedCameras.map((camera) => camera.id)).toEqual(["manual"]);
  });

  it("keeps non-fallback cameras unchanged", () => {
    const cameraA = createCamera({ id: "a", name: "Auto Camera: camera_front", parent_joint: "joint_a" });
    const cameraB = createCamera({ id: "b", name: "Manual Camera", parent_joint: "joint_b" });

    const result = partitionFallbackDemoCameras([cameraA, cameraB]);

    expect(result.cameraIdsToRemove).toEqual([]);
    expect(result.retainedCameras.map((camera) => camera.id)).toEqual(["a", "b"]);
  });
});
