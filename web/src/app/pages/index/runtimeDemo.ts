import type { CreatedObject } from "@/features/objects";
import { findRuntimeDemoObject } from "@/studio_ui/runtimeviz/runtimeDemoScene";
import type { RuntimeDemoSpeedMode } from "@/studio_ui/runtimeviz/runtimeRobotPreviewParams";
import { RUNTIME_DEMO_PARAMS } from "@/app/pages/index/runtimeDemoParams";

export type RuntimePose = {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
};

const RUNTIME_PREVIEW_NAVIGABLE_SOURCES = new Set<
  NonNullable<CreatedObject["source"]>
>(["runtime-demo", "runtime-detection"]);

const RUNTIME_DEMO_CONFIG = RUNTIME_DEMO_PARAMS;
const RUNTIME_DEMO_SCAN_SWEEP_RAD = RUNTIME_DEMO_CONFIG.scanSweepRadians;
const RUNTIME_DEMO_NAVIGATION_DURATION_MS = RUNTIME_DEMO_CONFIG.navigationDurationMs;
const RUNTIME_DEMO_STOP_DISTANCE_METERS = RUNTIME_DEMO_CONFIG.stopDistanceMeters;
const RUNTIME_DEMO_NAVIGATION_ROTATE_PHASE = RUNTIME_DEMO_CONFIG.navigationRotatePhase;
export const RUNTIME_DEMO_NAVIGATION_DURATION_BY_SPEED_MS: Record<
  RuntimeDemoSpeedMode,
  number
> = {
  slow: RUNTIME_DEMO_CONFIG.navigationDurationBySpeedMs.slow,
  normal: RUNTIME_DEMO_NAVIGATION_DURATION_MS,
  // Fast mode is intentionally aggressive so the captured trace violates the
  // Challenge 4 step-bound policy in demo mode.
  fast: RUNTIME_DEMO_CONFIG.navigationDurationBySpeedMs.fast,
};
export const RUNTIME_DEMO_MILLISECONDS_PER_SECOND = RUNTIME_DEMO_CONFIG.millisecondsPerSecond;
export const RUNTIME_DEMO_DIRECT_MOVE_MIN_DURATION_MS = RUNTIME_DEMO_CONFIG.directMoveMinDurationMs;
export const RUNTIME_DEMO_DIRECT_ROTATE_MIN_DURATION_MS = RUNTIME_DEMO_CONFIG.directRotateMinDurationMs;

const clampUnitInterval = (value: number) => Math.min(1, Math.max(0, value));

const normalizeRuntimePreviewTargetLabel = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, "_");

const smoothstep = (t: number) => {
  const clamped = clampUnitInterval(t);
  return clamped * clamped * (3 - 2 * clamped);
};

