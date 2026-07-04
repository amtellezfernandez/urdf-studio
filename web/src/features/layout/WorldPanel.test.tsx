/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorldPanel } from "@/features/layout/WorldPanel";
import { useObjectStore } from "@/features/objects";
import { useCameraStore } from "@/shared/store/useCameraStore";
import type { Camera } from "@/shared/types/camera";

vi.mock("@/features/viewer/trackingTarget", async () => {
  const THREE = await import("three");

  return {
    resolveTrackingReference: ({
      trackedName,
      endEffectorLink,
    }: {
      trackedName?: string | null;
      endEffectorLink?: string | null;
    }) => {
      if (trackedName) {
        return {
          name: trackedName,
          kind: "joint",
          label: `Joint: ${trackedName}`,
          position: new THREE.Vector3(0, 0, 0),
        };
      }

      if (endEffectorLink) {
        return {
          name: endEffectorLink,
          kind: "end-effector",
          label: `End-effector: ${endEffectorLink}`,
          position: new THREE.Vector3(1, 0, 0),
        };
      }

      return null;
    },
  };
});

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
  },
});

const createWorldObject = () => ({
  id: "object-1",
  type: "cube" as const,
  position: new THREE.Vector3(0.1, 0, 0),
  size: new THREE.Vector3(1, 1, 1),
  color: "#ffffff",
  trackedJointName: "joint_wrist",
  isIkTarget: false,
  source: "user" as const,
});

const renderWorldPanel = async (props: Parameters<typeof WorldPanel>[0]) => {
  const container = document.createElement("div");
  const root = createRoot(container);

  await act(async () => {
    root.render(createElement(WorldPanel, props));
  });

  return { container, root };
};

const clickButtonByLabel = async (container: HTMLElement, label: string) => {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.getAttribute("aria-label") === label
  );
  if (!button) {
    throw new Error(`Missing button: ${label}`);
  }

  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const clickElement = async (target: Element | null, label: string) => {
  if (!target) {
    throw new Error(`Missing element: ${label}`);
  }

  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("WorldPanel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;

    useObjectStore.setState({
      objects: [],
      selectedObjectId: null,
    });
    useCameraStore.setState({
      cameras: [],
      selectedCameraId: null,
    });
  });

  it("renders the empty world state", async () => {
    const { container, root } = await renderWorldPanel({});

    expect(container.textContent).toContain("No world objects yet. Use Create -> Objects.");

    await act(async () => {
      root.unmount();
    });
  });

  it("selects cameras and clears joint and link selections", async () => {
    const onJointSelect = vi.fn();
    const setSelectedLink = vi.fn();

    useObjectStore.setState({
      selectedObjectId: "object-1",
    });
    useCameraStore.setState({
      cameras: [createCamera()],
      selectedCameraId: null,
    });

    const { container, root } = await renderWorldPanel({
      onJointSelect,
      setSelectedLink,
    });

    await clickElement(
      container.querySelector('[data-world-camera-id="camera-1"]'),
      "camera row"
    );

    expect(useCameraStore.getState().selectedCameraId).toBe("camera-1");
    expect(useObjectStore.getState().selectedObjectId).toBeNull();
    expect(onJointSelect).toHaveBeenCalledWith(null);
    expect(setSelectedLink).toHaveBeenCalledWith(null);

    await act(async () => {
      root.unmount();
    });
  });

  it("selects objects and toggles visibility", async () => {
    const onJointSelect = vi.fn();
    const setSelectedLink = vi.fn();

    useObjectStore.setState({
      objects: [createWorldObject()],
      selectedObjectId: null,
    });
    useCameraStore.setState({
      selectedCameraId: "camera-1",
    });

    const { container, root } = await renderWorldPanel({
      endEffectorLink: "tool0",
      onJointSelect,
      setSelectedLink,
    });

    expect(container.textContent).toContain("0.100 m");
    expect(container.textContent).toContain("Joint: joint_wrist");

    await clickElement(
      container.querySelector('[data-world-object-id="object-1"]'),
      "object row"
    );

    expect(useObjectStore.getState().selectedObjectId).toBe("object-1");
    expect(useCameraStore.getState().selectedCameraId).toBeNull();
    expect(onJointSelect).toHaveBeenCalledWith(null);
    expect(setSelectedLink).toHaveBeenCalledWith(null);

    await clickButtonByLabel(container, "Hide object");

    expect(useObjectStore.getState().objects[0]?.isHidden).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });
});
