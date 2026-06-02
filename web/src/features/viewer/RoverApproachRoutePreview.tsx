import {
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ROVER_APPROACH_GUIDE_PARAMS } from "@/features/viewer/roverApproachGuideParams";
import type { RoverApproachRoutePreviewState } from "@/features/viewer/roverApproachGuideState";
import { resolveRoverApproachRoutePreviewPoints } from "@/features/viewer/roverApproachRoutePreviewMath";

export const RoverApproachRoutePreview = ({
  routePreviewStateRef,
  resolveUpAxis,
}: {
  routePreviewStateRef: MutableRefObject<RoverApproachRoutePreviewState>;
  resolveUpAxis: () => THREE.Vector3;
}) => {
  const positionsRef = useRef(
    new Float32Array(ROVER_APPROACH_GUIDE_PARAMS.maxRouteRenderPointCount * 3)
  );
  const lineGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positionsRef.current, 3)
    );
    return geometry;
  }, []);
  const lineMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: ROVER_APPROACH_GUIDE_PARAMS.routeColor,
        opacity: ROVER_APPROACH_GUIDE_PARAMS.routeOpacity,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    []
  );
  const lineObject = useMemo(() => {
    const line = new THREE.Line(lineGeometry, lineMaterial);
    line.visible = false;
    line.renderOrder = 19;
    line.raycast = () => null;
    return line;
  }, [lineGeometry, lineMaterial]);

  useEffect(
    () => () => {
      lineGeometry.dispose();
      lineMaterial.dispose();
    },
    [lineGeometry, lineMaterial]
  );

  useFrame(() => {
    const previewState = routePreviewStateRef.current;
    if (!previewState.visible || previewState.pointPlanarWorlds.length < 2) {
      lineObject.visible = false;
      lineGeometry.setDrawRange(0, 0);
      return;
    }
    const previewCurvePoints = resolveRoverApproachRoutePreviewPoints({
      pointWorlds: previewState.pointPlanarWorlds,
      upAxisWorld: resolveUpAxis(),
    });
    const pointCount = Math.min(
      previewCurvePoints.length,
      ROVER_APPROACH_GUIDE_PARAMS.maxRouteRenderPointCount
    );
    for (let index = 0; index < pointCount; index += 1) {
      const pointWorld = previewCurvePoints[index];
      const baseOffset = index * 3;
      positionsRef.current[baseOffset] = pointWorld.x;
      positionsRef.current[baseOffset + 1] = pointWorld.y;
      positionsRef.current[baseOffset + 2] = pointWorld.z;
    }
    const positions = lineGeometry.attributes.position as THREE.BufferAttribute;
    positions.needsUpdate = true;
    lineGeometry.setDrawRange(0, pointCount);
    lineGeometry.computeBoundingSphere();
    lineObject.visible = true;
  });

  return <primitive object={lineObject} />;
};
