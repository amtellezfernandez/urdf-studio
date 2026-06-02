import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import {
  KINEMATIC_SYNTHESIS_SUPPORT_PLANE_BAND_MIN_M,
  KINEMATIC_SYNTHESIS_SUPPORT_PLANE_BAND_RATIO,
  KINEMATIC_SYNTHESIS_SUPPORT_PLANE_MIN_CONFIDENCE,
  KINEMATIC_SYNTHESIS_SUPPORT_PLANE_MIN_MESHES,
  KINEMATIC_SYNTHESIS_SUPPORT_PLANE_MIN_VERTICES,
} from "./kinematicSynthesizerParams";

export type SupportPlaneAxis = "x" | "y" | "z";
export type SupportPlaneSign = 1 | -1;

export type SupportPlaneCandidate = {
  axis: SupportPlaneAxis;
  sign: SupportPlaneSign;
  score: number;
  supportAreaEstimate: number;
  supportVertexCount: number;
};

export type SupportPlaneOptimizationSuccess = {
  success: true;
  inferredUpAxis: SupportPlaneAxis;
  inferredUpSign: SupportPlaneSign;
  targetUpAxis: "z";
  targetUpSign: 1;
  confidence: number;
  alignmentQuaternion: THREE.Quaternion;
  alignmentMatrix: THREE.Matrix4;
  candidates: SupportPlaneCandidate[];
  evidence: string;
};

export type SupportPlaneOptimizationFailure = {
  success: false;
  fallbackReason: string;
  confidence: 0;
  candidates: SupportPlaneCandidate[];
  evidence: string;
};

export type SupportPlaneOptimizationResult =
  | SupportPlaneOptimizationSuccess
  | SupportPlaneOptimizationFailure;

const AXIS_ORDER: SupportPlaneAxis[] = ["x", "y", "z"];
const TARGET_UP_VECTOR = new THREE.Vector3(0, 0, 1);

const AXIS_TO_VECTOR: Record<SupportPlaneAxis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

const getAxisBasis = (axis: SupportPlaneAxis): [SupportPlaneAxis, SupportPlaneAxis] => {
  switch (axis) {
    case "x":
      return ["y", "z"];
    case "y":
      return ["x", "z"];
    case "z":
      return ["x", "y"];
  }
};

const isRenderableMesh = (object: THREE.Object3D): object is THREE.Mesh<THREE.BufferGeometry> =>
  object instanceof THREE.Mesh &&
  object.visible !== false &&
  !object.parent?.userData?.ignoreSupportPlane &&
  !("isURDFCollider" in object && Boolean((object as { isURDFCollider?: boolean }).isURDFCollider)) &&
  object.geometry instanceof THREE.BufferGeometry &&
  Boolean(object.geometry.getAttribute("position"));

const collectRobotWorldVertices = (
  robot: URDFRobot
): { vertices: THREE.Vector3[]; meshCount: number; extent: number } => {
  robot.updateMatrixWorld(true);
  const vertices: THREE.Vector3[] = [];
  let meshCount = 0;
  const bounds = new THREE.Box3();
  const position = new THREE.Vector3();

  robot.traverse((object) => {
    if (!isRenderableMesh(object)) {
      return;
    }
    meshCount += 1;
    const geometry = object.geometry;
    const positionAttribute = geometry.getAttribute("position");
    const sampleCount = positionAttribute.count;
    for (let index = 0; index < sampleCount; index += 1) {
      position.fromBufferAttribute(positionAttribute, index).applyMatrix4(object.matrixWorld);
      vertices.push(position.clone());
      bounds.expandByPoint(position);
    }
  });

  const size = bounds.isEmpty() ? new THREE.Vector3(0, 0, 0) : bounds.getSize(new THREE.Vector3());
  return {
    vertices,
    meshCount,
    extent: Math.max(size.x, size.y, size.z),
  };
};

const buildCandidateVector = (
  axis: SupportPlaneAxis,
  sign: SupportPlaneSign
): THREE.Vector3 => AXIS_TO_VECTOR[axis].clone().multiplyScalar(sign);

const buildCandidate = (
  axis: SupportPlaneAxis,
  sign: SupportPlaneSign,
  vertices: THREE.Vector3[],
  supportBand: number
): SupportPlaneCandidate => {
  const candidateVector = buildCandidateVector(axis, sign);
  const heights = vertices.map((vertex) => vertex.dot(candidateVector));
  const minimumHeight = Math.min(...heights);
  const supportVertices = vertices.filter(
    (vertex) => vertex.dot(candidateVector) <= minimumHeight + supportBand
  );
  const [basisA, basisB] = getAxisBasis(axis);
  const axisAMin = Math.min(...supportVertices.map((vertex) => vertex[basisA]));
  const axisAMax = Math.max(...supportVertices.map((vertex) => vertex[basisA]));
  const axisBMin = Math.min(...supportVertices.map((vertex) => vertex[basisB]));
  const axisBMax = Math.max(...supportVertices.map((vertex) => vertex[basisB]));
  const supportAreaEstimate = Math.max(0, axisAMax - axisAMin) * Math.max(0, axisBMax - axisBMin);
  return {
    axis,
    sign,
    supportVertexCount: supportVertices.length,
    supportAreaEstimate,
    score: supportAreaEstimate * supportVertices.length,
  };
};

