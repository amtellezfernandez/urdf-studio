import { describe, expect, it } from "vitest";

import { resolveDatasetSignalProfile } from "@/features/dataset";
import { JOINT_VALUE_CONVERSION_PARAMS } from "@/shared/lib/urdfBrowser";
import { materializeHfEpisodeFrames } from "@/features/layout/sidebar/hfEpisodeMaterializationCore";

describe("materializeHfEpisodeFrames", () => {
  it("converts rows, applies limit corrections, and derives replay metadata", () => {
    const signalProfile = resolveDatasetSignalProfile({
      featureNames: ["joint_0.pos"],
    });

    const result = materializeHfEpisodeFrames({
      numericRows: [
        { timestampMs: 0, values: [2] },
        { timestampMs: 1000, values: [0.5] },
      ],
      signalProfile,
      jointMapping: { joint_0: "shoulder" },
      jointOffsets: {},
      jointInversions: {},
      degToRad: false,
      jointLimitsSnapshot: {
        shoulder: {
          type: "revolute",
          lower: -1,
          upper: 1,
          velocity: null,
        },
      },
      limitModesByJoint: {
        shoulder: "clamp",
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.frames).toHaveLength(2);
    expect(result.frames[0]?.jointPositions.shoulder).toBe(1);
    expect(result.frames[1]?.jointPositions.shoulder).toBe(0.5);
    expect(result.fps).toBe(1);
    expect(result.durationSec).toBe(1);
    expect(result.mappedJointNames).toEqual(["shoulder"]);
    expect(result.report).toMatchObject({
      totalViolations: 1,
      totalClamped: 1,
    });
  });

  it("uses the URDF-aware conversion path before limit correction", () => {
    const servoTickNeutral = JOINT_VALUE_CONVERSION_PARAMS.servoTickNeutral;
    const servoTickQuarterTurn =
      JOINT_VALUE_CONVERSION_PARAMS.servoTickFullScale / 2;
    const signalProfile = resolveDatasetSignalProfile({
      featureNames: ["joint_0.pos"],
    });

    const result = materializeHfEpisodeFrames({
      numericRows: [
        { timestampMs: 0, values: [servoTickNeutral] },
        {
          timestampMs: 1000,
          values: [servoTickNeutral + servoTickQuarterTurn],
        },
      ],
      signalProfile,
      jointMapping: { joint_0: "shoulder" },
      jointOffsets: {},
      jointInversions: {},
      degToRad: true,
      jointLimitsSnapshot: {
        shoulder: {
          type: "revolute",
          lower: -Math.PI,
          upper: Math.PI,
          velocity: null,
        },
      },
      limitModesByJoint: {
        shoulder: "report",
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.frames[0]?.jointPositions.shoulder).toBeCloseTo(0, 8);
    expect(result.frames[1]?.jointPositions.shoulder).toBeCloseTo(
      Math.PI / 2,
      8
    );
    expect(result.report).toBeNull();
  });

  it("keeps HF frames in LeRobot visualizer coordinates", () => {
    const signalProfile = resolveDatasetSignalProfile({
      featureNames: ["joint_0.pos"],
    });

    const result = materializeHfEpisodeFrames({
      numericRows: [
        { timestampMs: 0, values: [1.25] },
        { timestampMs: 1000, values: [1.75] },
      ],
      signalProfile,
      jointMapping: { joint_0: "shoulder" },
      jointOffsets: {},
      jointInversions: {},
      degToRad: false,
      jointLimitsSnapshot: {
        shoulder: {
          type: "revolute",
          lower: -Math.PI,
          upper: Math.PI,
          velocity: null,
        },
      },
      limitModesByJoint: {
        shoulder: "report",
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.frames[0]?.jointPositions.shoulder).toBe(1.25);
    expect(result.frames[1]?.jointPositions.shoulder).toBe(1.75);
  });
});
