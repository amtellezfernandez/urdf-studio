import * as THREE from "three";
import { type ObjectCreatorType } from "./useObjectCreator";

export const DEFAULT_CUBE_SIZE = 0.1;
export const DEFAULT_POINT_SIZE = 0.02;
export const DEFAULT_SPHERE_DIAMETER = 0.1;
export const DEFAULT_CYLINDER_DIAMETER = 0.1;
export const DEFAULT_CYLINDER_HEIGHT = 0.16;
export const DEFAULT_ORBIT_RADIUS = 0.3;
export const DEFAULT_ORBIT_INCLINATION = 45;
export const DEFAULT_ORBIT_PHASE = 0;
export const DEFAULT_ORBIT_OFFSET = 180;

export const getDefaultSize = (type: ObjectCreatorType): THREE.Vector3 => {
  if (type === "point") {
    return new THREE.Vector3(DEFAULT_POINT_SIZE, DEFAULT_POINT_SIZE, DEFAULT_POINT_SIZE);
  }
  if (type === "sphere") {
    return new THREE.Vector3(
      DEFAULT_SPHERE_DIAMETER,
      DEFAULT_SPHERE_DIAMETER,
      DEFAULT_SPHERE_DIAMETER
    );
  }
  if (type === "cylinder") {
    return new THREE.Vector3(
      DEFAULT_CYLINDER_DIAMETER,
      DEFAULT_CYLINDER_DIAMETER,
      DEFAULT_CYLINDER_HEIGHT
    );
  }
  return new THREE.Vector3(DEFAULT_CUBE_SIZE, DEFAULT_CUBE_SIZE, DEFAULT_CUBE_SIZE);
};

export const suggestPositionFromBoundingBox = (robotBoundingBox?: THREE.Box3 | null) => {
  if (!robotBoundingBox || robotBoundingBox.isEmpty()) {
    return { x: 0.5, y: 0.5, z: 0.5 };
  }

  const robotMax = robotBoundingBox.max;
  const robotCenter = new THREE.Vector3();
  const robotSize = new THREE.Vector3();
  robotBoundingBox.getCenter(robotCenter);
  robotBoundingBox.getSize(robotSize);

  const offset = Math.max(robotSize.x, robotSize.y, robotSize.z) * 0.5 + 0.3;

  return {
    x: parseFloat((robotMax.x + offset).toFixed(3)),
    y: parseFloat(robotCenter.y.toFixed(3)),
    z: parseFloat(robotCenter.z.toFixed(3)),
  };
};
