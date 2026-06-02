import * as THREE from "three";
import type { LocalCameraFrameCue } from "./cameraAutoBounds";

type ResolvePreferredOrientationFromCuesOptions = {
  frameCue: LocalCameraFrameCue | null;
  directionForward: THREE.Vector3 | null;
  meshAxisForwardCue: THREE.Vector3 | null;
  meshAxisUpCue: THREE.Vector3 | null;
};

type PreferredOrientationCues = {
  preferredForward: THREE.Vector3 | null;
  preferredUp: THREE.Vector3 | null;
};

const cloneCue = (cue: THREE.Vector3 | null | undefined) => (cue ? cue.clone() : null);

export const resolvePreferredOrientationFromCues = ({
  frameCue,
  directionForward,
  meshAxisForwardCue,
  meshAxisUpCue,
}: ResolvePreferredOrientationFromCuesOptions): PreferredOrientationCues => {
  const preferredForward =
    frameCue?.forward ?? meshAxisForwardCue ?? directionForward ?? null;
  const preferredUp = frameCue?.up ?? meshAxisUpCue ?? null;

  return {
    preferredForward: cloneCue(preferredForward),
    preferredUp: cloneCue(preferredUp),
  };
};
