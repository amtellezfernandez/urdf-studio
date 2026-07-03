import {
  useRef,
  type MutableRefObject,
} from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ROVER_APPROACH_GUIDE_PARAMS } from "@/features/viewer/roverApproachGuideParams";
import type { RoverApproachGuideLineState } from "@/features/viewer/roverApproachGuideState";
import {
  hideRoverApproachOverlayLine,
  showRoverApproachOverlayLine,
  useRoverApproachOverlayLine,
} from "@/features/viewer/roverApproachOverlayLine";

const DEFAULT_ARROW_FORWARD = new THREE.Vector3(0, 1, 0);

export const RoverApproachGuideLine = ({
  guideLineStateRef,
  resolveUpAxis,
}: {
  guideLineStateRef: MutableRefObject<RoverApproachGuideLineState>;
  resolveUpAxis: () => THREE.Vector3;
}) => {
  const linePositionsRef = useRef(new Float32Array(2 * 3));
  const arrowsRef = useRef<THREE.InstancedMesh>(null);
  const worldUpRef = useRef(new THREE.Vector3());
  const liftedStartRef = useRef(new THREE.Vector3());
  const liftedEndRef = useRef(new THREE.Vector3());
  const segmentDirectionRef = useRef(new THREE.Vector3());
  const arrowPositionRef = useRef(new THREE.Vector3());
  const arrowQuaternionRef = useRef(new THREE.Quaternion());
  const arrowScaleRef = useRef(new THREE.Vector3(1, 1, 1));
  const arrowMatrixRef = useRef(new THREE.Matrix4());
  const { lineGeometry, lineObject } = useRoverApproachOverlayLine({
    positions: linePositionsRef.current,
    color: ROVER_APPROACH_GUIDE_PARAMS.color,
    opacity: ROVER_APPROACH_GUIDE_PARAMS.opacity,
  });

  useFrame(() => {
    const arrows = arrowsRef.current;
    if (!arrows) return;
    const guideState = guideLineStateRef.current;
    if (!guideState.visible) {
      hideRoverApproachOverlayLine(lineObject, lineGeometry);
      arrows.visible = false;
      return;
    }

    worldUpRef.current.copy(resolveUpAxis());
    if (worldUpRef.current.lengthSq() <= 1e-10) {
      worldUpRef.current.set(0, 0, 1);
    } else {
      worldUpRef.current.normalize();
    }

    liftedStartRef.current
      .copy(guideState.basePlanarWorld)
      .addScaledVector(worldUpRef.current, ROVER_APPROACH_GUIDE_PARAMS.liftMeters);
    liftedEndRef.current
      .copy(guideState.targetPlanarWorld)
      .addScaledVector(worldUpRef.current, ROVER_APPROACH_GUIDE_PARAMS.liftMeters);

    segmentDirectionRef.current
      .copy(liftedEndRef.current)
      .sub(liftedStartRef.current);
    const segmentLength = segmentDirectionRef.current.length();
    if (
      !Number.isFinite(segmentLength) ||
      segmentLength <= ROVER_APPROACH_GUIDE_PARAMS.minLengthMeters
    ) {
      hideRoverApproachOverlayLine(lineObject, lineGeometry);
      arrows.visible = false;
      return;
    }
    segmentDirectionRef.current.multiplyScalar(1 / segmentLength);

    linePositionsRef.current[0] = liftedStartRef.current.x;
    linePositionsRef.current[1] = liftedStartRef.current.y;
    linePositionsRef.current[2] = liftedStartRef.current.z;
    linePositionsRef.current[3] = liftedEndRef.current.x;
    linePositionsRef.current[4] = liftedEndRef.current.y;
    linePositionsRef.current[5] = liftedEndRef.current.z;

    showRoverApproachOverlayLine(lineObject, lineGeometry, 2);

    const requestedArrowCount = Math.floor(
      segmentLength / ROVER_APPROACH_GUIDE_PARAMS.arrowSpacingMeters
    );
    const arrowCount = Math.max(
      1,
      Math.min(requestedArrowCount, ROVER_APPROACH_GUIDE_PARAMS.maxArrowCount)
    );
    arrowQuaternionRef.current.setFromUnitVectors(
      DEFAULT_ARROW_FORWARD,
      segmentDirectionRef.current
    );

    for (let index = 0; index < arrowCount; index += 1) {
      const t = (index + 1) / (arrowCount + 1);
      arrowPositionRef.current
        .copy(liftedStartRef.current)
        .addScaledVector(segmentDirectionRef.current, segmentLength * t);
      arrowMatrixRef.current.compose(
        arrowPositionRef.current,
        arrowQuaternionRef.current,
        arrowScaleRef.current
      );
      arrows.setMatrixAt(index, arrowMatrixRef.current);
    }

    arrows.count = arrowCount;
    arrows.instanceMatrix.needsUpdate = true;
    arrows.visible = true;
  });

  return (
    <>
      <primitive object={lineObject} />
      <instancedMesh
        ref={arrowsRef}
        args={[undefined, undefined, ROVER_APPROACH_GUIDE_PARAMS.maxArrowCount]}
        visible={false}
        renderOrder={20}
        raycast={() => null}
      >
        <coneGeometry
          args={[
            ROVER_APPROACH_GUIDE_PARAMS.arrowRadiusMeters,
            ROVER_APPROACH_GUIDE_PARAMS.arrowLengthMeters,
            10,
          ]}
        />
        <meshBasicMaterial
          color={ROVER_APPROACH_GUIDE_PARAMS.color}
          opacity={ROVER_APPROACH_GUIDE_PARAMS.opacity}
          transparent
          depthTest={false}
          depthWrite={false}
        />
      </instancedMesh>
    </>
  );
};
