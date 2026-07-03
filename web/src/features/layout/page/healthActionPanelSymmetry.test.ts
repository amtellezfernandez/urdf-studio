import { describe, expect, it } from "vitest";
import type { RepeatedInertiaSymmetryChain } from "@/features/layout/page/repeatedInertiaSymmetry";
import type { RobotMirrorLinkResult } from "@/features/layout/page/robotMirrorSymmetryFix";
import {
  buildCompatibilityRobotMirrorSelectionState,
  formatRepeatedInertiaSymmetryAutoAlignButtonLabel,
  formatRepeatedInertiaSymmetryDistance,
  formatRepeatedInertiaSymmetryOffsetSummary,
  formatRepeatedInertiaSymmetryStatus,
  formatRobotMirrorLinkResultMetrics,
  formatRobotMirrorLinkResultReason,
  formatRobotMirrorLinkResultSummary,
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
