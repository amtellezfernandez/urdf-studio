/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAssemblyActions } from "@/app/pages/index/useAssemblyActions";
import type { AssemblyRobotInstance } from "@/features/assembly/store/useAssemblyStore";

const { downloadTextDocument, toast } = vi.hoisted(() => ({
  downloadTextDocument: vi.fn(),
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast,
}));

vi.mock("@/app/pages/index/useWorldSceneManager", () => ({
  downloadTextDocument,
}));

type AssemblyActions = ReturnType<typeof useAssemblyActions>;

const createAssemblyRobot = (
  overrides: Partial<AssemblyRobotInstance> = {}
): AssemblyRobotInstance => ({
  instanceId: "robot_a",
  isPrimary: true,
  name: "Robot A",
  urdfPath: "robots/a.urdf",
  ...overrides,
});

const renderAssemblyActions = (
  overrides: Partial<Parameters<typeof useAssemblyActions>[0]> = {}
) => {
  let actions: AssemblyActions | null = null;
  const duplicateAssemblyRobot = vi.fn();

  const Harness = () => {
    actions = useAssemblyActions({
      activeUrdfPath: "robots/a.urdf",
      assemblyHasPhysicalContact: true,
      assemblyPoses: {},
      assemblySelectedRobots: [
        createAssemblyRobot({
          urdfPath: "robots/a.urdf",
        }),
      ],
      clearAssemblyPlacement: vi.fn(),
      clearAssemblySelection: vi.fn(),
      duplicateAssemblyRobot,
      fallbackUrdfFileName: "viz-main.urdf",
      isAssemblyWorkspace: true,
      loadUrdfText: vi.fn(),
      meshFiles: {},
      packageRoots: {},
      setWorkspaceMode: vi.fn(),
      substitutionSession: null,
      urdfDocuments: {
        "robots/a.urdf": "<robot name=\"a\"><link name=\"base\" /></robot>",
      },
      vizUrdfContent: "<robot name=\"a\"><link name=\"base\" /></robot>",
      ...overrides,
    });
    return null;
  };

  const container = document.createElement("div");
  const root = createRoot(container);

  act(() => {
    root.render(createElement(Harness));
  });

  if (!actions) {
    throw new Error("Assembly actions hook did not render.");
  }

  return { actions, duplicateAssemblyRobot, root };
};

describe("useAssemblyActions", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    downloadTextDocument.mockReset();
    toast.error.mockReset();
    toast.success.mockReset();
  });

  it("blocks assembly export when physical contact is missing", () => {
    const { actions, root } = renderAssemblyActions({
      assemblyHasPhysicalContact: false,
      isAssemblyWorkspace: true,
    });

    act(() => {
      actions.handleExportAssemblyUrdf();
    });

    expect(downloadTextDocument).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Assembly export requires at least one physical robot contact."
    );

    act(() => {
      root.unmount();
    });
  });

  it("exports the assembled URDF and reports the robot count", () => {
    const { actions, root } = renderAssemblyActions();

    act(() => {
      actions.handleExportAssemblyUrdf();
    });

    expect(downloadTextDocument).toHaveBeenCalledWith(
      expect.stringContaining("<robot"),
      "assembled_robot.urdf",
      "application/xml"
    );
    expect(toast.success).toHaveBeenCalledWith("Exported assembly URDF (1 robot)");
    expect(toast.error).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("duplicates an assembly robot and reports success", () => {
    const { actions, duplicateAssemblyRobot, root } = renderAssemblyActions();

    act(() => {
      actions.handleDuplicateAssemblyRobot("robot_a");
    });

    expect(duplicateAssemblyRobot).toHaveBeenCalledWith("robot_a");
    expect(toast.success).toHaveBeenCalledWith("Duplicated robot instance in assembly.");

    act(() => {
      root.unmount();
    });
  });
});
