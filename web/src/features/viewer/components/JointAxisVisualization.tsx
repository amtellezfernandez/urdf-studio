import {
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";

import type { JointAxisMap, JointLimits } from "@/shared/lib/urdfBrowser";
import type { GPUMode } from "@/shared/hooks/use-gpu-mode";

type RotationPlaneProps = {
  axis: [number, number, number];
  gpuMode?: GPUMode;
  jointLimits?: JointLimits;
  jointName: string;
  robot: URDFRobot | null;
};

type AxisTuple = readonly [number, number, number];
type JointWithAxis = {
  axis?: unknown;
};

const DEFAULT_JOINT_AXIS: AxisTuple = [0, 0, 1];

const isFiniteAxisTuple = (
  axis: readonly number[] | undefined
): axis is AxisTuple =>
  Boolean(
    axis &&
      Number.isFinite(axis[0]) &&
      Number.isFinite(axis[1]) &&
      Number.isFinite(axis[2])
  );

const readJointAxisVector = (joint: unknown): THREE.Vector3 | null => {
  if (!joint || typeof joint !== "object") return null;
  const axis = (joint as JointWithAxis).axis;
  return axis instanceof THREE.Vector3 ? axis : null;
};

const resolveJointAxisTuple = (
  axisFromStore: readonly number[] | undefined,
  joint: unknown
): AxisTuple => {
  if (isFiniteAxisTuple(axisFromStore)) {
    return [axisFromStore[0], axisFromStore[1], axisFromStore[2]];
  }
  const axisFromJoint = readJointAxisVector(joint);
  if (axisFromJoint) {
    return [axisFromJoint.x, axisFromJoint.y, axisFromJoint.z];
  }
  return DEFAULT_JOINT_AXIS;
};

const setResolvedJointAxis = (
  target: THREE.Vector3,
  axisFromStore: readonly number[] | undefined,
  joint: unknown
): void => {
  const [x, y, z] = resolveJointAxisTuple(axisFromStore, joint);
  target.set(x, y, z);
};

export const RotationPlane = ({
  robot,
  jointName,
  axis,
  gpuMode = "high",
}: RotationPlaneProps) => {
  const planeRef = useRef<THREE.LineLoop>(null);
  const positionRef = useRef(new THREE.Vector3());
  const quaternionRef = useRef(new THREE.Quaternion());
  const defaultNormal = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  const fallbackAxis = useMemo(() => new THREE.Vector3(1, 0, 0), []);
  const [axisX, axisY, axisZ] = axis;

  const axisVec = useMemo(() => {
    return new THREE.Vector3(axisX, axisY, axisZ).normalize();
  }, [axisX, axisY, axisZ]);

  const { planeColor, isNegative } = useMemo(() => {
    const absX = Math.abs(axisVec.x);
    const absY = Math.abs(axisVec.y);
    const absZ = Math.abs(axisVec.z);

    let color: number;
    let negative = false;

    if (absX >= absY && absX >= absZ) {
      negative = axisVec.x < 0;
      color = axisVec.x > 0 ? 0xbe2c41 : 0x9a2333;
    } else if (absY >= absX && absY >= absZ) {
      negative = axisVec.y < 0;
      color = axisVec.y > 0 ? 0x6da424 : 0x56831c;
    } else {
      negative = axisVec.z < 0;
      color = axisVec.z > 0 ? 0x3464ad : 0x29508a;
    }

    return { planeColor: color, isNegative: negative };
  }, [axisVec]);

  const circleGeometry = useMemo(() => {
    const radius = 0.25;
    const segments = 96;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < segments; i += 1) {
      const t = (i / segments) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(t) * radius, Math.sin(t) * radius, 0));
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  }, []);

  const planeLineMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: planeColor,
        transparent: true,
        opacity: gpuMode === "low" ? 0.55 : 0.7,
        depthTest: true,
        depthWrite: false,
      }),
    [gpuMode, planeColor]
  );

  useEffect(() => () => circleGeometry.dispose(), [circleGeometry]);
  useEffect(() => () => planeLineMaterial.dispose(), [planeLineMaterial]);

  useFrame(() => {
    if (!robot || !planeRef.current) return;

    const joint = robot.joints?.[jointName];
    if (!joint) return;

    joint.updateWorldMatrix(true, true);
    joint.getWorldPosition(positionRef.current);
    planeRef.current.position.copy(positionRef.current);

    if (Math.abs(axisVec.dot(defaultNormal)) > 0.99) {
      quaternionRef.current.setFromAxisAngle(fallbackAxis, Math.PI / 2);
    } else if (Math.abs(axisVec.dot(defaultNormal)) < -0.99) {
      quaternionRef.current.setFromAxisAngle(fallbackAxis, -Math.PI / 2);
    } else {
      quaternionRef.current.setFromUnitVectors(defaultNormal, axisVec);
    }

    planeRef.current.quaternion.copy(quaternionRef.current);
  });

  const lineScale = isNegative ? 0.96 : 1.0;

  return (
    <lineLoop
      ref={planeRef}
      renderOrder={-10}
      geometry={circleGeometry}
      material={planeLineMaterial}
      scale={[lineScale, lineScale, 1]}
      frustumCulled={false}
    />
  );
};

