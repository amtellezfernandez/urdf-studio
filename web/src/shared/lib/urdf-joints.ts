import type { URDFRobot } from "urdf-loader";
import { isFiniteNumber } from "@/shared/lib/numeric";

type JointValueMap = Record<string, number>;

type ApplyJointValuesOptions = {
  filter?: boolean;
};

type JointNameLookup = {
  signature: string;
  exactNames: Set<string>;
  normalizedToExact: Map<string, string | null>;
  strippedToExact: Map<string, string | null>;
};

const JOINT_NAME_NORMALIZATION_PARAMS = {
  trailingJointToken: "joint",
  minUniqueSuffixLength: 4,
} as const;

const jointNameLookupCache = new WeakMap<URDFRobot, JointNameLookup>();

const buildNumericJointValues = (values: JointValueMap) => {
  const result: JointValueMap = {};
  for (const [name, value] of Object.entries(values)) {
    if (isFiniteNumber(value)) {
      result[name] = value;
    }
  }
  return result;
};

const normalizeJointNameKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const stripTrailingJointToken = (normalizedValue: string) => {
  const token = JOINT_NAME_NORMALIZATION_PARAMS.trailingJointToken;
  if (!normalizedValue.endsWith(token)) {
    return normalizedValue;
  }
  const stripped = normalizedValue.slice(0, -token.length);
  return stripped.length > 0 ? stripped : normalizedValue;
};

const updateUniqueNameMap = (
  map: Map<string, string | null>,
  key: string,
  name: string
) => {
  if (!key) return;
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, name);
    return;
  }
  if (existing !== name) {
    map.set(key, null);
  }
};

const buildJointNameLookupFromNames = (jointNames: string[]): JointNameLookup => {
  const signature = jointNames.join("\n");
  const exactNames = new Set(jointNames);
  const normalizedToExact = new Map<string, string | null>();
  const strippedToExact = new Map<string, string | null>();

  jointNames.forEach((jointName) => {
    const normalized = normalizeJointNameKey(jointName);
    updateUniqueNameMap(normalizedToExact, normalized, jointName);
    updateUniqueNameMap(
      strippedToExact,
      stripTrailingJointToken(normalized),
      jointName
    );
  });

  return {
    signature,
    exactNames,
    normalizedToExact,
    strippedToExact,
  };
};

const buildJointNameLookup = (robot: URDFRobot): JointNameLookup =>
  buildJointNameLookupFromNames(Object.keys(robot.joints ?? {}));

const resolveJointNameLookup = (robot: URDFRobot): JointNameLookup => {
  const cached = jointNameLookupCache.get(robot);
  const signature = Object.keys(robot.joints ?? {}).join("\n");
  if (cached && cached.signature === signature) {
    return cached;
  }
  const next = buildJointNameLookup(robot);
  jointNameLookupCache.set(robot, next);
  return next;
};

const resolveAliasedRobotJointName = (
  sourceJointName: string,
  lookup: JointNameLookup
): string | null => {
  if (lookup.exactNames.has(sourceJointName)) {
    return sourceJointName;
  }
  const normalized = normalizeJointNameKey(sourceJointName);
  const normalizedMatch = lookup.normalizedToExact.get(normalized);
  if (normalizedMatch) {
    return normalizedMatch;
  }
  const strippedMatch = lookup.strippedToExact.get(
    stripTrailingJointToken(normalized)
  );
  if (strippedMatch) {
    return strippedMatch;
  }
  const strippedSource = stripTrailingJointToken(normalized);
  if (
    strippedSource.length <
    JOINT_NAME_NORMALIZATION_PARAMS.minUniqueSuffixLength
  ) {
    return null;
  }
  let uniqueSuffixMatch: string | null = null;
  for (const candidateName of lookup.exactNames) {
    const candidate = normalizeJointNameKey(candidateName);
    const strippedCandidate = stripTrailingJointToken(candidate);
    if (
      candidate.endsWith(normalized) ||
      strippedCandidate.endsWith(strippedSource)
    ) {
      if (uniqueSuffixMatch !== null) {
        return null;
      }
      uniqueSuffixMatch = candidateName;
    }
  }
  if (uniqueSuffixMatch) {
    return uniqueSuffixMatch;
  }
  return null;
};

export const resolveJointNameFromNames = (
  jointNames: readonly string[],
  sourceJointName: string
): string | null =>
  resolveAliasedRobotJointName(
    sourceJointName,
    buildJointNameLookupFromNames([...jointNames])
  );

export const resolveRobotJointName = (
  robot: URDFRobot | null | undefined,
  sourceJointName: string
): string | null => {
  if (!robot) return null;
  return resolveAliasedRobotJointName(sourceJointName, resolveJointNameLookup(robot));
};

const resolveRobotJointPayload = (
  robot: URDFRobot,
  values: JointValueMap
): JointValueMap => {
  const jointEntries = Object.entries(robot.joints ?? {});
  if (jointEntries.length === 0) {
    return { ...values };
  }
  const lookup = resolveJointNameLookup(robot);
  const resolved: JointValueMap = {};
  for (const [sourceJointName, value] of Object.entries(values)) {
    const targetJointName = resolveAliasedRobotJointName(sourceJointName, lookup);
    if (!targetJointName) {
      continue;
    }
    resolved[targetJointName] = value;
  }
  return resolved;
};

export const applyJointValues = (
  robot: URDFRobot | null,
  values: JointValueMap,
  options: ApplyJointValuesOptions = {}
) => {
  if (!robot) return;
  const filteredPayload =
    options.filter === false ? values : buildNumericJointValues(values);
  const payload = resolveRobotJointPayload(robot, filteredPayload);
  if (Object.keys(payload).length === 0) return;

  if (typeof robot.setJointValues === "function") {
    robot.setJointValues(payload);
    return;
  }

  if (typeof robot.setJointValue === "function") {
    for (const [name, value] of Object.entries(payload)) {
      robot.setJointValue(name, value);
    }
  }
};
