import { describe, expect, it } from "vitest";
import type { RepeatedInertiaSymmetryChain } from "@/features/layout/page/repeatedInertiaSymmetry";

import {
  createDefaultInertialVisualizationSettings,
  createEmptyRobotMirrorVisualizationState,
  buildRepeatedInertiaSymmetryFamilyOutcomeKey,
  buildRepeatedInertiaSymmetryFamilyKey,
  buildRobotMirrorSymmetryVisualizationScopeKey,
  buildRepeatedInertiaVisualizationScopeKey,
  collectRobotMirrorSymmetryVisualizationLinkNames,
  collectRepeatedInertiaSymmetryFamilyLinkNames,
  collectRepeatedInertiaSymmetryScopedLinkNames,
  buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey,
  buildRepeatedInertiaSymmetryVisualizationScopeKey,
  mergeDisplayedRepeatedInertiaSymmetryChains,
  resolveSimulationPrepVisualizationScope,
  resolveRobotMirrorVisualizationState,
  resolveActiveSimulationPrepRobotMirrorVisualization,
  resolveActiveSimulationPrepSymmetryVisualization,
  SIMULATION_PREP_PSD_REGULARIZE_SCOPE_KEY,
  SIMULATION_PREP_VOXEL_RECOVERY_SCOPE_KEY,
  syncSimulationPrepInertiaVisualizationScope,
  withSimulationPrepInertiaVisualization,
} from "@/features/layout/page/simulationPrepViewerState";

