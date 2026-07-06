import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { resolveRoverApproachLockedGoalState } from "./approachGoalState";

const WORLD_UP = new THREE.Vector3(0, 0, 1);
const FORWARD_WORLD = new THREE.Vector3(1, 0, 0);

describe("resolveRoverApproachLockedGoalState", () => {
  it("keeps facing error against the object even when the rover is already at the standoff goal", () => {
    const state = resolveRoverApproachLockedGoalState({
      basePositionWorld: new THREE.Vector3(1, 0, 0),
      navigationGoalWorld: new THREE.Vector3(1, 0, 0),
      facingTargetWorld: new THREE.Vector3(1, 1, 0),
      forwardWorld: FORWARD_WORLD,
      upAxisWorld: WORLD_UP,
    });

    expect(state.distanceToGoalM).toBe(0);
    expect(state.yawErrorRad).toBeGreaterThan(0);
    expect(state.forwardDotFacingTarget).toBeLessThan(1);
  });

  it("uses a locked facing direction for waypoint legs instead of chasing the goal point", () => {
    const state = resolveRoverApproachLockedGoalState({
      basePositionWorld: new THREE.Vector3(0.6, 0.2, 0),
      navigationGoalWorld: new THREE.Vector3(1, 0, 0),
      facingDirectionWorld: new THREE.Vector3(1, 0, 0),
      forwardWorld: FORWARD_WORLD,
      upAxisWorld: WORLD_UP,
    });

    expect(state.distanceToGoalM).toBeGreaterThan(0);
    expect(state.yawErrorRad).toBeCloseTo(0);
    expect(state.forwardDotFacingTarget).toBeCloseTo(1);
  });

  it("falls back to the world-up plane when the up axis is invalid", () => {
    const state = resolveRoverApproachLockedGoalState({
      basePositionWorld: new THREE.Vector3(0, 0, 0),
      navigationGoalWorld: new THREE.Vector3(0, 0, 2),
      forwardWorld: FORWARD_WORLD,
      upAxisWorld: new THREE.Vector3(0, 0, 0),
    });

    expect(state.distanceToGoalM).toBe(0);
    expect(state.yawErrorRad).toBe(0);
    expect(state.forwardDotFacingTarget).toBe(1);
  });
});
