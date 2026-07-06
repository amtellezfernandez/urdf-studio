import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { WORLD_OBJECT_EDIT_PARAMS } from "@/features/objects/worldObjectEditParams";
import { buildWorldObjectFocusFrame } from "@/features/viewer/worldObjectFocusFrame";

describe("buildWorldObjectFocusFrame", () => {
  it("frames an object from the current camera direction", () => {
    const frame = buildWorldObjectFocusFrame({
      objectPosition: new THREE.Vector3(1, 2, 3),
      objectSize: new THREE.Vector3(2, 0, 0),
      cameraPosition: new THREE.Vector3(0, 0, 10),
      controlsTarget: new THREE.Vector3(0, 0, 0),
      cameraFovDegrees: 60,
      cameraAspect: 1,
    });

    expect(frame.radius).toBeCloseTo(1);
    expect(frame.distance).toBeCloseTo(2.3);
    expect(frame.target.toArray()).toEqual([1, 2, 3]);
    expect(frame.cameraPosition.x).toBeCloseTo(1);
    expect(frame.cameraPosition.y).toBeCloseTo(2);
    expect(frame.cameraPosition.z).toBeCloseTo(5.3);
    expect(frame.minDistance).toBeCloseTo(0.25);
    expect(frame.maxDistance).toBeCloseTo(20);
  });

  it("uses the default framing direction when the current camera direction is empty", () => {
    const frame = buildWorldObjectFocusFrame({
      objectPosition: new THREE.Vector3(0, 0, 0),
      objectSize: new THREE.Vector3(2, 0, 0),
      cameraPosition: new THREE.Vector3(0, 0, 0),
      controlsTarget: new THREE.Vector3(0, 0, 0),
      cameraFovDegrees: 60,
      cameraAspect: 1,
    });

    const defaultDirection = new THREE.Vector3(1, 1, 0.65).normalize();
    expect(frame.cameraPosition.x).toBeCloseTo(defaultDirection.x * frame.distance);
    expect(frame.cameraPosition.y).toBeCloseTo(defaultDirection.y * frame.distance);
    expect(frame.cameraPosition.z).toBeCloseTo(defaultDirection.z * frame.distance);
  });

  it("honors the minimum focus radius for very small objects", () => {
    const frame = buildWorldObjectFocusFrame({
      objectPosition: new THREE.Vector3(0, 0, 0),
      objectSize: new THREE.Vector3(0.01, 0.01, 0.01),
      cameraPosition: new THREE.Vector3(0, 0, 1),
      controlsTarget: new THREE.Vector3(0, 0, 0),
      cameraFovDegrees: 75,
      cameraAspect: 1.6,
    });

    expect(frame.radius).toBe(WORLD_OBJECT_EDIT_PARAMS.frameFocusMinRadiusM);
    expect(frame.minDistance).toBe(WORLD_OBJECT_EDIT_PARAMS.frameFocusMinDistanceFallbackM);
    expect(frame.maxDistance).toBe(WORLD_OBJECT_EDIT_PARAMS.frameFocusMaxDistanceFallbackM);
  });
});
