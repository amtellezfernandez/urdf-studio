import { describe, expect, it } from "vitest";
import {
  buildAssemblyExportModels,
  resolveAssemblyExportFileName,
  resolveAssemblyExportPrimaryRobotId,
} from "@/app/pages/index/assemblyExportDerivations";
import type { AssemblyRobotInstance } from "@/features/assembly/store/useAssemblyStore";

const createAssemblyRobot = (
  overrides: Partial<AssemblyRobotInstance>
): AssemblyRobotInstance => ({
  instanceId: "robot_a",
  isPrimary: false,
  name: "Robot A",
  urdfPath: "robots/a.urdf",
  ...overrides,
});

describe("assemblyExportDerivations", () => {
  it("builds export models from selected robots and preserves primary flags", () => {
    const models = buildAssemblyExportModels({
      activeUrdfPath: "robots/live.urdf",
      assemblySelectedRobots: [
        createAssemblyRobot({
          instanceId: "robot_a",
          isPrimary: false,
          name: "Stored Robot",
          urdfPath: "robots/stored.urdf",
        }),
        createAssemblyRobot({
          instanceId: "robot_b",
          isPrimary: true,
          name: "Live Robot",
          urdfPath: "robots\\live.urdf",
        }),
        createAssemblyRobot({
          instanceId: "robot_c",
          name: "Missing Robot",
          urdfPath: "robots/missing.urdf",
        }),
      ],
      fallbackUrdfFileName: "viz-active.urdf",
      urdfDocuments: {
        "robots/stored.urdf": "<robot name=\"stored\" />",
      },
      vizUrdfContent: "<robot name=\"live\" />",
    });

    expect(models).toEqual([
      {
        id: "robot_a",
        isPrimary: false,
        name: "Stored Robot",
        urdfContent: "<robot name=\"stored\" />",
      },
      {
        id: "robot_b",
        isPrimary: true,
        name: "Live Robot",
        urdfContent: "<robot name=\"live\" />",
      },
    ]);
  });

  it("falls back to the currently loaded URDF when no selected robot has content", () => {
    const models = buildAssemblyExportModels({
      activeUrdfPath: null,
      assemblySelectedRobots: [
        createAssemblyRobot({
          instanceId: "missing",
          isPrimary: true,
          urdfPath: "robots/missing.urdf",
        }),
      ],
      fallbackUrdfFileName: "viz-main.urdf",
      urdfDocuments: {},
      vizUrdfContent: "<robot name=\"primary\" />",
    });

    expect(models).toEqual([
      {
        id: "primary_robot",
        isPrimary: false,
        name: "main.urdf",
        urdfContent: "<robot name=\"primary\" />",
      },
    ]);
  });

  it("returns no export models when no selected or loaded URDF content exists", () => {
    expect(
      buildAssemblyExportModels({
        activeUrdfPath: null,
        assemblySelectedRobots: [],
        fallbackUrdfFileName: "robot.urdf",
        urdfDocuments: {},
        vizUrdfContent: "   ",
      })
    ).toEqual([]);
  });

  it("resolves primary robot ids from the assembly selection", () => {
    expect(
      resolveAssemblyExportPrimaryRobotId([
        createAssemblyRobot({ instanceId: "first" }),
        createAssemblyRobot({ instanceId: "primary", isPrimary: true }),
      ])
    ).toBe("primary");
    expect(
      resolveAssemblyExportPrimaryRobotId([
        createAssemblyRobot({ instanceId: "first" }),
        createAssemblyRobot({ instanceId: "second" }),
      ])
    ).toBe("first");
    expect(resolveAssemblyExportPrimaryRobotId([])).toBeNull();
  });

  it("uses stable export filenames for loaded URDF fallbacks", () => {
    expect(resolveAssemblyExportFileName("viz-demo.urdf")).toBe("demo.urdf");
    expect(resolveAssemblyExportFileName("")).toBe("primary.urdf");
    expect(resolveAssemblyExportFileName(null)).toBe("primary.urdf");
  });
});
