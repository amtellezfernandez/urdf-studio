import { describe, expect, it } from "vitest";

import {
  RUNTIME_DEMO_OBJECTS,
  buildRuntimeDemoObjects,
  buildRuntimeDemoTrajectoryObjects,
} from "@/studio_ui/runtimeviz/runtimeDemoScene";
import {
  RUNTIME_DEMO_TRAJECTORY_POINT_COUNT,
  RUNTIME_DEMO_TRAJECTORY_POINT_SIZE_METERS,
} from "@/studio_ui/runtimeviz/runtimeRobotPreviewParams";

describe("runtimeDemoScene", () => {
  it("builds demo objects from the seeded snapshots", () => {
    const objects = buildRuntimeDemoObjects();

    expect(objects).toHaveLength(RUNTIME_DEMO_OBJECTS.length);
    expect(objects.every((object) => object.source === "runtime-demo")).toBe(true);
    expect(objects.every((object) => object.type === "cube")).toBe(true);
  });

  it("does not build a trajectory without an explicit selection", () => {
    const trajectory = buildRuntimeDemoTrajectoryObjects();

    expect(trajectory).toHaveLength(0);
  });

  it("builds trajectory point markers from the robot origin to the selected demo object", () => {
    const trajectory = buildRuntimeDemoTrajectoryObjects({
      fromLabel: null,
      toLabel: "mug",
    });

    expect(trajectory).toHaveLength(RUNTIME_DEMO_TRAJECTORY_POINT_COUNT);
    expect(trajectory.every((object) => object.source === "runtime-trajectory")).toBe(true);
    expect(trajectory.every((object) => object.type === "point")).toBe(true);
    expect(trajectory[0]?.position.x).toBeCloseTo(0);
    expect(trajectory[0]?.position.y).toBeCloseTo(0);
    expect(trajectory[0]?.position.z).toBeCloseTo(
      RUNTIME_DEMO_TRAJECTORY_POINT_SIZE_METERS * 0.5
    );
    expect(trajectory.at(-1)?.position.x).toBeCloseTo(1.9);
    expect(trajectory.at(-1)?.position.y).toBeCloseTo(0.15);
  });

  it("builds trajectory point markers between selected demo objects", () => {
    const trajectory = buildRuntimeDemoTrajectoryObjects({
      fromLabel: "bowl",
      toLabel: "mug",
    });

    expect(trajectory).toHaveLength(RUNTIME_DEMO_TRAJECTORY_POINT_COUNT);
    expect(trajectory[0]?.position.x).toBeCloseTo(1.3);
    expect(trajectory[0]?.position.y).toBeCloseTo(1);
    expect(trajectory.at(-1)?.position.x).toBeCloseTo(1.9);
    expect(trajectory.at(-1)?.position.y).toBeCloseTo(0.15);
  });
});
