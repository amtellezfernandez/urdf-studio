import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  assessRoverApproachPlanarSegmentClearance,
  type RoverApproachPlanarObstacle,
} from "./approachDetour";
import {
  assessRoverApproachNavigationSegmentInScene,
  buildRoverApproachNavigationScene,
  planRoverApproachNavigationPath,
  planRoverApproachNavigationPathInScene,
  resolveRoverApproachFootprintSupportRadiusM,
  type RoverApproachRobotFootprint,
} from "./approachNavigation";

const WORLD_UP = new THREE.Vector3(0, 0, 1);
const SEGMENT_START_WORLD = new THREE.Vector3(0, 0, 0);
const SEGMENT_END_WORLD = new THREE.Vector3(2.4, 0, 0);
const PATH_CLEARANCE_M = 0.08;
const DEFAULT_OBSTACLE_RADIUS_M = 0.2;

const createObstacle = (
  id: string,
  centerWorld: THREE.Vector3,
  radiusM = DEFAULT_OBSTACLE_RADIUS_M
): RoverApproachPlanarObstacle => ({
  id,
  centerWorld,
  radiusM,
});

const createBoxObstacle = ({
  id,
  centerWorld,
  sizeWorld,
  rotationWorld = new THREE.Euler(0, 0, 0),
}: {
  id: string;
  centerWorld: THREE.Vector3;
  sizeWorld: THREE.Vector3;
  rotationWorld?: THREE.Euler;
}): RoverApproachPlanarObstacle => ({
  id,
  primitiveType: "cube",
  centerWorld,
  radiusM: Math.hypot(sizeWorld.x * 0.5, sizeWorld.y * 0.5),
  rotationWorld,
  sizeWorld,
});

const NARROW_ROBOT_FOOTPRINT: RoverApproachRobotFootprint = {
  halfLengthM: 0.1,
  halfWidthM: 0.06,
};

const WIDE_ROBOT_FOOTPRINT: RoverApproachRobotFootprint = {
  halfLengthM: 0.18,
  halfWidthM: 0.18,
};

