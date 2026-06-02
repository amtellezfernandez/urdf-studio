import * as THREE from "three";

export type PlanarClampReason = "y" | "roll" | "pitch";

export type PlanarClampResult = {
  clamped: boolean;
  reasons: PlanarClampReason[];
  floorHeight: number;
};

export type GroundHeightFn = (x: number, z: number) => number;

export const FLAT_GROUND_HEIGHT_FN: GroundHeightFn = () => 0;

type EnforcePlanarBasePoseOptions = {
  groundHeightFn?: GroundHeightFn;
  epsilon?: number;
  lockRollPitch?: boolean;
  updateMatrixWorld?: boolean;
};

export const enforcePlanarBasePose = (
  object: THREE.Object3D,
  options: EnforcePlanarBasePoseOptions = {}
): PlanarClampResult => {
  const groundHeightFn = options.groundHeightFn ?? FLAT_GROUND_HEIGHT_FN;
  const epsilon = Number.isFinite(options.epsilon) ? Math.max(options.epsilon ?? 0, 0) : 1e-6;
  const lockRollPitch = options.lockRollPitch !== false;
  const updateMatrixWorld = options.updateMatrixWorld !== false;

  const sampledHeight = groundHeightFn(object.position.x, object.position.z);
  const floorHeight = Number.isFinite(sampledHeight) ? sampledHeight : 0;
  const reasons: PlanarClampReason[] = [];

  if (Math.abs(object.position.y - floorHeight) > epsilon) {
    object.position.y = floorHeight;
    reasons.push("y");
  }

  if (lockRollPitch && Math.abs(object.rotation.x) > epsilon) {
    object.rotation.x = 0;
    reasons.push("roll");
  }

  if (lockRollPitch && Math.abs(object.rotation.z) > epsilon) {
    object.rotation.z = 0;
    reasons.push("pitch");
  }

  if (reasons.length > 0 && updateMatrixWorld) {
    object.updateMatrixWorld(true);
  }

  return {
    clamped: reasons.length > 0,
    reasons,
    floorHeight,
  };
};
