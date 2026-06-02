import type { OperatorLiveJointTelemetry } from "@/features/teleop/perception/operatorPerceptionStore";
import {
  OPERATOR_LEADER_TELEMETRY_SOURCE_PREFIX,
  OPERATOR_LEROBOT_CALIBRATION_FILE_SYNC_REVISION_INITIAL,
  OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
} from "@/features/teleop/params/operatorTeleopParams";
import type {
  OperatorLeaderControlPart,
  OperatorLeaderDevice,
  OperatorLeaderReleaseRequest,
  OperatorLeaderState,
  OperatorLeaderStateSide,
} from "@/features/teleop/transport/operatorHelperApi";
import type {
  OperatorLeaderAssignment,
  OperatorLeaderAssignments,
} from "@/features/teleop/transport/operatorLeaderAssignments";

export type OperatorLeaderTelemetryTarget = {
  id: string;
  path: string;
  identityKey: string;
  label: string;
  side: OperatorLeaderStateSide;
  motorIds: number[];
  motorModel: string | null;
  calibrationCategory: string | null;
  calibrationProfile: string | null;
  calibrationId: string | null;
  calibrationGroup: string | null;
  calibrationRevision: number;
  sourceJointNames: string[];
  targetJointNames: string[];
  targetJointDirections: OperatorLeaderTelemetryJointDirection[];
  sourceNeutralPositionsByTargetJointName: Record<string, number>;
};

export type OperatorLeaderTelemetryZeroOffsets = Record<
  string,
  Record<string, number>
>;

export type OperatorLeaderTelemetryJointDirection = -1 | 1;

type ResolveOperatorLeaderTelemetryTargetsParams = {
  leaders: readonly OperatorLeaderDevice[];
  assignments: OperatorLeaderAssignments;
  availableJointNames: readonly string[];
  resolveFallbackTargetJointNames?: (
    assignment: OperatorLeaderAssignment,
  ) => readonly string[];
};

type BuildMappedLeaderTelemetryParams = {
  state: OperatorLeaderState;
  sourceId: string;
  sourceLabel: string;
  sourceJointNames?: readonly string[];
  sourceMotorIds?: readonly number[];
  targetJointNames: readonly string[];
  targetJointDirections?: readonly OperatorLeaderTelemetryJointDirection[];
  fallbackToSourceJointNames?: boolean;
};

type ApplyLeaderTelemetryZeroOffsetsParams = {
  telemetryByName: Record<string, OperatorLiveJointTelemetry>;
  zeroOffsetKey: string;
  referencePositionsByJointName: Readonly<Record<string, number>>;
  zeroOffsetsByKey: OperatorLeaderTelemetryZeroOffsets;
};

type ApplyLeaderTelemetryPoseReferencesParams = {
  telemetryByName: Record<string, OperatorLiveJointTelemetry>;
  zeroOffsetKey: string;
  sourceNeutralPositionsByTargetJointName: Readonly<Record<string, number>>;
  targetZeroPositionsByJointName: Readonly<Record<string, number>>;
  fallbackReferencePositionsByJointName?: Readonly<Record<string, number>>;
  zeroOffsetsByKey: OperatorLeaderTelemetryZeroOffsets;
};

const GENERIC_LEADER_AXIS_NAME_PATTERN = /^leader_axis_(\d+)$/;
const GENERIC_TARGET_JOINT_TOKENS = new Set(["arm", "openarm"]);
const DEFAULT_LEADER_MODEL_JOINT_DIRECTION =
  1 satisfies OperatorLeaderTelemetryJointDirection;

const resolveGenericLeaderAxisIndex = (jointName: string): number => {
  const match = GENERIC_LEADER_AXIS_NAME_PATTERN.exec(jointName);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
};

