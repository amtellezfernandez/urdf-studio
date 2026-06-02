import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { buildRoverApproachPlanarObstacles } from "./approachObstacleProjection";

const WORLD_UP = new THREE.Vector3(0, 0, 1);

describe("approachObstacleProjection", () => {
  it("builds planar obstacles for visible objects only", () => {
    const obstacles = buildRoverApproachPlanarObstacles({
      objects: [
        {
          id: "visible",
          type: "cube",
          position: new THREE.Vector3(1, 2, 0),
          rotation: new THREE.Euler(0, 0, Math.PI / 4),
          size: new THREE.Vector3(0.4, 0.6, 0.8),
        },
        {
          id: "hidden",
          type: "cube",
          position: new THREE.Vector3(3, 4, 0),
          size: new THREE.Vector3(1, 1, 1),
          isHidden: true,
        },
      ],
      upAxisWorld: WORLD_UP,
    });

    expect(obstacles).toHaveLength(1);
    expect(obstacles[0]?.id).toBe("visible");
    expect(obstacles[0]?.centerWorld.equals(new THREE.Vector3(1, 2, 0))).toBe(true);
    expect(obstacles[0]?.radiusM).toBeGreaterThan(0);
    expect(obstacles[0]?.rotationWorld?.z).toBeCloseTo(Math.PI / 4);
  });

  it("normalizes invalid object vectors before projection", () => {
    const obstacles = buildRoverApproachPlanarObstacles({
      objects: [
        {
          id: "invalid",
          type: "cube",
          position: new THREE.Vector3(Number.NaN, 0, 0),
          size: new THREE.Vector3(0.4, 0.4, 0.4),
        },
      ],
      upAxisWorld: WORLD_UP,
    });

    expect(obstacles).toHaveLength(1);
    expect(Number.isFinite(obstacles[0]?.centerWorld.x)).toBe(true);
    expect(Number.isFinite(obstacles[0]?.radiusM)).toBe(true);
  });
});
