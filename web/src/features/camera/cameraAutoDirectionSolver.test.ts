import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  resolveUpCueFromDirectionSamples,
  type LocalDirectionSample,
} from "./cameraAutoDirectionSolver";

const FORWARD_X = new THREE.Vector3(1, 0, 0);
const LOCAL_UP_POSITIVE_Z = new THREE.Vector3(0, 0, 1);
const LOCAL_UP_NEGATIVE_Z = new THREE.Vector3(0, 0, -1);
const DIAGONAL_UP_DIRECTION = new THREE.Vector3(0, 1, 1).normalize();
const SAMPLE_DISTANCE_NEAR = 1.0;
const SAMPLE_DISTANCE_FAR = 2.0;
const FORWARD_HALF_EXTENT_X = 0.12;
const LATERAL_HALF_EXTENT_Y = 0.08;
const UP_HALF_EXTENT_Z = 0.03;
const ORTHOGONAL_DOT_MAX = 1e-6;
const UP_ALIGNMENT_DOT_MIN = 0.6;
const UP_ALIGNMENT_DOT_STRONG = 0.9;

const createSample = (direction: THREE.Vector3, distance: number): LocalDirectionSample => ({
  offset: direction.clone().multiplyScalar(distance),
  distance,
});

const createDiagonalUpSamples = (): LocalDirectionSample[] => [
  createSample(DIAGONAL_UP_DIRECTION, SAMPLE_DISTANCE_NEAR),
  createSample(DIAGONAL_UP_DIRECTION, SAMPLE_DISTANCE_FAR),
  createSample(DIAGONAL_UP_DIRECTION.clone().multiplyScalar(-1), SAMPLE_DISTANCE_NEAR),
  createSample(DIAGONAL_UP_DIRECTION.clone().multiplyScalar(-1), SAMPLE_DISTANCE_FAR),
];

const createBoxCornerSamples = (
  halfExtentX: number,
  halfExtentY: number,
  halfExtentZ: number
): LocalDirectionSample[] => {
  const signs = [-1, 1] as const;
  const samples: LocalDirectionSample[] = [];
  signs.forEach((sx) => {
    signs.forEach((sy) => {
      signs.forEach((sz) => {
        const offset = new THREE.Vector3(
          sx * halfExtentX,
          sy * halfExtentY,
          sz * halfExtentZ
        );
        samples.push({
          offset: offset.clone(),
          distance: offset.length(),
        });
      });
    });
  });
  return samples;
};

describe("resolveUpCueFromDirectionSamples", () => {
  it("anchors up-cue sign to local up reference", () => {
    const samples = createDiagonalUpSamples();
    const upCuePositive = resolveUpCueFromDirectionSamples(
      samples,
      FORWARD_X,
      LOCAL_UP_POSITIVE_Z
    );
    const upCueNegative = resolveUpCueFromDirectionSamples(
      samples,
      FORWARD_X,
      LOCAL_UP_NEGATIVE_Z
    );

    expect(upCuePositive).not.toBeNull();
    expect(upCueNegative).not.toBeNull();
    expect(Math.abs(upCuePositive!.dot(FORWARD_X))).toBeLessThan(ORTHOGONAL_DOT_MAX);
    expect(Math.abs(upCueNegative!.dot(FORWARD_X))).toBeLessThan(ORTHOGONAL_DOT_MAX);
    expect(upCuePositive!.dot(LOCAL_UP_POSITIVE_Z)).toBeGreaterThan(UP_ALIGNMENT_DOT_MIN);
    expect(upCueNegative!.dot(LOCAL_UP_POSITIVE_Z)).toBeLessThan(-UP_ALIGNMENT_DOT_MIN);
  });

  it("prefers local-up alignment over wider lateral span when selecting up axis", () => {
    const samples = createBoxCornerSamples(
      FORWARD_HALF_EXTENT_X,
      LATERAL_HALF_EXTENT_Y,
      UP_HALF_EXTENT_Z
    );
    const upCue = resolveUpCueFromDirectionSamples(samples, FORWARD_X, LOCAL_UP_POSITIVE_Z);

    expect(upCue).not.toBeNull();
    expect(Math.abs(upCue!.dot(FORWARD_X))).toBeLessThan(ORTHOGONAL_DOT_MAX);
    expect(upCue!.dot(LOCAL_UP_POSITIVE_Z)).toBeGreaterThan(UP_ALIGNMENT_DOT_STRONG);
  });
});
