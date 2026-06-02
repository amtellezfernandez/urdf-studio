import * as THREE from "three";
import { composeUrdfPoseMatrix } from "@/shared/lib/spatialFrame";

export type UrdfOriginPose = {
  xyz: [number, number, number];
  rpy: [number, number, number];
};

export type UrdfOriginAttributes = {
  xyz: string;
  rpy: string;
};

export type ResolvedUrdfOriginBake = {
  originalOrigin: UrdfOriginPose;
  bakedOrigin: UrdfOriginPose;
  bakeMatrix: THREE.Matrix4;
};

export const IDENTITY_URDF_ORIGIN: UrdfOriginPose = {
  xyz: [0, 0, 0],
  rpy: [0, 0, 0],
};

export const URDF_BAKE_SCALE_EPSILON = 1e-6;
const URDF_ORIGIN_COMPONENT_EPSILON = 1e-10;

const URDF_RPY_ORDER: THREE.EulerOrder = "ZYX";
const MATRIX_DECOMPOSE_POSITION = new THREE.Vector3();
const MATRIX_DECOMPOSE_QUATERNION = new THREE.Quaternion();
const MATRIX_DECOMPOSE_SCALE = new THREE.Vector3();
const MATRIX_DECOMPOSE_EULER = new THREE.Euler(0, 0, 0, URDF_RPY_ORDER);
const TEMP_INVERSE_BAKE_MATRIX = new THREE.Matrix4();
const TEMP_RESIDUAL_MATRIX = new THREE.Matrix4();

const normalizeOriginComponent = (value: number): number =>
  Math.abs(value) <= URDF_ORIGIN_COMPONENT_EPSILON ? 0 : value;

const assertUnitScaleMatrix = (matrix: THREE.Matrix4): void => {
  matrix.decompose(
    MATRIX_DECOMPOSE_POSITION,
    MATRIX_DECOMPOSE_QUATERNION,
    MATRIX_DECOMPOSE_SCALE
  );

  if (
    Math.abs(MATRIX_DECOMPOSE_SCALE.x - 1) > URDF_BAKE_SCALE_EPSILON ||
    Math.abs(MATRIX_DECOMPOSE_SCALE.y - 1) > URDF_BAKE_SCALE_EPSILON ||
    Math.abs(MATRIX_DECOMPOSE_SCALE.z - 1) > URDF_BAKE_SCALE_EPSILON
  ) {
    throw new Error("URDF origin bake math only supports rigid transforms with unit scale.");
  }
};

const formatOriginComponent = (value: number): string => {
  const normalizedValue = normalizeOriginComponent(value);
  return Number.isInteger(normalizedValue) ? `${normalizedValue}` : normalizedValue.toPrecision(12);
};

export const composeUrdfOriginMatrix = (
  origin: UrdfOriginPose,
  out = new THREE.Matrix4()
): THREE.Matrix4 =>
  composeUrdfPoseMatrix(
    {
      xyz: origin.xyz,
      rpy: origin.rpy,
    },
    out
  );

export const decomposeUrdfOriginMatrix = (matrix: THREE.Matrix4): UrdfOriginPose => {
  assertUnitScaleMatrix(matrix);
  matrix.decompose(
    MATRIX_DECOMPOSE_POSITION,
    MATRIX_DECOMPOSE_QUATERNION,
    MATRIX_DECOMPOSE_SCALE
  );
  MATRIX_DECOMPOSE_EULER.setFromQuaternion(MATRIX_DECOMPOSE_QUATERNION, URDF_RPY_ORDER);

  return {
    xyz: [
      normalizeOriginComponent(MATRIX_DECOMPOSE_POSITION.x),
      normalizeOriginComponent(MATRIX_DECOMPOSE_POSITION.y),
      normalizeOriginComponent(MATRIX_DECOMPOSE_POSITION.z),
    ],
    rpy: [
      normalizeOriginComponent(MATRIX_DECOMPOSE_EULER.x),
      normalizeOriginComponent(MATRIX_DECOMPOSE_EULER.y),
      normalizeOriginComponent(MATRIX_DECOMPOSE_EULER.z),
    ],
  };
};

export const buildUrdfOriginAttributes = (origin: UrdfOriginPose): UrdfOriginAttributes => ({
  xyz: origin.xyz.map(formatOriginComponent).join(" "),
  rpy: origin.rpy.map(formatOriginComponent).join(" "),
});

export const resolveUrdfOriginBake = (
  origin: UrdfOriginPose,
  bakeMatrix: THREE.Matrix4
): ResolvedUrdfOriginBake => {
  assertUnitScaleMatrix(bakeMatrix);
  const originalOriginMatrix = composeUrdfOriginMatrix(origin);
  TEMP_INVERSE_BAKE_MATRIX.copy(bakeMatrix).invert();
  TEMP_RESIDUAL_MATRIX.multiplyMatrices(originalOriginMatrix, TEMP_INVERSE_BAKE_MATRIX);

  return {
    originalOrigin: origin,
    bakedOrigin: decomposeUrdfOriginMatrix(TEMP_RESIDUAL_MATRIX),
    bakeMatrix: bakeMatrix.clone(),
  };
};

export const createFullUrdfOriginBake = (origin: UrdfOriginPose): ResolvedUrdfOriginBake =>
  resolveUrdfOriginBake(origin, composeUrdfOriginMatrix(origin));