describe("withSimulationPrepInertiaVisualization", () => {
  it("exports stable scope keys for simulation prep overlay focus", () => {
    expect(buildRepeatedInertiaVisualizationScopeKey("collision:wheel.stl:1 1 1")).toBe(
      "repeated:collision:wheel.stl:1 1 1"
    );
    expect(
      buildRepeatedInertiaSymmetryVisualizationScopeKey({
        symmetryRootLinkName: "base_link",
        outlierBranchRootLinkName: "rear_branch",
      })
    ).toBe("symmetry:base_link:rear_branch");
    expect(
      buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey({
        symmetryRootLinkName: "base_link",
        outlierBranchRootLinkName: "rear_branch",
        siblingBranchRootLinkNames: ["left_branch", "right_branch"],
      } as RepeatedInertiaSymmetryChain)
    ).toBe("symmetry-family:base_link:left_branch,rear_branch,right_branch");
    expect(
      buildRepeatedInertiaSymmetryFamilyOutcomeKey({
        symmetryRootLinkName: "base_link",
        outlierBranchRootLinkName: "rear_branch",
        siblingBranchRootLinkNames: ["left_branch", "right_branch"],
      } as RepeatedInertiaSymmetryChain)
    ).toBe("symmetry-outcome:base_link:left_branch,rear_branch,right_branch");
    expect(
      buildRobotMirrorSymmetryVisualizationScopeKey({
        planeLabel: "xz",
      } as const)
    ).toBe("robot-mirror:xz");
    expect(SIMULATION_PREP_VOXEL_RECOVERY_SCOPE_KEY).toBe("physics:voxel-recovery");
    expect(SIMULATION_PREP_PSD_REGULARIZE_SCOPE_KEY).toBe("physics:psd-regularize");
  });

  it("forces inertia boxes on without changing the other inertial toggles", () => {
    expect(
      withSimulationPrepInertiaVisualization({
        showGlobalCOM: false,
        showLinkCOM: true,
        showInertia: false,
        showReferenceGeometry: false,
        scopedLinkNames: ["stale_link"],
      })
    ).toEqual({
      showGlobalCOM: false,
      showLinkCOM: true,
      showInertia: true,
      showReferenceGeometry: true,
      scopedLinkNames: null,
    });
  });

  it("provides a stable hidden-by-default visualization baseline", () => {
    expect(createDefaultInertialVisualizationSettings()).toEqual({
      showGlobalCOM: true,
      showLinkCOM: false,
      showInertia: false,
      showReferenceGeometry: false,
      scopedLinkNames: null,
    });
  });

  it("provides an empty mirror visualization baseline", () => {
    expect(createEmptyRobotMirrorVisualizationState()).toEqual({
      deemphasizedVisualizationLinkNames: [],
      visualizationLinkNames: [],
    });
  });

  it("restores reference geometry when inertia was already enabled", () => {
    expect(
      withSimulationPrepInertiaVisualization({
        showGlobalCOM: true,
        showLinkCOM: false,
        showInertia: true,
        showReferenceGeometry: false,
        scopedLinkNames: null,
      })
    ).toEqual({
      showGlobalCOM: true,
      showLinkCOM: false,
      showInertia: true,
      showReferenceGeometry: true,
      scopedLinkNames: null,
    });
  });

  it("normalizes the focused repeated-part links when a scoped overlay is requested", () => {
    expect(
      withSimulationPrepInertiaVisualization(
        {
          showGlobalCOM: false,
          showLinkCOM: false,
          showInertia: false,
          showReferenceGeometry: false,
          scopedLinkNames: null,
        },
        ["wheel_right", "wheel_left", "wheel_right", " "]
      )
    ).toEqual({
      showGlobalCOM: false,
      showLinkCOM: false,
      showInertia: true,
      showReferenceGeometry: true,
      scopedLinkNames: ["wheel_left", "wheel_right"],
    });
  });

  it("preserves the previous mirror visualization while a refresh is pending", () => {
    expect(
      resolveRobotMirrorVisualizationState({
        previousState: {
          deemphasizedVisualizationLinkNames: ["centered_link"],
          visualizationLinkNames: ["active_link", "centered_link"],
        },
      })
    ).toEqual({
      deemphasizedVisualizationLinkNames: ["centered_link"],
      visualizationLinkNames: ["active_link", "centered_link"],
    });
  });

  it("replaces the mirror visualization once a refreshed selection resolves", () => {
    expect(
      resolveRobotMirrorVisualizationState({
        previousState: createEmptyRobotMirrorVisualizationState(),
        nextSelection: {
          deemphasizedVisualizationLinkNames: ["aligned_link"],
          visualizationLinkNames: ["aligned_link", "candidate_link"],
        } as Parameters<typeof resolveRobotMirrorVisualizationState>[0]["nextSelection"],
      })
    ).toEqual({
      deemphasizedVisualizationLinkNames: ["aligned_link"],
      visualizationLinkNames: ["aligned_link", "candidate_link"],
    });
  });

  it("clears the mirror visualization only when reset is requested", () => {
    expect(
      resolveRobotMirrorVisualizationState({
        previousState: {
          deemphasizedVisualizationLinkNames: ["aligned_link"],
          visualizationLinkNames: ["aligned_link", "candidate_link"],
        },
        reset: true,
      })
    ).toEqual(createEmptyRobotMirrorVisualizationState());
  });

  it("updates scoped links without forcing inertia visible", () => {
    expect(
      syncSimulationPrepInertiaVisualizationScope(
        {
          showGlobalCOM: true,
          showLinkCOM: false,
          showInertia: false,
          showReferenceGeometry: false,
          scopedLinkNames: ["stale_link"],
        },
        ["wheel_right", "wheel_left", "wheel_right"]
      )
    ).toEqual({
      showGlobalCOM: true,
      showLinkCOM: false,
      showInertia: false,
      showReferenceGeometry: false,
      scopedLinkNames: ["wheel_left", "wheel_right"],
    });
  });

  it("resolves the active symmetry visualization from the stable scope key", () => {
    const leftRightChain = {
      symmetryRootLinkName: "base_link",
      outlierBranchRootLinkName: "rear_branch",
      siblingBranchRootLinkNames: ["left_branch", "right_branch"],
    } as unknown as RepeatedInertiaSymmetryChain;
    const ignoredChain = {
      symmetryRootLinkName: "body_link",
      outlierBranchRootLinkName: "sensor_branch",
      siblingBranchRootLinkNames: ["sensor_branch_mirror"],
    } as unknown as RepeatedInertiaSymmetryChain;

    expect(
      resolveActiveSimulationPrepSymmetryVisualization({
        activeScopeKey: buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey(leftRightChain),
        repeatedInertiaSymmetryChains: [ignoredChain, leftRightChain],
      })
    ).toEqual(leftRightChain);
    expect(
      resolveActiveSimulationPrepSymmetryVisualization({
        activeScopeKey: "repeated:wheel_group",
        repeatedInertiaSymmetryChains: [ignoredChain, leftRightChain],
      })
    ).toBeNull();
    expect(
      resolveActiveSimulationPrepSymmetryVisualization({
        activeScopeKey: null,
        repeatedInertiaSymmetryChains: [ignoredChain, leftRightChain],
      })
    ).toBeNull();
  });

  it("resolves the active robot mirror visualization from the stable scope key", () => {
    const robotMirrorSymmetryCheck = {
      planeLabel: "xz",
    } as Parameters<typeof resolveActiveSimulationPrepRobotMirrorVisualization>[0]["robotMirrorSymmetryCheck"];

    expect(
      resolveActiveSimulationPrepRobotMirrorVisualization({
        activeScopeKey: buildRobotMirrorSymmetryVisualizationScopeKey(robotMirrorSymmetryCheck),
        robotMirrorSymmetryCheck,
      })
    ).toEqual(robotMirrorSymmetryCheck);
    expect(
      resolveActiveSimulationPrepRobotMirrorVisualization({
        activeScopeKey: "symmetry:base_link:rear_branch",
        robotMirrorSymmetryCheck,
      })
    ).toBeNull();
  });

  it("scopes symmetry visualization to the outlier branch links instead of the whole family", () => {
    expect(
      collectRepeatedInertiaSymmetryScopedLinkNames({
        outlierBranchRootLinkName: "rear_branch",
        affectedLinkNames: ["servo_rear", "wheel_rear"],
        branchLinkGroups: [
          {
            branchRootLinkName: "left_branch",
            linkNames: ["mount_left", "wheel_left"],
            status: "aligned",
          },
          {
            branchRootLinkName: "rear_branch",
            linkNames: ["mount_rear", "servo_rear", "wheel_rear"],
            status: "outlier",
          },
        ],
      } as unknown as RepeatedInertiaSymmetryChain)
    ).toEqual(["mount_rear", "servo_rear", "wheel_rear"]);
  });

  it("falls back to the outlier root plus affected links when branch link groups are missing", () => {
    expect(
      collectRepeatedInertiaSymmetryScopedLinkNames({
        outlierBranchRootLinkName: "rear_branch",
        affectedLinkNames: ["wheel_rear", "servo_rear", "wheel_rear"],
        branchLinkGroups: [],
      } as unknown as RepeatedInertiaSymmetryChain)
    ).toEqual(["rear_branch", "servo_rear", "wheel_rear"]);
  });

  it("collects the full symmetry family for the base-row eye toggle", () => {
    expect(
      collectRepeatedInertiaSymmetryFamilyLinkNames({
        outlierBranchRootLinkName: "rear_branch",
        affectedLinkNames: ["servo_rear", "wheel_rear"],
        branchLinkGroups: [
          {
            branchRootLinkName: "left_branch",
            linkNames: ["mount_left", "servo_left", "wheel_left"],
            status: "aligned",
          },
          {
            branchRootLinkName: "right_branch",
            linkNames: ["mount_right", "servo_right", "wheel_right"],
            status: "aligned",
          },
          {
            branchRootLinkName: "rear_branch",
            linkNames: ["mount_rear", "servo_rear", "wheel_rear"],
            status: "outlier",
          },
        ],
      } as unknown as RepeatedInertiaSymmetryChain)
    ).toEqual([
      "mount_left",
      "mount_rear",
      "mount_right",
      "servo_left",
      "servo_rear",
      "servo_right",
      "wheel_left",
      "wheel_rear",
      "wheel_right",
    ]);
  });

  it("builds a stable family key that does not depend on the current outlier branch", () => {
    expect(
      buildRepeatedInertiaSymmetryFamilyKey({
        symmetryRootLinkName: "base_link",
        outlierBranchRootLinkName: "rear_branch",
        siblingBranchRootLinkNames: ["left_branch", "right_branch"],
      } as RepeatedInertiaSymmetryChain)
    ).toBe("base_link:left_branch,rear_branch,right_branch");

    expect(
      buildRepeatedInertiaSymmetryFamilyKey({
        symmetryRootLinkName: "base_link",
        outlierBranchRootLinkName: "left_branch",
        siblingBranchRootLinkNames: ["right_branch", "rear_branch"],
      } as RepeatedInertiaSymmetryChain)
    ).toBe("base_link:left_branch,rear_branch,right_branch");
  });

  it("prefers the live symmetry family over a pinned copy of the same family", () => {
    const pinnedChain = {
      symmetryRootLinkName: "base_link",
      outlierBranchRootLinkName: "rear_branch",
      siblingBranchRootLinkNames: ["left_branch", "right_branch"],
    } as RepeatedInertiaSymmetryChain;
    const liveChain = {
      symmetryRootLinkName: "base_link",
      outlierBranchRootLinkName: "left_branch",
      siblingBranchRootLinkNames: ["rear_branch", "right_branch"],
    } as RepeatedInertiaSymmetryChain;

    expect(
      mergeDisplayedRepeatedInertiaSymmetryChains({
        pinnedChains: [pinnedChain],
        repeatedInertiaSymmetryChains: [liveChain],
      })
    ).toEqual([liveChain]);
  });

  it("resolves a family scope even when the displayed outlier branch changes", () => {
    const pinnedChain = {
      symmetryRootLinkName: "base_link",
      outlierBranchRootLinkName: "rear_branch",
      siblingBranchRootLinkNames: ["left_branch", "right_branch"],
    } as RepeatedInertiaSymmetryChain;
    const liveChain = {
      symmetryRootLinkName: "base_link",
      outlierBranchRootLinkName: "left_branch",
      siblingBranchRootLinkNames: ["rear_branch", "right_branch"],
    } as RepeatedInertiaSymmetryChain;

    expect(
      resolveActiveSimulationPrepSymmetryVisualization({
        activeScopeKey: buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey(pinnedChain),
        repeatedInertiaSymmetryChains: [liveChain],
      })
    ).toEqual(liveChain);
  });

  it("prefers plane-cut links for robot mirror review and falls back to supported links", () => {
    expect(
      collectRobotMirrorSymmetryVisualizationLinkNames({
        centeredLinkNames: ["spine_upper", "spine_lower"],
        supportedLinkNames: ["arm_left", "arm_right", "spine_upper", "spine_lower"],
      } as unknown as Parameters<typeof collectRobotMirrorSymmetryVisualizationLinkNames>[0])
    ).toEqual(["spine_lower", "spine_upper"]);

    expect(
      collectRobotMirrorSymmetryVisualizationLinkNames({
        centeredLinkNames: [],
        supportedLinkNames: ["arm_right", "arm_left"],
      } as unknown as Parameters<typeof collectRobotMirrorSymmetryVisualizationLinkNames>[0])
    ).toEqual(["arm_left", "arm_right"]);
  });

  it("lets hover preview override the clicked scope and falls back cleanly", () => {
    const scopeLinkNamesByKey = new Map<string, readonly string[]>([
      ["robot-mirror:yz", ["arm_left", "arm_right"]],
      ["symmetry:base_link:rear_branch", ["mount_rear", "servo_rear"]],
    ]);

    expect(
      resolveSimulationPrepVisualizationScope({
        activeScopeKey: "robot-mirror:yz",
        hoveredPreview: {
          scopeKey: "symmetry:base_link:rear_branch",
          scopedLinkNames: ["servo_rear", "mount_rear", "servo_rear"],
        },
        scopeLinkNamesByKey,
      })
    ).toEqual({
      effectiveScopeKey: "symmetry:base_link:rear_branch",
      effectiveScopedLinkNames: ["mount_rear", "servo_rear"],
    });

    expect(
      resolveSimulationPrepVisualizationScope({
        activeScopeKey: "robot-mirror:yz",
        hoveredPreview: null,
        scopeLinkNamesByKey,
      })
    ).toEqual({
      effectiveScopeKey: "robot-mirror:yz",
      effectiveScopedLinkNames: ["arm_left", "arm_right"],
    });

    expect(
      resolveSimulationPrepVisualizationScope({
        activeScopeKey: null,
        hoveredPreview: null,
        scopeLinkNamesByKey,
      })
    ).toEqual({
      effectiveScopeKey: null,
      effectiveScopedLinkNames: null,
    });
  });
});
