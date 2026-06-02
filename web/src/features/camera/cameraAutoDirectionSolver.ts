import * as THREE from "three";
import {
  resolveDirectionCueFromDirectionSamples as resolveDirectionCueFromDirectionSamplesCore,
  resolvePrincipalAxesFromDirectionSamples as resolvePrincipalAxesFromDirectionSamplesCore,
  resolveUpCueFromDirectionSamples as resolveUpCueFromDirectionSamplesCore,
} from "@/shared/lib/urdfCore";

export type PrincipalAxes = {
  primary: THREE.Vector3;
  secondary: THREE.Vector3;
  tertiary: THREE.Vector3;
};

export type LocalDirectionSample = {
  offset: THREE.Vector3;
  distance: number;
};

const toTupleSample = (sample: LocalDirectionSample) => ({
  offset: [sample.offset.x, sample.offset.y, sample.offset.z] as [number, number, number],
  distance: sample.distance,
});

const fromTupleVector = (vector: readonly number[]): THREE.Vector3 =>
  new THREE.Vector3(vector[0] ?? 0, vector[1] ?? 0, vector[2] ?? 0);

export const resolvePrincipalAxisFromDirectionSamples = (
  samples: LocalDirectionSample[]
): THREE.Vector3 | null => {
  const principalAxes = resolvePrincipalAxesFromDirectionSamplesCore(samples.map(toTupleSample));
  return principalAxes ? fromTupleVector(principalAxes.primary) : null;
};

const resolvePrincipalAxesFromDirectionSamples = (
  samples: LocalDirectionSample[]
): PrincipalAxes | null => {
  const principalAxes = resolvePrincipalAxesFromDirectionSamplesCore(samples.map(toTupleSample));
  if (!principalAxes) {
    return null;
  }
  return {
    primary: fromTupleVector(principalAxes.primary),
    secondary: fromTupleVector(principalAxes.secondary),
    tertiary: fromTupleVector(principalAxes.tertiary),
  };
};

export const resolveDirectionCueFromDirectionSamples = (
  samples: LocalDirectionSample[]
): THREE.Vector3 | null => {
  const cue = resolveDirectionCueFromDirectionSamplesCore(samples.map(toTupleSample));
  return cue ? fromTupleVector(cue.axis) : null;
};

export const resolveUpCueFromDirectionSamples = (
  samples: LocalDirectionSample[],
  forwardDirection: THREE.Vector3,
  localUpReference: THREE.Vector3
): THREE.Vector3 | null => {
  const cue = resolveUpCueFromDirectionSamplesCore(
    samples.map(toTupleSample),
    [forwardDirection.x, forwardDirection.y, forwardDirection.z],
    [localUpReference.x, localUpReference.y, localUpReference.z]
  );
  return cue ? fromTupleVector(cue.axis) : null;
};
