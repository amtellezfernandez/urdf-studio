import { useEffect, useMemo } from "react";
import * as THREE from "three";

type RoverApproachOverlayLineOptions = {
  positions: Float32Array;
  color: THREE.ColorRepresentation;
  opacity: number;
  renderOrder?: number;
};

export const useRoverApproachOverlayLine = ({
  positions,
  color,
  opacity,
  renderOrder = 19,
}: RoverApproachOverlayLineOptions) => {
  const lineGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geometry;
  }, [positions]);
  const lineMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color,
        opacity,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    [color, opacity]
  );
  const lineObject = useMemo(() => {
    const line = new THREE.Line(lineGeometry, lineMaterial);
    line.visible = false;
    line.renderOrder = renderOrder;
    line.raycast = () => null;
    return line;
  }, [lineGeometry, lineMaterial, renderOrder]);

  useEffect(
    () => () => {
      lineGeometry.dispose();
      lineMaterial.dispose();
    },
    [lineGeometry, lineMaterial]
  );

  return { lineGeometry, lineObject };
};

export const hideRoverApproachOverlayLine = (
  lineObject: THREE.Line,
  lineGeometry: THREE.BufferGeometry
) => {
  lineObject.visible = false;
  lineGeometry.setDrawRange(0, 0);
};

export const showRoverApproachOverlayLine = (
  lineObject: THREE.Line,
  lineGeometry: THREE.BufferGeometry,
  pointCount: number
) => {
  const positions = lineGeometry.attributes.position as THREE.BufferAttribute;
  positions.needsUpdate = true;
  lineGeometry.setDrawRange(0, pointCount);
  lineGeometry.computeBoundingSphere();
  lineObject.visible = true;
};