describe("approachNavigation", () => {
  it("ignores invalid robot footprint dimensions for support radius", () => {
    const supportRadiusM = resolveRoverApproachFootprintSupportRadiusM({
      robotFootprint: {
        halfLengthM: Number.NaN,
        halfWidthM: Number.POSITIVE_INFINITY,
      },
      forwardWorld: new THREE.Vector3(1, 0, 0),
      upAxisWorld: WORLD_UP,
      targetDirectionWorld: new THREE.Vector3(1, 1, 0),
    });

    expect(supportRadiusM).toBe(0);
  });

  it("keeps direct navigation when the path is already clear", () => {
    const result = planRoverApproachNavigationPath({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: SEGMENT_END_WORLD,
      upAxisWorld: WORLD_UP,
      obstacles: [createObstacle("far", new THREE.Vector3(0.6, 0.9, 0))],
      pathClearanceM: PATH_CLEARANCE_M,
    });

    expect(result.mode).toBe("direct");
    expect(result.waypointWorlds).toHaveLength(0);
    expect(result.plannerStage).toBe("direct");
    expect(result.blockedReason).toBe("none");
  });

  it("routes around multiple blocking obstacles with clear segments", () => {
    const obstacles = [
      createObstacle("obs-a", new THREE.Vector3(0.85, 0, 0)),
      createObstacle("obs-b", new THREE.Vector3(1.5, 0, 0)),
    ];
    const result = planRoverApproachNavigationPath({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: SEGMENT_END_WORLD,
      upAxisWorld: WORLD_UP,
      obstacles,
      pathClearanceM: PATH_CLEARANCE_M,
    });

    expect(result.mode).toBe("path");
    expect(result.waypointWorlds.length).toBeGreaterThan(0);
    expect(["visibility", "grid"]).toContain(result.plannerStage);
    expect(result.blockedReason).toBe("none");

    const pathPoints = [
      SEGMENT_START_WORLD,
      ...result.waypointWorlds,
      SEGMENT_END_WORLD,
    ];
    for (let index = 0; index < pathPoints.length - 1; index += 1) {
      const assessment = assessRoverApproachPlanarSegmentClearance({
        segmentStartWorld: pathPoints[index],
        segmentEndWorld: pathPoints[index + 1],
        upAxisWorld: WORLD_UP,
        obstacles,
        pathClearanceM: PATH_CLEARANCE_M,
      });
      expect(assessment.isClear).toBe(true);
    }
  });

  it("reports blocked when no waypoint path can be found", () => {
    const result = planRoverApproachNavigationPath({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: SEGMENT_END_WORLD,
      upAxisWorld: WORLD_UP,
      obstacles: [
        createBoxObstacle({
          id: "start-pocket-top",
          centerWorld: new THREE.Vector3(0.22, 0.2, 0),
          sizeWorld: new THREE.Vector3(0.44, 0.12, 0.4),
        }),
        createBoxObstacle({
          id: "start-pocket-bottom",
          centerWorld: new THREE.Vector3(0.22, -0.2, 0),
          sizeWorld: new THREE.Vector3(0.44, 0.12, 0.4),
        }),
        createBoxObstacle({
          id: "start-pocket-right",
          centerWorld: new THREE.Vector3(0.42, 0, 0),
          sizeWorld: new THREE.Vector3(0.12, 0.44, 0.4),
        }),
      ],
      pathClearanceM: PATH_CLEARANCE_M,
      robotFootprint: WIDE_ROBOT_FOOTPRINT,
    });

    expect(result.mode).toBe("blocked");
    expect(result.waypointWorlds).toHaveLength(0);
    expect(result.plannerStage).toBe("blocked");
    expect(result.blockedReason).toBe("start-in-collision");
  });

  it("reuses a prebuilt navigation scene for repeated path queries", () => {
    const obstacles = [
      createObstacle("obs-a", new THREE.Vector3(0.85, 0, 0)),
      createObstacle("obs-b", new THREE.Vector3(1.5, 0, 0)),
    ];
    const scene = buildRoverApproachNavigationScene({
      upAxisWorld: WORLD_UP,
      obstacles,
    });

    const result = planRoverApproachNavigationPathInScene({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: SEGMENT_END_WORLD,
      scene,
      obstacles,
      pathClearanceM: PATH_CLEARANCE_M,
    });
    const cacheSizeAfterFirstQuery = scene.blockedCellKeyCache.size;
    const repeatedResult = planRoverApproachNavigationPathInScene({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: SEGMENT_END_WORLD,
      scene,
      obstacles,
      pathClearanceM: PATH_CLEARANCE_M,
    });

    expect(result.mode).toBe("path");
    expect(result.waypointWorlds.length).toBeGreaterThan(0);
    expect(repeatedResult.mode).toBe("path");
    expect(repeatedResult.plannerStage).toBe("visibility");
    expect(scene.blockedCellKeyCache.size).toBe(cacheSizeAfterFirstQuery);
    expect(scene.blockedCellKeyCache.size).toBe(1);
  });

  it("finds a constrained route around a blocker band", () => {
    const obstacles = [
      createObstacle("center-blocker-a", new THREE.Vector3(0.9, 0, 0), 0.12),
      createObstacle("center-blocker-b", new THREE.Vector3(1.35, 0, 0), 0.12),
      createObstacle("corridor-top-a", new THREE.Vector3(0.95, 0.34, 0), 0.1),
      createObstacle("corridor-top-b", new THREE.Vector3(1.3, 0.34, 0), 0.1),
      createObstacle("corridor-bottom-a", new THREE.Vector3(0.95, -0.34, 0), 0.1),
      createObstacle("corridor-bottom-b", new THREE.Vector3(1.3, -0.34, 0), 0.1),
    ];
    const result = planRoverApproachNavigationPath({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: SEGMENT_END_WORLD,
      upAxisWorld: WORLD_UP,
      obstacles,
      pathClearanceM: 0.03,
    });

    expect(result.mode).toBe("path");
    expect(result.waypointWorlds.length).toBeGreaterThan(0);
    expect(["visibility", "grid"]).toContain(result.plannerStage);
    expect(
      result.waypointWorlds.some((waypointWorld) => Math.abs(waypointWorld.y) > 0.2)
    ).toBe(true);
    result.waypointWorlds.forEach((waypointWorld) => {
      expect(Math.abs(waypointWorld.y)).toBeLessThan(0.8);
    });
    const pathPoints = [SEGMENT_START_WORLD, ...result.waypointWorlds, SEGMENT_END_WORLD];
    for (let index = 0; index < pathPoints.length - 1; index += 1) {
      const assessment = assessRoverApproachPlanarSegmentClearance({
        segmentStartWorld: pathPoints[index],
        segmentEndWorld: pathPoints[index + 1],
        upAxisWorld: WORLD_UP,
        obstacles,
        pathClearanceM: 0.03,
      });
      expect(assessment.isClear).toBe(true);
    }
  });

  it("prefers a wider corridor over a tighter shortcut", () => {
    const obstacles = [
      createObstacle("center-blocker", new THREE.Vector3(1.2, 0, 0), 0.18),
      createObstacle("tight-top-a", new THREE.Vector3(1.02, 0.3, 0), 0.11),
      createObstacle("tight-top-b", new THREE.Vector3(1.38, 0.3, 0), 0.11),
      createObstacle("wide-bottom-guide", new THREE.Vector3(1.2, -0.55, 0), 0.08),
    ];
    const result = planRoverApproachNavigationPath({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: SEGMENT_END_WORLD,
      upAxisWorld: WORLD_UP,
      obstacles,
      pathClearanceM: 0.04,
      robotFootprint: NARROW_ROBOT_FOOTPRINT,
    });

    expect(result.mode).toBe("path");
    expect(result.waypointWorlds.length).toBeGreaterThan(0);
    expect(result.blockedReason).toBe("none");
    expect(
      result.waypointWorlds.some((waypointWorld) => waypointWorld.y < -0.18)
    ).toBe(true);
    expect(
      result.waypointWorlds.some((waypointWorld) => waypointWorld.y > 0.18)
    ).toBe(false);
  });

  it("prefers the shorter branch when route clearances are comparable", () => {
    const obstacles = [
      createObstacle("center-blocker", new THREE.Vector3(1.2, 0, 0), 0.17),
      createObstacle("top-guide-a", new THREE.Vector3(0.98, 0.42, 0), 0.09),
      createObstacle("top-guide-b", new THREE.Vector3(1.42, 0.42, 0), 0.09),
      createObstacle("bottom-guide-a", new THREE.Vector3(0.98, -0.24, 0), 0.09),
      createObstacle("bottom-guide-b", new THREE.Vector3(1.42, -0.24, 0), 0.09),
    ];
    const result = planRoverApproachNavigationPath({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: SEGMENT_END_WORLD,
      upAxisWorld: WORLD_UP,
      obstacles,
      pathClearanceM: 0.03,
      robotFootprint: NARROW_ROBOT_FOOTPRINT,
    });

    expect(result.mode).toBe("path");
    expect(result.waypointWorlds.length).toBeGreaterThan(0);
    expect(
      result.waypointWorlds.some((waypointWorld) => waypointWorld.y < -0.12)
    ).toBe(true);
    expect(
      result.waypointWorlds.some((waypointWorld) => waypointWorld.y > 0.18)
    ).toBe(false);
  });

  it("routes through broader open space in a staggered clutter field", () => {
    const obstacles = [
      createObstacle("clutter-1", new THREE.Vector3(0.7, 0.12, 0), 0.13),
      createObstacle("clutter-2", new THREE.Vector3(0.95, -0.14, 0), 0.13),
      createObstacle("clutter-3", new THREE.Vector3(1.2, 0.12, 0), 0.13),
      createObstacle("clutter-4", new THREE.Vector3(1.45, -0.14, 0), 0.13),
      createObstacle("clutter-5", new THREE.Vector3(1.7, 0.12, 0), 0.13),
      createObstacle("clutter-top-cap", new THREE.Vector3(1.2, 0.38, 0), 0.11),
    ];
    const result = planRoverApproachNavigationPath({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: SEGMENT_END_WORLD,
      upAxisWorld: WORLD_UP,
      obstacles,
      pathClearanceM: 0.03,
      robotFootprint: NARROW_ROBOT_FOOTPRINT,
    });

    expect(result.mode).toBe("path");
    expect(result.waypointWorlds.length).toBeGreaterThan(0);
    expect(
      result.waypointWorlds.some((waypointWorld) => waypointWorld.y < -0.18)
    ).toBe(true);
  });

  it("avoids dead-end pockets even when they look locally reachable", () => {
    const deadEndObstacles = [
      createObstacle("pocket-top-a", new THREE.Vector3(0.72, 0.16, 0), 0.12),
      createObstacle("pocket-top-b", new THREE.Vector3(1.02, 0.16, 0), 0.12),
      createObstacle("pocket-bottom-a", new THREE.Vector3(0.72, -0.16, 0), 0.12),
      createObstacle("pocket-bottom-b", new THREE.Vector3(1.02, -0.16, 0), 0.12),
      createObstacle("pocket-cap", new THREE.Vector3(1.18, 0, 0), 0.12),
      createObstacle("right-wall", new THREE.Vector3(1.6, 0, 0), 0.14),
    ];
    const result = planRoverApproachNavigationPath({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: SEGMENT_END_WORLD,
      upAxisWorld: WORLD_UP,
      obstacles: deadEndObstacles,
      pathClearanceM: 0.02,
    });

    expect(result.mode).toBe("path");
    expect(result.waypointWorlds.length).toBeGreaterThan(0);
    expect(
      result.waypointWorlds.some((waypointWorld) => Math.abs(waypointWorld.y) > 0.22)
    ).toBe(true);
    const pathPoints = [SEGMENT_START_WORLD, ...result.waypointWorlds, SEGMENT_END_WORLD];
    for (let index = 0; index < pathPoints.length - 1; index += 1) {
      const assessment = assessRoverApproachPlanarSegmentClearance({
        segmentStartWorld: pathPoints[index],
        segmentEndWorld: pathPoints[index + 1],
        upAxisWorld: WORLD_UP,
        obstacles: deadEndObstacles,
        pathClearanceM: 0.02,
      });
      expect(assessment.isClear).toBe(true);
    }
  });

  it("routes around rotated box footprints instead of cutting through them", () => {
    const obstacles = [
      createBoxObstacle({
        id: "rotated-box",
        centerWorld: new THREE.Vector3(1.2, 0, 0),
        sizeWorld: new THREE.Vector3(0.75, 0.22, 0.3),
        rotationWorld: new THREE.Euler(0, 0, Math.PI / 4),
      }),
    ];

    const result = planRoverApproachNavigationPath({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: SEGMENT_END_WORLD,
      upAxisWorld: WORLD_UP,
      obstacles,
      pathClearanceM: 0.05,
      robotFootprint: NARROW_ROBOT_FOOTPRINT,
    });

    expect(result.mode).toBe("path");
    expect(result.waypointWorlds.length).toBeGreaterThan(0);
    expect(
      result.waypointWorlds.some((waypointWorld) => Math.abs(waypointWorld.y) > 0.12)
    ).toBe(true);
  });

  it("does not reuse blocked-cell occupancy across different robot footprints", () => {
    const obstacles = [
      createBoxObstacle({
        id: "center-blocker",
        centerWorld: new THREE.Vector3(1.2, 0, 0),
        sizeWorld: new THREE.Vector3(0.44, 0.44, 0.4),
      }),
    ];
    const scene = buildRoverApproachNavigationScene({
      upAxisWorld: WORLD_UP,
      obstacles,
    });

    const narrowResult = planRoverApproachNavigationPathInScene({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: SEGMENT_END_WORLD,
      scene,
      obstacles,
      pathClearanceM: 0.01,
      robotFootprint: NARROW_ROBOT_FOOTPRINT,
    });
    const wideResult = planRoverApproachNavigationPathInScene({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: SEGMENT_END_WORLD,
      scene,
      obstacles,
      pathClearanceM: 0.01,
      robotFootprint: WIDE_ROBOT_FOOTPRINT,
    });

    expect(narrowResult.mode).toBe("path");
    expect(wideResult.mode).not.toBe("direct");
    expect(scene.blockedCellKeyCache.size).toBe(2);
  });

  it("does not overreport collision for a rotated footprint near a front-axis obstacle", () => {
    const obstacles = [createObstacle("near-front-axis", new THREE.Vector3(0.18, 0, 0), 0.025)];
    const scene = buildRoverApproachNavigationScene({
      upAxisWorld: WORLD_UP,
      obstacles,
    });
    const diagonalForwardWorld = new THREE.Vector3(1, 1, 0).normalize();

    const assessment = assessRoverApproachNavigationSegmentInScene({
      segmentStartWorld: SEGMENT_START_WORLD,
      segmentEndWorld: SEGMENT_START_WORLD,
      scene,
      obstacles,
      pathClearanceM: 0,
      robotFootprint: NARROW_ROBOT_FOOTPRINT,
      footprintForwardWorldStart: diagonalForwardWorld,
      footprintForwardWorldEnd: diagonalForwardWorld,
    });

    expect(assessment.isClear).toBe(true);
  });
});
