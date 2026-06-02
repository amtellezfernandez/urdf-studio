import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { CreatedObject } from "@/features/objects";
import { IK_OBJECT_TARGET_PARAMS } from "@/features/viewer/ikObjectTargetParams";
import {
  resolveIkObjectSolveTargetWorld,
  type WorldTargetPosition,
} from "./ikObjectTargetSelection";

const CUBE_HALF_EXTENT_X_METERS = 0.15;
const CUBE_SIZE_X_METERS = CUBE_HALF_EXTENT_X_METERS * 2;
const CUBE_SIZE_Y_METERS = 0.2;
const CUBE_SIZE_Z_METERS = 0.12;
const POINT_RADIUS_METERS = 0.01;
const POINT_SIZE_METERS = POINT_RADIUS_METERS * 2;
const OBJECT_CENTER: WorldTargetPosition = [1, 2, 3];

const createObject = (overrides: Partial<CreatedObject> = {}): CreatedObject => ({
  id: "object-0",
  type: "cube",
  position: new THREE.Vector3(OBJECT_CENTER[0], OBJECT_CENTER[1], OBJECT_CENTER[2]),
  size: new THREE.Vector3(CUBE_SIZE_X_METERS, CUBE_SIZE_Y_METERS, CUBE_SIZE_Z_METERS),
  color: "#ffffff",
  trackedJointName: null,
  isIkTarget: true,
  ikTargetType: "punctual",
  ...overrides,
});

describe("resolveIkObjectSolveTargetWorld", () => {
  it("targets punctual cube objects on nearest external surface", () => {
    const objectTargetPositionWorld: WorldTargetPosition = OBJECT_CENTER;
    const effectorWorldPosition = new THREE.Vector3(4, 2, 3);
    const clampTargetPositionToArmReach = vi.fn((): WorldTargetPosition => [9, 9, 9]);
    const result = resolveIkObjectSolveTargetWorld({
      object: createObject(),
      objectTargetPositionWorld,
      isOrbitTarget: false,
      effectorWorldPosition,
      clampTargetPositionToArmReach,
    });
    expect(result[0]).toBeCloseTo(
      OBJECT_CENTER[0] + CUBE_HALF_EXTENT_X_METERS + IK_OBJECT_TARGET_PARAMS.surfacePadMeters
    );
    expect(result[1]).toBeCloseTo(OBJECT_CENTER[1]);
    expect(result[2]).toBeCloseTo(OBJECT_CENTER[2]);
    expect(clampTargetPositionToArmReach).not.toHaveBeenCalled();
  });

  it("targets punctual point objects on external radius with pad", () => {
    const objectTargetPositionWorld: WorldTargetPosition = OBJECT_CENTER;
    const effectorWorldPosition = new THREE.Vector3(1, 5, 3);
    const result = resolveIkObjectSolveTargetWorld({
      object: createObject({
        type: "point",
        size: new THREE.Vector3(POINT_SIZE_METERS, POINT_SIZE_METERS, POINT_SIZE_METERS),
      }),
      objectTargetPositionWorld,
      isOrbitTarget: false,
      effectorWorldPosition,
      clampTargetPositionToArmReach: (target) => target,
    });
    expect(result[0]).toBeCloseTo(OBJECT_CENTER[0]);
    expect(result[1]).toBeCloseTo(
      OBJECT_CENTER[1] + POINT_RADIUS_METERS + IK_OBJECT_TARGET_PARAMS.surfacePadMeters
    );
    expect(result[2]).toBeCloseTo(OBJECT_CENTER[2]);
  });

  it("keeps orbit targets clamped to reachable range", () => {
    const objectTargetPositionWorld: WorldTargetPosition = OBJECT_CENTER;
    const clampTargetPositionToArmReach = vi.fn(
      (): WorldTargetPosition => [0.4, 0.5, 0.6]
    );
    const result = resolveIkObjectSolveTargetWorld({
      object: createObject({
        ikTargetType: "orbit",
      }),
      objectTargetPositionWorld,
      isOrbitTarget: true,
      effectorWorldPosition: new THREE.Vector3(0, 0, 0),
      clampTargetPositionToArmReach,
    });
    expect(result).toEqual([0.4, 0.5, 0.6]);
    expect(clampTargetPositionToArmReach).toHaveBeenCalledWith(OBJECT_CENTER);
  });

  it("re-resolves a punctual surface target from the settled post-approach pose", () => {
    const objectTargetPositionWorld: WorldTargetPosition = OBJECT_CENTER;
    const initialEffectorWorldPosition = new THREE.Vector3(4, 2, 3);
    const laterEffectorWorldPosition = new THREE.Vector3(1, -2, 3);
    const initialTarget = resolveIkObjectSolveTargetWorld({
      object: createObject(),
      objectTargetPositionWorld,
      isOrbitTarget: false,
      effectorWorldPosition: initialEffectorWorldPosition,
      clampTargetPositionToArmReach: (target) => target,
    });

    const recomputedTarget = resolveIkObjectSolveTargetWorld({
      object: createObject(),
      objectTargetPositionWorld,
      isOrbitTarget: false,
      effectorWorldPosition: laterEffectorWorldPosition,
      clampTargetPositionToArmReach: (target) => target,
    });

    expect(initialTarget).not.toEqual(recomputedTarget);
    expect(initialTarget[0]).toBeCloseTo(
      OBJECT_CENTER[0] + CUBE_HALF_EXTENT_X_METERS + IK_OBJECT_TARGET_PARAMS.surfacePadMeters
    );
    expect(recomputedTarget[1]).toBeLessThan(OBJECT_CENTER[1]);
  });
});
