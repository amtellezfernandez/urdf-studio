import * as THREE from "three";
import type { WorldLabsSplatGroundProbe } from "@/features/viewer/worldLabsSplatGroundProbe";

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
      scale: 10,
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
        clearance: 0.02,
        maxDistance: 6,
        maxSnapDelta: 3,
        minConfidence: 0.35,
        minNormalUpDot: 0.5,
        rayStartHeight: 2,
        sampleRadius: 0.35,
        surfaceTolerance: 0.22,
      },
    };
  }

  return {
    scale: 1,
    rotationRpy: [0, 0, 0],
  };
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
    bounds.isEmpty() || !Number.isFinite(bounds.min.y)
      ? 0
      : bounds.min.y - robot.position.y;
  const surface = groundProbe.probeDown(
    new THREE.Vector3(
      robot.position.x,
      robot.position.y + probeConfig.rayStartHeight,
      robot.position.z
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

  const upDot = surface.normal.dot(new THREE.Vector3(0, 1, 0));
  if (surface.confidence < probeConfig.minConfidence || upDot < probeConfig.minNormalUpDot) {
    return { applied: false, reason: "low_confidence" };
  }

  const nextY = surface.point.y - bottomOffset + probeConfig.clearance;
  if (
    !Number.isFinite(nextY) ||
    Math.abs(nextY - robot.position.y) > probeConfig.maxSnapDelta
  ) {
    return { applied: false, reason: "snap_out_of_range" };
  }

  robot.position.y = nextY;
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
