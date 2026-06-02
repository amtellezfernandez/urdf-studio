import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import { ROVER_APPROACH_CONFIG } from "@/features/locomotion/approach";
import {
  shouldRetryRoverApproachForSurfaceTarget,
  shouldRunSurfaceTargetApproachRetry,
} from "./ikSurfaceApproachPolicy";

const MAX_LINK_TRAVERSAL = 32;
const REACH_DISTANCE_METERS = 1.0;

const createAnalysis = (): UrdfAnalysis =>
  ({
    isValid: true,
    rootLinks: ["base_link"],
    jointByChildLink: {
      ee_link: {
        parentLink: "base_link",
        childLink: "ee_link",
        origin: [REACH_DISTANCE_METERS, 0, 0],
        axis: [0, 0, 1],
        type: "fixed",
        limitLower: null,
        limitUpper: null,
      },
    },
  }) as unknown as UrdfAnalysis;

const createRobot = (): URDFRobot => {
  const robot = new THREE.Group() as unknown as URDFRobot;
  const base = new THREE.Group();
  base.name = "base_link";
  robot.add(base);
  robot.updateMatrixWorld(true);
  return robot;
};

describe("shouldRetryRoverApproachForSurfaceTarget", () => {
  it("retries when the surface target remains outside reach comfort", () => {
    expect(
      shouldRetryRoverApproachForSurfaceTarget({
        robot: createRobot(),
        urdfAnalysis: createAnalysis(),
        endEffectorLink: "ee_link",
        maxLinkTraversal: MAX_LINK_TRAVERSAL,
        targetPosition: [
          REACH_DISTANCE_METERS - ROVER_APPROACH_CONFIG.reachGapTriggerM + 0.01,
          0,
          0,
        ],
      })
    ).toBe(true);
  });

  it("does not retry once the surface target is inside reach comfort", () => {
    expect(
      shouldRetryRoverApproachForSurfaceTarget({
        robot: createRobot(),
        urdfAnalysis: createAnalysis(),
        endEffectorLink: "ee_link",
        maxLinkTraversal: MAX_LINK_TRAVERSAL,
        targetPosition: [
          REACH_DISTANCE_METERS - ROVER_APPROACH_CONFIG.reachGapTriggerM - 0.01,
          0,
          0,
        ],
      })
    ).toBe(false);
  });
});

describe("shouldRunSurfaceTargetApproachRetry", () => {
  const surfaceRetryArgs = {
    robot: createRobot(),
    urdfAnalysis: createAnalysis(),
    endEffectorLink: "ee_link",
    maxLinkTraversal: MAX_LINK_TRAVERSAL,
    targetPosition: [
      REACH_DISTANCE_METERS - ROVER_APPROACH_CONFIG.reachGapTriggerM + 0.01,
      0,
      0,
    ] as [number, number, number],
  };

  it("blocks the retry after a completed rover pre-solve already chose the route", () => {
    expect(
      shouldRunSurfaceTargetApproachRetry({
        ...surfaceRetryArgs,
        hasPreSolveHandler: true,
        isOrbitTarget: false,
        wheelDriveEnabled: true,
        initialPreSolveStatus: "completed",
      })
    ).toBe(false);
  });

  it("allows the retry only when the handler, mode, and reach policy all agree", () => {
    expect(
      shouldRunSurfaceTargetApproachRetry({
        ...surfaceRetryArgs,
        hasPreSolveHandler: true,
        isOrbitTarget: false,
        wheelDriveEnabled: true,
        initialPreSolveStatus: "skipped",
      })
    ).toBe(true);
  });

  it("blocks the retry for orbit targets or when wheel drive is disabled", () => {
    expect(
      shouldRunSurfaceTargetApproachRetry({
        ...surfaceRetryArgs,
        hasPreSolveHandler: true,
        isOrbitTarget: true,
        wheelDriveEnabled: true,
        initialPreSolveStatus: "skipped",
      })
    ).toBe(false);
    expect(
      shouldRunSurfaceTargetApproachRetry({
        ...surfaceRetryArgs,
        hasPreSolveHandler: true,
        isOrbitTarget: false,
        wheelDriveEnabled: false,
        initialPreSolveStatus: "skipped",
      })
    ).toBe(false);
  });
});
