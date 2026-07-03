import { describe, expect, it } from "vitest";
import * as THREE from "three";

import type { RepeatedInertiaSymmetryChain } from "@/features/layout/page/repeatedInertiaSymmetry";
import type { RobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import {
  buildSimulationPrepSymmetryLinkNames,
  collectSimulationPrepRobotMirrorFocusLinkNames,
  resolveSimulationPrepRobotMirrorFocusRadius,
  resolveSimulationPrepSymmetryFocusRadius,
} from "@/features/viewer/simulationPrepFocus";

const createBoxLink = ({
  name,
  position = [0, 0, 0],
  size = [2, 2, 2],
}: {
  name: string;
  position?: [number, number, number];
  size?: [number, number, number];
}) => {
  const link = new THREE.Mesh(new THREE.BoxGeometry(...size));
  link.name = name;
  link.position.set(...position);
  link.updateMatrixWorld(true);
  return link;
};

const createSymmetryChain = (
  overrides: Partial<RepeatedInertiaSymmetryChain> = {}
): RepeatedInertiaSymmetryChain =>
  ({
    affectedLinkNames: [],
    branchCount: 2,
    branchLinkGroups: [
      { branchRootLinkName: "left", linkNames: ["left_a", "shared"], status: "aligned" },
      { branchRootLinkName: "right", linkNames: ["right_a", "shared"], status: "outlier" },
    ],
    branchRows: [],
    earliestDivergenceLinkName: "right",
    expectedAngleDegrees: null,
    maxAngularErrorDegrees: null,
    maxDistanceDeltaMeters: 0.25,
    outlierAngularErrorDegrees: null,
    outlierBranchRootLinkName: "right",
    recommendedRepair: null,
    repeatedGroupCount: 1,
    repeatedMeshLabels: [],
    rootMeshCenterPositionMeters: [0, 0, 0],
    siblingBranchRootLinkNames: ["left"],
    symmetryCenterMode: "root-mesh-center",
    symmetryCenterPositionMeters: [0, 0, 0],
    symmetryRootLinkName: "base",
    symmetryType: "linear",
    topologyMatchingBranchCount: 2,
    ...overrides,
  }) as RepeatedInertiaSymmetryChain;

const createMirrorCheck = (
  overrides: Partial<RobotMirrorSymmetryCheck> = {}
): RobotMirrorSymmetryCheck => ({
  averageResidualMeters: 0.1,
  centeredLinkCount: 0,
  centeredLinkNames: [],
  matchedPairCount: 0,
  matchedPairs: [],
  maxResidualMeters: 0.42,
  originMeters: [0, 0, 0],
  pairedGroupCount: 0,
  pairedLinkCount: 0,
  planeLabel: "yz",
  planeNormalWorld: [1, 0, 0],
  reviewGroups: [],
  reviewLinkCount: 0,
  supportedGroupCount: 1,
  supportedLinkCount: 2,
  supportedLinkNames: ["left", "right"],
  totalRepeatedLinkCount: 2,
  ...overrides,
});

describe("simulationPrepFocus", () => {
  it("deduplicates symmetry focus link names while preserving first-seen order", () => {
    expect(buildSimulationPrepSymmetryLinkNames(createSymmetryChain())).toEqual([
      "left_a",
      "shared",
      "right_a",
    ]);
  });

  it("uses resolved link bounds for symmetry focus radius", () => {
    const links = new Map<string, THREE.Object3D>([
      ["left_a", createBoxLink({ name: "left_a", position: [-2, 0, 0] })],
      ["right_a", createBoxLink({ name: "right_a", position: [2, 0, 0] })],
    ]);

    const radius = resolveSimulationPrepSymmetryFocusRadius({
      chain: createSymmetryChain(),
      resolveLinkObject: (linkName) => links.get(linkName) ?? null,
    });

    expect(radius).toBeCloseTo(Math.sqrt(44) / 2);
  });

  it("falls back to authored symmetry row radii when links are unavailable", () => {
    const radius = resolveSimulationPrepSymmetryFocusRadius({
      chain: createSymmetryChain({
        branchRows: [
          {
            idealRadialDistanceMeters: 1.25,
            linkRows: [{ idealLayerRadiusMeters: 1.75 }],
            radialDistanceMeters: 0.5,
          },
        ] as RepeatedInertiaSymmetryChain["branchRows"],
      }),
      resolveLinkObject: () => null,
    });

    expect(radius).toBe(1.75);
  });

  it("prefers centered mirror links and falls back to supported mirror links", () => {
    expect(
      collectSimulationPrepRobotMirrorFocusLinkNames(
        createMirrorCheck({ centeredLinkNames: ["base"], supportedLinkNames: ["left", "right"] })
      )
    ).toEqual(["base"]);
    expect(collectSimulationPrepRobotMirrorFocusLinkNames(createMirrorCheck())).toEqual([
      "left",
      "right",
    ]);
  });

  it("uses mirror focus bounds before falling back to max residual", () => {
    const links = new Map<string, THREE.Object3D>([
      ["base", createBoxLink({ name: "base", size: [4, 2, 2] })],
    ]);

    expect(
      resolveSimulationPrepRobotMirrorFocusRadius({
        check: createMirrorCheck({ centeredLinkNames: ["base"] }),
        resolveLinkObject: (linkName) => links.get(linkName) ?? null,
      })
    ).toBeCloseTo(Math.sqrt(24) / 2);

    expect(
      resolveSimulationPrepRobotMirrorFocusRadius({
        check: createMirrorCheck({ maxResidualMeters: 0.33 }),
        resolveLinkObject: () => null,
      })
    ).toBe(0.33);
  });
});
