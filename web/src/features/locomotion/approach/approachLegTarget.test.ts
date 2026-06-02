import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  resolveRoverApproachFinalLegTarget,
  resolveRoverApproachWaypointLegTarget,
} from "./approachLegTarget";

describe("resolveRoverApproachWaypointLegTarget", () => {
  it("targets the waypoint with the same cloned point-target semantics as blue motion", () => {
    const waypointWorld = new THREE.Vector3(3, 2, 0);
    const target = resolveRoverApproachWaypointLegTarget({
      waypointWorld,
    });

    expect(target.applyObjectSupportRadius).toBe(false);
    expect(target.facingTargetWorld).not.toBeNull();
    expect(target.facingTargetWorld).not.toBe(waypointWorld);
    expect(target.facingTargetWorld?.equals(waypointWorld)).toBe(true);
    expect(target.facingDirectionWorld).toBeNull();
    expect(target.navigationGoalWorld.equals(waypointWorld)).toBe(true);
  });

  it("copies the waypoint world position for the active leg", () => {
    const waypointWorld = new THREE.Vector3(1, 1, 0);
    const target = resolveRoverApproachWaypointLegTarget({
      waypointWorld,
    });

    expect(target.navigationGoalWorld).not.toBe(waypointWorld);
    expect(target.navigationGoalWorld.equals(waypointWorld)).toBe(true);
  });
});

describe("resolveRoverApproachFinalLegTarget", () => {
  it("keeps the final facing target and object-support mode locked", () => {
    const navigationGoalWorld = new THREE.Vector3(1, 0, 0);
    const facingTargetWorld = new THREE.Vector3(2, 0, 0);
    const target = resolveRoverApproachFinalLegTarget({
      navigationGoalWorld,
      facingTargetWorld,
      applyObjectSupportRadius: true,
    });

    expect(target.applyObjectSupportRadius).toBe(true);
    expect(target.navigationGoalWorld).not.toBe(navigationGoalWorld);
    expect(target.facingTargetWorld).not.toBe(facingTargetWorld);
    expect(target.navigationGoalWorld.equals(navigationGoalWorld)).toBe(true);
    expect(target.facingTargetWorld?.equals(facingTargetWorld)).toBe(true);
  });
});
