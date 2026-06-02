import * as THREE from "three";
import { computeOwnedLinkLocalVisualBounds } from "@/features/camera/cameraAutoBounds";

type AxisName = "x" | "y" | "z";

const AXIS_PRIORITY: AxisName[] = ["x", "y", "z"];
const MIN_VALID_BOUNDS_EXTENT_METERS = 1e-9;
const TMP_LOCAL_SIZE = new THREE.Vector3();
const TMP_LOCAL_ANCHOR = new THREE.Vector3();

const resolveDominantBoundsAxis = (size: THREE.Vector3): AxisName => {
  let axis: AxisName = AXIS_PRIORITY[0];
  let dominantExtent = size[axis];
  for (let i = 1; i < AXIS_PRIORITY.length; i += 1) {
    const nextAxis = AXIS_PRIORITY[i];
    const nextExtent = size[nextAxis];
    if (nextExtent > dominantExtent) {
      dominantExtent = nextExtent;
      axis = nextAxis;
    }
  }
  return axis;
};

export const computeStableDragHandleAnchorLocalFromBounds = (
  localBounds: THREE.Box3,
  surfacePadMeters: number,
  out: THREE.Vector3
): THREE.Vector3 | null => {
  if (localBounds.isEmpty()) return null;
  localBounds.getCenter(out);
  const size = localBounds.getSize(TMP_LOCAL_SIZE);
  if (!Number.isFinite(size.x) || !Number.isFinite(size.y) || !Number.isFinite(size.z)) {
    return null;
  }
  if (
    size.x < MIN_VALID_BOUNDS_EXTENT_METERS &&
    size.y < MIN_VALID_BOUNDS_EXTENT_METERS &&
    size.z < MIN_VALID_BOUNDS_EXTENT_METERS
  ) {
    return null;
  }

  const dominantAxis = resolveDominantBoundsAxis(size);
  if (dominantAxis === "x") {
    out.x = localBounds.max.x + surfacePadMeters;
  } else if (dominantAxis === "y") {
    out.y = localBounds.max.y + surfacePadMeters;
  } else {
    out.z = localBounds.max.z + surfacePadMeters;
  }
  return out;
};

type ComputeStableDragHandleAnchorWorldParams = {
  linkObject: THREE.Object3D;
  surfacePadMeters: number;
  out: THREE.Vector3;
};

export const computeStableDragHandleAnchorWorld = ({
  linkObject,
  surfacePadMeters,
  out,
}: ComputeStableDragHandleAnchorWorldParams): THREE.Vector3 | null => {
  linkObject.updateMatrixWorld(true);
  const localBounds = computeOwnedLinkLocalVisualBounds(linkObject);
  if (!localBounds) return null;

  const localAnchor = computeStableDragHandleAnchorLocalFromBounds(
    localBounds,
    surfacePadMeters,
    TMP_LOCAL_ANCHOR
  );
  if (!localAnchor) return null;
  return out.copy(localAnchor).applyMatrix4(linkObject.matrixWorld);
};
