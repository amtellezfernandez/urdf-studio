import { describe, expect, it, vi } from "vitest";
import type {
  SerializableWorldObject,
  WorldSceneRegistryEnvelope,
} from "@/features/world-share/worldScenePackageTypes";
import type { WorkspaceTransferTargetDescriptor } from "@/features/world-share/workspaceTransferApi";
import {
  assertWorkspacePackageCarriesSceneObjects,
  buildWorkspaceTransferTargetState,
  canLaunchWorkspaceTransferTarget,
  formatSceneTransferSummary,
  resolveWorkspaceTransferTargetStatusLabel,
} from "@/app/pages/index/workspaceTransferLauncherDerivations";

const createTargetDescriptor = (
  overrides: Partial<WorkspaceTransferTargetDescriptor> = {},
): WorkspaceTransferTargetDescriptor => ({
  targetId: "pybullet",
  label: "PyBullet",
  targetKind: "physics_simulator",
  capabilities: {
    workspaceTarget: true,
    motionValidation: false,
    layoutRoundTrip: false,
  },
  transferPolicy: {
    robotAssetFormat: "urdf",
    sceneAssetFormat: "urdf",
    frameConvention: "ros-rep-103",
    transferStrategy: "direct",
  },
  ...overrides,
});

const createWorldPackage = (
  objects: SerializableWorldObject[] = [],
): WorldSceneRegistryEnvelope => ({
  package_id: "demo-world",
  version: "1.0.0",
  description: "Demo World",
  artifacts: [],
  provenance: {},
  world: {
    name: "Demo World",
    urdf_xml: "<robot name=\"demo\"><link name=\"base\"/></robot>",
    joint_positions: {},
    cameras: [],
    objects,
    scenario_time_ms: 0,
    scenario_duration_ms: 0,
    environment: {
      frame_convention: "ros-rep-103",
    },
  },
});

describe("workspaceTransferLauncherDerivations", () => {
  it("formats compact scene summaries", () => {
    expect(formatSceneTransferSummary(13, 2)).toBe("13 obj · 2 cam");
  });

  it("keeps degraded available targets openable and marked for attention", () => {
    const descriptor = createTargetDescriptor();
    const status = {
      targetId: descriptor.targetId,
      available: true,
      status: "ready, display degraded: software OpenGL",
      dependencies: [],
    };
    const targetState = buildWorkspaceTransferTargetState({
      descriptor,
      lastOpenedTargetId: null,
      loadingTargetId: descriptor.targetId,
      onCancelTarget: vi.fn(),
      onOpenTarget: vi.fn(),
      sceneSummary: formatSceneTransferSummary(3, 1),
      status,
    });

    expect(canLaunchWorkspaceTransferTarget(descriptor, status)).toBe(true);
    expect(targetState.canOpen).toBe(true);
    expect(targetState.isBusy).toBe(true);
    expect(targetState.needsAttention).toBe(true);
    expect(targetState.detail).toBe("URDF simulation workspace · 3 obj · 1 cam");
    expect(targetState.statusLabel).toBe("ready, display degraded: software OpenGL");
  });

  it("marks available targets with missing optional dependencies for attention", () => {
    const descriptor = createTargetDescriptor();
    const status = {
      targetId: descriptor.targetId,
      available: true,
      status: "ready",
      dependencies: [
        {
          name: "warp",
          available: false,
          required: false,
          scope: "validation" as const,
        },
      ],
    };
    const targetState = buildWorkspaceTransferTargetState({
      descriptor,
      lastOpenedTargetId: null,
      loadingTargetId: null,
      onCancelTarget: vi.fn(),
      onOpenTarget: vi.fn(),
      sceneSummary: formatSceneTransferSummary(3, 1),
      status,
    });

    expect(canLaunchWorkspaceTransferTarget(descriptor, status)).toBe(true);
    expect(targetState.canOpen).toBe(true);
    expect(targetState.needsAttention).toBe(true);
    expect(targetState.statusLabel).toBe("ready");
  });

  it("blocks workspace targets until an available status is confirmed", () => {
    const descriptor = createTargetDescriptor();
    const targetState = buildWorkspaceTransferTargetState({
      descriptor,
      lastOpenedTargetId: null,
      loadingTargetId: null,
      onCancelTarget: vi.fn(),
      onOpenTarget: vi.fn(),
      sceneSummary: formatSceneTransferSummary(3, 1),
    });

    expect(canLaunchWorkspaceTransferTarget(descriptor)).toBe(false);
    expect(targetState.canOpen).toBe(false);
    expect(targetState.statusLabel).toBe("checking");
    expect(targetState.disabledLabel).toBe("PyBullet: checking availability");
    expect(targetState.detail).toBe("URDF checking · 3 obj · 1 cam");
  });

  it("labels unavailable and planned targets distinctly", () => {
    const unavailableDescriptor = createTargetDescriptor();
    const unavailableStatus = {
      targetId: unavailableDescriptor.targetId,
      available: false,
      status: "missing display",
      dependencies: [],
    };
    const plannedDescriptor = createTargetDescriptor({
      capabilities: {
        workspaceTarget: false,
        motionValidation: false,
        layoutRoundTrip: false,
      },
    });

    expect(resolveWorkspaceTransferTargetStatusLabel(unavailableDescriptor, unavailableStatus)).toBe(
      "missing display",
    );
    expect(resolveWorkspaceTransferTargetStatusLabel(plannedDescriptor)).toBe("planned");
    expect(canLaunchWorkspaceTransferTarget(unavailableDescriptor, unavailableStatus)).toBe(false);
    expect(canLaunchWorkspaceTransferTarget(plannedDescriptor)).toBe(false);
  });

  it("blocks empty scene packages when Studio has objects", () => {
    expect(() => assertWorkspacePackageCarriesSceneObjects(createWorldPackage(), 2)).toThrow(
      "Workspace transfer blocked: Studio has world objects, but the generated scene package is empty.",
    );
  });

  it("accepts empty scene packages when Studio has no objects", () => {
    expect(() => assertWorkspacePackageCarriesSceneObjects(createWorldPackage(), 0)).not.toThrow();
  });
});
