import * as THREE from "three";
import { composeUrdfPoseMatrix } from "@/shared/lib/spatialFrame";
import type {
  GeometryReferencePoint,
  GeometryReferenceSource,
} from "@/features/viewer/inertiaGeometryReference";
import {
  INERTIA_EIGEN_MAX_ITERATIONS,
  INERTIA_INERTIAL_FRAME_MISMATCH_PENALTY,
  INERTIA_LOW_MASS_MAX_RADIUS_METERS,
  INERTIA_LOW_MASS_THRESHOLD_KG,
  INERTIA_MEDIUM_CONFIDENCE_MISMATCH_MAX,
  INERTIA_MIN_DENSITY_KG_PER_M3,
  INERTIA_MIN_EIGEN_TOLERANCE,
  INERTIA_NEAR_ZERO_TENSOR_EPSILON,
  INERTIA_NUMERICAL_EPSILON,
  INERTIA_PRINCIPAL_AXIS_NEAR_DEGENERATE_RELATIVE_GAP_MAX,
  INERTIA_PRINCIPAL_HIGH_CONFIDENCE_MISMATCH_MAX,
  INERTIA_REFERENCE_CENTER_MISMATCH_WEIGHT,
  INERTIA_REFERENCE_CENTER_OUTSIDE_TOLERANCE_METERS,
  INERTIA_REFERENCE_MIN_SIZE_METERS,
} from "@/features/viewer/inertialMathParams";

export type InertiaTensor = {
  ixx: number;
  ixy: number;
  ixz: number;
  iyy: number;
  iyz: number;
  izz: number;
};

type EigenDecomposition = {
  values: [number, number, number];
  vectors: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
};

const EPS = INERTIA_NUMERICAL_EPSILON;
const MIN_EIGEN_TOL = INERTIA_MIN_EIGEN_TOLERANCE;

const clampSmall = (value: number): number => (Math.abs(value) < EPS ? 0 : value);

const sortEigenPairs = (eigen: EigenDecomposition): EigenDecomposition => {
  const pairs = [
    { value: eigen.values[0], vector: eigen.vectors[0] },
    { value: eigen.values[1], vector: eigen.vectors[1] },
    { value: eigen.values[2], vector: eigen.vectors[2] },
  ].sort((a, b) => b.value - a.value);

  const v0 = pairs[0].vector.clone();
  const v1 = pairs[1].vector.clone();
  const v2 = pairs[2].vector.clone();

  // Ensure right-handed basis
  const det = v0.clone().cross(v1).dot(v2);
  if (det < 0) {
    v2.multiplyScalar(-1);
  }

  return {
    values: [pairs[0].value, pairs[1].value, pairs[2].value],
    vectors: [v0, v1, v2],
  };
};

