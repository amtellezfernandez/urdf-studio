import { BASE_POSE_SIGNAL_PARAMS } from "@/features/dataset/episode-viewer/basePoseSignalParams";
import type { RobotBasePose } from "@/shared/types/feature";

const METERS_TO_MILLIMETERS = BASE_POSE_SIGNAL_PARAMS.metersToMillimeters;
const MILLIMETERS_TO_METERS = 1 / METERS_TO_MILLIMETERS;
const QUATERNION_YAW_SCALE = BASE_POSE_SIGNAL_PARAMS.quaternionYawScale;
const QUATERNION_NORM_EPSILON =
  BASE_POSE_SIGNAL_PARAMS.quaternionNormEpsilon;

export const DERIVED_BASE_POSE_SIGNAL_NAMES =
  BASE_POSE_SIGNAL_PARAMS.derivedSignalNames;

type DerivedBasePoseSignalName = (typeof DERIVED_BASE_POSE_SIGNAL_NAMES)[number];

type BasePoseLike = {
  position?: {
    x?: unknown;
    y?: unknown;
    z?: unknown;
  } | null;
  quaternion?: {
    x?: unknown;
    y?: unknown;
    z?: unknown;
    w?: unknown;
  } | null;
};

type EpisodeFrameLike = {
  jointPositions?: Record<string, number>;
  basePose?: BasePoseLike | RobotBasePose | null;
};

const DERIVED_BASE_POSE_SIGNAL_NAME_SET = new Set<string>(
  DERIVED_BASE_POSE_SIGNAL_NAMES
);

const normalizeSignalName = (name: string) => name.trim().toLowerCase();

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const resolveBasePosePositionValue = (
  basePose: BasePoseLike,
  axis: "x" | "y" | "z"
) => {
  const value = basePose.position?.[axis];
  return isFiniteNumber(value) ? value : null;
};

const normalizeQuaternion = (
  quaternion:
    | {
        x?: unknown;
        y?: unknown;
        z?: unknown;
        w?: unknown;
      }
    | null
    | undefined
) => {
  if (!quaternion) return null;
  const x = quaternion.x;
  const y = quaternion.y;
  const z = quaternion.z;
  const w = quaternion.w;
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(z) ||
    !isFiniteNumber(w)
  ) {
    return null;
  }
  const norm = Math.hypot(x, y, z, w);
  if (!Number.isFinite(norm) || norm <= QUATERNION_NORM_EPSILON) {
    return null;
  }
  const scale = 1 / norm;
  return {
    x: x * scale,
    y: y * scale,
    z: z * scale,
    w: w * scale,
  };
};

const resolveNormalizedQuaternion = (basePose: BasePoseLike) =>
  normalizeQuaternion(basePose.quaternion);

const resolveYawRadiansFromQuaternion = (
  quaternion: RobotBasePose["quaternion"]
) => {
  const { x, y, z, w } = quaternion;
  const numerator = QUATERNION_YAW_SCALE * (w * z + x * y);
  const denominator = 1 - QUATERNION_YAW_SCALE * (y * y + z * z);
  const yawRad = Math.atan2(numerator, denominator);
  return Number.isFinite(yawRad) ? yawRad : null;
};

const multiplyQuaternions = (
  left: RobotBasePose["quaternion"],
  right: RobotBasePose["quaternion"]
): RobotBasePose["quaternion"] => ({
  x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
  y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
  z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
  w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
});