export const normalizeAngle = (angleRad: number) => {
  let normalized = angleRad;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  while (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
};

const interpolateAngle = (fromRad: number, toRad: number, t: number) =>
  fromRad + normalizeAngle(toRad - fromRad) * smoothstep(t);

export const buildRuntimeDemoScanPose = (progress: number): RuntimePose => {
  const yawRad = clampUnitInterval(progress) * RUNTIME_DEMO_SCAN_SWEEP_RAD;
  return {
    position: {
      x: 0,
      y: 0,
      z: 0,
    },
    quaternion: {
      x: 0,
      y: 0,
      z: Math.sin(yawRad * 0.5),
      w: Math.cos(yawRad * 0.5),
    },
  };
};

export const buildRuntimePoseFromPlanarPose = (
  x: number,
  y: number,
  yawRad: number
): RuntimePose => ({
  position: {
    x,
    y,
    z: 0,
  },
  quaternion: {
    x: 0,
    y: 0,
    z: Math.sin(yawRad * 0.5),
    w: Math.cos(yawRad * 0.5),
  },
});

export const readPlanarPose = (pose: RuntimePose | null | undefined) => {
  if (!pose) {
    return { x: 0, y: 0, yawRad: 0 };
  }
  const yawRad = 2 * Math.atan2(pose.quaternion.z, pose.quaternion.w);
  return { x: pose.position.x, y: pose.position.y, yawRad };
};

export const resolveRuntimePreviewTargetPosition = ({
  label,
  runtimeObjects,
}: {
  label: string;
  runtimeObjects: readonly CreatedObject[];
}): [number, number, number] | null => {
  const normalizedLabel = normalizeRuntimePreviewTargetLabel(label);
  if (normalizedLabel.length === 0) {
    return null;
  }

  const demoObject = findRuntimeDemoObject(normalizedLabel);
  if (demoObject) {
    return [...demoObject.position_xyz];
  }

  const runtimeObject =
    runtimeObjects.find((object) => {
      if (!object.source || !RUNTIME_PREVIEW_NAVIGABLE_SOURCES.has(object.source)) {
        return false;
      }
      const labelCandidates = [object.label, object.id]
        .filter((candidate): candidate is string => typeof candidate === "string")
        .map(normalizeRuntimePreviewTargetLabel);
      return labelCandidates.includes(normalizedLabel);
    }) ?? null;

  if (!runtimeObject) {
    return null;
  }

  return [
    runtimeObject.position.x,
    runtimeObject.position.y,
    runtimeObject.position.z,
  ];
};

export const computeRuntimeDemoNavigatePose = ({
  startPose,
  targetPosition,
  progress,
}: {
  startPose: RuntimePose | null | undefined;
  targetPosition: [number, number, number];
  progress: number;
}): RuntimePose => {
  const clampedProgress = clampUnitInterval(progress);
  const { x: startX, y: startY, yawRad: startYawRad } = readPlanarPose(startPose);
  const dx = targetPosition[0] - startX;
  const dy = targetPosition[1] - startY;
  const distance = Math.hypot(dx, dy);
  const facingYawRad = Math.atan2(dy, dx);
  const travelDistance = Math.max(0, distance - RUNTIME_DEMO_STOP_DISTANCE_METERS);
  const targetX = startX + Math.cos(facingYawRad) * travelDistance;
  const targetY = startY + Math.sin(facingYawRad) * travelDistance;

  if (clampedProgress < RUNTIME_DEMO_NAVIGATION_ROTATE_PHASE) {
    const rotatePhaseProgress =
      clampedProgress / RUNTIME_DEMO_NAVIGATION_ROTATE_PHASE;
    return buildRuntimePoseFromPlanarPose(
      startX,
      startY,
      interpolateAngle(startYawRad, facingYawRad, rotatePhaseProgress)
    );
  }

  const movePhaseProgress =
    (clampedProgress - RUNTIME_DEMO_NAVIGATION_ROTATE_PHASE) /
    (1 - RUNTIME_DEMO_NAVIGATION_ROTATE_PHASE);
  const easedMoveProgress = smoothstep(movePhaseProgress);
  const currentX = startX + (targetX - startX) * easedMoveProgress;
  const currentY = startY + (targetY - startY) * easedMoveProgress;
  return buildRuntimePoseFromPlanarPose(currentX, currentY, facingYawRad);
};

export const computeRuntimeDemoDirectMovePose = ({
  startPose,
  xVel,
  yVel,
  durationS,
  progress,
}: {
  startPose: RuntimePose | null | undefined;
  xVel: number;
  yVel: number;
  durationS: number;
  progress: number;
}): RuntimePose => {
  const clampedProgress = clampUnitInterval(progress);
  const { x: startX, y: startY, yawRad } = readPlanarPose(startPose);
  const distanceScale = Math.max(0, durationS) * clampedProgress;
  const dx = xVel * distanceScale;
  const dy = yVel * distanceScale;
  const worldDx = Math.cos(yawRad) * dx - Math.sin(yawRad) * dy;
  const worldDy = Math.sin(yawRad) * dx + Math.cos(yawRad) * dy;
  return buildRuntimePoseFromPlanarPose(startX + worldDx, startY + worldDy, yawRad);
};

export const computeRuntimeDemoDirectRotatePose = ({
  startPose,
  degrees,
  progress,
}: {
  startPose: RuntimePose | null | undefined;
  degrees: number;
  progress: number;
}): RuntimePose => {
  const clampedProgress = clampUnitInterval(progress);
  const { x, y, yawRad } = readPlanarPose(startPose);
  const targetYawRad = yawRad + (degrees * Math.PI) / 180;
  return buildRuntimePoseFromPlanarPose(x, y, interpolateAngle(yawRad, targetYawRad, clampedProgress));
};
