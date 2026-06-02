import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  resolvePlanarProjectedObstacleRadiusM,
  resolveRoverApproachDetourWaypoint,
  type RoverApproachPlanarObstacle,
} from "./approachDetour";

const WORLD_UP = new THREE.Vector3(0, 0, 1);
const SEGMENT_START = new THREE.Vector3(0, 0, 0);
const SEGMENT_END = new THREE.Vector3(2, 0, 0);
const PATH_CLEARANCE_M = 0.05;

const createObstacle = (
  id: string,
  centerWorld: THREE.Vector3,
  radiusM: number
): RoverApproachPlanarObstacle => ({
  id,
  centerWorld,
  radiusM,
});

describe("approachDetour", () => {
  it("keeps direct path when segment is clear", () => {
    const result = resolveRoverApproachDetourWaypoint({
      segmentStartWorld: SEGMENT_START,
      segmentEndWorld: SEGMENT_END,
      upAxisWorld: WORLD_UP,
      obstacles: [createObstacle("obs", new THREE.Vector3(1, 0.8, 0), 0.15)],
      pathClearanceM: PATH_CLEARANCE_M,
    });

    expect(result.mode).toBe("direct");
    expect(result.waypointWorld).toBeNull();
  });

  it("returns a detour waypoint when direct line intersects obstacle clearance", () => {
    const result = resolveRoverApproachDetourWaypoint({
      segmentStartWorld: SEGMENT_START,
      segmentEndWorld: SEGMENT_END,
      upAxisWorld: WORLD_UP,
      obstacles: [createObstacle("obs", new THREE.Vector3(1, 0, 0), 0.2)],
      pathClearanceM: PATH_CLEARANCE_M,
    });

    expect(result.mode).toBe("detour");
    expect(result.waypointWorld).not.toBeNull();
    if (result.mode === "detour") {
      expect(Math.abs(result.waypointWorld.y)).toBeGreaterThan(0.1);
    }
  });

  it("returns direct when every detour candidate still collides", () => {
    const result = resolveRoverApproachDetourWaypoint({
      segmentStartWorld: SEGMENT_START,
      segmentEndWorld: SEGMENT_END,
      upAxisWorld: WORLD_UP,
      obstacles: [
        createObstacle("primary", new THREE.Vector3(1, 0, 0), 0.2),
        createObstacle("upper-blocker", new THREE.Vector3(1, 0.34, 0), 0.12),
        createObstacle("lower-blocker", new THREE.Vector3(1, -0.34, 0), 0.12),
      ],
      pathClearanceM: PATH_CLEARANCE_M,
    });

    expect(result.mode).toBe("direct");
    expect(result.waypointWorld).toBeNull();
  });

  it("resolves projected planar radius from 3D half extents", () => {
    const radiusM = resolvePlanarProjectedObstacleRadiusM({
      halfExtentsWorld: new THREE.Vector3(0.5, 0.25, 0.1),
      upAxisWorld: WORLD_UP,
    });

    expect(radiusM).toBeCloseTo(Math.sqrt(0.5 * 0.5 + 0.25 * 0.25), 6);
  });
});