export const computeEigenDecompositionSymmetric3x3 = (
  matrix: THREE.Matrix3
): EigenDecomposition => {
  const m = matrix.elements;

  let a00 = m[0];
  let a01 = m[1];
  let a02 = m[2];
  let a11 = m[4];
  let a12 = m[5];
  let a22 = m[8];

  let v00 = 1, v01 = 0, v02 = 0;
  let v10 = 0, v11 = 1, v12 = 0;
  let v20 = 0, v21 = 0, v22 = 1;

  const maxIterations = INERTIA_EIGEN_MAX_ITERATIONS;
  for (let iter = 0; iter < maxIterations; iter += 1) {
    let maxVal = Math.abs(a01);
    let p = 0;
    let q = 1;

    if (Math.abs(a02) > maxVal) {
      maxVal = Math.abs(a02);
      p = 0;
      q = 2;
    }
    if (Math.abs(a12) > maxVal) {
      maxVal = Math.abs(a12);
      p = 1;
      q = 2;
    }

    if (maxVal < EPS) break;

    let apq: number;
    let app: number;
    let aqq: number;
    if (p === 0 && q === 1) {
      apq = a01;
      app = a00;
      aqq = a11;
    } else if (p === 0 && q === 2) {
      apq = a02;
      app = a00;
      aqq = a22;
    } else {
      apq = a12;
      app = a11;
      aqq = a22;
    }

    const tau = (aqq - app) / (2 * apq);
    const tauSign = tau >= 0 ? 1 : -1;
    const t = tauSign / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;

    if (p === 0 && q === 1) {
      const temp00 = a00;
      const temp01 = a01;
      const temp02 = a02;
      const temp11 = a11;
      const temp12 = a12;

      a00 = c * c * temp00 - 2 * c * s * temp01 + s * s * temp11;
      a11 = s * s * temp00 + 2 * c * s * temp01 + c * c * temp11;
      a01 = 0;
      a02 = c * temp02 - s * temp12;
      a12 = s * temp02 + c * temp12;

      const tv00 = v00, tv01 = v01, tv02 = v02;
      const tv10 = v10, tv11 = v11, tv12 = v12;

      v00 = c * tv00 - s * tv10;
      v01 = c * tv01 - s * tv11;
      v02 = c * tv02 - s * tv12;
      v10 = s * tv00 + c * tv10;
      v11 = s * tv01 + c * tv11;
      v12 = s * tv02 + c * tv12;
    } else if (p === 0 && q === 2) {
      const temp00 = a00;
      const temp01 = a01;
      const temp02 = a02;
      const temp12 = a12;
      const temp22 = a22;

      a00 = c * c * temp00 - 2 * c * s * temp02 + s * s * temp22;
      a22 = s * s * temp00 + 2 * c * s * temp02 + c * c * temp22;
      a02 = 0;
      a01 = c * temp01 - s * temp12;
      a12 = s * temp01 + c * temp12;

      const tv00 = v00, tv01 = v01, tv02 = v02;
      const tv20 = v20, tv21 = v21, tv22 = v22;

      v00 = c * tv00 - s * tv20;
      v01 = c * tv01 - s * tv21;
      v02 = c * tv02 - s * tv22;
      v20 = s * tv00 + c * tv20;
      v21 = s * tv01 + c * tv21;
      v22 = s * tv02 + c * tv22;
    } else {
      const temp11 = a11;
      const temp01 = a01;
      const temp12 = a12;
      const temp02 = a02;
      const temp22 = a22;

      a11 = c * c * temp11 - 2 * c * s * temp12 + s * s * temp22;
      a22 = s * s * temp11 + 2 * c * s * temp12 + c * c * temp22;
      a12 = 0;
      a01 = c * temp01 - s * temp02;
      a02 = s * temp01 + c * temp02;

      const tv10 = v10, tv11 = v11, tv12 = v12;
      const tv20 = v20, tv21 = v21, tv22 = v22;

      v10 = c * tv10 - s * tv20;
      v11 = c * tv11 - s * tv21;
      v12 = c * tv12 - s * tv22;
      v20 = s * tv10 + c * tv20;
      v21 = s * tv11 + c * tv21;
      v22 = s * tv12 + c * tv22;
    }
  }

  const eigen: EigenDecomposition = {
    values: [clampSmall(a00), clampSmall(a11), clampSmall(a22)],
    vectors: [
      new THREE.Vector3(v00, v01, v02),
      new THREE.Vector3(v10, v11, v12),
      new THREE.Vector3(v20, v21, v22),
    ],
  };

  return sortEigenPairs(eigen);
};

export type InertiaBox = {
  size: [number, number, number];
  rotation: THREE.Quaternion;
  center?: [number, number, number];
};

type Vector3Tuple = [number, number, number];

const toSafeInertiaBoxSize = (
  width: number,
  height: number,
  depth: number
): Vector3Tuple | null => {
  const size: Vector3Tuple = [
    Math.max(width, INERTIA_REFERENCE_MIN_SIZE_METERS),
    Math.max(height, INERTIA_REFERENCE_MIN_SIZE_METERS),
    Math.max(depth, INERTIA_REFERENCE_MIN_SIZE_METERS),
  ];

  return size.every((dimension) => Number.isFinite(dimension)) ? size : null;
};

const createAxisAlignedInertiaBox = (
  width: number,
  height: number,
  depth: number,
  center: Vector3Tuple
): InertiaBox | null => {
  const size = toSafeInertiaBoxSize(width, height, depth);
  if (!size) return null;

  return {
    size,
    rotation: new THREE.Quaternion(),
    center,
  };
};

type NormalizedInertiaTensorComponents = {
  Ixx: number;
  Iyy: number;
  Izz: number;
  Ixy: number;
  Ixz: number;
  Iyz: number;
};

