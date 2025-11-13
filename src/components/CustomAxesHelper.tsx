import { useMemo } from "react";
import * as THREE from "three";

interface CustomAxesHelperProps {
  size?: number;
}

const DOT_SPACING = 0.25;
const DOT_SIZE = 0.02;
const LINE_WIDTH = 1;
const ORIGIN = new THREE.Vector3(0, 0, 0);

const AXES: Array<{ color: number; direction: THREE.Vector3 }> = [
  { color: 0xff0000, direction: new THREE.Vector3(1, 0, 0) }, // X (red)
  { color: 0x00ff00, direction: new THREE.Vector3(0, 1, 0) }, // Y (green)
  { color: 0x0000ff, direction: new THREE.Vector3(0, 0, 1) }, // Z (blue)
];

const createPositiveLine = (direction: THREE.Vector3, color: number, length: number) => {
  const endPoint = direction.clone().multiplyScalar(length);
  const geometry = new THREE.BufferGeometry().setFromPoints([
    ORIGIN.clone(),
    endPoint,
  ]);
  return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, linewidth: LINE_WIDTH }));
};

const createNegativeDots = (direction: THREE.Vector3, color: number, length: number) => {
  const steps = Math.floor(length / DOT_SPACING);
  if (steps <= 0) {
    return null;
  }

  const points: THREE.Vector3[] = [];
  for (let step = 1; step <= steps; step += 1) {
    const distance = -step * DOT_SPACING;
    points.push(direction.clone().multiplyScalar(distance));
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Points(geometry, new THREE.PointsMaterial({ color, size: DOT_SIZE }));
};

/**
 * Custom axes helper that extends in both directions
 * Positive direction: solid lines (like axesHelper)
 * Negative direction: dots of the same color
 */
export const CustomAxesHelper = ({ size = 10 }: CustomAxesHelperProps) => {
  const axes = useMemo(() => {
    const group = new THREE.Group();

    for (const { color, direction } of AXES) {
      group.add(createPositiveLine(direction, color, size));

      const negativeDots = createNegativeDots(direction, color, size);
      if (negativeDots) {
        group.add(negativeDots);
      }
    }

    return group;
  }, [size]);

  return <primitive object={axes} />;
};

