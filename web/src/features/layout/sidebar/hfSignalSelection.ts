import {
  resolveDatasetSignalProfile,
  resolveJointChannelNames,
} from "@/features/dataset/profiles/semanticDetection";

const HF_SIGNAL_FIELD_PRIORITY = ["observation.state", "action"] as const;
const HF_SIGNAL_SELECTION_PARAMS = {
  exactJointMatchWeight: 2,
  fuzzyJointMatchWeight: 1,
} as const;

type HfSignalField = (typeof HF_SIGNAL_FIELD_PRIORITY)[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
};

const collectFeatureNames = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return toStringArray(value);
  }
  if (!isRecord(value)) {
    return [];
  }
  return Object.values(value).flatMap((entry) => collectFeatureNames(entry));
};

const resolveFeatureNamesFromDefinition = (feature: unknown): string[] => {
  if (!isRecord(feature)) {
    return [];
  }
  const nestedFeatureNames = isRecord(feature.feature)
    ? collectFeatureNames(feature.feature.names)
    : [];
  if (nestedFeatureNames.length > 0) {
    return nestedFeatureNames;
  }

  const directNames = collectFeatureNames(feature.names);
  if (directNames.length > 0) {
    return directNames;
  }

  return collectFeatureNames(feature.fieldNames);
};

const resolveCandidateFieldOrder = (preferredField?: HfSignalField | null) => {
  if (!preferredField) {
    return HF_SIGNAL_FIELD_PRIORITY;
  }
  return [
    preferredField,
    ...HF_SIGNAL_FIELD_PRIORITY.filter((field) => field !== preferredField),
  ];
};

const normalizeJointNameForSignalMatch = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

const computeSignalJointNameMatchScore = (
  datasetJointNames: string[],
  availableJointNames: string[]
) => {
  if (datasetJointNames.length === 0 || availableJointNames.length === 0) {
    return 0;
  }
  const normalizedUrdfJointNames = availableJointNames
    .map(normalizeJointNameForSignalMatch)
    .filter((name) => name.length > 0);
  const normalizedUrdfJointSet = new Set(normalizedUrdfJointNames);
  let exactMatches = 0;
  let fuzzyMatches = 0;
  datasetJointNames.forEach((jointName) => {
    const normalizedDatasetJoint = normalizeJointNameForSignalMatch(jointName);
    if (!normalizedDatasetJoint) {
      return;
    }
    if (normalizedUrdfJointSet.has(normalizedDatasetJoint)) {
      exactMatches += 1;
      return;
    }
    const hasFuzzyMatch = normalizedUrdfJointNames.some(
      (candidate) =>
        candidate.includes(normalizedDatasetJoint) ||
        normalizedDatasetJoint.includes(candidate)
    );
    if (hasFuzzyMatch) {
      fuzzyMatches += 1;
    }
  });
  return (
    exactMatches * HF_SIGNAL_SELECTION_PARAMS.exactJointMatchWeight +
    fuzzyMatches * HF_SIGNAL_SELECTION_PARAMS.fuzzyJointMatchWeight
  );
};

export const resolveHfSignalValuesFromRow = (
  row: Record<string, unknown>,
  preferredField?: HfSignalField | null
): { field: HfSignalField | null; values: unknown[] } => {
  if (preferredField) {
    const preferredValues = row[preferredField];
    if (Array.isArray(preferredValues) && preferredValues.length > 0) {
      return { field: preferredField, values: preferredValues };
    }
  }

  const candidates = HF_SIGNAL_FIELD_PRIORITY.map((field) => ({
    field,
    values: row[field],
  }));

  for (const candidate of candidates) {
    if (Array.isArray(candidate.values) && candidate.values.length > 0) {
      return { field: candidate.field, values: candidate.values };
    }
  }

  for (const candidate of candidates) {
    if (Array.isArray(candidate.values)) {
      return { field: candidate.field, values: candidate.values };
    }
  }

  if (preferredField) {
    const preferredValues = row[preferredField];
    if (Array.isArray(preferredValues)) {
      return { field: preferredField, values: preferredValues };
    }
  }

  return { field: null, values: [] };
};