const readInertiaTensorComponents = (
  inertia: InertiaTensor
): NormalizedInertiaTensorComponents => ({
  Ixx: inertia.ixx || 0,
  Iyy: inertia.iyy || 0,
  Izz: inertia.izz || 0,
  Ixy: inertia.ixy || 0,
  Ixz: inertia.ixz || 0,
  Iyz: inertia.iyz || 0,
});

const hasFiniteInertiaDiagonal = (
  components: Pick<NormalizedInertiaTensorComponents, "Ixx" | "Iyy" | "Izz">
): boolean =>
  Number.isFinite(components.Ixx) &&
  Number.isFinite(components.Iyy) &&
  Number.isFinite(components.Izz);

export type ReliableInertiaStrategy =
  | "principal"
  | "inertial-frame"
  | "collision-fitted";

export type InertiaVisualizationConfidence = "high" | "medium" | "low" | "unverified";

export type ReliableInertiaBox = {
  box: InertiaBox;
  strategy: ReliableInertiaStrategy;
  confidence: InertiaVisualizationConfidence;
  referenceBox?: InertiaBox;
  referenceSource?: GeometryReferenceSource;
  mismatchScore?: number;
  mismatchBreakdown?: {
    volume: number;
    shape: number;
    center: number;
  };
  centerOfMassOutsideReference?: boolean;
};

export type GeometryReferenceForBounds = {
  points: GeometryReferencePoint[];
  source: GeometryReferenceSource;
};

export type CollisionPrimitiveForBounds =
  | {
      type: "box";
      size: [number, number, number];
      origin: [number, number, number];
      rpy: [number, number, number];
    }
  | {
      type: "sphere";
      radius: number;
      origin: [number, number, number];
      rpy: [number, number, number];
    }
  | {
      type: "cylinder";
      radius: number;
      length: number;
      origin: [number, number, number];
      rpy: [number, number, number];
    };

const buildPrimitiveCorners = (primitive: CollisionPrimitiveForBounds): THREE.Vector3[] => {
  if (primitive.type === "box") {
    const hx = primitive.size[0] * 0.5;
    const hy = primitive.size[1] * 0.5;
    const hz = primitive.size[2] * 0.5;
    return [
      new THREE.Vector3(-hx, -hy, -hz),
      new THREE.Vector3(-hx, -hy, hz),
      new THREE.Vector3(-hx, hy, -hz),
      new THREE.Vector3(-hx, hy, hz),
      new THREE.Vector3(hx, -hy, -hz),
      new THREE.Vector3(hx, -hy, hz),
      new THREE.Vector3(hx, hy, -hz),
      new THREE.Vector3(hx, hy, hz),
    ];
  }
  if (primitive.type === "sphere") {
    const r = primitive.radius;
    return [
      new THREE.Vector3(-r, -r, -r),
      new THREE.Vector3(-r, -r, r),
      new THREE.Vector3(-r, r, -r),
      new THREE.Vector3(-r, r, r),
      new THREE.Vector3(r, -r, -r),
      new THREE.Vector3(r, -r, r),
      new THREE.Vector3(r, r, -r),
      new THREE.Vector3(r, r, r),
    ];
  }
  const r = primitive.radius;
  const hz = primitive.length * 0.5;
  // URDF cylinders are aligned with the local Z axis.
  return [
    new THREE.Vector3(-r, -r, -hz),
    new THREE.Vector3(-r, -r, hz),
    new THREE.Vector3(-r, r, -hz),
    new THREE.Vector3(-r, r, hz),
    new THREE.Vector3(r, -r, -hz),
    new THREE.Vector3(r, -r, hz),
    new THREE.Vector3(r, r, -hz),
    new THREE.Vector3(r, r, hz),
  ];
};

