import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import type { GPUMode } from "@/shared/hooks/use-gpu-mode";
import { resolveTrackingReference } from "@/features/viewer/trackingTarget";
import { getJointColor } from "@/features/urdf/utils/jointColors";
import { safeDecode } from "@/features/viewer/uri";

const namesMatch = (a: string | null | undefined, b: string | null | undefined) => {
  if (!a || !b) return false;
  const aa = a.trim();
  const bb = b.trim();
  if (!aa || !bb) return false;
  if (aa === bb) return true;
  return safeDecode(aa) === safeDecode(bb);
};

const findJointByChildLink = (
  joints: Record<string, THREE.Object3D> | undefined,
  linkName: string
): string | null => {
  if (!joints) return null;
  for (const [jointName, jointObj] of Object.entries(joints)) {
    const childLink =
      (jointObj as THREE.Object3D & { childLink?: string }).childLink ?? null;
    if (namesMatch(childLink, linkName)) return jointName;
  }
  return null;
};

const resolveAttachedJointName = ({
  robot,
  trackedJointName,
  endEffectorLink,
}: {
  robot: URDFRobot | null;
  trackedJointName: string | null;
  endEffectorLink?: string | null;
}) => {
  if (!robot) return null;
  const joints = (robot.joints ?? {}) as Record<string, THREE.Object3D>;
  const trackedName = trackedJointName?.trim() ?? "";

  if (trackedName) {
    if (joints[trackedName]) return trackedName;
    const decoded = safeDecode(trackedName);
    if (joints[decoded]) return decoded;
    return findJointByChildLink(joints, trackedName);
  }

  const endEffectorName = endEffectorLink?.trim() ?? "";
  if (!endEffectorName) return null;
  if (joints[endEffectorName]) return endEffectorName;
  const decoded = safeDecode(endEffectorName);
  if (joints[decoded]) return decoded;
  return findJointByChildLink(joints, endEffectorName);
};

export const TrackingLine = ({
  cubePos,
  robot,
  trackedJointName,
  endEffectorLink,
  gpuMode = "high",
}: {
  cubePos: THREE.Vector3;
  robot: URDFRobot | null;
  trackedJointName: string | null;
  endEffectorLink?: string | null;
  gpuMode?: GPUMode;
}) => {
  const lineRef = useRef<THREE.LineSegments>(null);
  const smoothedStartRef = useRef(new THREE.Vector3());
  const smoothedEndRef = useRef(new THREE.Vector3());
  const initializedRef = useRef(false);
  const lastDistanceRef = useRef(-1);
  const lineColor = useMemo(() => {
    const attachedJointName = resolveAttachedJointName({
      robot,
      trackedJointName,
      endEffectorLink,
    });
    if (!attachedJointName || !robot?.joints) return "#d6d6d6";
    return getJointColor(attachedJointName, Object.keys(robot.joints));
  }, [robot, trackedJointName, endEffectorLink]);
  const isEndEffectorLine = useMemo(() => {
    const trackedName = trackedJointName?.trim();
    if (!trackedName) return true;
    return namesMatch(trackedName, endEffectorLink);
  }, [trackedJointName, endEffectorLink]);

  useFrame(() => {
    if (!robot || !lineRef.current) return;

    const reference = resolveTrackingReference({
      robot,
      trackedName: trackedJointName,
      endEffectorLink,
    });
    const targetPos = reference?.position ?? null;
    if (!targetPos) return;

    if (!initializedRef.current) {
      smoothedStartRef.current.copy(cubePos);
      smoothedEndRef.current.copy(targetPos);
      initializedRef.current = true;
    } else {
      // Damp micro-jitter from fast IK updates while keeping response immediate.
      smoothedStartRef.current.lerp(cubePos, 0.55);
      smoothedEndRef.current.lerp(targetPos, 0.55);
    }

    const geometry = lineRef.current.geometry as THREE.BufferGeometry;
    const positions = geometry.attributes.position as THREE.BufferAttribute;
    if (positions) {
      positions.array[0] = smoothedStartRef.current.x;
      positions.array[1] = smoothedStartRef.current.y;
      positions.array[2] = smoothedStartRef.current.z;
      positions.array[3] = smoothedEndRef.current.x;
      positions.array[4] = smoothedEndRef.current.y;
      positions.array[5] = smoothedEndRef.current.z;
      positions.needsUpdate = true;
      const segmentDistance = smoothedStartRef.current.distanceTo(smoothedEndRef.current);
      if (Math.abs(segmentDistance - lastDistanceRef.current) > 1e-4) {
        lineRef.current.computeLineDistances();
        lastDistanceRef.current = segmentDistance;
      }
    }
  });

  return (
    <lineSegments ref={lineRef} renderOrder={1000}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={2}
          array={new Float32Array([
            cubePos.x,
            cubePos.y,
            cubePos.z,
            cubePos.x,
            cubePos.y,
            cubePos.z,
          ])}
          itemSize={3}
        />
      </bufferGeometry>
      <lineDashedMaterial
        color={lineColor}
        linewidth={isEndEffectorLine ? 1.6 : 1}
        opacity={0.22}
        dashSize={0.028}
        gapSize={0.02}
        transparent
        depthTest={false}
        depthWrite={false}
      />
    </lineSegments>
  );
};
