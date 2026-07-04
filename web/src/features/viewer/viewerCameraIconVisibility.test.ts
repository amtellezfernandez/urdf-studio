import { describe, expect, it } from "vitest";

import {
  buildVisibleViewerCameraConfigs,
  filterVisibleCameraIconConfigs,
  shouldHideCameraInReadOnlyRuntime,
} from "@/features/viewer/viewerCameraIconVisibility";
import type { Camera as RobotCamera } from "@/shared/types/camera";

const createCamera = (overrides: Partial<RobotCamera> = {}): RobotCamera => ({
  id: "camera-1",
  name: "Front Camera",
  parent_joint: "base_camera_joint",
  pose: {
    xyz: [0, 0, 0],
    rpy: [0, 0, 0],
  },
  intrinsics: {
    width: 640,
    height: 480,
    fov_deg: 60,
  },
  ...overrides,
});

describe("viewerCameraIconVisibility", () => {
  it("filters icon configs by hidden camera ids", () => {
    const cameras = [
      createCamera({ id: "camera-a" }),
      createCamera({ id: "camera-b", name: "Top Camera" }),
    ];

    expect(filterVisibleCameraIconConfigs(cameras, new Set(["camera-b"]))).toEqual([
      cameras[0],
    ]);
  });

  it("deduplicates visible viewer camera configs by id and name", () => {
    const canonical = createCamera({ id: "camera-a", name: "Front Camera" });
    const duplicateById = createCamera({ id: "camera-a", name: "Other Name" });
    const duplicateByName = createCamera({ id: "camera-b", name: "Front Camera" });
    const unique = createCamera({ id: "camera-c", name: "Rear Camera" });

    expect(
      buildVisibleViewerCameraConfigs(
        [canonical, duplicateById, duplicateByName, unique],
        new Set<string>(),
        false
      )
    ).toEqual([canonical, unique]);
  });

  it("hides wrist and end-effector cameras in read-only mode", () => {
    const baseCamera = createCamera({ id: "camera-a", name: "Base Camera" });
    const wristCamera = createCamera({
      id: "camera-b",
      name: "Wrist POV",
      parent_joint: "tool_joint",
    });

    expect(shouldHideCameraInReadOnlyRuntime(baseCamera)).toBe(false);
    expect(shouldHideCameraInReadOnlyRuntime(wristCamera)).toBe(true);
    expect(
      buildVisibleViewerCameraConfigs([baseCamera, wristCamera], new Set<string>(), true)
    ).toEqual([baseCamera]);
  });
});
