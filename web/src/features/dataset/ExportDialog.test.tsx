/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExportDialog } from "./ExportDialog";

vi.mock("@/shared/store/useCameraStore", () => ({
  useCameraStore: () => [],
}));

describe("ExportDialog", () => {
  const createBakeMatrix = (x: number): THREE.Matrix4 =>
    new THREE.Matrix4().set(
      1, 0, 0, x,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    );

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("offers USD as a robot export format", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(ExportDialog, {
          isOpen: true,
          onClose: vi.fn(),
          urdfContent: '<robot name="demo"><link name="base"/></robot>',
          meshFiles: {},
          robotName: "demo_robot",
        })
      );
    });

    expect(container.textContent).toContain("USD");
    expect(container.querySelector("#usd")).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
  });

  it("shows staged bake details and keeps export enabled for a conflict-free bake session", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(ExportDialog, {
          isOpen: true,
          onClose: vi.fn(),
          urdfContent: '<robot name="demo"><link name="base"/></robot>',
          meshFiles: {},
          robotName: "demo_robot",
          stagedBakeSession: {
            sourceContent: '<robot name="demo"><link name="base"/></robot>',
            stagedContent: '<robot name="demo"><link name="base"/></robot>',
            preview: {
              success: true,
              content: '<robot name="demo"><link name="base"/></robot>',
              entries: [
                {
                  kind: "visual",
                  linkName: "base_link",
                  index: 0,
                  geometryType: "mesh",
                  meshFilename: "meshes/base.obj",
                  bake: {
                    originalOrigin: { xyz: [1, 0, 0], rpy: [0, 0, 0] },
                    bakedOrigin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
                    bakeMatrix: createBakeMatrix(1),
                  },
                },
              ],
              skipped: [],
            },
          },
        })
      );
    });

    expect(container.textContent).toContain("Bake Export");
    expect(container.textContent).toContain("Mesh-backed entries: 1");
    expect(container.textContent).toContain("Current export will bake supported staged meshes");

    const downloadButton = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent?.includes("Download")
    );
    expect(downloadButton).toBeTruthy();
    expect(downloadButton?.hasAttribute("disabled")).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("blocks export when staged bake plan contains shared-mesh conflicts", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(ExportDialog, {
          isOpen: true,
          onClose: vi.fn(),
          urdfContent: '<robot name="demo"><link name="base"/></robot>',
          meshFiles: {},
          robotName: "demo_robot",
          stagedBakeSession: {
            sourceContent: '<robot name="demo"><link name="base"/></robot>',
            stagedContent: '<robot name="demo"><link name="base"/></robot>',
            preview: {
              success: true,
              content: '<robot name="demo"><link name="base"/></robot>',
              entries: [
                {
                  kind: "visual",
                  linkName: "left_link",
                  index: 0,
                  geometryType: "mesh",
                  meshFilename: "meshes/shared.obj",
                  bake: {
                    originalOrigin: { xyz: [1, 0, 0], rpy: [0, 0, 0] },
                    bakedOrigin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
                    bakeMatrix: createBakeMatrix(1),
                  },
                },
                {
                  kind: "visual",
                  linkName: "right_link",
                  index: 0,
                  geometryType: "mesh",
                  meshFilename: "meshes/shared.obj",
                  bake: {
                    originalOrigin: { xyz: [-1, 0, 0], rpy: [0, 0, 0] },
                    bakedOrigin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
                    bakeMatrix: createBakeMatrix(-1),
                  },
                },
              ],
              skipped: [],
            },
          },
        })
      );
    });

    expect(container.textContent).toContain("Conflicts: meshes/shared.obj");
    expect(container.textContent).toContain("shared mesh files with conflicting transforms");

    const downloadButton = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent?.includes("Download")
    );
    expect(downloadButton).toBeTruthy();
    expect(downloadButton?.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });
});
