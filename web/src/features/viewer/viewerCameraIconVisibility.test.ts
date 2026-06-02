import { describe, expect, it } from "vitest";

import {
  OPENARM_HF_LIVE_CAMERA_FOV_DEG,
  OPENARM_HF_LIVE_CAMERA_ID,
  OPENARM_HF_LIVE_CAMERA_PARENT_JOINT,
  OPENARM_HF_LIVE_DEFAULT_INTRINSICS,
  OPENARM_HF_LIVE_REAL_SENSE_POSE,
} from "@/features/teleop/perception/openArmHfLiveParams";
import { filterVisibleCameraIconConfigs } from "@/features/viewer/viewerCameraIconVisibility";
import type { Camera as RobotCamera } from "@/shared/types/camera";

const buildCamera = (id: string): RobotCamera => ({
  id,
  name: id,
  parent_joint: OPENARM_HF_LIVE_CAMERA_PARENT_JOINT,
  pose: {
    xyz: [...OPENARM_HF_LIVE_REAL_SENSE_POSE.position] as [number, number, number],
    rpy: [...OPENARM_HF_LIVE_REAL_SENSE_POSE.rotationRpyDeg] as [number, number, number],
  },
  intrinsics: {
    width: OPENARM_HF_LIVE_DEFAULT_INTRINSICS.width,
    height: OPENARM_HF_LIVE_DEFAULT_INTRINSICS.height,
    fov_deg: OPENARM_HF_LIVE_CAMERA_FOV_DEG,
    fx: OPENARM_HF_LIVE_DEFAULT_INTRINSICS.fx,
    fy: OPENARM_HF_LIVE_DEFAULT_INTRINSICS.fy,
    cx: OPENARM_HF_LIVE_DEFAULT_INTRINSICS.ppx,
    cy: OPENARM_HF_LIVE_DEFAULT_INTRINSICS.ppy,
  },
});

describe("viewerCameraIconVisibility", () => {
  it("hides generated live point-cloud cameras from 3D camera icon chrome", () => {
    const storedCamera = buildCamera("stored-camera");
    const liveCamera = buildCamera(OPENARM_HF_LIVE_CAMERA_ID);

    expect(
      filterVisibleCameraIconConfigs(
        [storedCamera, liveCamera],
        new Set([OPENARM_HF_LIVE_CAMERA_ID]),
      ),
    ).toEqual([storedCamera]);
  });

  it("keeps camera icon configs unchanged when no generated live cameras are hidden", () => {
    const storedCamera = buildCamera("stored-camera");

    expect(filterVisibleCameraIconConfigs([storedCamera], new Set())).toEqual([
      storedCamera,
    ]);
  });
});
