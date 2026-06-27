import type {
  OperatorLeRobotCalibrationCatalogEntry,
  OperatorLeRobotCalibrationSource,
} from "@/features/teleop/transport/operatorHelperApi";
import { formatOperatorCalibrationModifiedLine } from "@/features/teleop/transport/operatorCalibrationFileTimestamp";

const LEROBOT_CALIBRATION_CATEGORIES = {
  robot: "robots",
} as const;
const COMPATIBILITY_RANK = {
  recommended: 0,
  compatible: 1,
  advanced: 2,
} as const;
export const OPERATOR_LEROBOT_CALIBRATION_MESSAGES = {
  advancedReuseConfirmation:
    "This calibration source may not match this physical follower. Use it only if this is the same arm or the motor layout matches.",
} as const;

export type OperatorLeRobotCalibrationCompatibility =
  | "recommended"
  | "compatible"
  | "advanced";

export type OperatorLeRobotCalibrationOption = {
  id: string;
  label: string;
  optionLabel: string;
  detailLines: string[];
  compatibility: OperatorLeRobotCalibrationCompatibility;
  compatibilityLabel: string;
  source: OperatorLeRobotCalibrationSource;
};

type OperatorLeRobotCalibrationContext = {
  expectedActuatorCount: number;
  normalizedModelIds: Set<string>;
  normalizedRobotIds: Set<string>;
};

export const buildOperatorLeRobotCalibrationOptions = ({
  entries,
  expectedActuatorCount,
  expectedModelIds,
  expectedRobotIds,
  showAll,
}: {
  entries: readonly OperatorLeRobotCalibrationCatalogEntry[];
  expectedActuatorCount: number;
  expectedModelIds: readonly string[];
  expectedRobotIds: readonly string[];
  showAll: boolean;
}): OperatorLeRobotCalibrationOption[] => {
  const context = buildOperatorLeRobotCalibrationContext({
    expectedActuatorCount,
    expectedModelIds,
    expectedRobotIds,
  });
  return entries
    .map((entry) => buildOperatorLeRobotCalibrationOption(entry, context))
    .filter((option) => showAll || option.compatibility !== "advanced")
    .sort(compareOperatorLeRobotCalibrationOptions);
};

export const findOperatorLeRobotCalibrationOption = (
  options: readonly OperatorLeRobotCalibrationOption[],
  sourceId: string | null,
): OperatorLeRobotCalibrationOption | null =>
  options.find((option) => option.id === sourceId) ?? null;

export const findOperatorLeRobotCalibrationOptionBySource = (
  options: readonly OperatorLeRobotCalibrationOption[],
  source: OperatorLeRobotCalibrationSource | null,
): OperatorLeRobotCalibrationOption | null =>
  source
    ? options.find((option) =>
        operatorLeRobotCalibrationSourcesMatch(option.source, source),
      ) ?? null
    : null;

export const shouldConfirmOperatorLeRobotCalibrationSource = (
  option: OperatorLeRobotCalibrationOption | null,
): boolean => option?.compatibility === "advanced";

const operatorLeRobotCalibrationSourcesMatch = (
  left: OperatorLeRobotCalibrationSource,
  right: OperatorLeRobotCalibrationSource,
): boolean =>
  left.category === right.category &&
  left.profileId === right.profileId &&
  left.calibrationId === right.calibrationId &&
  left.calibrationDir === right.calibrationDir &&
  left.groupId === right.groupId;

const buildOperatorLeRobotCalibrationContext = ({
  expectedActuatorCount,
  expectedModelIds,
  expectedRobotIds,
}: {
  expectedActuatorCount: number;
  expectedModelIds: readonly string[];
  expectedRobotIds: readonly string[];
}): OperatorLeRobotCalibrationContext => ({
  expectedActuatorCount,
  normalizedModelIds: normalizeTokenSet(expectedModelIds),
  normalizedRobotIds: normalizeTokenSet(expectedRobotIds),
});

const buildOperatorLeRobotCalibrationOption = (
  entry: OperatorLeRobotCalibrationCatalogEntry,
  context: OperatorLeRobotCalibrationContext,
): OperatorLeRobotCalibrationOption => {
  const compatibility = resolveOperatorLeRobotCalibrationCompatibility({
    entry,
    context,
  });
  const groupSuffix = entry.groupId === "all" ? "" : ` · ${entry.groupId}`;
  const label = `${entry.profileId} · ${entry.calibrationId}${groupSuffix}`;
  const modifiedLine = formatOperatorCalibrationModifiedLine(entry.mtimeNs);
  return {
    id: entry.id,
    label,
    optionLabel: `${label} (${formatCompatibilityLabel(compatibility)})`,
    detailLines: [
      `${entry.category} · ${entry.actuatorCount} motors`,
      ...(modifiedLine ? [modifiedLine] : []),
      entry.path,
    ],
    compatibility,
    compatibilityLabel: formatCompatibilityLabel(compatibility),
    source: {
      category: entry.category,
      profileId: entry.profileId,
      calibrationId: entry.calibrationId,
      calibrationDir: entry.calibrationDir,
      groupId: entry.groupId,
    },
  };
};

const resolveOperatorLeRobotCalibrationCompatibility = ({
  entry,
  context,
}: {
  entry: OperatorLeRobotCalibrationCatalogEntry;
  context: OperatorLeRobotCalibrationContext;
}): OperatorLeRobotCalibrationCompatibility => {
  const sameCategory = entry.category === LEROBOT_CALIBRATION_CATEGORIES.robot;
  const sameProfile = profileMatchesModel(
    entry.profileId,
    context.normalizedModelIds,
  );
  const sameRobotId = context.normalizedRobotIds.has(
    normalizeToken(entry.calibrationId),
  );
  const sameActuatorCount =
    context.expectedActuatorCount > 0 &&
    entry.actuatorCount === context.expectedActuatorCount;
  if (sameCategory && (sameRobotId || (sameProfile && sameActuatorCount))) {
    return "recommended";
  }
  if (sameCategory && (sameProfile || sameActuatorCount)) {
    return "compatible";
  }
  return "advanced";
};

const profileMatchesModel = (
  profileId: string,
  normalizedModelIds: Set<string>,
): boolean => {
  const normalizedProfile = normalizeToken(profileId);
  return Array.from(normalizedModelIds).some((modelId) =>
    normalizedProfile.includes(modelId),
  );
};

const normalizeToken = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

const normalizeTokenSet = (values: readonly string[]): Set<string> =>
  new Set(values.map(normalizeToken).filter(Boolean));

const compareOperatorLeRobotCalibrationOptions = (
  left: OperatorLeRobotCalibrationOption,
  right: OperatorLeRobotCalibrationOption,
): number => {
  const rankDelta =
    COMPATIBILITY_RANK[left.compatibility] -
    COMPATIBILITY_RANK[right.compatibility];
  if (rankDelta !== 0) return rankDelta;
  return left.optionLabel.localeCompare(right.optionLabel);
};

const formatCompatibilityLabel = (
  compatibility: OperatorLeRobotCalibrationCompatibility,
): string => {
  if (compatibility === "recommended") return "Recommended";
  if (compatibility === "compatible") return "Compatible";
  return "Advanced";
};
