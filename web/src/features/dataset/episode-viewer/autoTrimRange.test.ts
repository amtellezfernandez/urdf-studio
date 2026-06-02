import { describe, expect, it } from "vitest";

import { resolveEpisodeFrameSignalValue } from "@/features/dataset/episode-viewer/basePoseSignals";
import { resolveAutoTrimRange } from "@/features/dataset/episode-viewer/autoTrimRange";

const IDENTITY_QUATERNION = { x: 0, y: 0, z: 0, w: 1 };
const DEFAULT_POSITION_Z = 0;

const buildJointFrames = (jointName: string, values: number[]) =>
  values.map((value) => ({
    jointPositions: {
      [jointName]: value,
    },
  }));

const buildBasePoseFrames = (xPositionsMeters: number[]) =>
  xPositionsMeters.map((x) => ({
    jointPositions: {},
    basePose: {
      position: { x, y: 0, z: DEFAULT_POSITION_Z },
      quaternion: IDENTITY_QUATERNION,
    },
  }));

describe("resolveAutoTrimRange", () => {
  it("detects idle-move-idle segments from joint motion", () => {
    const JOINT_NAME = "shoulder_pan";
    const frames = buildJointFrames(JOINT_NAME, [0, 0, 0, 0.2, 0.4, 0.6, 0.6, 0.6]);

    const result = resolveAutoTrimRange({
      frames,
      signalNames: [JOINT_NAME],
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.start).toBe(2);
    expect(result.end).toBe(6);
  });

  it("returns already_trimmed when movement spans nearly the full episode", () => {
    const JOINT_NAME = "elbow_flex";
    const frames = buildJointFrames(JOINT_NAME, [0, 1, 2, 3, 4, 5, 6]);

    const result = resolveAutoTrimRange({
      frames,
      signalNames: [JOINT_NAME],
    });

    expect(result).toEqual({ status: "already_trimmed" });
  });

  it("detects motion from derived base-pose channels", () => {
    const frames = buildBasePoseFrames([0, 0, 0.001, 0.002, 0.003, 0.003, 0.003]);

    const result = resolveAutoTrimRange({
      frames,
      signalNames: ["x_mm"],
      resolveSignalValue: (frame, signalName) =>
        resolveEpisodeFrameSignalValue(frame, signalName),
    });

    expect(result.status).toBe("ok");
  });

  it("returns movement_too_small for jitter-only episodes", () => {
    const JOINT_NAME = "wrist_roll";
    const frames = buildJointFrames(JOINT_NAME, [0, 0.0001, 0, -0.0001, 0, 0.0001]);

    const result = resolveAutoTrimRange({
      frames,
      signalNames: [JOINT_NAME],
    });

    expect(result).toEqual({ status: "movement_too_small" });
  });
});

