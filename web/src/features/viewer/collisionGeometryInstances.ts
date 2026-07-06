import * as THREE from "three";
import type { CollisionEntry } from "@/shared/lib/urdfCore";
import {
  composeUrdfPoseMatrix,
  URDF_CYLINDER_TO_THREE_AXIS_QUATERNION,
} from "@/shared/lib/spatialFrame";

export type CollisionInstance = {
  linkName: string;
  localMatrix: THREE.Matrix4;
};

export type CollisionPrimitiveType = "box" | "sphere" | "cylinder";

export type CollisionPrimitiveInstance = CollisionInstance & {
  primitiveType: CollisionPrimitiveType;
};

type CollisionMatrixParams = {
  xyz: [number, number, number];
  rpy: [number, number, number];
  scale?: [number, number, number];
  extraRotation?: THREE.Quaternion;
  centerOffset?: THREE.Vector3;
};

export const buildCollisionLocalMatrix = ({
  xyz,
  rpy,
  scale,
  extraRotation,
  centerOffset,
}: CollisionMatrixParams): THREE.Matrix4 =>
  composeUrdfPoseMatrix(
    {
      xyz,
      rpy,
      scale,
      extraRotation,
      centerOffset,
    },
    new THREE.Matrix4()
  );

export const buildPrimitiveCollisionInstance = ({
  collision,
  linkName,
  useBoxProxyScale = false,
}: {
  collision: CollisionEntry;
  linkName: string;
  useBoxProxyScale?: boolean;
}): CollisionPrimitiveInstance | null => {
  const geometry = collision.geometry;

  if (geometry.type === "box") {
    return {
      linkName,
      primitiveType: "box",
      localMatrix: buildCollisionLocalMatrix({
        xyz: collision.origin.xyz,
        rpy: collision.origin.rpy,
        scale: geometry.size,
      }),
    };
  }

  if (geometry.type === "sphere") {
    const scale: [number, number, number] = useBoxProxyScale
      ? [geometry.radius * 2, geometry.radius * 2, geometry.radius * 2]
      : [geometry.radius, geometry.radius, geometry.radius];
    return {
      linkName,
      primitiveType: "sphere",
      localMatrix: buildCollisionLocalMatrix({
        xyz: collision.origin.xyz,
        rpy: collision.origin.rpy,
        scale,
      }),
    };
  }

  if (geometry.type === "cylinder") {
    const scale: [number, number, number] = useBoxProxyScale
      ? [geometry.radius * 2, geometry.length, geometry.radius * 2]
      : [geometry.radius, geometry.length, geometry.radius];
    return {
      linkName,
      primitiveType: "cylinder",
      localMatrix: buildCollisionLocalMatrix({
        xyz: collision.origin.xyz,
        rpy: collision.origin.rpy,
        scale,
        extraRotation: URDF_CYLINDER_TO_THREE_AXIS_QUATERNION,
      }),
    };
  }

  return null;
};

export const buildMeshCollisionProxyInstanceFromBounds = ({
  bounds,
  meshScale,
  collision,
  linkName,
}: {
  bounds: THREE.Box3;
  meshScale: [number, number, number];
  collision: CollisionEntry;
  linkName: string;
}): CollisionInstance | null => {
  if (bounds.isEmpty()) {
    return null;
  }

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bounds.getSize(size);
  bounds.getCenter(center);
  size.multiply(new THREE.Vector3(meshScale[0], meshScale[1], meshScale[2]));
  center.multiply(new THREE.Vector3(meshScale[0], meshScale[1], meshScale[2]));

  return {
    linkName,
    localMatrix: buildCollisionLocalMatrix({
      xyz: collision.origin.xyz,
      rpy: collision.origin.rpy,
      scale: [size.x, size.y, size.z],
      centerOffset: center,
    }),
  };
};
