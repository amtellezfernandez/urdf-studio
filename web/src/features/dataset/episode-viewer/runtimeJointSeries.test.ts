import { describe, expect, it } from "vitest";

import {
  buildRuntimeJointSeries,
  recordRuntimeJointSeriesFrame,
  resolveRuntimeJointSeriesValue,
} from "@/features/dataset/episode-viewer/runtimeJointSeries";

describe("runtimeJointSeries", () => {
  it("initializes series for requested joints and preserves existing samples", () => {
    const previous = new Map<string, number[]>();
    previous.set("wheel_left_joint", [0.1, Number.NaN, 0.3]);

    const series = buildRuntimeJointSeries({
      jointNames: ["wheel_left_joint", "wheel_right_joint"],
      frameCount: 4,
      previousSeries: previous,
    });

    expect(resolveRuntimeJointSeriesValue({
      series,
      jointName: "wheel_left_joint",
      frameIndex: 0,
    })).toBe(0.1);
    expect(resolveRuntimeJointSeriesValue({
      series,
      jointName: "wheel_left_joint",
      frameIndex: 1,
    })).toBeCloseTo(0.2);
    expect(resolveRuntimeJointSeriesValue({
      series,
      jointName: "wheel_left_joint",
      frameIndex: 2,
    })).toBe(0.3);
    expect(resolveRuntimeJointSeriesValue({
      series,
      jointName: "wheel_right_joint",
      frameIndex: 0,
    })).toBeNull();
  });

  it("records frame samples only for finite values and matching joints", () => {
    const series = buildRuntimeJointSeries({
      jointNames: ["wheel_left_joint", "wheel_right_joint"],
      frameCount: 3,
    });

    const didRecord = recordRuntimeJointSeriesFrame({
      series,
      frameIndex: 1,
      jointNames: ["wheel_left_joint", "wheel_right_joint"],
      jointValues: {
        wheel_left_joint: 1.25,
        wheel_right_joint: Number.NaN,
        elbow_joint: 0.5,
      },
    });

    expect(didRecord).toBe(true);
    expect(resolveRuntimeJointSeriesValue({
      series,
      jointName: "wheel_left_joint",
      frameIndex: 1,
    })).toBe(1.25);
    expect(resolveRuntimeJointSeriesValue({
      series,
      jointName: "wheel_right_joint",
      frameIndex: 1,
    })).toBeNull();
  });

  it("returns false when a sample write does not change series", () => {
    const series = buildRuntimeJointSeries({
      jointNames: ["wheel_left_joint"],
      frameCount: 2,
    });
    recordRuntimeJointSeriesFrame({
      series,
      frameIndex: 0,
      jointNames: ["wheel_left_joint"],
      jointValues: {
        wheel_left_joint: 0.5,
      },
    });

    const didChange = recordRuntimeJointSeriesFrame({
      series,
      frameIndex: 0,
      jointNames: ["wheel_left_joint"],
      jointValues: {
        wheel_left_joint: 0.5,
      },
    });

    expect(didChange).toBe(false);
  });

  it("interpolates and extends sparse runtime samples for continuity", () => {
    const series = buildRuntimeJointSeries({
      jointNames: ["wheel_left_joint"],
      frameCount: 5,
    });
    recordRuntimeJointSeriesFrame({
      series,
      frameIndex: 1,
      jointNames: ["wheel_left_joint"],
      jointValues: {
        wheel_left_joint: 1,
      },
    });
    recordRuntimeJointSeriesFrame({
      series,
      frameIndex: 3,
      jointNames: ["wheel_left_joint"],
      jointValues: {
        wheel_left_joint: 3,
      },
    });

    expect(resolveRuntimeJointSeriesValue({
      series,
      jointName: "wheel_left_joint",
      frameIndex: 0,
    })).toBe(1);
    expect(resolveRuntimeJointSeriesValue({
      series,
      jointName: "wheel_left_joint",
      frameIndex: 2,
    })).toBe(2);
    expect(resolveRuntimeJointSeriesValue({
      series,
      jointName: "wheel_left_joint",
      frameIndex: 4,
    })).toBe(3);
  });
});
