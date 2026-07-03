import { useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ROVER_APPROACH_GUIDE_PARAMS } from "@/features/viewer/roverApproachGuideParams";
import type { RoverApproachRoutePreviewState } from "@/features/viewer/roverApproachGuideState";
import { resolveRoverApproachRoutePreviewPoints } from "@/features/viewer/roverApproachRoutePreviewMath";
import {
  hideRoverApproachOverlayLine,
  showRoverApproachOverlayLine,
  useRoverApproachOverlayLine,
} from "@/features/viewer/roverApproachOverlayLine";

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
  const { lineGeometry, lineObject } = useRoverApproachOverlayLine({
    positions: positionsRef.current,
    color: ROVER_APPROACH_GUIDE_PARAMS.routeColor,
    opacity: ROVER_APPROACH_GUIDE_PARAMS.routeOpacity,
  });

  useFrame(() => {
    const previewState = routePreviewStateRef.current;
    if (!previewState.visible || previewState.pointPlanarWorlds.length < 2) {
      hideRoverApproachOverlayLine(lineObject, lineGeometry);
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
    showRoverApproachOverlayLine(lineObject, lineGeometry, pointCount);
  });

  return <primitive object={lineObject} />;
};
