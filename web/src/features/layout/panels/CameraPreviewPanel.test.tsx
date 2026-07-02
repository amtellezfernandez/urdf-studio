/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CameraPreviewPanel } from "./CameraPreviewPanel";
import { useCameraStore } from "@/shared/store/useCameraStore";
import type { Camera } from "@/shared/types/camera";

vi.mock("@/features/camera/CameraViewportPreview", async () => {
  const React = await import("react");
  return {
    CameraViewportPreview: ({ cameraId }: { cameraId: string | null }) =>
      React.createElement("div", { "data-camera-preview": cameraId ?? "none" }),
  };
});

const createCamera = (index: number): Camera => ({
  id: `camera-${index}`,
  name: `Camera ${index}`,
  parent_joint: `joint_${index}`,
  pose: {
    xyz: [0, 0, 0],
    rpy: [0, 0, 0],
  },
  intrinsics: {
    width: 640,
    height: 480,
    fov_deg: 60,
  },
});

const renderPanel = async (cameras: Camera[]) => {
  const container = document.createElement("div");
  const root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(CameraPreviewPanel, {
        cameras,
        meshFiles: {},
        originalUrdf: "<robot name='test' />",
      })
    );
  });

  return { container, root };
};

const clickModeButton = async (container: HTMLElement, mode: string) => {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === mode
  );
  if (!button) throw new Error(`Missing ${mode} mode button.`);

  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("CameraPreviewPanel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    useCameraStore.setState({ cameras: [], selectedCameraId: null });
  });

  it("starts in all mode with a capped live camera preview grid", async () => {
    const cameras = Array.from({ length: 6 }, (_, index) => createCamera(index + 1));
    const { container, root } = await renderPanel(cameras);

    expect(container.querySelectorAll("[data-camera-preview]")).toHaveLength(4);
    expect(container.textContent).toContain("Camera 1");
    expect(container.textContent).toContain("+2");

    await act(async () => {
      root.unmount();
    });
  });

  it("caps the all-camera live preview grid", async () => {
    const cameras = Array.from({ length: 6 }, (_, index) => createCamera(index + 1));
    const { container, root } = await renderPanel(cameras);

    await clickModeButton(container, "all");

    expect(container.querySelectorAll("[data-camera-preview]")).toHaveLength(4);
    expect(container.textContent).toContain("+2");

    await act(async () => {
      root.unmount();
    });
  });
});