const createIdentityBasePose = (): RobotBasePose => ({
  position: { x: 0, y: 0, z: 0 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
});

const createWritableBasePose = (
  basePose: Pick<EpisodeFrameLike, "basePose">["basePose"]
): RobotBasePose => {
  const normalizedQuaternion = resolveNormalizedQuaternion(
    (basePose ?? {}) as BasePoseLike
  );
  return {
    position: {
      x: resolveBasePosePositionValue((basePose ?? {}) as BasePoseLike, "x") ?? 0,
      y: resolveBasePosePositionValue((basePose ?? {}) as BasePoseLike, "y") ?? 0,
      z: resolveBasePosePositionValue((basePose ?? {}) as BasePoseLike, "z") ?? 0,
    },
    quaternion: normalizedQuaternion ?? createIdentityBasePose().quaternion,
  };
};

const resolveDerivedBasePoseSignalName = (
  signalName: string
): DerivedBasePoseSignalName | null => {
  const normalizedSignalName = normalizeSignalName(signalName);
  if (!DERIVED_BASE_POSE_SIGNAL_NAME_SET.has(normalizedSignalName)) {
    return null;
  }
  return normalizedSignalName as DerivedBasePoseSignalName;
};

const isDerivedBasePoseSignalName = (
  signalName: string
): signalName is DerivedBasePoseSignalName =>
  resolveDerivedBasePoseSignalName(signalName) !== null;

export const resolveDerivedBasePoseSignalValue = (
  frame: Pick<EpisodeFrameLike, "basePose"> | null | undefined,
  signalName: string
) => {
  const derivedSignalName = resolveDerivedBasePoseSignalName(signalName);
  if (!derivedSignalName) return null;
  const basePose = frame?.basePose;
  if (!basePose) return null;

  if (derivedSignalName === "x_mm") {
    const xMeters = resolveBasePosePositionValue(basePose, "x");
    return xMeters === null ? null : xMeters * METERS_TO_MILLIMETERS;
  }
  if (derivedSignalName === "y_mm") {
    const yMeters = resolveBasePosePositionValue(basePose, "y");
    return yMeters === null ? null : yMeters * METERS_TO_MILLIMETERS;
  }
  const normalizedQuaternion = resolveNormalizedQuaternion(basePose);
  return normalizedQuaternion
    ? resolveYawRadiansFromQuaternion(normalizedQuaternion)
    : null;
};

export const writeEpisodeFrameSignalValue = <
  Frame extends EpisodeFrameLike
>(
  frame: Frame,
  signalName: string,
  nextValue: number
): Frame => {
  if (!Number.isFinite(nextValue)) {
    return frame;
  }
  const derivedSignalName = resolveDerivedBasePoseSignalName(signalName);
  if (!derivedSignalName) {
    return {
      ...frame,
      jointPositions: {
        ...(frame.jointPositions ?? {}),
        [signalName]: nextValue,
      },
    } as Frame;
  }

  const nextBasePose = createWritableBasePose(frame.basePose);
  if (derivedSignalName === "x_mm") {
    nextBasePose.position.x = nextValue * MILLIMETERS_TO_METERS;
  } else if (derivedSignalName === "y_mm") {
    nextBasePose.position.y = nextValue * MILLIMETERS_TO_METERS;
  } else {
    const currentYaw = resolveYawRadiansFromQuaternion(nextBasePose.quaternion) ?? 0;
    const halfYawDelta = (nextValue - currentYaw) * 0.5;
    const deltaQuaternion = {
      x: 0,
      y: 0,
      z: Math.sin(halfYawDelta),
      w: Math.cos(halfYawDelta),
    };
    nextBasePose.quaternion =
      normalizeQuaternion(
        multiplyQuaternions(deltaQuaternion, nextBasePose.quaternion)
      ) ?? createIdentityBasePose().quaternion;
  }

  const nextJointPositions = { ...(frame.jointPositions ?? {}) };
  delete nextJointPositions[derivedSignalName];
  return {
    ...frame,
    jointPositions: nextJointPositions,
    basePose: nextBasePose,
  } as Frame;
};

export const resolveEpisodeFrameSignalValue = (
  frame: EpisodeFrameLike | null | undefined,
  signalName: string
) => {
  const directSignalValue = frame?.jointPositions?.[signalName];
  if (isFiniteNumber(directSignalValue)) {
    return directSignalValue;
  }
  return resolveDerivedBasePoseSignalValue(frame, signalName);
};

export const collectDerivedBasePoseSignalNames = (
  frames: ReadonlyArray<Pick<EpisodeFrameLike, "basePose">>
) => {
  const names = new Set<string>();
  frames.forEach((frame) => {
    DERIVED_BASE_POSE_SIGNAL_NAMES.forEach((signalName) => {
      const value = resolveDerivedBasePoseSignalValue(frame, signalName);
      if (isFiniteNumber(value)) {
        names.add(signalName);
      }
    });
  });
  return Array.from(names);
};
