import { describe, expect, it } from "vitest";

import {
  normalizeOpenArmHfLiveObservePath,
  OPENARM_HF_LIVE_BAGUETTE_REALSENSE_PATH,
  OPENARM_HF_LIVE_BROWSER_DIRECT_ORIGIN_ENABLED,
  OPENARM_HF_LIVE_CAMERA_ID,
  OPENARM_HF_LIVE_CAN_COMMAND_PATH_SEGMENT,
  OPENARM_HF_LIVE_CAN_SOURCES,
  OPENARM_HF_LIVE_CAN_STATE_PATH_SUFFIX,
  OPENARM_HF_LIVE_OBSERVE_ONLY,
  OPENARM_HF_LIVE_REAL_SENSE_POSE,
  OPENARM_HF_LIVE_REAL_SENSE_POSITION_M,
  OPENARM_HF_LIVE_REAL_SENSE_ROTATION_RPY_DEG,
  OPENARM_HF_LIVE_REALSENSE_SOURCES,
  OPENARM_HF_LIVE_RELAY_URL,
} from "@/features/teleop/perception/openArmHfLiveParams";

const TEST_OPENARM_LIVE_PATH_FIXTURE = {
  canSourcePath: "anon/test-machine/xoq-can-can0",
  get canStatePath() {
    return `${this.canSourcePath}${OPENARM_HF_LIVE_CAN_STATE_PATH_SUFFIX}`;
  },
  get canCommandPath() {
    return `${this.canSourcePath}/${OPENARM_HF_LIVE_CAN_COMMAND_PATH_SEGMENT}`;
  },
} as const;

describe("openArmHfLiveParams", () => {
  it("ships the public observe-only OpenArm live defaults to the browser", () => {
    expect(OPENARM_HF_LIVE_OBSERVE_ONLY).toBe(true);
    expect(OPENARM_HF_LIVE_BROWSER_DIRECT_ORIGIN_ENABLED).toBe(true);
    expect(OPENARM_HF_LIVE_RELAY_URL).toBe("https://cdn.1ms.ai");
    expect(OPENARM_HF_LIVE_REALSENSE_SOURCES).toEqual([
      expect.objectContaining({
        cameraId: OPENARM_HF_LIVE_CAMERA_ID,
        path: OPENARM_HF_LIVE_BAGUETTE_REALSENSE_PATH,
        pose: OPENARM_HF_LIVE_REAL_SENSE_POSE,
      }),
    ]);
    expect(OPENARM_HF_LIVE_CAN_SOURCES).toEqual([]);
  });

  it("places the direct OpenArm RealSense on the URDF X axis above the workspace", () => {
    expect(OPENARM_HF_LIVE_REAL_SENSE_POSE).toEqual({
      position: [...OPENARM_HF_LIVE_REAL_SENSE_POSITION_M],
      rotationRpyDeg: [...OPENARM_HF_LIVE_REAL_SENSE_ROTATION_RPY_DEG],
      scale: 0.001,
      worldFrame: "urdf_z_up",
    });
  });

  it("normalizes existing state suffixes without creating command paths", () => {
    expect(
      normalizeOpenArmHfLiveObservePath(
        TEST_OPENARM_LIVE_PATH_FIXTURE.canStatePath,
      ),
    ).toBe(
      TEST_OPENARM_LIVE_PATH_FIXTURE.canSourcePath,
    );
  });

  it("rejects command paths for public CAN observe", () => {
    expect(() =>
      normalizeOpenArmHfLiveObservePath(
        TEST_OPENARM_LIVE_PATH_FIXTURE.canCommandPath,
      ),
    ).toThrow("cannot connect to command paths");
  });
});
