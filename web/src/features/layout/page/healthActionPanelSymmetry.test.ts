import { describe, expect, it } from "vitest";
import type { RepeatedInertiaSymmetryChain } from "@/features/layout/page/repeatedInertiaSymmetry";
import type { RobotMirrorLinkResult } from "@/features/layout/page/robotMirrorSymmetryFix";
import type { RobotMirrorSelectionLink } from "@/features/layout/page/robotMirrorSymmetrySelection";
import {
  buildCompatibilityRobotMirrorSelectionState,
  buildRepeatedInertiaSymmetryBranchRowViewState,
  buildRepeatedInertiaSymmetryChainViewState,
  buildRepeatedInertiaSymmetryRepairText,
  buildRobotMirrorSelectionStats,
  formatRepeatedInertiaSymmetryAutoAlignButtonLabel,
  formatRepeatedInertiaSymmetryDistance,
  formatRepeatedInertiaSymmetryOffsetSummary,
  formatRepeatedInertiaSymmetryStatus,
  formatRobotMirrorLinkResultMetrics,
  formatRobotMirrorLinkResultReason,
  formatRobotMirrorLinkResultSummary,
  groupRobotMirrorSelectionLinksByMeshLabel,
  resolveMirrorSelectionStatusBadge,
  resolveRepeatedInertiaSymmetryStatusBadgeClass,
} from "@/features/layout/page/healthActionPanelSymmetry";

const createBranchRow = (
  overrides: Partial<RepeatedInertiaSymmetryChain["branchRows"][number]> = {}
): RepeatedInertiaSymmetryChain["branchRows"][number] => ({
  angleDegrees: 0,
  angularErrorDegrees: 0,
  branchRootLinkName: "branch_a",
  idealAngleDegrees: null,
  idealPositionMeters: [0, 0, 0],
  idealRadialDistanceMeters: null,
  linkRows: [],
  lateralOffsetMeters: 0,
  offsetDistanceMeters: 0,
  offsetVectorMeters: [0, 0, 0],
  radialDistanceDeltaMeters: 0,
  radialDistanceMeters: 0,
  radialOffsetMeters: 0,
  representativeLinkName: "link_a",
  rotationRadians: null,
  status: "aligned",
  topologyMatchesFamily: true,
  ...overrides,
});

const createRepeatedInertiaSymmetryChain = (
  overrides: Partial<RepeatedInertiaSymmetryChain> = {}
): RepeatedInertiaSymmetryChain => ({
  affectedLinkNames: ["branch_a_link", "branch_b_link"],
  branchCount: 2,
  branchLinkGroups: [
    {
      branchRootLinkName: "branch_a",
      linkNames: ["branch_a_link"],
      status: "outlier",
    },
    {
      branchRootLinkName: "branch_b",
      linkNames: ["branch_b_link"],
      status: "aligned",
    },
  ],
  branchRows: [createBranchRow({ branchRootLinkName: "branch_a" })],
  earliestDivergenceLinkName: "branch_a",
  expectedAngleDegrees: 180,
  maxAngularErrorDegrees: 0,
  maxDistanceDeltaMeters: 0.01,
  outlierAngularErrorDegrees: 0,
  outlierBranchRootLinkName: "branch_a",
  recommendedRepair: {
    articulatedBoundaryJointName: null,
    blockedTargetLinkNames: [],
    kind: "translation",
    mode: "single-joint",
    stepCount: 2,
    steps: [
      {
        childLinkName: "branch_a",
        jointName: "joint_a",
        parentLinkName: "root",
        targetPositionMeters: [0, 0, 0],
      },
    ],
    summary: "Move branch_a",
    targetLinkNames: ["branch_a_link"],
  },
  repeatedGroupCount: 1,
  repeatedMeshLabels: ["finger.stl"],
  rootMeshCenterPositionMeters: [0, 0, 0],
  siblingBranchRootLinkNames: ["branch_b"],
  symmetryCenterMode: "robot-center",
  symmetryCenterPositionMeters: [0, 0, 0],
  symmetryRootLinkName: "root",
  symmetryType: "radial",
  topologyMatchingBranchCount: 2,
  ...overrides,
});

const createRepeatedInertiaSymmetryRepairPlan = (
  overrides: Partial<NonNullable<RepeatedInertiaSymmetryChain["recommendedRepair"]>> = {}
): NonNullable<RepeatedInertiaSymmetryChain["recommendedRepair"]> => {
  const repairPlan = createRepeatedInertiaSymmetryChain().recommendedRepair;
  if (!repairPlan) {
    throw new Error("Expected repeated inertia symmetry repair fixture.");
  }
  return {
    ...repairPlan,
    ...overrides,
  };
};

const createRobotMirrorLinkResult = (
  overrides: Partial<RobotMirrorLinkResult> = {}
): RobotMirrorLinkResult => ({
  counterpartLinkName: "right_finger",
  finalResidualMeters: null,
  inertialOriginMovedDistanceMeters: 0,
  linkName: "left_finger",
  movedDistanceMeters: 0,
  orientationDecision: "align-to-plane",
  orientationSkipReason: null,
  planeNormalResidualRadians: null,
  repairMode: "position-only",
  rotationAppliedRadians: 0,
  selectionStatus: "paired",
  ...overrides,
});

