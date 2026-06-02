import { describe, expect, it } from "vitest";
import {
  isLeKiwiRobotAsset,
  isOpenArmRobotAsset,
  resolveRemountPreservedFrameTimestamp,
} from "@/features/viewer/demoRobotPolicy";

describe("demoRobotPolicy", () => {
  it("detects LeKiwi assets from filenames and paths", () => {
    expect(isLeKiwiRobotAsset("lekiwi.urdf")).toBe(true);
    expect(isLeKiwiRobotAsset("/demo/LeKiwi/robot.urdf")).toBe(true);
    expect(isLeKiwiRobotAsset("other_robot.urdf")).toBe(false);
  });

  it("detects OpenArm assets from demo filenames and robot names", () => {
    expect(isOpenArmRobotAsset("openarm.urdf")).toBe(true);
    expect(isOpenArmRobotAsset("/demo/openarm/openarm_description/openarm.urdf")).toBe(true);
    expect(isOpenArmRobotAsset("OpenArm Bimanual")).toBe(true);
    expect(isOpenArmRobotAsset("openarmoire.urdf")).toBe(false);
    expect(isOpenArmRobotAsset("other_robot.urdf")).toBe(false);
  });

  it("preserves the current demo frame timestamp across remounts", () => {
    expect(
      resolveRemountPreservedFrameTimestamp({
        animationFrames: [{ timestamp: 100, joints: {} }, { timestamp: 240, joints: {} }],
        currentFrameIndex: 1,
      })
    ).toBe(240);
  });

  it("preserves remount timestamps outside demo mode as well", () => {
    expect(
      resolveRemountPreservedFrameTimestamp({
        animationFrames: [{ timestamp: 100, joints: {} }],
        currentFrameIndex: 0,
      })
    ).toBe(100);
  });
});
