import { describe, expect, it } from "vitest";

import {
  resolvePreferredHfSignalField,
  resolveHfSignalFeatureNames,
  resolveHfSignalValuesFromRow,
} from "@/features/layout/sidebar/hfSignalSelection";

describe("resolveHfSignalValuesFromRow", () => {
  it("prefers observation.state when both signal arrays are present", () => {
    const result = resolveHfSignalValuesFromRow({
      action: [9, 8, 7],
      "observation.state": [1, 2, 3],
    });

    expect(result.field).toBe("observation.state");
    expect(result.values).toEqual([1, 2, 3]);
  });

  it("falls back to action when observation.state is missing", () => {
    const result = resolveHfSignalValuesFromRow({
      action: [0.1, 0.2],
    });

    expect(result.field).toBe("action");
    expect(result.values).toEqual([0.1, 0.2]);
  });

  it("falls back to action when observation.state is empty", () => {
    const result = resolveHfSignalValuesFromRow({
      action: [0.1, 0.2],
      "observation.state": [],
    });

    expect(result.field).toBe("action");
    expect(result.values).toEqual([0.1, 0.2]);
  });

  it("keeps observation.state priority even when action is longer", () => {
    const result = resolveHfSignalValuesFromRow({
      action: [0, 1, 2, 3, 4, 5, 6, 7, 8],
      "observation.state": [0, 1, 2, 3, 4, 5],
    });

    expect(result.field).toBe("observation.state");
    expect(result.values).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("uses preferred field when available and non-empty", () => {
    const result = resolveHfSignalValuesFromRow(
      {
        action: [9, 8, 7],
        "observation.state": [1, 2, 3],
      },
      "action"
    );

    expect(result.field).toBe("action");
    expect(result.values).toEqual([9, 8, 7]);
  });
});

describe("resolveHfSignalFeatureNames", () => {
  it("uses preferred field when available", () => {
    const names = resolveHfSignalFeatureNames(
      {
        action: { names: ["action_a", "action_b"] },
        "observation.state": { names: ["state_a", "state_b"] },
      },
      "observation.state"
    );

    expect(names).toEqual(["state_a", "state_b"]);
  });

  it("supports nested Dataset Server feature shape", () => {
    const names = resolveHfSignalFeatureNames(
      {
        action: { feature: { names: ["a0", "a1"] } },
      },
      "observation.state"
    );

    expect(names).toEqual(["a0", "a1"]);
  });

  it("flattens LeRobot-style grouped feature names", () => {
    const names = resolveHfSignalFeatureNames({
      "observation.state": {
        names: {
          motors: ["joint_a", "joint_b"],
        },
      },
    });

    expect(names).toEqual(["joint_a", "joint_b"]);
  });
});

describe("resolvePreferredHfSignalField", () => {
  it("keeps observation.state when joint match quality is tied", () => {
    const field = resolvePreferredHfSignalField({
      sampleRow: {
        action: [1, 2],
        "observation.state": [1, 2, 3, 4, 5],
      },
      features: {
        action: { names: ["shoulder_pan", "shoulder_lift"] },
        "observation.state": {
          names: ["shoulder_pan", "shoulder_lift", "x_mm", "y_mm", "theta"],
        },
      },
      availableJointNames: ["shoulder_pan", "shoulder_lift", "elbow_flex"],
      fallbackDatasetId: "so100",
    });

    expect(field).toBe("observation.state");
  });

  it("switches to action when it has strictly better joint-name match", () => {
    const field = resolvePreferredHfSignalField({
      sampleRow: {
        action: [1, 2, 3],
        "observation.state": [1, 2, 3],
      },
      features: {
        action: { names: ["shoulder_pan", "shoulder_lift", "elbow_flex"] },
        "observation.state": { names: ["cmd_0", "cmd_1", "cmd_2"] },
      },
      availableJointNames: ["shoulder_pan", "shoulder_lift", "elbow_flex"],
      fallbackDatasetId: "so100",
    });

    expect(field).toBe("action");
  });
});
