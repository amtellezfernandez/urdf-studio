export type TransformContract = {
  strictParity: boolean;
  allowUrdfMutation: boolean;
  allowAxisRemap: boolean;
  allowGeometryBake: boolean;
};

export const DEFAULT_TRANSFORM_CONTRACT: TransformContract = {
  strictParity: true,
  allowUrdfMutation: false,
  allowAxisRemap: false,
  allowGeometryBake: false,
};

export const getTransformContract = (): TransformContract => {
  return DEFAULT_TRANSFORM_CONTRACT;
};

export const assertTransformContract = (contract: TransformContract) => {
  if (!import.meta.env.DEV) return;

  if (!contract.strictParity) {
    console.warn("[URDF runtime] strict parity disabled.");
  }
  if (contract.allowUrdfMutation) {
    console.warn("[URDF runtime] URDF mutation is enabled and may diverge from source semantics.");
  }
  if (contract.allowAxisRemap) {
    console.warn("[URDF runtime] axis remap is enabled and may diverge from URDF visual parity.");
  }
  if (contract.allowGeometryBake) {
    console.warn("[URDF runtime] geometry baking is enabled and may alter mesh-space transforms.");
  }
};
