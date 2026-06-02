import type { RobotBasePose } from "@/shared/types/feature";

const QUATERNION_NORMALIZE_EPSILON = 1e-12;
const QUATERNION_LERP_THRESHOLD = 0.9995;

const clampUnit = (value: number) => Math.min(1, Math.max(-1, value));

const normalizeQuaternion = (quaternion: RobotBasePose["quaternion"]) => {
  const magnitude = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  if (!Number.isFinite(magnitude) || magnitude <= QUATERNION_NORMALIZE_EPSILON) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }
  return {
    x: quaternion.x / magnitude,
    y: quaternion.y / magnitude,
    z: quaternion.z / magnitude,
    w: quaternion.w / magnitude,
  };
};

const quaternionDot = (lhs: RobotBasePose["quaternion"], rhs: RobotBasePose["quaternion"]) =>
  lhs.x * rhs.x + lhs.y * rhs.y + lhs.z * rhs.z + lhs.w * rhs.w;

const clampLerpAlpha = (alpha: number) => {
  if (!Number.isFinite(alpha)) return 0;
  return Math.min(1, Math.max(0, alpha));
};

export const cloneRobotBasePose = (
  pose: RobotBasePose | null | undefined
): RobotBasePose | undefined => {
  if (!pose) return undefined;
  return {
    position: {
      x: pose.position.x,
      y: pose.position.y,
      z: pose.position.z,
    },
    quaternion: {
      x: pose.quaternion.x,
      y: pose.quaternion.y,
      z: pose.quaternion.z,
      w: pose.quaternion.w,
    },
  };
};

export const isFiniteRobotBasePose = (
  pose: RobotBasePose | null | undefined
): pose is RobotBasePose => {
  if (!pose) return false;
  const position = pose.position;
  const quaternion = pose.quaternion;
  return (
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    Number.isFinite(position.z) &&
    Number.isFinite(quaternion.x) &&
    Number.isFinite(quaternion.y) &&
    Number.isFinite(quaternion.z) &&
    Number.isFinite(quaternion.w)
  );
};

export const quaternionAngularDistanceRad = (
  lhs: RobotBasePose["quaternion"],
  rhs: RobotBasePose["quaternion"]
) => {
  const left = normalizeQuaternion(lhs);
  const right = normalizeQuaternion(rhs);
  const dot = Math.abs(clampUnit(quaternionDot(left, right)));
  return 2 * Math.acos(dot);
};

export const hasMeaningfulRobotBasePoseDelta = (
  baseline: RobotBasePose | null | undefined,
  current: RobotBasePose | null | undefined,
  translationThresholdMeters: number,
  rotationThresholdRad: number
) => {
  if (!baseline || !current) return false;
  const dx = current.position.x - baseline.position.x;
  const dy = current.position.y - baseline.position.y;
  const dz = current.position.z - baseline.position.z;
  const translation = Math.hypot(dx, dy, dz);
  if (translation > translationThresholdMeters) return true;
  const angularDistance = quaternionAngularDistanceRad(
    baseline.quaternion,
    current.quaternion
  );
  return angularDistance > rotationThresholdRad;
};

export const interpolateRobotBasePose = (
  fromPose: RobotBasePose | null | undefined,
  toPose: RobotBasePose | null | undefined,
  alpha: number
): RobotBasePose | undefined => {
  if (!fromPose && !toPose) return undefined;
  if (!fromPose) return cloneRobotBasePose(toPose);
  if (!toPose) return cloneRobotBasePose(fromPose);

  const t = clampLerpAlpha(alpha);
  const invT = 1 - t;
  const position = {
    x: fromPose.position.x * invT + toPose.position.x * t,
    y: fromPose.position.y * invT + toPose.position.y * t,
    z: fromPose.position.z * invT + toPose.position.z * t,
  };

  const fromQuat = normalizeQuaternion(fromPose.quaternion);
  let toQuat = normalizeQuaternion(toPose.quaternion);
  let dot = clampUnit(quaternionDot(fromQuat, toQuat));

  if (dot < 0) {
    dot = -dot;
    toQuat = {
      x: -toQuat.x,
      y: -toQuat.y,
      z: -toQuat.z,
      w: -toQuat.w,
    };
  }

  let quaternion: RobotBasePose["quaternion"];
  if (dot > QUATERNION_LERP_THRESHOLD) {
    quaternion = normalizeQuaternion({
      x: fromQuat.x * invT + toQuat.x * t,
      y: fromQuat.y * invT + toQuat.y * t,
      z: fromQuat.z * invT + toQuat.z * t,
      w: fromQuat.w * invT + toQuat.w * t,
    });
  } else {
    const theta0 = Math.acos(dot);
    const sinTheta0 = Math.sin(theta0);
    if (Math.abs(sinTheta0) <= QUATERNION_NORMALIZE_EPSILON) {
      quaternion = fromQuat;
    } else {
      const theta = theta0 * t;
      const sinTheta = Math.sin(theta);
      const s0 = Math.cos(theta) - (dot * sinTheta) / sinTheta0;
      const s1 = sinTheta / sinTheta0;
      quaternion = normalizeQuaternion({
        x: s0 * fromQuat.x + s1 * toQuat.x,
        y: s0 * fromQuat.y + s1 * toQuat.y,
        z: s0 * fromQuat.z + s1 * toQuat.z,
        w: s0 * fromQuat.w + s1 * toQuat.w,
      });
    }
  }

  return {
    position,
    quaternion,
  };
};
