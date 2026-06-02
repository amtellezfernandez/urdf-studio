import { OPERATOR_ROBOT_MODEL_ID_DESCRIPTOR_SUFFIXES } from "@/features/teleop/params/operatorTeleopParams";

const CAMEL_CASE_BOUNDARY_PATTERN = /([a-z0-9])([A-Z])/g;
const NON_ALNUM_PATTERN = /[^a-z0-9]+/g;

export const normalizeOperatorRobotModelId = (
  value: string | null | undefined,
): string => {
  const tokens = String(value ?? "")
    .replace(CAMEL_CASE_BOUNDARY_PATTERN, "$1 $2")
    .toLowerCase()
    .split(NON_ALNUM_PATTERN)
    .filter(Boolean);
  let normalized = tokens.join("");
  let suffixRemoved = true;
  while (suffixRemoved) {
    suffixRemoved = false;
    for (const suffix of OPERATOR_ROBOT_MODEL_ID_DESCRIPTOR_SUFFIXES) {
      if (normalized.endsWith(suffix) && normalized.length > suffix.length) {
        normalized = normalized.slice(0, -suffix.length);
        suffixRemoved = true;
      }
    }
  }
  return normalized;
};

export const operatorRobotModelIdsMatch = (
  loadedRobotName: string | null | undefined,
  expectedModelRobotIds:
    | string
    | readonly (string | null | undefined)[]
    | null
    | undefined,
): boolean => {
  const loaded = normalizeOperatorRobotModelId(loadedRobotName);
  if (!loaded) return false;
  const expectedCandidates = Array.isArray(expectedModelRobotIds)
    ? expectedModelRobotIds
    : [expectedModelRobotIds];
  return expectedCandidates.some(
    (candidate) => loaded === normalizeOperatorRobotModelId(candidate),
  );
};
