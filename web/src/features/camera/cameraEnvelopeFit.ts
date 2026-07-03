import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import { buildAxisFrameBasis } from "@/shared/lib/axisFrame";
import {
  CAMERA_LINK_PREFIX_PATTERN,
  CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH,
  CAMERA_AUTO_FRAME_CUE_EPSILON,
} from "./cameraAutoGenerationParams";
import {
  computeLinkLocalWorldUpReference,
  computeOwnedLinkLocalVisualBounds,
  type LocalCameraFrameCue,
} from "./cameraAutoBounds";
import { resolveCameraParentLinkNameFromJoint, resolveRobotLinkObject } from "./cameraWorldPose";
import {
  CAMERA_ICON_ENVELOPE_BASIS_MIN_VECTOR_LENGTH,
  CAMERA_ICON_ENVELOPE_MIN_EDGE_M,
} from "./cameraIconParams";

type CameraLinkEnvelope = {
  linkObject: THREE.Object3D;
  localCenter: THREE.Vector3;
  localSize: THREE.Vector3;
  localQuaternion: THREE.Quaternion;
};

type LinkBoundsPointSample = {
  points: THREE.Vector3[];
  dominantBasis: {
    xAxis: THREE.Vector3;
    yAxis: THREE.Vector3;
    zAxis: THREE.Vector3;
  } | null;
};

const clampAxisToMinEdge = (value: number) => Math.max(value, CAMERA_ICON_ENVELOPE_MIN_EDGE_M);
const normalizeIfValid = (candidate: THREE.Vector3) => {
  if (candidate.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) return null;
  return candidate.normalize();
};

const toOrthonormalBasis = (xAxis: THREE.Vector3, yAxis: THREE.Vector3, zAxis: THREE.Vector3) => {
  const x = xAxis.clone().normalize();
  if (x.lengthSq() < CAMERA_ICON_ENVELOPE_BASIS_MIN_VECTOR_LENGTH) return null;
  const yProjected = yAxis
    .clone()
    .addScaledVector(x, -yAxis.dot(x));
  if (yProjected.lengthSq() < CAMERA_ICON_ENVELOPE_BASIS_MIN_VECTOR_LENGTH) return null;
  const y = yProjected.normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  if (z.lengthSq() < CAMERA_ICON_ENVELOPE_BASIS_MIN_VECTOR_LENGTH) return null;
  if (z.dot(zAxis) < 0) {
    z.multiplyScalar(-1);
    y.multiplyScalar(-1);
  }
  return { xAxis: x, yAxis: y, zAxis: z };
};

const gatherOwnedLinkBoundsPointSample = (linkObject: THREE.Object3D): LinkBoundsPointSample => {
  linkObject.updateMatrixWorld(true);
  const worldToLink = new THREE.Matrix4().copy(linkObject.matrixWorld).invert();
  const points: THREE.Vector3[] = [];
  const min = new THREE.Vector3();
  const max = new THREE.Vector3();
  const corner = new THREE.Vector3();
  const nodeToLink = new THREE.Matrix4();
  const basisX = new THREE.Vector3();
  const basisY = new THREE.Vector3();
  const basisZ = new THREE.Vector3();

  let dominantBasis: LinkBoundsPointSample["dominantBasis"] = null;
  let dominantWeight = -Infinity;

  const addBoundingBoxCorners = (bbox: THREE.Box3) => {
    min.copy(bbox.min);
    max.copy(bbox.max);
    for (let x = 0; x < 2; x += 1) {
      for (let y = 0; y < 2; y += 1) {
        for (let z = 0; z < 2; z += 1) {
          corner.set(
            x === 0 ? min.x : max.x,
            y === 0 ? min.y : max.y,
            z === 0 ? min.z : max.z
          );
          points.push(corner.clone().applyMatrix4(nodeToLink));
        }
      }
    }
  };

  const traverse = (node: THREE.Object3D) => {
    node.children.forEach((child) => {
      if (child !== linkObject && (child as { isURDFLink?: boolean }).isURDFLink) return;

      const mesh = child as THREE.Mesh;
      const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
      if (mesh.isMesh && geometry) {
        if (!geometry.boundingBox) {
          geometry.computeBoundingBox();
        }
        const bbox = geometry.boundingBox;
        if (bbox) {
          nodeToLink.copy(worldToLink).multiply(mesh.matrixWorld);
          addBoundingBoxCorners(bbox);

          nodeToLink.extractBasis(basisX, basisY, basisZ);
          const candidateBasis = toOrthonormalBasis(basisX, basisY, basisZ);
          if (candidateBasis) {
            const weight = bbox.getSize(new THREE.Vector3()).lengthSq();
            if (weight > dominantWeight) {
              dominantWeight = weight;
              dominantBasis = candidateBasis;
            }
          }
        }
      }

      traverse(child);
    });
  };

  traverse(linkObject);
  return {
    points,
    dominantBasis,
  };
};

