import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveWorldLabsSo101DemoTransform } from "./worldLabsSo101DemoTransform";

const WORLD_LABS_PACKAGE_PATH = fileURLToPath(
  new URL(
    "../../../public/world-layouts/world-labs-third-person-controller.world-package.json",
    import.meta.url
  )
);

const loadWorldLabsPackageJointPositions = (): Record<string, number> => {
  const manifest = JSON.parse(readFileSync(WORLD_LABS_PACKAGE_PATH, "utf8")) as {
    world_snapshot?: {
      joint_positions?: Record<string, number>;
    };
  };
  return manifest.world_snapshot?.joint_positions ?? {};
};

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

  it("keeps the bundled World Labs package pose aligned with the runtime demo pose", () => {
    const transform = resolveWorldLabsSo101DemoTransform({
      activePackageId: "world-labs-third-person-controller-open",
      robotName: "so101_new_calib",
    });

    expect(loadWorldLabsPackageJointPositions()).toEqual(transform.jointPositions);
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
