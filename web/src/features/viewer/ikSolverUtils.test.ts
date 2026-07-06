import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { resolveIkRearTransitWorldTarget } from "./ikSolverUtils";

describe("ikSolverUtils", () => {
  it("resolves a rear-target transit waypoint in the base-to-target direction", () => {
    const waypoint = resolveIkRearTransitWorldTarget({
      baseWorldPosition: new THREE.Vector3(0, 0, 0),
      effectorWorldPosition: new THREE.Vector3(0.2, 0, 0.1),
      targetWorldPosition: new THREE.Vector3(1, 0, 0.2),
    });

    expect(waypoint[0]).toBeCloseTo(0.3);
    expect(waypoint[1]).toBeCloseTo(0);
    expect(waypoint[2]).toBeCloseTo(0.34);
  });

  it("uses the effector planar direction when the target is above the base", () => {
    const waypoint = resolveIkRearTransitWorldTarget({
      baseWorldPosition: new THREE.Vector3(0, 0, 0),
      effectorWorldPosition: new THREE.Vector3(0, -1, 0.1),
      targetWorldPosition: new THREE.Vector3(0, 0, 0.2),
    });

    expect(waypoint[0]).toBeCloseTo(0);
    expect(waypoint[1]).toBeCloseTo(-0.12);
    expect(waypoint[2]).toBeCloseTo(0.26);
  });

  it("falls back to the x axis when planar direction is degenerate", () => {
    const waypoint = resolveIkRearTransitWorldTarget({
      baseWorldPosition: new THREE.Vector3(0, 0, 0),
      effectorWorldPosition: new THREE.Vector3(0, 0, 0),
      targetWorldPosition: new THREE.Vector3(0, 0, 0),
    });

    expect(waypoint[0]).toBeCloseTo(0.12);
    expect(waypoint[1]).toBeCloseTo(0);
    expect(waypoint[2]).toBeCloseTo(0.18);
  });
});
