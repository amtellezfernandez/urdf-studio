/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CameraEditorPanel } from "@/features/layout/CameraEditorPanel";
import { useCameraStore } from "@/shared/store/useCameraStore";
import type { Camera } from "@/shared/types/camera";

const {
  buildCameraTransformDebugReport,
  remapCameraPoseBetweenParentJoints,
} = vi.hoisted(() => ({
  buildCameraTransformDebugReport: vi.fn(),
  remapCameraPoseBetweenParentJoints: vi.fn(),
}));

vi.mock("@/shared/ui/select", async () => {
  const React = await import("react");

  return {
    Select: ({
      children,
      onValueChange,
      value,
    }: {
      children: React.ReactNode;
      onValueChange: (value: string) => void;
      value: string;
    }) =>
      React.createElement(
        "div",
        { "data-select-value": value },
        React.createElement(
          "button",
          {
            onClick: () => onValueChange("joint_next"),
            type: "button",
          },
          `select ${value}`
        ),
        children
      ),
    SelectContent: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", null, children),
    SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) =>
      React.createElement("div", { "data-select-item": value }, children),
    SelectTrigger: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", null, children),
    SelectValue: () => React.createElement("span", null, "value"),
  };
});

vi.mock("@/shared/ui/blender-panel", async () => {
  const React = await import("react");

  return {
    BlenderPanel: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", { "data-blender-panel": "true" }, children),
    BlenderPropertyRow: ({
      children,
      label,
    }: {
      children: React.ReactNode;
      label: React.ReactNode;
    }) =>
      React.createElement(
        "div",
        { "data-property-row": String(label) },
        React.createElement("span", null, label),
        children
      ),
  };
});

vi.mock("@/features/layout/sidebarNumberField", async () => {
  const React = await import("react");

  return {
    LabeledNumberField: ({
      label,
      onValueChange,
      value,
    }: {
      label: string;
      onValueChange: (value: number) => void;
      value: number;
    }) =>
      React.createElement(
        "button",
        {
          "data-number-field": label,
          onClick: () => onValueChange(value + 1),
          type: "button",
        },
        `${label}:${value}`
      ),
  };
});

vi.mock("@/features/camera", async () => ({
  buildCameraTransformDebugReport,
  remapCameraPoseBetweenParentJoints,
}));

const createCamera = (): Camera => ({
  id: "camera-1",
  name: "Wrist Cam",
  parent_joint: "joint_wrist",
  pose: {
    xyz: [0, 0, 0],
    rpy: [0, 0, 0],
  },
  intrinsics: {
    width: 640,
    height: 480,
    fov_deg: 60,
    fx: 320,
    fy: 320,
    cx: 320,
    cy: 240,
  },
});

const renderCameraEditor = async () => {
  const container = document.createElement("div");
  const root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(CameraEditorPanel, {
        availableJoints: ["joint_wrist", "joint_next"],
        cameraId: "camera-1",
        urdfSensors: [],
      })
    );
  });

  return { container, root };
};

describe("CameraEditorPanel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    buildCameraTransformDebugReport.mockReset();
    remapCameraPoseBetweenParentJoints.mockReset();
    remapCameraPoseBetweenParentJoints.mockReturnValue({
      xyz: [1, 2, 3],
      rpy: [0.1, 0.2, 0.3],
    });
    useCameraStore.setState({
      cameras: [createCamera()],
      selectedCameraId: "camera-1",
    });
  });

  it("returns null when the camera does not exist", async () => {
    useCameraStore.setState({ cameras: [], selectedCameraId: null });
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(CameraEditorPanel, {
          availableJoints: [],
          cameraId: "missing",
        })
      );
    });

    expect(container.textContent).toBe("");

    await act(async () => {
      root.unmount();
    });
  });

  it("updates the parent joint through the remap helper", async () => {
    const { container, root } = await renderCameraEditor();

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "select joint_wrist")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(remapCameraPoseBetweenParentJoints).toHaveBeenCalledWith(
      null,
      "joint_wrist",
      "joint_next",
      createCamera().pose
    );
    expect(useCameraStore.getState().cameras[0]?.parent_joint).toBe("joint_next");
    expect(useCameraStore.getState().cameras[0]?.pose).toEqual({
      xyz: [1, 2, 3],
      rpy: [0.1, 0.2, 0.3],
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("updates numeric pose and intrinsics fields through store actions", async () => {
    const { container, root } = await renderCameraEditor();

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.getAttribute("data-number-field") === "X (m)")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.getAttribute("data-number-field") === "W")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const updatedCamera = useCameraStore.getState().cameras[0];
    expect(updatedCamera?.pose.xyz[0]).toBe(1);
    expect(updatedCamera?.intrinsics.width).toBe(641);

    await act(async () => {
      root.unmount();
    });
  });

  it("dumps debug output, applies sensor pose, and deletes the camera", async () => {
    buildCameraTransformDebugReport.mockReturnValue({
      angle_delta_deg: 2,
      position_delta_m: 0.1,
      sensor_pose_joint_frame: {
        xyz: [9, 8, 7],
        rpy: [0.4, 0.5, 0.6],
      },
      within_tolerance: false,
    });
    const { container, root } = await renderCameraEditor();

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Dump transform")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Alignment: Mismatch");
    expect(buildCameraTransformDebugReport).toHaveBeenCalledOnce();

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Apply sensor pose")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useCameraStore.getState().cameras[0]?.pose).toEqual({
      xyz: [9, 8, 7],
      rpy: [0.4, 0.5, 0.6],
    });

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Delete camera"))
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useCameraStore.getState().cameras).toHaveLength(0);
    expect(useCameraStore.getState().selectedCameraId).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
