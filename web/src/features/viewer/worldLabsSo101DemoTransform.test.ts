import { describe, expect, it } from "vitest";
import { resolveWorldLabsSo101DemoTransform } from "./worldLabsSo101DemoTransform";

describe("resolveWorldLabsSo101DemoTransform", () => {
  it("scales SO101 for the World Labs demo world without changing the canonical URDF orientation", () => {
    const transform = resolveWorldLabsSo101DemoTransform({
      activePackageId: "world-labs-third-person-controller-open",
      robotName: "so101_new_calib",
    });

    expect(transform.scale).toBe(10);
    expect(transform.rotationRpy).toEqual([0, 0, 0]);
    expect(transform.jointPositions).toMatchObject({
      shoulder_lift: -0.34,
      elbow_flex: -1.32,
      wrist_flex: -0.2,
    });
    expect(transform.splatGroundProbe?.enabled).toBe(true);
    expect(transform.splatGroundProbe?.minConfidence).toBeGreaterThan(0);
  });

  it("leaves non-demo robots unchanged", () => {
    const transform = resolveWorldLabsSo101DemoTransform({
      activePackageId: "world-labs-third-person-controller-open",
      robotName: "other_robot",
    });

    expect(transform.scale).toBe(1);
    expect(transform.rotationRpy).toEqual([0, 0, 0]);
    expect(transform.splatGroundProbe).toBeUndefined();
  });
});
