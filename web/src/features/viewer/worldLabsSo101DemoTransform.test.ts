import { describe, expect, it } from "vitest";
import { resolveWorldLabsSo101DemoTransform } from "./worldLabsSo101DemoTransform";

describe("resolveWorldLabsSo101DemoTransform", () => {
  it("scales and rotates SO101 for the World Labs demo world", () => {
    const transform = resolveWorldLabsSo101DemoTransform({
      activePackageId: "world-labs-third-person-controller-open",
      robotName: "so101_new_calib",
    });

    expect(transform.scale).toBe(10);
    expect(transform.rotationRpy).toEqual([-Math.PI / 2, 0, 0]);
  });

  it("leaves non-demo robots unchanged", () => {
    const transform = resolveWorldLabsSo101DemoTransform({
      activePackageId: "world-labs-third-person-controller-open",
      robotName: "other_robot",
    });

    expect(transform.scale).toBe(1);
    expect(transform.rotationRpy).toEqual([0, 0, 0]);
  });
});
