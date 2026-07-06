import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { CreatedObject } from "@/features/objects";
import {
  normalizeOrbitPhaseDeg,
  resolveObjectCenterOfMassWorld,
  resolveObjectIkTargetWorld,
  resolveObjectOrbitFollowPath,
  resolveObjectOrbitPhaseWorldTarget,
  type IkOrbitDefaults,
} from "./objectTargeting";

const ORBIT_DEFAULTS: IkOrbitDefaults = {
  radius: 0.3,
  inclinationDeg: 45,
  phaseDeg: 0,
  secondaryOffsetDeg: 180,
};

const createObject = (overrides: Partial<CreatedObject> = {}): CreatedObject => ({
  id: "object-0",
  type: "cube",
  position: new THREE.Vector3(1, 2, 3),
  size: new THREE.Vector3(0.2, 0.2, 0.2),
  color: "#ffffff",
  source: "user",
  trackedJointName: null,
  isIkTarget: true,
  ikTargetType: "punctual",
  orbitRadius: ORBIT_DEFAULTS.radius,
  orbitInclination: ORBIT_DEFAULTS.inclinationDeg,
  orbitPhase: ORBIT_DEFAULTS.phaseDeg,
  orbitSecondaryOffset: ORBIT_DEFAULTS.secondaryOffsetDeg,
  orbitTargetPoint: "primary",
  ...overrides,
});

describe("objectTargeting", () => {
  it("uses object center as COM target", () => {
    const object = createObject();
    expect(resolveObjectCenterOfMassWorld(object)).toEqual([1, 2, 3]);
    expect(
      resolveObjectIkTargetWorld({
        object,
        orbitDefaults: ORBIT_DEFAULTS,
      })
    ).toEqual([1, 2, 3]);
  });

  it("uses object center for orbit center target point", () => {
    const object = createObject({
      ikTargetType: "orbit",
      orbitTargetPoint: "center",
    });
    expect(
      resolveObjectIkTargetWorld({
        object,
        orbitDefaults: ORBIT_DEFAULTS,
      })
    ).toEqual([1, 2, 3]);
  });

  it("resolves orbit target from selected orbit phase", () => {
    const object = createObject({
      ikTargetType: "orbit",
      orbitTargetPoint: "primary",
      orbitRadius: 0.5,
      orbitInclination: 0,
      orbitPhase: 90,
    });
    expect(
      resolveObjectOrbitPhaseWorldTarget({
        object,
        orbitDefaults: ORBIT_DEFAULTS,
        phaseDeg: 90,
      })
    ).toEqual([1, 2.5, 3]);
    expect(
      resolveObjectIkTargetWorld({
        object,
        orbitDefaults: ORBIT_DEFAULTS,
      })
    ).toEqual([1, 2.5, 3]);
  });

  it("applies secondary orbit offset for secondary targets", () => {
    const object = createObject({
      ikTargetType: "orbit",
      orbitTargetPoint: "secondary",
      orbitRadius: 0.5,
      orbitInclination: 0,
      orbitPhase: 0,
      orbitSecondaryOffset: 180,
    });
    const target = resolveObjectIkTargetWorld({
      object,
      orbitDefaults: ORBIT_DEFAULTS,
    });
    expect(target[0]).toBeCloseTo(0.5);
    expect(target[1]).toBeCloseTo(2);
    expect(target[2]).toBeCloseTo(3);
  });

  it("falls back to defaults for non-finite orbit params", () => {
    const object = createObject({
      ikTargetType: "orbit",
      orbitTargetPoint: "primary",
      orbitRadius: Number.NaN,
      orbitInclination: Number.NaN,
      orbitPhase: Number.NaN,
    });
    expect(
      resolveObjectIkTargetWorld({
        object,
        orbitDefaults: ORBIT_DEFAULTS,
      })
    ).toEqual([1.3, 2, 3]);
  });

  it("normalizes orbit phases into one revolution", () => {
    expect(normalizeOrbitPhaseDeg(390)).toBe(30);
    expect(normalizeOrbitPhaseDeg(-30)).toBe(330);
    expect(normalizeOrbitPhaseDeg(720)).toBe(0);
  });

  it("resolves the shortest orbit follow path across phase wraparound", () => {
    const primaryStart = createObject({
      orbitPhase: 350,
      orbitSecondaryOffset: 40,
      orbitTargetPoint: "primary",
    });
    expect(
      resolveObjectOrbitFollowPath({
        object: primaryStart,
        orbitDefaults: ORBIT_DEFAULTS,
      })
    ).toEqual({
      startPhaseDeg: 350,
      destinationPhaseDeg: 30,
      arcLengthDeg: 40,
      direction: 1,
    });

    const secondaryStart = createObject({
      orbitPhase: 350,
      orbitSecondaryOffset: 40,
      orbitTargetPoint: "secondary",
    });
    expect(
      resolveObjectOrbitFollowPath({
        object: secondaryStart,
        orbitDefaults: ORBIT_DEFAULTS,
      })
    ).toEqual({
      startPhaseDeg: 30,
      destinationPhaseDeg: 350,
      arcLengthDeg: 40,
      direction: -1,
    });
  });

  it("keeps full-circle orbit follow behavior when target phases overlap", () => {
    const object = createObject({
      orbitPhase: 0,
      orbitSecondaryOffset: 360,
      orbitTargetPoint: "primary",
    });
    expect(
      resolveObjectOrbitFollowPath({
        object,
        orbitDefaults: ORBIT_DEFAULTS,
      })
    ).toEqual({
      startPhaseDeg: 0,
      destinationPhaseDeg: 0,
      arcLengthDeg: 360,
      direction: 1,
    });
  });

  it("does not resolve an orbit follow path for the center target point", () => {
    const object = createObject({
      orbitTargetPoint: "center",
    });
    expect(
      resolveObjectOrbitFollowPath({
        object,
        orbitDefaults: ORBIT_DEFAULTS,
      })
    ).toBeNull();
  });
});