const buildPrimitiveReferencePoints = (
  collisions: CollisionPrimitiveForBounds[]
): GeometryReferencePoint[] => {
  const points: GeometryReferencePoint[] = [];
  const vector = new THREE.Vector3();
  const collisionMatrix = new THREE.Matrix4();

  collisions.forEach((primitive) => {
    if (primitive.type === "box") {
      if (primitive.size.some((value) => !Number.isFinite(value) || value <= 0)) {
        return;
      }
    } else if (primitive.type === "sphere") {
      if (!Number.isFinite(primitive.radius) || primitive.radius <= 0) {
        return;
      }
    } else if (
      !Number.isFinite(primitive.radius) ||
      primitive.radius <= 0 ||
      !Number.isFinite(primitive.length) ||
      primitive.length <= 0
    ) {
      return;
    }

    composeUrdfPoseMatrix(
      {
        xyz: primitive.origin,
        rpy: primitive.rpy,
      },
      collisionMatrix
    );

    buildPrimitiveCorners(primitive).forEach((corner) => {
      vector.copy(corner).applyMatrix4(collisionMatrix);
      points.push([vector.x, vector.y, vector.z]);
    });
  });

  return points;
};

const pickProjectedAnchorAxis = (
  uniqueAxis: THREE.Vector3,
  anchorAxes: readonly THREE.Vector3[]
): THREE.Vector3 => {
  const planeNormal = uniqueAxis.clone().normalize();
  const projectedAnchors = anchorAxes
    .map((axis) => axis.clone().projectOnPlane(planeNormal))
    .filter((axis) => axis.lengthSq() > EPS)
    .sort((left, right) => right.lengthSq() - left.lengthSq());
  if (projectedAnchors[0]) {
    return projectedAnchors[0].normalize();
  }
  const fallbackSeed =
    Math.abs(planeNormal.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  return fallbackSeed.projectOnPlane(planeNormal).normalize();
};

const computeReferenceBoxFromSamples = (
  points: GeometryReferencePoint[],
  inertialOrigin: [number, number, number],
  inertialRpy: [number, number, number]
): InertiaBox | null => {
  if (points.length === 0) {
    return null;
  }

  const inertialMatrix = composeUrdfPoseMatrix(
    {
      xyz: inertialOrigin,
      rpy: inertialRpy,
    },
    new THREE.Matrix4()
  );
  const inertialInverse = inertialMatrix.clone().invert();
  const temp = new THREE.Vector3();
  const localPoints = points.map(([x, y, z]) => temp.clone().set(x, y, z).applyMatrix4(inertialInverse));
  const centroid = new THREE.Vector3();

  localPoints.forEach((point) => {
    centroid.add(point);
  });
  centroid.multiplyScalar(1 / localPoints.length);

  const covariance = new THREE.Matrix3();
  let c00 = 0;
  let c01 = 0;
  let c02 = 0;
  let c11 = 0;
  let c12 = 0;
  let c22 = 0;

  localPoints.forEach((point) => {
    const dx = point.x - centroid.x;
    const dy = point.y - centroid.y;
    const dz = point.z - centroid.z;
    c00 += dx * dx;
    c01 += dx * dy;
    c02 += dx * dz;
    c11 += dy * dy;
    c12 += dy * dz;
    c22 += dz * dz;
  });

  covariance.set(
    c00, c01, c02,
    c01, c11, c12,
    c02, c12, c22
  );
  const eigen = computeEigenDecompositionSymmetric3x3(covariance);
  const [largest, middle, smallest] = eigen.values.map((value) => Math.max(value, 0));
  const eigenScale = Math.max(largest, EPS);
  const largestGap = Math.abs(largest - middle) / eigenScale;
  const smallestGap = Math.abs(middle - smallest) / eigenScale;
  const canonicalAxes = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ] as const;
  const referenceAxes =
    smallestGap <= INERTIA_PRINCIPAL_AXIS_NEAR_DEGENERATE_RELATIVE_GAP_MAX
      ? (() => {
          const uniqueAxis = eigen.vectors[0].clone().normalize();
          const secondaryAxis = pickProjectedAnchorAxis(uniqueAxis, canonicalAxes);
          const tertiaryAxis = uniqueAxis.clone().cross(secondaryAxis).normalize();
          return [uniqueAxis, secondaryAxis, tertiaryAxis];
        })()
      : largestGap <= INERTIA_PRINCIPAL_AXIS_NEAR_DEGENERATE_RELATIVE_GAP_MAX
        ? (() => {
            const uniqueAxis = eigen.vectors[2].clone().normalize();
            const primaryAxis = pickProjectedAnchorAxis(uniqueAxis, canonicalAxes);
            const secondaryAxis = uniqueAxis.clone().cross(primaryAxis).normalize();
            return [primaryAxis, secondaryAxis, uniqueAxis];
          })()
        : eigen.vectors.map((vector) => vector.clone().normalize());
  const hasValidAxes = referenceAxes.every((axis) => Number.isFinite(axis.lengthSq()) && axis.lengthSq() > EPS);

  if (!hasValidAxes) {
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

    localPoints.forEach((point) => {
      min.min(point);
      max.max(point);
    });

    const center = min.clone().add(max).multiplyScalar(0.5);
    const size = max.clone().sub(min);
    return createAxisAlignedInertiaBox(size.x, size.y, size.z, [center.x, center.y, center.z]);
  }

  const minProjection = [Infinity, Infinity, Infinity];
  const maxProjection = [-Infinity, -Infinity, -Infinity];
  localPoints.forEach((point) => {
    temp.copy(point).sub(centroid);
    referenceAxes.forEach((axis, axisIndex) => {
      const projection = temp.dot(axis);
      minProjection[axisIndex] = Math.min(minProjection[axisIndex], projection);
      maxProjection[axisIndex] = Math.max(maxProjection[axisIndex], projection);
    });
  });

  const orientedCenter = centroid.clone();
  referenceAxes.forEach((axis, axisIndex) => {
    const centerOffset = (minProjection[axisIndex] + maxProjection[axisIndex]) * 0.5;
    orientedCenter.addScaledVector(axis, centerOffset);
  });

  const safeSize = toSafeInertiaBoxSize(
    maxProjection[0] - minProjection[0],
    maxProjection[1] - minProjection[1],
    maxProjection[2] - minProjection[2]
  );
  if (!safeSize) return null;

  const rotationMatrix = new THREE.Matrix4().set(
    referenceAxes[0].x, referenceAxes[1].x, referenceAxes[2].x, 0,
    referenceAxes[0].y, referenceAxes[1].y, referenceAxes[2].y, 0,
    referenceAxes[0].z, referenceAxes[1].z, referenceAxes[2].z, 0,
    0, 0, 0, 1
  );
  const rotation = new THREE.Quaternion().setFromRotationMatrix(rotationMatrix);

  return {
    size: safeSize,
    rotation,
    center: [orientedCenter.x, orientedCenter.y, orientedCenter.z],
  };
};