type JointAxisIndicatorProps = {
  jointAxes?: JointAxisMap;
  jointLimits?: JointLimits;
  jointName: string | null;
  robot: URDFRobot | null;
};

export const JointAxisIndicator = ({
  robot,
  jointName,
  jointAxes,
  jointLimits,
}: JointAxisIndicatorProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const worldPositionRef = useRef(new THREE.Vector3());
  const worldQuaternionRef = useRef(new THREE.Quaternion());
  const axisLocalRef = useRef(new THREE.Vector3(0, 0, 1));
  const axisWorldRef = useRef(new THREE.Vector3(0, 0, 1));
  const alignQuaternionRef = useRef(new THREE.Quaternion());
  const upAxis = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  const shouldRender = useMemo(() => {
    if (!robot || !jointName) return false;
    const jointType = (
      jointLimits?.[jointName]?.type ??
      robot.joints?.[jointName]?.jointType ??
      ""
    ).toLowerCase();
    return jointType === "revolute" || jointType === "continuous";
  }, [jointLimits, jointName, robot]);

  const { straightAxisColor, planeCueBaseColor } = useMemo(() => {
    if (!robot || !jointName) {
      return { straightAxisColor: 0xbe2c41, planeCueBaseColor: 0xbe2c41 };
    }

    const joint = robot.joints?.[jointName];
    const axisFromStore = jointAxes?.[jointName]?.xyz;
    const [x, y, z] = resolveJointAxisTuple(axisFromStore, joint);

    const absX = Math.abs(x);
    const absY = Math.abs(y);
    const absZ = Math.abs(z);

    if (absX >= absY && absX >= absZ) {
      return {
        straightAxisColor: 0xbe2c41,
        planeCueBaseColor: x >= 0 ? 0xbe2c41 : 0x9a2333,
      };
    }
    if (absY >= absX && absY >= absZ) {
      return {
        straightAxisColor: 0x6da424,
        planeCueBaseColor: y >= 0 ? 0x6da424 : 0x56831c,
      };
    }
    return {
      straightAxisColor: 0x3464ad,
      planeCueBaseColor: z >= 0 ? 0x3464ad : 0x29508a,
    };
  }, [jointAxes, jointName, robot]);

  const rotationCueColor = planeCueBaseColor;
  const rotationCueHeadColor = planeCueBaseColor;

  const {
    arrowLength,
    shaftRadius,
    headRadius,
    arcRadius,
    arcTubeRadius,
    arcArrowRadius,
    arcArrowLength,
  } = useMemo(() => {
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    let robotExtent = 1.0;
    let localJointExtent: number | null = null;

    if (robot && jointName) {
      const jointObj = robot.joints?.[jointName] as
        | (THREE.Object3D & { children?: THREE.Object3D[] })
        | undefined;
      const childCandidates = jointObj?.children ?? [];
      const childLink =
        childCandidates.find((child) => Boolean(robot.links?.[child.name])) ??
        childCandidates[0];
      if (childLink) {
        const localBox = new THREE.Box3().setFromObject(childLink);
        if (!localBox.isEmpty()) {
          const localSize = localBox.getSize(new THREE.Vector3());
          const localMax = Math.max(localSize.x, localSize.y, localSize.z);
          if (Number.isFinite(localMax) && localMax > 1e-4) {
            localJointExtent = localMax;
          }
        }
      }
    }

    if (robot) {
      const box = new THREE.Box3().setFromObject(robot);
      if (!box.isEmpty()) {
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        if (Number.isFinite(maxDim) && maxDim > 1e-4) {
          robotExtent = maxDim;
        }
      }
    }

    const length =
      localJointExtent !== null
        ? clamp(localJointExtent * 0.45, 0.02, 0.12)
        : clamp(robotExtent * 0.045, 0.022, 0.12);
    const shaftR = clamp(length * 0.02, 0.0014, 0.005);
    const headR = clamp(length * 0.06, 0.0038, 0.011);
    const arcR = length * 0.25;
    const arcTubeR = clamp(length * 0.01, 0.001, 0.0028);
    const arcArrowR = clamp(length * 0.04, 0.003, 0.0085);
    const arcArrowL = arcArrowR * 2;

    return {
      arrowLength: length,
      shaftRadius: shaftR,
      headRadius: headR,
      arcRadius: arcR,
      arcTubeRadius: arcTubeR,
      arcArrowRadius: arcArrowR,
      arcArrowLength: arcArrowL,
    };
  }, [jointName, robot]);

  useFrame(() => {
    if (!shouldRender || !groupRef.current || !robot || !jointName) return;
    const joint = robot.joints?.[jointName];
    if (!joint) return;

    const axisFromStore = jointAxes?.[jointName]?.xyz;
    setResolvedJointAxis(axisLocalRef.current, axisFromStore, joint);

    if (axisLocalRef.current.lengthSq() < 1e-9) {
      axisLocalRef.current.set(0, 0, 1);
    }
    axisLocalRef.current.normalize();

    joint.updateWorldMatrix(true, true);
    joint.getWorldPosition(worldPositionRef.current);
    joint.getWorldQuaternion(worldQuaternionRef.current);

    axisWorldRef.current
      .copy(axisLocalRef.current)
      .applyQuaternion(worldQuaternionRef.current)
      .normalize();

    alignQuaternionRef.current.setFromUnitVectors(upAxis, axisWorldRef.current);
    groupRef.current.position.copy(worldPositionRef.current);
    groupRef.current.quaternion.copy(alignQuaternionRef.current);
  });

  if (!shouldRender) {
    return null;
  }

  const shaftLength = arrowLength * 0.7;
  const headLength = arrowLength * 0.3;
  const arcYOffset = arrowLength * 0.85;
  const arcSweep = Math.PI * 1.5;

  return (
    <group ref={groupRef} renderOrder={1002} frustumCulled={false}>
      <mesh position={[0, shaftLength / 2, 0]} renderOrder={1002} frustumCulled={false}>
        <cylinderGeometry args={[shaftRadius, shaftRadius, shaftLength, 12]} />
        <meshBasicMaterial
          color={straightAxisColor}
          transparent
          opacity={0.95}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, shaftLength + headLength / 2, 0]} renderOrder={1002} frustumCulled={false}>
        <coneGeometry args={[headRadius, headLength, 16]} />
        <meshBasicMaterial
          color={straightAxisColor}
          transparent
          opacity={0.95}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <mesh
        position={[0, arcYOffset, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        renderOrder={1002}
        frustumCulled={false}
      >
        <torusGeometry args={[arcRadius, arcTubeRadius, 8, 42, arcSweep]} />
        <meshBasicMaterial
          color={rotationCueColor}
          transparent
          opacity={0.95}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <mesh
        position={[0, arcYOffset, -arcRadius]}
        rotation={[0, 0, -Math.PI / 2]}
        renderOrder={1002}
        frustumCulled={false}
      >
        <coneGeometry args={[arcArrowRadius, arcArrowLength, 8]} />
        <meshBasicMaterial
          color={rotationCueHeadColor}
          transparent
          opacity={0.95}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
};
