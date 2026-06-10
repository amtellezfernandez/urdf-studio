/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoadIssuesPanel } from "./LoadIssuesPanel";

const getText = (node: ParentNode) => node.textContent ?? "";

describe("LoadIssuesPanel", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("shows mesh fix action for absolute file mesh refs", async () => {
    const onFixMeshPaths = vi.fn();
    const onOpenUrdfEditor = vi.fn();
    const onClose = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(LoadIssuesPanel, {
          open: true,
          urdfError: null,
          unmatchedURDFRefs: [],
          absoluteFileMeshRefs: ["file:///tmp/mesh.stl"],
          missingPackageRefs: [],
          onFixMeshPaths,
          onOpenUrdfEditor,
          onClose,
        })
      );
    });

    const button = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent?.trim() === "Correct Mesh Paths"
    );
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onFixMeshPaths).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("stays focused on load integrity when mesh references need attention", async () => {
    const onFixMeshPaths = vi.fn();
    const onOpenUrdfEditor = vi.fn();
    const onClose = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(LoadIssuesPanel, {
          open: true,
          urdfError: null,
          unmatchedURDFRefs: ["meshes/base.stl"],
          absoluteFileMeshRefs: [],
          missingPackageRefs: [],
          onFixMeshPaths,
          onOpenUrdfEditor,
          onClose,
        })
      );
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    const meshButton = buttons.find((node) => node.textContent?.trim() === "Correct Mesh Paths");
    expect(meshButton).toBeTruthy();
    expect(getText(container)).toContain("Load needs attention");
    expect(getText(container)).toContain("Mesh refs need attention");
    expect(getText(container)).not.toContain("Frame orientation");
    expect(getText(container)).not.toContain("Align Orientation");

    await act(async () => {
      meshButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onFixMeshPaths).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("does not render simulation-prep summaries or actions", async () => {
    const onFixMeshPaths = vi.fn();
    const onOpenUrdfEditor = vi.fn();
    const onClose = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(LoadIssuesPanel, {
          open: true,
          urdfError: null,
          unmatchedURDFRefs: [],
          absoluteFileMeshRefs: [],
          missingPackageRefs: [],
          onFixMeshPaths,
          onOpenUrdfEditor,
          onClose,
        })
      );
    });

    expect(getText(container)).not.toContain("Inertial synthesis draft staged");
    expect(getText(container)).not.toContain("Voxel-derived links:");
    expect(getText(container)).not.toContain("Total synthesized mass:");
    expect(getText(container)).not.toContain("Align Orientation");
    expect(getText(container)).not.toContain("Open Simulation Prep");

    await act(async () => {
      root.unmount();
    });
  });

  it("redirects to simulation prep when load is clean but simulation prep still needs attention", async () => {
    const onFixMeshPaths = vi.fn();
    const onOpenUrdfEditor = vi.fn();
    const onOpenSimulationPrep = vi.fn();
    const onClose = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(LoadIssuesPanel, {
          open: true,
          urdfError: null,
          unmatchedURDFRefs: [],
          absoluteFileMeshRefs: [],
          missingPackageRefs: [],
          simulationPrepStatusLabel: "Physics Warning",
          simulationPrepNeedsAttention: true,
          onFixMeshPaths,
          onOpenSimulationPrep,
          onOpenUrdfEditor,
          onClose,
        })
      );
    });

    expect(getText(container)).not.toContain("Ready");
    expect(getText(container)).toContain("Valid");
    expect(getText(container)).toContain("Mesh refs OK");
    expect(getText(container)).toContain("Simulation Prep needs attention: Physics Warning");

    const openSimulationPrepButton = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent?.trim() === "Open"
    );
    expect(openSimulationPrepButton).toBeTruthy();

    await act(async () => {
      openSimulationPrepButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOpenSimulationPrep).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });
});
