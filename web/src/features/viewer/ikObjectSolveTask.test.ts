import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { CreatedObject } from "@/features/objects";
import { createLockedIkObjectSolveTask } from "./ikObjectSolveTask";

const createObject = (overrides: Partial<CreatedObject> = {}): CreatedObject => ({
  id: "object-0",
  type: "cube",
  position: new THREE.Vector3(1, 2, 3),
  rotation: new THREE.Euler(0, 0, Math.PI / 6),
  size: new THREE.Vector3(0.4, 0.2, 0.2),
  color: "#ffffff",
  trackedJointName: null,
  isIkTarget: true,
  ikTargetType: "punctual",
  ...overrides,
});

const ORBIT_DEFAULTS = {
  radius: 0.5,
  inclinationDeg: 10,
  phaseDeg: 20,
  secondaryOffsetDeg: 180,
} as const;

describe("createLockedIkObjectSolveTask", () => {
  it("locks the clicked object snapshot and target position", () => {
    const object = createObject();

    const task = createLockedIkObjectSolveTask({
      object,
      orbitDefaults: ORBIT_DEFAULTS,
    });

    object.position.set(9, 9, 9);
    object.size.set(1, 1, 1);
    object.rotation?.set(0, 0, 0);

    expect(task.object).not.toBe(object);
    expect(task.object.position.toArray()).toEqual([1, 2, 3]);
    expect(task.object.size.toArray()).toEqual([0.4, 0.2, 0.2]);
    expect(task.object.rotation?.z).toBeCloseTo(Math.PI / 6);
    expect(task.objectTargetPositionWorld).toEqual([1, 2, 3]);
    expect(task.isOrbitTarget).toBe(false);
  });

  it("locks the chosen orbit target point at task creation time", () => {
    const object = createObject({
      ikTargetType: "orbit",
      orbitTargetPoint: "secondary",
      orbitPhase: 0,
      orbitSecondaryOffset: 180,
    });

    const task = createLockedIkObjectSolveTask({
      object,
      orbitDefaults: ORBIT_DEFAULTS,
    });

    object.orbitTargetPoint = "primary";
    expect(task.isOrbitTarget).toBe(true);
    expect(task.object.orbitTargetPoint).toBe("secondary");
    expect(task.objectTargetPositionWorld[0]).toBeLessThan(1);
  });
});