export const resolveHfSignalFeatureNames = (
  features: unknown,
  preferredField?: HfSignalField | null
): string[] => {
  if (!isRecord(features)) {
    return [];
  }
  const orderedFields = resolveCandidateFieldOrder(preferredField);
  for (const field of orderedFields) {
    const names = resolveFeatureNamesFromDefinition(features[field]);
    if (names.length > 0) {
      return names;
    }
  }
  return [];
};

type HfSignalFieldSelectionCandidate = {
  field: HfSignalField;
  priorityIndex: number;
  jointNameMatchScore: number;
  mappedJointCount: number;
};

const resolveHfSignalFieldSelectionCandidate = ({
  field,
  priorityIndex,
  sampleRow,
  features,
  availableJointNames,
  robotTypeHint,
  fallbackDatasetId,
}: {
  field: HfSignalField;
  priorityIndex: number;
  sampleRow: Record<string, unknown>;
  features: Record<string, unknown>;
  availableJointNames: string[];
  robotTypeHint?: string | null;
  fallbackDatasetId: string;
}): HfSignalFieldSelectionCandidate | null => {
  const rowValues = sampleRow[field];
  if (!Array.isArray(rowValues) || rowValues.length === 0) {
    return null;
  }
  const featureNames = resolveHfSignalFeatureNames(features, field);
  const signalProfile = resolveDatasetSignalProfile({
    featureNames,
    robotTypeHint: robotTypeHint ?? fallbackDatasetId,
    fallbackChannelCount: rowValues.length,
  });
  const datasetJointNames = resolveJointChannelNames(signalProfile);
  return {
    field,
    priorityIndex,
    jointNameMatchScore: computeSignalJointNameMatchScore(
      datasetJointNames,
      availableJointNames
    ),
    mappedJointCount: datasetJointNames.length,
  };
};

export const resolvePreferredHfSignalField = ({
  sampleRow,
  features,
  availableJointNames,
  robotTypeHint,
  fallbackDatasetId,
}: {
  sampleRow: Record<string, unknown>;
  features: Record<string, unknown>;
  availableJointNames: string[];
  robotTypeHint?: string | null;
  fallbackDatasetId: string;
}): HfSignalField | null => {
  const defaultField = resolveHfSignalValuesFromRow(sampleRow).field;
  const candidates = HF_SIGNAL_FIELD_PRIORITY.map((field, priorityIndex) =>
    resolveHfSignalFieldSelectionCandidate({
      field,
      priorityIndex,
      sampleRow,
      features,
      availableJointNames,
      robotTypeHint,
      fallbackDatasetId,
    })
  ).filter(
    (candidate): candidate is HfSignalFieldSelectionCandidate =>
      candidate !== null
  );

  if (candidates.length === 0) {
    return defaultField;
  }

  const observationCandidate = candidates.find(
    (candidate) => candidate.field === "observation.state"
  );
  const actionCandidate = candidates.find(
    (candidate) => candidate.field === "action"
  );

  // Keep state-first behavior unless action has a strictly better joint-name match.
  if (
    observationCandidate &&
    (!actionCandidate ||
      observationCandidate.jointNameMatchScore >=
        actionCandidate.jointNameMatchScore)
  ) {
    return observationCandidate.field;
  }

  const bestCandidate = candidates.reduce((currentBest, candidate) => {
    if (candidate.jointNameMatchScore !== currentBest.jointNameMatchScore) {
      return candidate.jointNameMatchScore > currentBest.jointNameMatchScore
        ? candidate
        : currentBest;
    }
    if (candidate.mappedJointCount !== currentBest.mappedJointCount) {
      return candidate.mappedJointCount > currentBest.mappedJointCount
        ? candidate
        : currentBest;
    }
    return candidate.priorityIndex < currentBest.priorityIndex
      ? candidate
      : currentBest;
  });

  return bestCandidate.field ?? defaultField;
};

export type { HfSignalField };