export const computeCollisionFittedInertiaBox = (
  collisions: CollisionPrimitiveForBounds[],
  inertialOrigin: [number, number, number],
  inertialRpy: [number, number, number]
): InertiaBox | null => {
  if (collisions.length === 0) return null;
  return computeReferenceBoxFromSamples(
    buildPrimitiveReferencePoints(collisions),
    inertialOrigin,
    inertialRpy
  );
};

const computeVolume = (size: [number, number, number]) => size[0] * size[1] * size[2];

const computeAspectRatio = (size: [number, number, number]) => {
  const dims = [...size].sort((a, b) => a - b);
  const min = Math.max(dims[0], EPS);
  const max = Math.max(dims[2], min);
  return max / min;
};

const computeMismatchAgainstReference = (candidate: InertiaBox, reference: InertiaBox) => {
  const vCand = Math.max(computeVolume(candidate.size), EPS);
  const vRef = Math.max(computeVolume(reference.size), EPS);
  const arCand = Math.max(computeAspectRatio(candidate.size), 1);
  const arRef = Math.max(computeAspectRatio(reference.size), 1);
  const volMismatch = Math.abs(Math.log(vCand / vRef));
  const arMismatch = Math.abs(Math.log(arCand / arRef));
  const candidateCenter = candidate.center ?? [0, 0, 0];
  const referenceCenter = reference.center ?? [0, 0, 0];
  const referenceSpan = Math.max(...reference.size, EPS);
  const centerDelta = Math.sqrt(
    (candidateCenter[0] - referenceCenter[0]) ** 2 +
    (candidateCenter[1] - referenceCenter[1]) ** 2 +
    (candidateCenter[2] - referenceCenter[2]) ** 2
  );
  const centerMismatch =
    (centerDelta / referenceSpan) * INERTIA_REFERENCE_CENTER_MISMATCH_WEIGHT;
  return {
    score: volMismatch + arMismatch + centerMismatch,
    breakdown: {
      volume: volMismatch,
      shape: arMismatch,
      center: centerMismatch,
    },
  };
};

