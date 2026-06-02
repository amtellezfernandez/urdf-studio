import { describe, expect, it } from "vitest";

import type { LinkData } from "@/shared/lib/urdfCore";
import type { RepeatedInertiaDiagnosticGroup } from "@/features/layout/page/repeatedInertiaDiagnostics";
import type { RepeatedInertiaSymmetryChain } from "@/features/layout/page/repeatedInertiaSymmetry";
import type { RobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import { buildRobotMirrorSelectionLinks } from "@/features/layout/page/robotMirrorSymmetrySelection";

const createDiagnosticGroup = (
  groupKey: string,
  meshLabel: string,
  linkNames: readonly string[]
): RepeatedInertiaDiagnosticGroup => ({
  confidenceValues: [],
  groupKey,
  instanceCount: linkNames.length,
  issueKeys: [],
  issueSummary: [],
  linkEntries: linkNames.map((linkName) => ({
    centerOfMassOutsideReference: false,
    confidence: null,
    linkName,
    massKg: 1,
    meshLocalComMeters: [0, 0, 0],
    mismatchBreakdown: null,
    mismatchScore: null,
    principalMomentsKgM2: [1, 1, 1],
    strategy: null,
  })),
  massRelativeSpread: 0,
  meshLabel,
  meshLocalComMaxSeparationMeters: 0,
  meshReference: meshLabel,
  physicalMismatch: false,
  principalMomentRelativeSpread: 0,
  source: "visual",
  strategyValues: [],
});

const createRobotMirrorCheck = (
  overrides: Partial<RobotMirrorSymmetryCheck>
): RobotMirrorSymmetryCheck => ({
  averageResidualMeters: 0,
  centeredLinkCount: 0,
  centeredLinkNames: [],
  matchedPairs: [],
  matchedPairCount: 0,
  maxResidualMeters: 0,
  originMeters: [0, 0, 0],
  pairedGroupCount: 0,
  pairedLinkCount: 0,
  planeLabel: "xz",
  planeNormalWorld: [0, 1, 0],
  reviewGroups: [],
  reviewLinkCount: 0,
  supportedGroupCount: 0,
  supportedLinkCount: 0,
  supportedLinkNames: [],
  totalRepeatedLinkCount: 0,
  ...overrides,
});

const createMeshBackedLinkData = (
  meshReference: string,
  scale = "1 1 1"
): LinkData =>
  ({
    collisions: [],
    visuals: [
      {
        geometry: {
          type: "mesh",
          params: {
            filename: meshReference,
            scale,
          },
        },
        origin: {
          xyz: [0, 0, 0],
          rpy: [0, 0, 0],
        },
      },
    ],
  }) as unknown as LinkData;

describe("buildRobotMirrorSelectionLinks", () => {
  it("prefers only centered links in larger groups that straddle the symmetry plane", () => {
    const standoffLinks = [
      "standoff_center",
      "standoff_radial_1",
      "standoff_radial_2",
      "standoff_radial_3",
      "standoff_radial_4",
      "standoff_radial_5",
    ];
    const selectionLinks = buildRobotMirrorSelectionLinks({
      linkDataByName: null,
      repeatedInertiaDiagnostics: [
        createDiagnosticGroup(
          "group:standoff",
          "94868A713_NO-THREADS_Female-Threaded-Hex-Standoff.stl",
          standoffLinks
        ),
      ],
      repeatedInertiaSymmetryChains: [] as RepeatedInertiaSymmetryChain[],
      robotMirrorSymmetryCheck: createRobotMirrorCheck({
        centeredLinkCount: 1,
        centeredLinkNames: ["standoff_center"],
        supportedGroupCount: 1,
        supportedLinkCount: standoffLinks.length,
        supportedLinkNames: [...standoffLinks],
        totalRepeatedLinkCount: standoffLinks.length,
      }),
    });

    expect(
      selectionLinks.filter((selectionLink) => selectionLink.preselected).map((selectionLink) => selectionLink.linkName)
    ).toEqual(["standoff_center"]);
    expect(
      selectionLinks
        .filter((selectionLink) => selectionLink.linkName !== "standoff_center")
        .every((selectionLink) => selectionLink.defaultExclusionReason === "radial-symmetry")
    ).toBe(true);
  });

  it("keeps paired mirror links preselected for simple two-link mirror groups", () => {
    const selectionLinks = buildRobotMirrorSelectionLinks({
      linkDataByName: null,
      repeatedInertiaDiagnostics: [
        createDiagnosticGroup("group:arm", "arm.stl", ["arm_left", "arm_right"]),
      ],
      repeatedInertiaSymmetryChains: [] as RepeatedInertiaSymmetryChain[],
      robotMirrorSymmetryCheck: createRobotMirrorCheck({
        matchedPairs: [
          {
            groupKey: "group:arm",
            leftLinkName: "arm_left",
            residualMeters: 0.001,
            rightLinkName: "arm_right",
          },
        ],
        matchedPairCount: 1,
        pairedGroupCount: 1,
        pairedLinkCount: 2,
        supportedGroupCount: 1,
        supportedLinkCount: 2,
        supportedLinkNames: ["arm_left", "arm_right"],
        totalRepeatedLinkCount: 2,
      }),
    });

    expect(
      selectionLinks.filter((selectionLink) => selectionLink.preselected).map((selectionLink) => selectionLink.linkName)
    ).toEqual(["arm_left", "arm_right"]);
  });

  it("includes uniquely meshed plane-touch candidates when link data is available", () => {
    const selectionLinks = buildRobotMirrorSelectionLinks({
      linkDataByName: {
        arm_left: createMeshBackedLinkData("meshes/arm.stl"),
        arm_right: createMeshBackedLinkData("meshes/arm.stl"),
        sensor_center: createMeshBackedLinkData("meshes/sensor.stl"),
      },
      repeatedInertiaDiagnostics: [
        createDiagnosticGroup("group:arm", "arm.stl", ["arm_left", "arm_right"]),
      ],
      repeatedInertiaSymmetryChains: [] as RepeatedInertiaSymmetryChain[],
      robotMirrorSymmetryCheck: createRobotMirrorCheck({
        matchedPairs: [
          {
            groupKey: "visual:meshes/arm.stl:1 1 1",
            leftLinkName: "arm_left",
            residualMeters: 0.001,
            rightLinkName: "arm_right",
          },
        ],
        matchedPairCount: 1,
        pairedGroupCount: 1,
        pairedLinkCount: 2,
        supportedGroupCount: 1,
        supportedLinkCount: 2,
        supportedLinkNames: ["arm_left", "arm_right"],
        totalRepeatedLinkCount: 2,
      }),
    });

    expect(selectionLinks.map((selectionLink) => selectionLink.linkName)).toEqual([
      "arm_left",
      "arm_right",
      "sensor_center",
    ]);
    expect(selectionLinks.find((selectionLink) => selectionLink.linkName === "sensor_center")).toMatchObject({
      groupLinkCount: 1,
      meshLabel: "sensor.stl",
      preselected: false,
      status: "available",
    });
  });

  it("groups signed-scale mirror copies together for robot mirror actions", () => {
    const selectionLinks = buildRobotMirrorSelectionLinks({
      linkDataByName: {
        arm_left: createMeshBackedLinkData("meshes/arm.stl", "0.001 -0.001 0.001"),
        arm_right: createMeshBackedLinkData("meshes/arm.stl", "0.001 0.001 0.001"),
      },
      repeatedInertiaDiagnostics: [],
      repeatedInertiaSymmetryChains: [] as RepeatedInertiaSymmetryChain[],
      robotMirrorSymmetryCheck: createRobotMirrorCheck({
        matchedPairs: [
          {
            groupKey: "visual:meshes/arm.stl:0.001 0.001 0.001",
            leftLinkName: "arm_left",
            residualMeters: 0.001,
            rightLinkName: "arm_right",
          },
        ],
        matchedPairCount: 1,
        pairedGroupCount: 1,
        pairedLinkCount: 2,
        supportedGroupCount: 1,
        supportedLinkCount: 2,
        supportedLinkNames: ["arm_left", "arm_right"],
        totalRepeatedLinkCount: 2,
      }),
    });

    expect(selectionLinks).toEqual([
      expect.objectContaining({
        groupKey: "visual:meshes/arm.stl:0.001 0.001 0.001",
        groupLinkCount: 2,
        linkName: "arm_left",
        preselected: true,
        status: "paired",
      }),
      expect.objectContaining({
        groupKey: "visual:meshes/arm.stl:0.001 0.001 0.001",
        groupLinkCount: 2,
        linkName: "arm_right",
        preselected: true,
        status: "paired",
      }),
    ]);
  });
});
