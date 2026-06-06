import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import type { WorldLabsSplatGroundProbe } from "@/features/viewer/worldLabsSplatGroundProbe";
import { applyJointValues } from "@/shared/lib/urdf-joints";

const STUDIO_UP_AXIS = new THREE.Vector3(0, 0, 1);

export type WorldLabsSo101DemoTransform = {
  scale: number;
  rotationRpy: [number, number, number];
  jointPositions?: Record<string, number>;
  splatGroundProbe?: {
    enabled: boolean;
    clearance: number;
    maxDistance: number;
    maxSnapDelta: number;
    minConfidence: number;
    minNormalUpDot: number;
    rayStartHeight: number;
    sampleRadius: number;
    surfaceTolerance: number;
  };
};

export type WorldLabsSplatGroundingApplyResult = {
  applied: boolean;
  reason:
    | "applied"
    | "disabled"
    | "missing_probe"
    | "package_mismatch"
    | "probe_miss"
    | "low_confidence"
    | "snap_out_of_range";
};

export const resolveWorldLabsSo101DemoTransform = ({
  activePackageId,
  robotName,
}: {
  activePackageId: string | null | undefined;
  robotName: string | null | undefined;
}): WorldLabsSo101DemoTransform => {
  if (
    activePackageId === "world-labs-third-person-controller-open" &&
    robotName === "so101_new_calib"
  ) {
    return {
      scale: 1,
      rotationRpy: [0, 0, 0],
      jointPositions: {
        shoulder_pan: 0,
        shoulder_lift: -0.34,
        elbow_flex: -1.32,
        wrist_flex: -0.2,
        wrist_roll: 0,
        gripper: 0.35,
      },
      splatGroundProbe: {
        enabled: true,
        clearance: 0.01,
        maxDistance: 2,
        maxSnapDelta: 0.75,
        minConfidence: 0.35,
        minNormalUpDot: 0.5,
        rayStartHeight: 0.8,
        sampleRadius: 0.08,
        surfaceTolerance: 0.05,
      },
    };
  }

  return {
    scale: 1,
    rotationRpy: [0, 0, 0],
  };
};

export const applyWorldLabsSo101DemoTransformToRobot = ({
  activePackageId,
  robot,
  applyJointPositions = true,
}: {
  activePackageId: string | null | undefined;
  robot: URDFRobot;
  applyJointPositions?: boolean;
}): WorldLabsSo101DemoTransform => {
  const demoTransform = resolveWorldLabsSo101DemoTransform({
    activePackageId,
    robotName: robot.name,
  });

  robot.rotation.set(...demoTransform.rotationRpy);
  robot.scale.setScalar(demoTransform.scale);
  if (applyJointPositions && demoTransform.jointPositions) {
    applyJointValues(robot, demoTransform.jointPositions);
  }
  robot.userData.worldLabsSo101DemoTransform = demoTransform;
  robot.updateMatrixWorld?.(true);
  return demoTransform;
};

export const applyWorldLabsSplatGroundProbeToRobot = ({
  activePackageId,
  groundProbe,
  robot,
}: {
  activePackageId: string | null | undefined;
  groundProbe: WorldLabsSplatGroundProbe | null | undefined;
  robot: THREE.Object3D & { name?: string };
}): WorldLabsSplatGroundingApplyResult => {
  const demoTransform = resolveWorldLabsSo101DemoTransform({
    activePackageId,
    robotName: robot.name,
  });
  const probeConfig = demoTransform.splatGroundProbe;
  if (!probeConfig?.enabled) {
    return { applied: false, reason: "disabled" };
  }
  if (!groundProbe) {
    return { applied: false, reason: "missing_probe" };
  }
  if (groundProbe.packageId !== activePackageId) {
    return { applied: false, reason: "package_mismatch" };
  }

  robot.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(robot);
  const bottomOffset =
    bounds.isEmpty() || !Number.isFinite(bounds.min.z)
      ? 0
      : bounds.min.z - robot.position.z;
  const surface = groundProbe.probeDown(
    new THREE.Vector3(
      robot.position.x,
      robot.position.y,
      robot.position.z + probeConfig.rayStartHeight
    ),
    {
      maxDistance: probeConfig.maxDistance,
      minHitCount: 4,
      sampleRadius: probeConfig.sampleRadius,
      surfaceTolerance: probeConfig.surfaceTolerance,
    }
  );
  if (!surface) {
    return { applied: false, reason: "probe_miss" };
  }

  const upDot = surface.normal.dot(STUDIO_UP_AXIS);
  if (surface.confidence < probeConfig.minConfidence || upDot < probeConfig.minNormalUpDot) {
    return { applied: false, reason: "low_confidence" };
  }

  const nextZ = surface.point.z - bottomOffset + probeConfig.clearance;
  if (
    !Number.isFinite(nextZ) ||
    Math.abs(nextZ - robot.position.z) > probeConfig.maxSnapDelta
  ) {
    return { applied: false, reason: "snap_out_of_range" };
  }

  robot.position.z = nextZ;
  robot.userData.worldLabsSplatGroundProbe = {
    confidence: surface.confidence,
    hitCount: surface.hitCount,
    maxPlaneResidual: surface.maxPlaneResidual,
    normal_xyz: surface.normal.toArray(),
    point_xyz: surface.point.toArray(),
    sampleCount: surface.sampleCount,
    sampleRadius: surface.sampleRadius,
    source: surface.source,
  };
  robot.updateMatrixWorld(true);
  return { applied: true, reason: "applied" };
};