const resolveEnvelopeFromDominantBasis = (
  points: THREE.Vector3[],
  dominantBasis: NonNullable<LinkBoundsPointSample["dominantBasis"]>
) => {
  const minProjection = new THREE.Vector3(Infinity, Infinity, Infinity);
  const maxProjection = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

  points.forEach((point) => {
    const px = point.dot(dominantBasis.xAxis);
    const py = point.dot(dominantBasis.yAxis);
    const pz = point.dot(dominantBasis.zAxis);
    minProjection.x = Math.min(minProjection.x, px);
    minProjection.y = Math.min(minProjection.y, py);
    minProjection.z = Math.min(minProjection.z, pz);
    maxProjection.x = Math.max(maxProjection.x, px);
    maxProjection.y = Math.max(maxProjection.y, py);
    maxProjection.z = Math.max(maxProjection.z, pz);
  });

  const centerProjection = minProjection
    .clone()
    .add(maxProjection)
    .multiplyScalar(0.5);
  const localCenter = dominantBasis.xAxis
    .clone()
    .multiplyScalar(centerProjection.x)
    .addScaledVector(dominantBasis.yAxis, centerProjection.y)
    .addScaledVector(dominantBasis.zAxis, centerProjection.z);
  const localSize = new THREE.Vector3(
    clampAxisToMinEdge(maxProjection.x - minProjection.x),
    clampAxisToMinEdge(maxProjection.y - minProjection.y),
    clampAxisToMinEdge(maxProjection.z - minProjection.z)
  );
  const localQuaternion = new THREE.Quaternion()
    .setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(
        dominantBasis.xAxis,
        dominantBasis.yAxis,
        dominantBasis.zAxis
      )
    )
    .normalize();
  return {
    localCenter,
    localSize,
    localQuaternion,
  };
};

export const computeOwnedLinkDominantBasisFrameCue = (
  linkObject: THREE.Object3D,
  desiredForwardDirection: THREE.Vector3
): LocalCameraFrameCue | null => {
  if (desiredForwardDirection.lengthSq() < CAMERA_AUTO_DIRECTION_CUE_MIN_VECTOR_LENGTH) {
    return null;
  }
  const pointSample = gatherOwnedLinkBoundsPointSample(linkObject);
  const dominantBasis = pointSample.dominantBasis;
  if (!dominantBasis) return null;

  const desiredForward = desiredForwardDirection.clone().normalize();
  const basisAxes = [
    dominantBasis.xAxis.clone(),
    dominantBasis.yAxis.clone(),
    dominantBasis.zAxis.clone(),
  ];
  let bestForward: THREE.Vector3 | null = null;
  let bestForwardAlignment = -Infinity;
  basisAxes.forEach((basisAxis) => {
    const alignment = Math.abs(basisAxis.dot(desiredForward));
    if (alignment <= bestForwardAlignment) return;
    bestForwardAlignment = alignment;
    bestForward = basisAxis
      .clone()
      .multiplyScalar(basisAxis.dot(desiredForward) >= 0 ? 1 : -1)
      .normalize();
  });
  if (!bestForward) return null;

  const localUpReference = computeLinkLocalWorldUpReference(linkObject);
  const upReferenceProjected = localUpReference
    .clone()
    .addScaledVector(bestForward, -localUpReference.dot(bestForward));
  const projectedUpReference = normalizeIfValid(upReferenceProjected);
  if (!projectedUpReference) return null;

  let bestUp: THREE.Vector3 | null = null;
  let bestUpAlignment = -Infinity;
  basisAxes.forEach((basisAxis) => {
    if (Math.abs(basisAxis.dot(bestForward)) > CAMERA_AUTO_FRAME_CUE_EPSILON) return;
    const projectedUp = basisAxis
      .clone()
      .addScaledVector(bestForward, -basisAxis.dot(bestForward));
    const normalizedProjectedUp = normalizeIfValid(projectedUp);
    if (!normalizedProjectedUp) return;
    if (normalizedProjectedUp.dot(projectedUpReference) < 0) {
      normalizedProjectedUp.multiplyScalar(-1);
    }
    const alignment = normalizedProjectedUp.dot(projectedUpReference);
    if (alignment <= bestUpAlignment) return;
    bestUpAlignment = alignment;
    bestUp = normalizedProjectedUp;
  });
  if (!bestUp) return null;

  const basis = buildAxisFrameBasis({
    forwardHint: bestForward,
    upHint: bestUp,
  });

  return {
    forward: basis.forward,
    right: basis.right,
    up: basis.up,
    confidence: Math.max(0, Math.min(1, bestForwardAlignment * bestUpAlignment)),
  };
};

export const resolveCameraLinkEnvelope = (
  robot: URDFRobot | null,
  parentJointName: string
): CameraLinkEnvelope | null => {
  if (!robot || !parentJointName.trim()) return null;
  const parentLinkName = resolveCameraParentLinkNameFromJoint(robot, parentJointName);
  if (!parentLinkName || !CAMERA_LINK_PREFIX_PATTERN.test(parentLinkName)) return null;

  const linkObject = resolveRobotLinkObject(robot, parentLinkName);
  if (!linkObject) return null;

  const pointSample = gatherOwnedLinkBoundsPointSample(linkObject);
  if (pointSample.points.length === 0) return null;
  const orientedEnvelope = pointSample.dominantBasis
    ? resolveEnvelopeFromDominantBasis(pointSample.points, pointSample.dominantBasis)
    : null;
  const fallbackBounds = !orientedEnvelope
    ? computeOwnedLinkLocalVisualBounds(linkObject)
    : null;
  if (!orientedEnvelope && !fallbackBounds) return null;

  const localCenter =
    orientedEnvelope?.localCenter ??
    fallbackBounds!.getCenter(new THREE.Vector3());
  const localSize =
    orientedEnvelope?.localSize ??
    (() => {
      const rawSize = fallbackBounds!.getSize(new THREE.Vector3());
      return new THREE.Vector3(
        clampAxisToMinEdge(rawSize.x),
        clampAxisToMinEdge(rawSize.y),
        clampAxisToMinEdge(rawSize.z)
      );
    })();
  const localQuaternion = orientedEnvelope?.localQuaternion ?? new THREE.Quaternion();

  return {
    linkObject,
    localCenter,
    localSize,
    localQuaternion,
  };
};