const compareCandidates = (lhs: SupportPlaneCandidate, rhs: SupportPlaneCandidate): number => {
  if (rhs.score !== lhs.score) {
    return rhs.score - lhs.score;
  }
  if (rhs.supportAreaEstimate !== lhs.supportAreaEstimate) {
    return rhs.supportAreaEstimate - lhs.supportAreaEstimate;
  }
  if (rhs.supportVertexCount !== lhs.supportVertexCount) {
    return rhs.supportVertexCount - lhs.supportVertexCount;
  }
  if (rhs.sign !== lhs.sign) {
    return rhs.sign - lhs.sign;
  }
  return AXIS_ORDER.indexOf(lhs.axis) - AXIS_ORDER.indexOf(rhs.axis);
};

const createFailure = (
  fallbackReason: string,
  evidence: string,
  candidates: SupportPlaneCandidate[] = []
): SupportPlaneOptimizationFailure => ({
  success: false,
  fallbackReason,
  confidence: 0,
  candidates,
  evidence,
});

export const optimizeRobotSupportPlane = (
  robot: URDFRobot | null
): SupportPlaneOptimizationResult => {
  if (!robot) {
    return createFailure("No robot is loaded.", "Support-plane inference requires a loaded robot.");
  }

  const { vertices, meshCount, extent } = collectRobotWorldVertices(robot);
  if (meshCount < KINEMATIC_SYNTHESIS_SUPPORT_PLANE_MIN_MESHES) {
    return createFailure(
      "No renderable mesh geometry is available.",
      "Support-plane inference could not find any renderable mesh geometry."
    );
  }
  if (vertices.length < KINEMATIC_SYNTHESIS_SUPPORT_PLANE_MIN_VERTICES) {
    return createFailure(
      "Not enough mesh vertices are available.",
      `Support-plane inference sampled ${vertices.length} vertices, below the required minimum.`
    );
  }

  const supportBand = Math.max(
    KINEMATIC_SYNTHESIS_SUPPORT_PLANE_BAND_MIN_M,
    extent * KINEMATIC_SYNTHESIS_SUPPORT_PLANE_BAND_RATIO
  );
  const candidates = AXIS_ORDER.flatMap((axis) =>
    ([1, -1] as const).map((sign) => buildCandidate(axis, sign, vertices, supportBand))
  ).sort(compareCandidates);

  const winner = candidates[0];
  const runnerUp = candidates.find((candidate) => candidate.axis !== winner.axis);
  if (!winner) {
    return createFailure(
      "Support-plane inference did not produce any candidates.",
      "No support-plane candidates were generated from the mesh geometry."
    );
  }
  if (winner.supportVertexCount < KINEMATIC_SYNTHESIS_SUPPORT_PLANE_MIN_VERTICES) {
    return createFailure(
      "The inferred support plane is too sparse.",
      "No candidate produced enough support vertices to infer a stable asset up-axis.",
      candidates
    );
  }

  const confidence =
    winner.score > 0 && runnerUp
      ? Number(Math.max(0, Math.min(1, (winner.score - runnerUp.score) / winner.score)).toFixed(6))
      : 1;

  if (confidence < KINEMATIC_SYNTHESIS_SUPPORT_PLANE_MIN_CONFIDENCE) {
    return createFailure(
      "Support-plane confidence is too low.",
      `The leading support-plane candidate did not separate clearly from the runner-up (confidence ${confidence}).`,
      candidates
    );
  }

  const inferredVector = buildCandidateVector(winner.axis, winner.sign);
  const alignmentQuaternion = new THREE.Quaternion().setFromUnitVectors(
    inferredVector.clone().normalize(),
    TARGET_UP_VECTOR
  );
  const alignmentMatrix = new THREE.Matrix4().makeRotationFromQuaternion(alignmentQuaternion);

  return {
    success: true,
    inferredUpAxis: winner.axis,
    inferredUpSign: winner.sign,
    targetUpAxis: "z",
    targetUpSign: 1,
    confidence,
    alignmentQuaternion,
    alignmentMatrix,
    candidates,
    evidence: `Likely ${winner.sign > 0 ? "+" : "-"}${winner.axis} up from support-plane geometry (${winner.supportVertexCount} support vertices, area ${winner.supportAreaEstimate.toFixed(4)}).`,
  };
};