const isCenterOfMassOutsideReference = (reference: InertiaBox): boolean => {
  const [cx = 0, cy = 0, cz = 0] = reference.center ?? [0, 0, 0];
  const [sx, sy, sz] = reference.size;
  return (
    Math.abs(cx) > sx * 0.5 + INERTIA_REFERENCE_CENTER_OUTSIDE_TOLERANCE_METERS ||
    Math.abs(cy) > sy * 0.5 + INERTIA_REFERENCE_CENTER_OUTSIDE_TOLERANCE_METERS ||
    Math.abs(cz) > sz * 0.5 + INERTIA_REFERENCE_CENTER_OUTSIDE_TOLERANCE_METERS
  );
};

const resolveStableNearDegeneratePrincipalRotation = (
  inertia: InertiaTensor,
  referenceRotation: THREE.Quaternion
): THREE.Quaternion | null => {
  const matrix = new THREE.Matrix3().set(
    inertia.ixx || 0,
    inertia.ixy || 0,
    inertia.ixz || 0,
    inertia.ixy || 0,
    inertia.iyy || 0,
    inertia.iyz || 0,
    inertia.ixz || 0,
    inertia.iyz || 0,
    inertia.izz || 0
  );
  const eigen = computeEigenDecompositionSymmetric3x3(matrix);
  const [largest, middle, smallest] = eigen.values.map((value) => Math.max(value, 0));
  const scale = Math.max(largest, EPS);
  const largestGap = Math.abs(largest - middle) / scale;
  const smallestGap = Math.abs(middle - smallest) / scale;

  let basis: [THREE.Vector3, THREE.Vector3, THREE.Vector3] | null = null;
  const referenceAxes = [
    new THREE.Vector3(1, 0, 0).applyQuaternion(referenceRotation),
    new THREE.Vector3(0, 1, 0).applyQuaternion(referenceRotation),
    new THREE.Vector3(0, 0, 1).applyQuaternion(referenceRotation),
  ];

  if (smallestGap <= INERTIA_PRINCIPAL_AXIS_NEAR_DEGENERATE_RELATIVE_GAP_MAX) {
    const uniqueAxis = eigen.vectors[0].clone().normalize();
    const secondaryAxis = pickProjectedAnchorAxis(uniqueAxis, referenceAxes);
    const tertiaryAxis = uniqueAxis.clone().cross(secondaryAxis).normalize();
    basis = [uniqueAxis, secondaryAxis, tertiaryAxis];
  } else if (largestGap <= INERTIA_PRINCIPAL_AXIS_NEAR_DEGENERATE_RELATIVE_GAP_MAX) {
    const uniqueAxis = eigen.vectors[2].clone().normalize();
    const primaryAxis = pickProjectedAnchorAxis(uniqueAxis, referenceAxes);
    const secondaryAxis = uniqueAxis.clone().cross(primaryAxis).normalize();
    basis = [primaryAxis, secondaryAxis, uniqueAxis];
  }

  if (!basis) {
    return null;
  }

  const rotationMatrix = new THREE.Matrix4().set(
    basis[0].x, basis[1].x, basis[2].x, 0,
    basis[0].y, basis[1].y, basis[2].y, 0,
    basis[0].z, basis[1].z, basis[2].z, 0,
    0, 0, 0, 1
  );
  return new THREE.Quaternion().setFromRotationMatrix(rotationMatrix);
};

