import {
  OPERATOR_LEADER_ASSIGNMENTS_STORAGE_KEY,
  OPERATOR_PREVIOUS_OPENARM_LEADER_ASSIGNMENTS_STORAGE_KEY,
} from "@/features/teleop/params/operatorTeleopParams";
import { resolveBrowserStorage } from "@/shared/lib/browserStorage";

export type OperatorLeaderAssignmentSide = "left" | "right" | "both";
export type OperatorLeaderAssignment = {
  side: OperatorLeaderAssignmentSide;
  targetGroupId: string;
  targetJointNames: string[];
  targetEndEffectorJointNames: string[];
  controlPartId: string;
  sourceMotorIds: number[];
  sourceMotorModel: string | null;
  sourceActuatorCount: number;
  sourceCalibrationCategory?: string | null;
  sourceCalibrationProfile?: string | null;
  sourceCalibrationId?: string | null;
  sourceCalibrationGroup?: string | null;
};
export type OperatorLeaderAssignmentInput = Partial<
  Omit<OperatorLeaderAssignment, "side">
>;
export type OperatorLeaderAssignments = Record<string, OperatorLeaderAssignment>;

const resolveOperatorLeaderAssignmentStorage = (): Storage | undefined => {
  return resolveBrowserStorage("local");
};

const readStoredLeaderAssignments = (
  storage: Storage,
  key: string,
): OperatorLeaderAssignments | null => {
  const rawValue = storage.getItem(key);
  if (!rawValue) return null;
  const parsedValue = JSON.parse(rawValue) as unknown;
  if (
    typeof parsedValue !== "object" ||
    parsedValue === null ||
    Array.isArray(parsedValue)
  ) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(parsedValue)
      .map(([identityKey, rawAssignment]) => [
        identityKey.trim(),
        normalizeOperatorLeaderAssignment(rawAssignment),
      ])
      .filter(
        (entry): entry is [string, OperatorLeaderAssignment] =>
          Boolean(entry[0]) && entry[1] !== null,
      ),
  );
};

export const readOperatorLeaderAssignments = (
  storage: Storage | undefined = resolveOperatorLeaderAssignmentStorage(),
): OperatorLeaderAssignments => {
  if (!storage) return {};
  try {
    return (
      readStoredLeaderAssignments(
        storage,
        OPERATOR_LEADER_ASSIGNMENTS_STORAGE_KEY,
      ) ??
      readStoredLeaderAssignments(
        storage,
        OPERATOR_PREVIOUS_OPENARM_LEADER_ASSIGNMENTS_STORAGE_KEY,
      ) ??
      {}
    );
  } catch {
    return {};
  }
};

export const writeOperatorLeaderAssignments = (
  assignments: OperatorLeaderAssignments,
  storage: Storage | undefined = resolveOperatorLeaderAssignmentStorage(),
): void => {
  if (!storage) return;
  try {
    storage.setItem(
      OPERATOR_LEADER_ASSIGNMENTS_STORAGE_KEY,
      JSON.stringify(assignments),
    );
  } catch {
    // Assignment persistence is best-effort. Detection and control setup must
    // continue when browser storage is blocked.
  }
};

export const assignOperatorLeaderSide = (
  assignments: OperatorLeaderAssignments,
  identityKey: string,
  side: OperatorLeaderAssignmentSide,
  assignmentInput: OperatorLeaderAssignmentInput = {},
): OperatorLeaderAssignments => {
  const normalizedIdentityKey = identityKey.trim();
  if (!normalizedIdentityKey) return assignments;
  const nextAssignment = buildOperatorLeaderAssignment(side, assignmentInput);
  const shouldReplaceCandidate = (
    candidateKey: string,
    candidateAssignment: OperatorLeaderAssignment,
  ): boolean => {
    if (candidateKey === normalizedIdentityKey) return false;
    if (
      nextAssignment.targetGroupId &&
      candidateAssignment.targetGroupId === nextAssignment.targetGroupId
    ) {
      return true;
    }
    if (side === "both") return true;
    return candidateAssignment.side === side || candidateAssignment.side === "both";
  };
  const nextAssignments = Object.fromEntries(
    Object.entries(assignments).filter(
      ([candidateKey, candidateAssignment]) =>
        !shouldReplaceCandidate(candidateKey, candidateAssignment),
    ),
  ) as OperatorLeaderAssignments;
  nextAssignments[normalizedIdentityKey] = nextAssignment;
  return nextAssignments;
};

export const releaseOperatorLeaderAssignment = (
  assignments: OperatorLeaderAssignments,
  identityKey: string,
): OperatorLeaderAssignments => {
  const normalizedIdentityKey = identityKey.trim();
  if (!normalizedIdentityKey || !(normalizedIdentityKey in assignments)) {
    return assignments;
  }
  const nextAssignments = { ...assignments };
  delete nextAssignments[normalizedIdentityKey];
  return nextAssignments;
};

const normalizeOperatorLeaderAssignment = (
  value: unknown,
): OperatorLeaderAssignment | null => {
  if (value === "left" || value === "right" || value === "both") {
    return buildOperatorLeaderAssignment(value);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<OperatorLeaderAssignment>;
  if (
    candidate.side !== "left" &&
    candidate.side !== "right" &&
    candidate.side !== "both"
  ) {
    return null;
  }
  return buildOperatorLeaderAssignment(candidate.side, candidate);
};

const buildOperatorLeaderAssignment = (
  side: OperatorLeaderAssignmentSide,
  input: OperatorLeaderAssignmentInput = {},
): OperatorLeaderAssignment => {
  const sourceCalibrationCategory = normalizeNullableString(
    input.sourceCalibrationCategory,
  );
  const sourceCalibrationProfile = normalizeNullableString(
    input.sourceCalibrationProfile,
  );
  const sourceCalibrationId = normalizeNullableString(input.sourceCalibrationId);
  const sourceCalibrationGroup = normalizeNullableString(
    input.sourceCalibrationGroup,
  );
  return {
    side,
    targetGroupId: normalizeString(input.targetGroupId),
    targetJointNames: normalizeStringArray(input.targetJointNames),
    targetEndEffectorJointNames: normalizeStringArray(
      input.targetEndEffectorJointNames,
    ),
    controlPartId: normalizeString(input.controlPartId),
    sourceMotorIds: normalizePositiveIntegerArray(input.sourceMotorIds),
    sourceMotorModel: normalizeNullableString(input.sourceMotorModel),
    sourceActuatorCount: normalizeNonNegativeInteger(input.sourceActuatorCount),
    ...(sourceCalibrationCategory
      ? { sourceCalibrationCategory }
      : {}),
    ...(sourceCalibrationProfile ? { sourceCalibrationProfile } : {}),
    ...(sourceCalibrationId ? { sourceCalibrationId } : {}),
    ...(sourceCalibrationGroup ? { sourceCalibrationGroup } : {}),
  };
};

const normalizeString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const normalizeNullableString = (value: unknown): string | null => {
  const normalized = normalizeString(value);
  return normalized || null;
};

const normalizeStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .map((entry) => normalizeString(entry))
            .filter((entry) => entry.length > 0),
        ),
      )
    : [];

const normalizePositiveIntegerArray = (value: unknown): number[] =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .map((entry) => Number(entry))
            .filter((entry) => Number.isInteger(entry) && entry > 0),
        ),
      )
    : [];

const normalizeNonNegativeInteger = (value: unknown): number => {
  const candidate = Number(value);
  return Number.isInteger(candidate) && candidate > 0 ? candidate : 0;
};
