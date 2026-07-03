/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { Camera } from "@/shared/types/camera";
import { useCameraExportActions } from "@/app/pages/index/useCameraExportActions";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const cameraFixture: Camera = {
  id: "cam-1",
  intrinsics: {
    fov_deg: 70,
    height: 720,
    width: 1280,
  },
  name: "wrist_rgb",
  parent_joint: "wrist_joint",
  pose: {
    rpy: [0, 0, 0],
    xyz: [0.1, 0.2, 0.3],
  },
};

type CameraExportActions = ReturnType<typeof useCameraExportActions>;

const renderCameraExportActions = async ({
  cameras,
  downloadDocument,
}: {
  cameras: Camera[];
  downloadDocument: (content: string, filename: string, mimeType: string) => void;
}) => {
  let latestActions: CameraExportActions | null = null;
  const Probe = () => {
    latestActions = useCameraExportActions({ cameras, downloadDocument });
    return null;
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe));
  });
  if (!latestActions) {
    throw new Error("Camera export actions did not render.");
  }
  return {
    actions: latestActions,
    root,
  };
};

describe("useCameraExportActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("exports camera configs as JSON and YAML", async () => {
    const downloadDocument = vi.fn();
    const { actions, root } = await renderCameraExportActions({
      cameras: [cameraFixture],
      downloadDocument,
    });

    expect(actions.hasCamerasToExport).toBe(true);

    await act(async () => {
      actions.exportCamerasAsJSON();
      actions.exportCamerasAsYAML();
    });

    expect(downloadDocument).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('"wrist_rgb"'),
      "camera-config.json",
      "application/json"
    );
    expect(downloadDocument).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("wrist_rgb"),
      "camera-config.yaml",
      "text/yaml"
    );
    expect(toast.success).toHaveBeenCalledWith("Exported 1 camera(s) to JSON");
    expect(toast.success).toHaveBeenCalledWith("Exported 1 camera(s) to YAML");

    await act(async () => {
      root.unmount();
    });
  });

  it("blocks export when there are no cameras", async () => {
    const downloadDocument = vi.fn();
    const { actions, root } = await renderCameraExportActions({
      cameras: [],
      downloadDocument,
    });

    expect(actions.hasCamerasToExport).toBe(false);

    await act(async () => {
      actions.exportCamerasAsJSON();
    });

    expect(downloadDocument).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("No cameras to export");

    await act(async () => {
      root.unmount();
    });
  });
});