export const computeReliableInertiaBox = (options: {
  inertia: InertiaTensor;
  mass: number;
  inertialOrigin: [number, number, number];
  inertialRpy: [number, number, number];
  collisions?: CollisionPrimitiveForBounds[];
  geometryReference?: GeometryReferenceForBounds | null;
}): ReliableInertiaBox | null => {
  const {
    inertia,
    mass,
    inertialOrigin,
    inertialRpy,
    collisions = [],
    geometryReference = null,
  } = options;
  const tensorValidation = validateInertiaTensor(inertia);
  const principal = tensorValidation.valid ? computeInertiaBox(inertia, mass) : null;
  const inertialFrame = tensorValidation.valid ? computeInertiaBoxInInertialFrame(inertia, mass) : null;
  const derivedGeometryReference =
    geometryReference ??
    (collisions.length > 0
      ? {
          points: buildPrimitiveReferencePoints(collisions),
          source: "primitive" as const,
        }
      : null);
  const referenceBox = derivedGeometryReference
    ? computeReferenceBoxFromSamples(derivedGeometryReference.points, inertialOrigin, inertialRpy)
    : null;
  const centerOfMassOutsideReference = referenceBox ? isCenterOfMassOutsideReference(referenceBox) : false;
  const stabilizedNearDegenerateRotation =
    principal && referenceBox
      ? resolveStableNearDegeneratePrincipalRotation(inertia, referenceBox.rotation)
      : null;
  const authoredBox =
    principal && stabilizedNearDegenerateRotation
      ? {
          ...principal,
          // Near-symmetric tensors do not define a stable spin around their unique principal axis.
          // Keep the physically meaningful axis from the tensor and use the geometry reference only
          // to resolve the otherwise-arbitrary in-plane orientation.
          rotation: stabilizedNearDegenerateRotation,
        }
      : principal ?? inertialFrame ?? null;
  const authoredStrategy: ReliableInertiaStrategy | null = principal
    ? "principal"
    : inertialFrame
      ? "inertial-frame"
      : null;

  if (!authoredBox && !referenceBox) {
    return null;
  }

  if (!referenceBox) {
    if (authoredBox && authoredStrategy) {
      return { box: authoredBox, strategy: authoredStrategy, confidence: "unverified" };
    }
    return null;
  }

  if (!authoredBox || !authoredStrategy) {
    return {
      box: referenceBox,
      strategy: "collision-fitted",
      confidence: "low",
      referenceBox,
      referenceSource: derivedGeometryReference?.source,
      centerOfMassOutsideReference,
    };
  }

  const referenceMismatch = computeMismatchAgainstReference(authoredBox, referenceBox);
  const mismatchScore =
    referenceMismatch.score +
    (authoredStrategy === "inertial-frame" ? INERTIA_INERTIAL_FRAME_MISMATCH_PENALTY : 0);
  const sharedResult = {
    referenceBox,
    referenceSource: derivedGeometryReference?.source,
    mismatchScore,
    mismatchBreakdown: referenceMismatch.breakdown,
    centerOfMassOutsideReference,
  } satisfies Partial<ReliableInertiaBox>;

  if (centerOfMassOutsideReference) {
    return {
      box: authoredBox,
      strategy: authoredStrategy,
      confidence: "low",
      ...sharedResult,
    };
  }

  if (
    authoredStrategy === "principal" &&
    mismatchScore < INERTIA_PRINCIPAL_HIGH_CONFIDENCE_MISMATCH_MAX
  ) {
    return { box: authoredBox, strategy: authoredStrategy, confidence: "high", ...sharedResult };
  }

  if (mismatchScore < INERTIA_MEDIUM_CONFIDENCE_MISMATCH_MAX) {
    return { box: authoredBox, strategy: authoredStrategy, confidence: "medium", ...sharedResult };
  }

  return {
    box: authoredBox,
    strategy: authoredStrategy,
    confidence: "low",
    ...sharedResult,
  };
};

export const computeInertiaBoxInInertialFrame = (
  inertia: InertiaTensor,
  mass: number
): InertiaBox | null => {
  if (!Number.isFinite(mass) || mass <= 0) return null;
  const { Ixx, Iyy, Izz } = readInertiaTensorComponents(inertia);
  if (!hasFiniteInertiaDiagonal({ Ixx, Iyy, Izz })) {
    return null;
  }
  const factor = 6.0 / mass;
  const width = Math.sqrt(Math.max(0, factor * (Iyy + Izz - Ixx)));
  const height = Math.sqrt(Math.max(0, factor * (Ixx + Izz - Iyy)));
  const depth = Math.sqrt(Math.max(0, factor * (Ixx + Iyy - Izz)));
  return createAxisAlignedInertiaBox(width, height, depth, [0, 0, 0]);
};

