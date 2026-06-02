import { describe, expect, it } from "vitest";
import {
  collectDerivedBasePoseSignalNames,
  resolveDerivedBasePoseSignalValue,
  resolveEpisodeFrameSignalValue,
  writeEpisodeFrameSignalValue,
} from "@/features/dataset/episode-viewer/basePoseSignals";

const HALF_TURN_RADIANS = Math.PI / 2;
const HALF_TURN_QUATERNION_Z = Math.sin(HALF_TURN_RADIANS / 2);
const HALF_TURN_QUATERNION_W = Math.cos(HALF_TURN_RADIANS / 2);
const METER_SAMPLE = 1.25;
const NEGATIVE_METER_SAMPLE = -0.4;
const MILLIMETER_SAMPLE = 1250;
const NEGATIVE_MILLIMETER_SAMPLE = -400;
const ASSERTION_PRECISION_DECIMALS = 8;
const DIRECT_THETA_SAMPLE = 0.123;
const NORMALIZED_SCALE = 10;
const UPDATED_THETA_SAMPLE = Math.PI / 3;
const UPDATED_X_MM_SAMPLE = 2400;
const ROLL_COMPONENT_SAMPLE = 0.2;
const PITCH_COMPONENT_SAMPLE = -0.15;
const NO_BASE_POSE_FRAME = {
  basePose: null,
};

describe("basePoseSignals", () => {
  it("derives x_mm, y_mm, and theta from base pose", () => {
    const frame = {
      basePose: {
        position: { x: METER_SAMPLE, y: NEGATIVE_METER_SAMPLE, z: 0 },
        quaternion: {
          x: 0,
          y: 0,
          z: HALF_TURN_QUATERNION_Z,
          w: HALF_TURN_QUATERNION_W,
        },
      },
    };

    expect(resolveDerivedBasePoseSignalValue(frame, "x_mm")).toBeCloseTo(
      MILLIMETER_SAMPLE,
      ASSERTION_PRECISION_DECIMALS
    );
    expect(resolveDerivedBasePoseSignalValue(frame, "y_mm")).toBeCloseTo(
      NEGATIVE_MILLIMETER_SAMPLE,
      ASSERTION_PRECISION_DECIMALS
    );
    expect(resolveDerivedBasePoseSignalValue(frame, "theta")).toBeCloseTo(
      HALF_TURN_RADIANS,
      ASSERTION_PRECISION_DECIMALS
    );
  });

  it("prefers direct joint values over derived values", () => {
    const frame = {
      jointPositions: {
        theta: DIRECT_THETA_SAMPLE,
      },
      basePose: {
        position: { x: 0, y: 0, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
      },
    };

    expect(resolveEpisodeFrameSignalValue(frame, "theta")).toBeCloseTo(
      DIRECT_THETA_SAMPLE,
      ASSERTION_PRECISION_DECIMALS
    );
  });

  it("normalizes quaternion magnitude before deriving theta", () => {
    const frame = {
      basePose: {
        position: { x: 0, y: 0, z: 0 },
        quaternion: {
          x: 0,
          y: 0,
          z: HALF_TURN_QUATERNION_Z * NORMALIZED_SCALE,
          w: HALF_TURN_QUATERNION_W * NORMALIZED_SCALE,
        },
      },
    };

    expect(resolveDerivedBasePoseSignalValue(frame, "theta")).toBeCloseTo(
      HALF_TURN_RADIANS,
      ASSERTION_PRECISION_DECIMALS
    );
  });

  it("returns null when base pose data is unavailable", () => {
    expect(resolveDerivedBasePoseSignalValue(NO_BASE_POSE_FRAME, "x_mm")).toBeNull();
    expect(resolveDerivedBasePoseSignalValue(NO_BASE_POSE_FRAME, "theta")).toBeNull();
  });

  it("returns null for malformed base pose values", () => {
    const malformedFrame = {
      basePose: {
        position: null,
        quaternion: { x: 0, y: 0, z: 0, w: 0 },
      },
    };

    expect(resolveDerivedBasePoseSignalValue(malformedFrame, "x_mm")).toBeNull();
    expect(resolveDerivedBasePoseSignalValue(malformedFrame, "theta")).toBeNull();
  });

  it("collects derived base-pose signal names only when base pose is present", () => {
    const names = collectDerivedBasePoseSignalNames([
      {
        basePose: {
          position: { x: 0.1, y: 0.2, z: 0 },
          quaternion: { x: 0, y: 0, z: 0, w: 1 },
        },
      },
      {
        basePose: null,
      },
    ]);

    expect(names.sort()).toEqual(["theta", "x_mm", "y_mm"]);
  });

  it("writes derived base pose signals back into basePose and clears shadow joint values", () => {
    const frame = {
      jointPositions: {
        theta: DIRECT_THETA_SAMPLE,
      },
      basePose: {
        position: { x: METER_SAMPLE, y: NEGATIVE_METER_SAMPLE, z: 0.3 },
        quaternion: {
          x: ROLL_COMPONENT_SAMPLE,
          y: PITCH_COMPONENT_SAMPLE,
          z: 0,
          w: 1,
        },
      },
    };

    const thetaUpdatedFrame = writeEpisodeFrameSignalValue(
      frame,
      "theta",
      UPDATED_THETA_SAMPLE
    );
    expect(thetaUpdatedFrame.jointPositions.theta).toBeUndefined();
    expect(resolveEpisodeFrameSignalValue(thetaUpdatedFrame, "theta")).toBeCloseTo(
      UPDATED_THETA_SAMPLE,
      ASSERTION_PRECISION_DECIMALS
    );

    const xUpdatedFrame = writeEpisodeFrameSignalValue(
      thetaUpdatedFrame,
      "x_mm",
      UPDATED_X_MM_SAMPLE
    );
    expect(resolveEpisodeFrameSignalValue(xUpdatedFrame, "x_mm")).toBeCloseTo(
      UPDATED_X_MM_SAMPLE,
      ASSERTION_PRECISION_DECIMALS
    );
    expect(xUpdatedFrame.basePose?.position.y).toBeCloseTo(
      NEGATIVE_METER_SAMPLE,
      ASSERTION_PRECISION_DECIMALS
    );
    expect(xUpdatedFrame.basePose?.position.z).toBeCloseTo(0.3, ASSERTION_PRECISION_DECIMALS);
  });

  it("creates a base pose when editing a derived channel on a frame without one", () => {
    const frame = {
      jointPositions: {},
      basePose: null,
    };

    const updated = writeEpisodeFrameSignalValue(frame, "y_mm", NEGATIVE_MILLIMETER_SAMPLE);

    expect(updated.basePose?.position.x).toBe(0);
    expect(updated.basePose?.position.y).toBeCloseTo(
      NEGATIVE_METER_SAMPLE,
      ASSERTION_PRECISION_DECIMALS
    );
    expect(updated.basePose?.quaternion.w).toBe(1);
  });
});
