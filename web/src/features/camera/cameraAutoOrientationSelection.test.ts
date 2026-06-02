import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { LocalCameraFrameCue } from "./cameraAutoBounds";
import { resolvePreferredOrientationFromCues } from "./cameraAutoOrientationSelection";

const FRAME_FORWARD = new THREE.Vector3(1, 0, 0);
const FRAME_RIGHT = new THREE.Vector3(0, 1, 0);
const FRAME_UP = new THREE.Vector3(0, 0, 1);
const MESH_AXIS_FORWARD = new THREE.Vector3(0, 1, 0);
const MESH_AXIS_UP = new THREE.Vector3(0, 0, 1);
const DIRECTION_FORWARD = new THREE.Vector3(0, -1, 0);

const createFrameCue = (): LocalCameraFrameCue => ({
  forward: FRAME_FORWARD.clone(),
  right: FRAME_RIGHT.clone(),
  up: FRAME_UP.clone(),
  confidence: 1,
});

describe("resolvePreferredOrientationFromCues", () => {
  it("prioritizes coherent frame cues over mixed fallback cues", () => {
    const frameCue = createFrameCue();
    const result = resolvePreferredOrientationFromCues({
      frameCue,
      directionForward: DIRECTION_FORWARD,
      meshAxisForwardCue: MESH_AXIS_FORWARD,
      meshAxisUpCue: MESH_AXIS_UP,
    });

    expect(result.preferredForward?.dot(FRAME_FORWARD)).toBeCloseTo(1, 8);
    expect(result.preferredUp?.dot(FRAME_UP)).toBeCloseTo(1, 8);
    expect(result.preferredForward).not.toBe(frameCue.forward);
    expect(result.preferredUp).not.toBe(frameCue.up);
  });

  it("uses mesh-axis cues when frame cue is missing", () => {
    const result = resolvePreferredOrientationFromCues({
      frameCue: null,
      directionForward: DIRECTION_FORWARD,
      meshAxisForwardCue: MESH_AXIS_FORWARD,
      meshAxisUpCue: MESH_AXIS_UP,
    });

    expect(result.preferredForward?.dot(MESH_AXIS_FORWARD)).toBeCloseTo(1, 8);
    expect(result.preferredUp?.dot(MESH_AXIS_UP)).toBeCloseTo(1, 8);
  });

  it("falls back to direction forward when no frame/mesh forward exists", () => {
    const result = resolvePreferredOrientationFromCues({
      frameCue: null,
      directionForward: DIRECTION_FORWARD,
      meshAxisForwardCue: null,
      meshAxisUpCue: null,
    });

    expect(result.preferredForward?.dot(DIRECTION_FORWARD)).toBeCloseTo(1, 8);
    expect(result.preferredUp).toBeNull();
  });
});