export const computeInertiaBox = (
  inertia: InertiaTensor,
  mass: number
): InertiaBox | null => {
  if (!Number.isFinite(mass) || mass <= 0) return null;

  const { Ixx, Iyy, Izz, Ixy, Ixz, Iyz } = readInertiaTensorComponents(inertia);

  const minMassThreshold = INERTIA_LOW_MASS_THRESHOLD_KG;
  if (mass < minMassThreshold) {
    const avgInertia = (Math.abs(Ixx) + Math.abs(Iyy) + Math.abs(Izz)) / 3;
    const inertiaRadius = Math.sqrt(avgInertia / Math.max(mass, EPS));
    if (inertiaRadius > INERTIA_LOW_MASS_MAX_RADIUS_METERS) {
      return null;
    }
  }

  const inertiaThreshold = INERTIA_NEAR_ZERO_TENSOR_EPSILON;
  if (
    Math.abs(Ixx) < inertiaThreshold &&
    Math.abs(Iyy) < inertiaThreshold &&
    Math.abs(Izz) < inertiaThreshold
  ) {
    return null;
  }

  const matrix = new THREE.Matrix3().set(
    Ixx, Ixy, Ixz,
    Ixy, Iyy, Iyz,
    Ixz, Iyz, Izz
  );

  const eigen = computeEigenDecompositionSymmetric3x3(matrix);
  const minEigen = Math.min(eigen.values[0], eigen.values[1], eigen.values[2]);
  if (minEigen < MIN_EIGEN_TOL) {
    return null;
  }
  const [I1, I2, I3] = eigen.values.map((v) => Math.max(v, 0));

  const factor = 6.0 / mass;
  const width = Math.sqrt(Math.abs(factor * (I2 + I3 - I1)));
  const height = Math.sqrt(Math.abs(factor * (I1 + I3 - I2)));
  const depth = Math.sqrt(Math.abs(factor * (I1 + I2 - I3)));

  const avgInertia = (Math.abs(I1) + Math.abs(I2) + Math.abs(I3)) / 3;
  const inertiaRadius = Math.sqrt(avgInertia / mass);
  const avgBoxSize = (width + height + depth) / 3;
  if (avgBoxSize > 0 && inertiaRadius > avgBoxSize) {
    return null;
  }

  const volume = width * height * depth;
  const minDensity = INERTIA_MIN_DENSITY_KG_PER_M3;
  if (volume > 0 && mass / volume < minDensity) {
    return null;
  }

  const safeSize = toSafeInertiaBoxSize(width, height, depth);
  if (!safeSize) return null;

  const rotMatrix = new THREE.Matrix4().set(
    eigen.vectors[0].x, eigen.vectors[1].x, eigen.vectors[2].x, 0,
    eigen.vectors[0].y, eigen.vectors[1].y, eigen.vectors[2].y, 0,
    eigen.vectors[0].z, eigen.vectors[1].z, eigen.vectors[2].z, 0,
    0, 0, 0, 1
  );
  const rotation = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

  return {
    size: safeSize,
    rotation,
    center: [0, 0, 0],
  };
};

export const validateInertiaTensor = (inertia: InertiaTensor) => {
  const { ixx, ixy, ixz, iyy, iyz, izz } = inertia;
  const values = [ixx, ixy, ixz, iyy, iyz, izz];
  if (values.some((value) => !Number.isFinite(value))) {
    return { valid: false, reason: "non-finite" as const };
  }
  const nearZero =
    Math.abs(ixx) < INERTIA_NEAR_ZERO_TENSOR_EPSILON &&
    Math.abs(iyy) < INERTIA_NEAR_ZERO_TENSOR_EPSILON &&
    Math.abs(izz) < INERTIA_NEAR_ZERO_TENSOR_EPSILON &&
    Math.abs(ixy) < INERTIA_NEAR_ZERO_TENSOR_EPSILON &&
    Math.abs(ixz) < INERTIA_NEAR_ZERO_TENSOR_EPSILON &&
    Math.abs(iyz) < INERTIA_NEAR_ZERO_TENSOR_EPSILON;
  if (nearZero) {
    return { valid: false, reason: "near-zero" as const };
  }

  const matrix = new THREE.Matrix3().set(
    ixx, ixy, ixz,
    ixy, iyy, iyz,
    ixz, iyz, izz
  );
  const eigen = computeEigenDecompositionSymmetric3x3(matrix);
  const minEigen = Math.min(eigen.values[0], eigen.values[1], eigen.values[2]);
  if (minEigen < MIN_EIGEN_TOL) {
    return { valid: false, reason: "negative-eigen" as const };
  }
  return { valid: true, reason: "ok" as const };
};