const sortLeaderStateEntries = (
  state: OperatorLeaderState,
): Array<[string, OperatorLeaderState["joints"][string]]> =>
  Object.entries(state.joints).sort(
    ([leftName], [rightName]) =>
      resolveGenericLeaderAxisIndex(leftName) -
        resolveGenericLeaderAxisIndex(rightName) ||
      leftName.localeCompare(rightName, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
  );

const tokenizeJointName = (value: string): string[] =>
  value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([a-zA-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

const normalizeSemanticTokens = (value: string): string[] =>
  tokenizeJointName(value).filter(
    (token) => !GENERIC_TARGET_JOINT_TOKENS.has(token),
  );

const semanticJointMatchScore = (
  sourceJointName: string,
  targetJointName: string,
): number => {
  const sourceTokens = normalizeSemanticTokens(sourceJointName);
  const targetTokens = normalizeSemanticTokens(targetJointName);
  if (sourceTokens.length === 0 || targetTokens.length === 0) return 0;
  const targetTokenSet = new Set(targetTokens);
  if (!sourceTokens.every((token) => targetTokenSet.has(token))) return 0;
  return sourceTokens.length;
};

export const resolveOperatorLeaderTargetJointNames = (
  sourceJointNames: readonly string[],
  targetJointNames: readonly string[],
  targetActuatorCount: number,
): string[] => {
  if (sourceJointNames.length === 0) {
    return targetJointNames.slice(0, targetActuatorCount);
  }

  const usedTargetNames = new Set<string>();
  return sourceJointNames.flatMap((sourceJointName, sourceIndex) => {
    let bestTargetName = "";
    let bestScore = 0;
    for (const targetJointName of targetJointNames) {
      if (usedTargetNames.has(targetJointName)) continue;
      const score = semanticJointMatchScore(sourceJointName, targetJointName);
      if (score > bestScore) {
        bestScore = score;
        bestTargetName = targetJointName;
      }
    }
    const fallbackTargetName = targetJointNames.find(
      (targetJointName, targetIndex) =>
        targetIndex === sourceIndex && !usedTargetNames.has(targetJointName),
    );
    const targetJointName = bestTargetName || fallbackTargetName;
    if (!targetJointName) return [];
    usedTargetNames.add(targetJointName);
    return [targetJointName];
  });
};

export const scoreOperatorLeaderControlPartForTarget = (
  controlPart: Pick<OperatorLeaderControlPart, "jointNames">,
  targetJointNames: readonly string[],
): number =>
  controlPart.jointNames.reduce((score, sourceJointName) => {
    const bestScore = targetJointNames.reduce(
      (best, targetJointName) =>
        Math.max(best, semanticJointMatchScore(sourceJointName, targetJointName)),
      0,
    );
    return score + bestScore;
  }, 0);

const sameMotorIds = (
  left: readonly number[],
  right: readonly number[],
): boolean =>
  left.length === right.length &&
  left.every((motorId, index) => motorId === right[index]);

const resolveAssignedControlPart = (
  leader: OperatorLeaderDevice,
  assignment: OperatorLeaderAssignment,
): OperatorLeaderControlPart | null => {
  const exactMatch =
    leader.controlParts.find((part) => part.id === assignment.controlPartId) ??
    null;
  if (exactMatch) return exactMatch;
  if (assignment.sourceMotorIds.length > 0) {
    const motorIdMatch = leader.controlParts.find((part) =>
      sameMotorIds(part.motorIds, assignment.sourceMotorIds),
    );
    if (motorIdMatch) return motorIdMatch;
  }
  return leader.controlParts[0] ?? null;
};

const buildTelemetrySample = (
  state: OperatorLeaderState,
  sourceId: string,
  sourceLabel: string,
  positionRad: number,
  velocityRadPerSec: number | null,
  torqueNm: number | null,
  motorId: number | null | undefined,
): OperatorLiveJointTelemetry => ({
  positionRad,
  velocityRadPerSec,
  torqueNm,
  tempMos: Number.NaN,
  tempRotor: Number.NaN,
  sourceId,
  sourceLabel,
  sourceTsMs: state.sourceTsMs > 0 ? state.sourceTsMs : Date.now(),
  motorId,
});

export const mapOperatorLeaderSourcePositionsToTargetPositions = ({
  sourceJointNames,
  targetJointNames,
  targetJointDirections = [],
  sourceReferencePositionsByJointName,
}: {
  sourceJointNames: readonly string[];
  targetJointNames: readonly string[];
  targetJointDirections?: readonly OperatorLeaderTelemetryJointDirection[];
  sourceReferencePositionsByJointName: Readonly<Record<string, number>>;
}): Record<string, number> =>
  Object.fromEntries(
    targetJointNames.flatMap((targetJointName, index) => {
      const sourceJointName = sourceJointNames[index];
      if (!sourceJointName) return [];
      const referencePosition =
        sourceReferencePositionsByJointName[sourceJointName];
      const direction =
        targetJointDirections[index] ?? DEFAULT_LEADER_MODEL_JOINT_DIRECTION;
      return Number.isFinite(referencePosition)
        ? [[targetJointName, referencePosition * direction]]
        : [];
    }),
  );

export const resolveOperatorLeaderTargetJointDirections = ({
  targetJointNames,
}: {
  calibrationProfile: string | null;
  targetJointNames: readonly string[];
}): OperatorLeaderTelemetryJointDirection[] =>
  targetJointNames.map(() => DEFAULT_LEADER_MODEL_JOINT_DIRECTION);

export const buildOperatorLeaderTelemetrySourceId = (
  identityKey: string,
): string => `${OPERATOR_LEADER_TELEMETRY_SOURCE_PREFIX}${identityKey}`;

export const buildOperatorLeaderTelemetryZeroOffsetKey = (
  target: Pick<
    OperatorLeaderTelemetryTarget,
    | "identityKey"
    | "calibrationCategory"
    | "calibrationProfile"
    | "calibrationId"
    | "calibrationGroup"
    | "calibrationRevision"
    | "targetJointNames"
    | "targetJointDirections"
  >,
): string =>
  [
    target.identityKey,
    target.calibrationCategory ?? "",
    target.calibrationProfile ?? "",
    target.calibrationId ?? "",
    target.calibrationGroup ?? "",
    String(target.calibrationRevision),
    target.targetJointNames.join(","),
    target.targetJointDirections.join(","),
  ].join("|");

export const applyOperatorLeaderTelemetryZeroOffsets = ({
  telemetryByName,
  zeroOffsetKey,
  referencePositionsByJointName,
  zeroOffsetsByKey,
}: ApplyLeaderTelemetryZeroOffsetsParams): Record<
  string,
  OperatorLiveJointTelemetry
> => {
  const existingOffsets = zeroOffsetsByKey[zeroOffsetKey] ?? {};
  const nextOffsets = { ...existingOffsets };
  const zeroedTelemetry = Object.fromEntries(
    Object.entries(telemetryByName).map(([jointName, telemetry]) => {
      let offset = nextOffsets[jointName];
      if (!Number.isFinite(offset)) {
        const referencePosition = referencePositionsByJointName[jointName];
        offset = Number.isFinite(referencePosition)
          ? referencePosition - telemetry.positionRad
          : OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD;
        nextOffsets[jointName] = offset;
      }
      return [
        jointName,
        {
          ...telemetry,
          positionRad: telemetry.positionRad + offset,
        },
      ];
    }),
  );
  zeroOffsetsByKey[zeroOffsetKey] = nextOffsets;
  return zeroedTelemetry;
};

const resolveOperatorLeaderTargetReferencePosition = ({
  jointName,
  targetZeroPositionsByJointName,
  fallbackReferencePositionsByJointName,
}: {
  jointName: string;
  targetZeroPositionsByJointName: Readonly<Record<string, number>>;
  fallbackReferencePositionsByJointName: Readonly<Record<string, number>>;
}): number => {
  const targetZeroPosition = targetZeroPositionsByJointName[jointName];
  if (Number.isFinite(targetZeroPosition)) {
    return targetZeroPosition;
  }
  const fallbackReferencePosition =
    fallbackReferencePositionsByJointName[jointName];
  return Number.isFinite(fallbackReferencePosition)
    ? fallbackReferencePosition
    : OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD;
};

export const applyOperatorLeaderTelemetryPoseReferences = ({
  telemetryByName,
  zeroOffsetKey,
  sourceNeutralPositionsByTargetJointName,
  targetZeroPositionsByJointName,
  fallbackReferencePositionsByJointName = targetZeroPositionsByJointName,
  zeroOffsetsByKey,
}: ApplyLeaderTelemetryPoseReferencesParams): Record<
  string,
  OperatorLiveJointTelemetry
> => {
  const calibratedTelemetry: Record<string, OperatorLiveJointTelemetry> = {};
  const fallbackTelemetry: Record<string, OperatorLiveJointTelemetry> = {};

  Object.entries(telemetryByName).forEach(([jointName, telemetry]) => {
    const sourceNeutralPosition =
      sourceNeutralPositionsByTargetJointName[jointName];
    if (Number.isFinite(sourceNeutralPosition)) {
      const targetReferencePosition =
        resolveOperatorLeaderTargetReferencePosition({
          jointName,
          targetZeroPositionsByJointName,
          fallbackReferencePositionsByJointName,
        });
      calibratedTelemetry[jointName] = {
        ...telemetry,
        positionRad:
          targetReferencePosition +
          (telemetry.positionRad - sourceNeutralPosition),
      };
      return;
    }
    fallbackTelemetry[jointName] = telemetry;
  });

  if (Object.keys(fallbackTelemetry).length === 0) {
    delete zeroOffsetsByKey[zeroOffsetKey];
    return calibratedTelemetry;
  }

  const existingFallbackOffsets = zeroOffsetsByKey[zeroOffsetKey];
  if (existingFallbackOffsets) {
    const nextFallbackOffsets = { ...existingFallbackOffsets };
    Object.keys(calibratedTelemetry).forEach((jointName) => {
      delete nextFallbackOffsets[jointName];
    });
    zeroOffsetsByKey[zeroOffsetKey] = nextFallbackOffsets;
  }

  return {
    ...calibratedTelemetry,
    ...applyOperatorLeaderTelemetryZeroOffsets({
      telemetryByName: fallbackTelemetry,
      zeroOffsetKey,
      referencePositionsByJointName: fallbackReferencePositionsByJointName,
      zeroOffsetsByKey,
    }),
  };
};

export const pruneOperatorLeaderTelemetryZeroOffsets = (
  zeroOffsetsByKey: OperatorLeaderTelemetryZeroOffsets,
  activeKeys: ReadonlySet<string>,
): void => {
  for (const key of Object.keys(zeroOffsetsByKey)) {
    if (!activeKeys.has(key)) {
      delete zeroOffsetsByKey[key];
    }
  }
};

export const buildOperatorLeaderHardwareReleaseRequest = (
  leader: OperatorLeaderDevice,
  controlPart: OperatorLeaderControlPart | null = null,
): OperatorLeaderReleaseRequest => ({
  port: leader.path,
  motorIds:
    controlPart?.motorIds && controlPart.motorIds.length > 0
      ? controlPart.motorIds
      : leader.motorIds,
  motorModel: controlPart?.motorModel ?? null,
  calibrationCategory: controlPart?.calibrationCategory ?? null,
  calibrationProfile: controlPart?.calibrationProfile ?? null,
  calibrationId: controlPart?.calibrationId ?? null,
  calibrationGroup: controlPart?.calibrationGroup ?? null,
});

export const buildOperatorLeaderTelemetryTargetReleaseRequest = (
  target: Pick<
    OperatorLeaderTelemetryTarget,
    | "path"
    | "motorIds"
    | "motorModel"
    | "calibrationCategory"
    | "calibrationProfile"
    | "calibrationId"
    | "calibrationGroup"
  >,
): OperatorLeaderReleaseRequest => ({
  port: target.path,
  motorIds: target.motorIds,
  motorModel: target.motorModel,
  calibrationCategory: target.calibrationCategory,
  calibrationProfile: target.calibrationProfile,
  calibrationId: target.calibrationId,
  calibrationGroup: target.calibrationGroup,
});

export const buildMappedOperatorLeaderTelemetry = ({
  state,
  sourceId,
  sourceLabel,
  sourceJointNames = [],
  sourceMotorIds = [],
  targetJointNames,
  targetJointDirections = [],
  fallbackToSourceJointNames = false,
}: BuildMappedLeaderTelemetryParams): Record<string, OperatorLiveJointTelemetry> => {
  if (!state.connected) return {};

  if (targetJointNames.length === 0) {
    if (!fallbackToSourceJointNames) return {};
    return Object.fromEntries(
      Object.entries(state.joints).flatMap(([jointName, telemetry]) => {
        if (!Number.isFinite(telemetry.positionRad)) return [];
        return [
          [
            jointName,
            buildTelemetrySample(
              state,
              sourceId,
              sourceLabel,
              telemetry.positionRad,
              telemetry.velocityRadPerSec,
              telemetry.torqueNm,
              telemetry.motorId,
            ),
          ],
        ];
      }),
    );
  }

  const leaderEntries =
    sourceJointNames.length > 0
      ? sourceJointNames.map(
          (jointName) => [jointName, state.joints[jointName]] as const,
        )
      : sortLeaderStateEntries(state);
  return Object.fromEntries(
    targetJointNames.flatMap((targetJointName, index) => {
      const telemetry = leaderEntries[index]?.[1];
      if (!telemetry || !Number.isFinite(telemetry.positionRad)) return [];
      const direction =
        targetJointDirections[index] ?? DEFAULT_LEADER_MODEL_JOINT_DIRECTION;
      return [
        [
          targetJointName,
          buildTelemetrySample(
            state,
            sourceId,
            sourceLabel,
            telemetry.positionRad * direction,
            telemetry.velocityRadPerSec === null
              ? null
              : telemetry.velocityRadPerSec * direction,
            telemetry.torqueNm === null ? null : telemetry.torqueNm * direction,
            telemetry.motorId ?? sourceMotorIds[index],
          ),
        ],
      ];
    }),
  );
};

export const resolveOperatorLeaderTelemetryTargets = ({
  leaders,
  assignments,
  availableJointNames,
  resolveFallbackTargetJointNames,
}: ResolveOperatorLeaderTelemetryTargetsParams): OperatorLeaderTelemetryTarget[] => {
  const availableJointSet =
    availableJointNames.length > 0 ? new Set(availableJointNames) : null;

  return leaders
    .filter((leader) => leader.available)
    .map((leader) => {
      const assignment = assignments[leader.identityKey];
      if (!assignment?.side) return null;

      const controlPart = resolveAssignedControlPart(leader, assignment);
      const motorIds =
        controlPart?.motorIds && controlPart.motorIds.length > 0
          ? controlPart.motorIds
          : assignment.sourceMotorIds.length > 0
          ? assignment.sourceMotorIds
          : leader.motorIds;
      const sourceTargetJointNames =
        assignment.targetJointNames.length > 0
          ? assignment.targetJointNames
          : resolveFallbackTargetJointNames?.(assignment) ?? [];
      const sourceJointNames =
        controlPart?.jointNames && controlPart.jointNames.length > 0
          ? controlPart.jointNames.slice(0, motorIds.length)
          : [];
      const availableTargetJointNames = availableJointSet
        ? sourceTargetJointNames.filter((jointName) =>
            availableJointSet.has(jointName),
          )
        : sourceTargetJointNames;
      const targetActuatorCount = Math.max(
        0,
        controlPart?.actuatorCount ||
          assignment.sourceActuatorCount ||
          motorIds.length ||
          availableTargetJointNames.length,
      );
      const targetJointNames = resolveOperatorLeaderTargetJointNames(
        sourceJointNames,
        availableTargetJointNames,
        targetActuatorCount,
      );
      if (targetJointNames.length === 0) return null;
      const calibrationProfile =
        controlPart?.calibrationProfile ?? assignment.sourceCalibrationProfile;
      const targetJointDirections = resolveOperatorLeaderTargetJointDirections({
        calibrationProfile,
        targetJointNames,
      });

      return {
        id: leader.id,
        path: leader.path,
        identityKey: leader.identityKey,
        label: leader.label,
        side: assignment.side,
        motorIds,
        motorModel: controlPart?.motorModel ?? assignment.sourceMotorModel,
        calibrationCategory:
          controlPart?.calibrationCategory ??
          assignment.sourceCalibrationCategory,
        calibrationProfile,
        calibrationId: controlPart?.calibrationId ?? assignment.sourceCalibrationId,
        calibrationGroup:
          controlPart?.calibrationGroup ?? assignment.sourceCalibrationGroup,
        calibrationRevision: OPERATOR_LEROBOT_CALIBRATION_FILE_SYNC_REVISION_INITIAL,
        sourceJointNames,
        targetJointNames,
        targetJointDirections,
        sourceNeutralPositionsByTargetJointName:
          mapOperatorLeaderSourcePositionsToTargetPositions({
            sourceJointNames,
            targetJointNames,
            targetJointDirections,
            sourceReferencePositionsByJointName: controlPart?.zeroPositionsRad ?? {},
          }),
      };
    })
    .filter((target): target is OperatorLeaderTelemetryTarget =>
      Boolean(target),
    );
};