const createRobotMirrorSelectionLink = (
  overrides: Partial<RobotMirrorSelectionLink> = {}
): RobotMirrorSelectionLink => ({
  counterpartLinkName: null,
  defaultExclusionReason: null,
  groupKey: "finger",
  groupLinkCount: 1,
  linkName: "finger_tip",
  meshLabel: "Finger",
  preselected: false,
  status: "available",
  ...overrides,
});

describe("healthActionPanelSymmetry", () => {
  it("builds legacy mirror selection state with sorted unique links", () => {
    const state = buildCompatibilityRobotMirrorSelectionState({
      selectedRobotMirrorGroupKeys: ["right"],
      robotMirrorSelectionGroups: [
        { groupKey: "right", linkNames: ["finger_b", "finger_a", "finger_a"], meshLabel: "Finger" },
        { groupKey: "left", linkNames: ["palm"], meshLabel: "Palm" },
      ],
    });

    expect(state.selectedLinkNames).toEqual(["finger_a", "finger_b"]);
    expect(state.selectionLinks.map((link) => [link.groupKey, link.linkName, link.preselected])).toEqual([
      ["right", "finger_a", true],
      ["right", "finger_b", true],
      ["left", "palm", false],
    ]);
  });

  it("builds repeated inertia symmetry chain view state once for compact and expanded rows", () => {
    const chain = createRepeatedInertiaSymmetryChain();
    const baseState = buildRepeatedInertiaSymmetryChainViewState({
      activeInertiaVisualizationScopeKey: null,
      chain,
      outcomeByKey: {},
      repeatedInertiaSymmetryActingChainKey: null,
      repeatedInertiaSymmetryActingProgress: null,
    });

    expect(baseState).toMatchObject({
      chain,
      chainKey: "root:branch_a",
      completedProgress: null,
      isActing: false,
      isAutoAlignAvailable: true,
      isVisualizationActive: false,
      outcome: null,
      progress: null,
      repairText: {
        detail: "Auto-fix checks up to 2 joints in order.",
        summary: "Move branch_a",
      },
      visualizationLinkNames: ["branch_a_link", "branch_b_link"],
    });
    expect(baseState.branchRows[0]).toMatchObject({
      branchSummary: "branch_a_link",
      branchTitle: "branch_a_link",
      key: "root:branch_a",
      representativeLinkName: "link_a",
      statusText: "Aligned",
    });

    expect(
      buildRepeatedInertiaSymmetryChainViewState({
        activeInertiaVisualizationScopeKey: baseState.scopeKey,
        chain,
        outcomeByKey: {
          [baseState.chainKey]: {
            completedProgress: { appliedStepCount: 1, totalStepCount: 2 },
            message: "Aligned one joint",
            tone: "success",
          },
        },
        repeatedInertiaSymmetryActingChainKey: baseState.chainKey,
        repeatedInertiaSymmetryActingProgress: {
          appliedStepCount: 2,
          chainKey: baseState.chainKey,
          totalStepCount: 2,
        },
      })
    ).toMatchObject({
      completedProgress: { appliedStepCount: 1, totalStepCount: 2 },
      isActing: true,
      isVisualizationActive: true,
      outcome: {
        message: "Aligned one joint",
        tone: "success",
      },
      progress: { appliedStepCount: 2, totalStepCount: 2 },
    });
  });

  it("builds branch row display state with branch fallback and topology status", () => {
    const chain = createRepeatedInertiaSymmetryChain({
      branchLinkGroups: [
        {
          branchRootLinkName: "other_branch",
          linkNames: ["other_link"],
          status: "aligned",
        },
      ],
    });
    const row = createBranchRow({
      angularErrorDegrees: 6,
      branchRootLinkName: "missing_branch",
      idealAngleDegrees: 180,
      idealRadialDistanceMeters: 0.2,
      offsetDistanceMeters: 0.003,
      radialDistanceMeters: 0.15,
      representativeLinkName: "fallback_link",
      topologyMatchesFamily: false,
    });

    expect(buildRepeatedInertiaSymmetryBranchRowViewState({ chain, row })).toMatchObject({
      angleText: "0.0° → 180.0° (6.0° err)",
      branchSummary: "fallback_link",
      branchTitle: "fallback_link",
      key: "root:missing_branch",
      offsetText: "3.0 mm (rad 0.0 mm • lat 0.0 mm)",
      radiusText: "150.0 mm → 200.0 mm",
      representativeLinkName: "fallback_link",
      showTopologyBadge: true,
      statusText: "Angle",
    });
  });

  it("formats repeated inertia symmetry repair text for repair and manual states", () => {
    expect(buildRepeatedInertiaSymmetryRepairText(null)).toEqual({
      detail:
        "This branch is already aligned closely enough that no automatic radial step remains.",
      summary: "No auto-align steps remain for this branch.",
    });
    expect(
      buildRepeatedInertiaSymmetryRepairText(createRepeatedInertiaSymmetryRepairPlan({
        articulatedBoundaryJointName: "elbow_joint",
        blockedTargetLinkNames: ["finger_a", "finger_b"],
        stepCount: 0,
        targetLinkNames: ["finger_a", "finger_b"],
      }))
    ).toEqual({
      detail:
        "All 2 tracked targets sit past elbow_joint; auto-fix will not rewrite that articulation.",
      summary: "Move branch_a",
    });
    expect(
      buildRepeatedInertiaSymmetryRepairText(createRepeatedInertiaSymmetryRepairPlan({
        blockedTargetLinkNames: ["finger_b"],
        stepCount: 1,
      }))
    ).toEqual({
      detail:
        "Auto-fix can edit up to 1 joint in order; 1 connected target move with those rigid edits.",
      summary: "Move branch_a",
    });
  });

  it("summarizes and groups mirror selection links by mesh label", () => {
    const selectionLinks = [
      createRobotMirrorSelectionLink({
        defaultExclusionReason: "radial-symmetry",
        linkName: "finger_b",
        meshLabel: "Finger",
      }),
      createRobotMirrorSelectionLink({
        groupKey: "palm",
        linkName: "palm",
        meshLabel: "Palm",
      }),
      createRobotMirrorSelectionLink({
        linkName: "finger_a",
        meshLabel: "Finger",
      }),
    ];

    expect(
      buildRobotMirrorSelectionStats({
        selectedLinkNames: ["finger_a", "palm"],
        selectionLinks,
      })
    ).toEqual({
      selectedLinkCount: 2,
      selectedMeshCount: 2,
    });
    expect(groupRobotMirrorSelectionLinksByMeshLabel(selectionLinks)).toEqual([
      {
        meshLabel: "Finger",
        radialExcludedCount: 1,
        selectionLinks: [selectionLinks[2], selectionLinks[0]],
      },
      {
        meshLabel: "Palm",
        radialExcludedCount: 0,
        selectionLinks: [selectionLinks[1]],
      },
    ]);
  });

  it("formats repeated symmetry distances, offsets, and status badges", () => {
    expect(formatRepeatedInertiaSymmetryDistance(0.01234)).toBe("12.3 mm");
    expect(
      formatRepeatedInertiaSymmetryOffsetSummary(
        createBranchRow({
          lateralOffsetMeters: 0.001,
          offsetDistanceMeters: 0.006,
          radialOffsetMeters: -0.002,
        })
      )
    ).toBe("6.0 mm (rad -2.0 mm • lat 1.0 mm)");

    const angleRow = createBranchRow({ angularErrorDegrees: 6 });
    expect(formatRepeatedInertiaSymmetryStatus(angleRow)).toBe("Angle");
    expect(resolveRepeatedInertiaSymmetryStatusBadgeClass(angleRow)).toContain("rose");

    expect(formatRepeatedInertiaSymmetryStatus(createBranchRow({ status: "outlier" }))).toBe(
      "Outlier"
    );
  });

  it("formats auto-align progress without overstating unavailable work", () => {
    expect(
      formatRepeatedInertiaSymmetryAutoAlignButtonLabel({
        completedProgress: null,
        isActing: false,
        progress: null,
      })
    ).toBe("Auto Align");
    expect(
      formatRepeatedInertiaSymmetryAutoAlignButtonLabel({
        completedProgress: null,
        isActing: true,
        progress: { appliedStepCount: 2, totalStepCount: 3 },
      })
    ).toBe("Auto Align 2/3 joint moves");
    expect(
      formatRepeatedInertiaSymmetryAutoAlignButtonLabel({
        completedProgress: { appliedStepCount: 9, totalStepCount: 3 },
        isActing: false,
        progress: null,
      })
    ).toBe("Auto Align 3/3 joint moves");
  });

  it("summarizes robot mirror link repair outcomes and review badges", () => {
    const linkResult = createRobotMirrorLinkResult({
      finalResidualMeters: 0.001,
      inertialOriginMovedDistanceMeters: 0.002,
      movedDistanceMeters: 0.0123,
      orientationSkipReason: "rotation-too-large",
      planeNormalResidualRadians: 0.05,
      rotationAppliedRadians: 0.1,
    });

    expect(formatRobotMirrorLinkResultSummary(linkResult)).toBe(
      "position only, kept orientation"
    );
    expect(formatRobotMirrorLinkResultReason(linkResult)).toBe("large rotation would be risky");
    expect(formatRobotMirrorLinkResultMetrics(linkResult)).toBe(
      "move 12.3 mm • res 1.0 mm • rot 5.7° • com 2.0 mm • axis 2.9°"
    );
    expect(
      resolveMirrorSelectionStatusBadge({
        counterpartLinkName: null,
        defaultExclusionReason: null,
        groupKey: "finger",
        groupLinkCount: 1,
        linkName: "finger_tip",
        meshLabel: "Finger",
        preselected: false,
        status: "review",
      })?.label
    ).toBe("attention");
  });
});
