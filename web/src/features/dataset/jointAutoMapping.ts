import type { JointLimits } from "@/shared/lib/urdfBrowser";
import type { JointMapping } from "@/shared/types/feature";
import { JOINT_AUTO_MAPPING_PARAMS } from "@/features/dataset/jointAutoMappingParams";

type JointCandidate = {
  datasetIndex: number;
  urdfJoint: string;
  score: number;
};

type CanonicalArmSemantic =
  (typeof JOINT_AUTO_MAPPING_PARAMS.canonicalArmSemanticOrder)[number];

const normalizeJointName = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toCompactJointName = (value: string) => normalizeJointName(value).replace(/\s+/g, "");

const tokenizeJointName = (value: string) =>
  normalizeJointName(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

const containsAnyToken = (
  tokens: readonly string[],
  expectedTokens: readonly string[]
) => expectedTokens.some((token) => tokens.includes(token));

const expandJointTokens = (tokens: string[]) => {
  const expanded = new Set<string>(tokens);
  tokens.forEach((token) => {
    const aliases =
      JOINT_AUTO_MAPPING_PARAMS.tokenAliases[
        token as keyof typeof JOINT_AUTO_MAPPING_PARAMS.tokenAliases
      ] ?? [];
    aliases.forEach((alias) => {
      expanded.add(alias);
    });
  });
  return expanded;
};

const resolveSharedTokenCount = (left: Set<string>, right: Set<string>) => {
  let shared = 0;
  left.forEach((token) => {
    if (right.has(token)) {
      shared += 1;
    }
  });
  return shared;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isLockedUrdfJoint = (jointName: string, jointLimits?: JointLimits) => {
  const limit = jointLimits?.[jointName];
  if (!limit) {
    return false;
  }
  if (!isFiniteNumber(limit.lower) || !isFiniteNumber(limit.upper)) {
    return false;
  }
  return (
    Math.abs(limit.upper - limit.lower) <=
    JOINT_AUTO_MAPPING_PARAMS.lockedJointRangeEpsilonRad
  );
};

const isMovableUrdfJoint = (jointName: string, jointLimits?: JointLimits) => {
  const limit = jointLimits?.[jointName];
  if (!limit) {
    const tokens = tokenizeJointName(jointName);
    if (containsAnyToken(tokens, JOINT_AUTO_MAPPING_PARAMS.fixedJointNameTokens)) {
      return false;
    }
    if (containsAnyToken(tokens, JOINT_AUTO_MAPPING_PARAMS.movableJointNameTokens)) {
      return true;
    }
    return true;
  }
  return limit.type !== "fixed";
};

const resolveCanonicalArmSemantic = (
  datasetJoint: string
): CanonicalArmSemantic | null => {
  const tokens = tokenizeJointName(datasetJoint);
  const hasToken = (token: string) => tokens.includes(token);
  const hasAnyToken = (expectedTokens: readonly string[]) =>
    containsAnyToken(tokens, expectedTokens);

  const hasShoulder = hasToken("shoulder");
  const hasElbow = hasToken("elbow");
  const hasWrist = hasToken("wrist");
  const hasGripperFamily = hasAnyToken(
    JOINT_AUTO_MAPPING_PARAMS.gripperFamilyTokens
  );

  if (hasShoulder && hasAnyToken(["pan", "yaw"])) {
    return "shoulder_pan";
  }
  if (hasShoulder && hasAnyToken(["lift", "pitch", "flex", "bend"])) {
    return "shoulder_lift";
  }
  if (hasElbow && hasAnyToken(["flex", "pitch", "bend"])) {
    return "elbow_flex";
  }
  if (hasWrist && hasAnyToken(["roll", "twist", "yaw"])) {
    return "wrist_roll";
  }
  if (hasWrist && hasAnyToken(["flex", "pitch", "bend"])) {
    return "wrist_flex";
  }
  if (hasGripperFamily) {
    return "gripper";
  }
  return null;
};

const resolveAvailableUrdfJoint = ({
  requestedUrdfJoint,
  urdfJoints,
}: {
  requestedUrdfJoint: string;
  urdfJoints: string[];
}) => {
  const trimmedRequestedJoint = requestedUrdfJoint.trim();
  if (!trimmedRequestedJoint) {
    return "";
  }
  if (urdfJoints.includes(trimmedRequestedJoint)) {
    return trimmedRequestedJoint;
  }

  const requestedCompact = toCompactJointName(trimmedRequestedJoint);
  const compactMatch = urdfJoints.find(
    (urdfJoint) => toCompactJointName(urdfJoint) === requestedCompact
  );
  if (compactMatch) {
    return compactMatch;
  }
  return null;
};

const isManipulatorCandidateJoint = (
  urdfJoint: string,
  jointLimits?: JointLimits
) => {
  if (!isMovableUrdfJoint(urdfJoint, jointLimits)) {
    return false;
  }
  const normalized = normalizeJointName(urdfJoint);
  return !JOINT_AUTO_MAPPING_PARAMS.manipulatorExclusionTokens.some((token) =>
    normalized.includes(token)
  );
};

const isEligibleUrdfJointForDatasetJoint = ({
  datasetSemantic,
  urdfJoint,
  jointLimits,
}: {
  datasetSemantic: CanonicalArmSemantic | null;
  urdfJoint: string;
  jointLimits?: JointLimits;
}) => {
  if (!isMovableUrdfJoint(urdfJoint, jointLimits)) {
    return false;
  }
  if (datasetSemantic === null) {
    return true;
  }
  return isManipulatorCandidateJoint(urdfJoint, jointLimits);
};

const parseTrailingIndex = (jointName: string) => {
  const explicitSuffixMatch = jointName.match(/(?:-|_)(\d+)\s*$/);
  if (explicitSuffixMatch?.[1]) {
    return Number.parseInt(explicitSuffixMatch[1], 10);
  }
  const normalized = normalizeJointName(jointName);
  const segments = normalized.split(" ");
  const trailing = segments[segments.length - 1] ?? "";
  if (/^\d+$/.test(trailing)) {
    return Number.parseInt(trailing, 10);
  }
  return Number.POSITIVE_INFINITY;
};

const applyCanonicalArmOrderFallback = ({
  datasetJoints,
  urdfJoints,
  jointLimits,
  assignedByDatasetIndex,
  assignedUrdfJoints,
}: {
  datasetJoints: string[];
  urdfJoints: string[];
  jointLimits?: JointLimits;
  assignedByDatasetIndex: Map<number, string>;
  assignedUrdfJoints: Set<string>;
}) => {
  const semanticEntries = datasetJoints
    .map((datasetJoint, datasetIndex) => ({
      datasetIndex,
      semantic: resolveCanonicalArmSemantic(datasetJoint),
    }))
    .filter(
      (
        entry
      ): entry is { datasetIndex: number; semantic: CanonicalArmSemantic } =>
        entry.semantic !== null
    );

  if (
    semanticEntries.length <
    JOINT_AUTO_MAPPING_PARAMS.minCanonicalArmDatasetJointsForOrderFallback
  ) {
    return;
  }

  const unresolvedEntries = semanticEntries.filter(
    (entry) => !assignedByDatasetIndex.has(entry.datasetIndex)
  );
  if (unresolvedEntries.length === 0) {
    return;
  }

  const availableUrdfCandidates = urdfJoints
    .filter(
      (jointName) =>
        !assignedUrdfJoints.has(jointName) &&
        isManipulatorCandidateJoint(jointName, jointLimits)
    )
    .sort((left, right) => {
      const leftIndex = parseTrailingIndex(left);
      const rightIndex = parseTrailingIndex(right);
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }
      return left.localeCompare(right, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

  if (availableUrdfCandidates.length < unresolvedEntries.length) {
    return;
  }

  const takePreferredCandidate = (
    predicate: (jointName: string) => boolean
  ) => {
    const candidateIndex = availableUrdfCandidates.findIndex(predicate);
    if (candidateIndex < 0) {
      return null;
    }
    const [candidate] = availableUrdfCandidates.splice(candidateIndex, 1);
    return candidate ?? null;
  };

  const tryAssignSemantic = (
    semantic: CanonicalArmSemantic,
    predicate: (jointName: string) => boolean
  ) => {
    const targetEntry = unresolvedEntries.find((entry) => entry.semantic === semantic);
    if (!targetEntry || assignedByDatasetIndex.has(targetEntry.datasetIndex)) {
      return;
    }
    const candidate = takePreferredCandidate(predicate);
    if (!candidate) {
      return;
    }
    assignedByDatasetIndex.set(targetEntry.datasetIndex, candidate);
    assignedUrdfJoints.add(candidate);
  };

  tryAssignSemantic("wrist_roll", (jointName) => {
    const tokens = tokenizeJointName(jointName);
    return tokens.includes("wrist") && tokens.includes("roll");
  });
  tryAssignSemantic("gripper", (jointName) => {
    const tokens = tokenizeJointName(jointName);
    return containsAnyToken(tokens, JOINT_AUTO_MAPPING_PARAMS.gripperFamilyTokens);
  });

  const semanticOrder = JOINT_AUTO_MAPPING_PARAMS.canonicalArmSemanticOrder;
  const unresolvedInOrder = unresolvedEntries
    .filter((entry) => !assignedByDatasetIndex.has(entry.datasetIndex))
    .sort(
      (left, right) =>
        semanticOrder.indexOf(left.semantic) - semanticOrder.indexOf(right.semantic)
    );

  unresolvedInOrder.forEach((entry) => {
    const candidate = availableUrdfCandidates.shift();
    if (!candidate) {
      return;
    }
    assignedByDatasetIndex.set(entry.datasetIndex, candidate);
    assignedUrdfJoints.add(candidate);
  });
};

const scoreJointPair = ({
  datasetJoint,
  urdfJoint,
  jointLimits,
}: {
  datasetJoint: string;
  urdfJoint: string;
  jointLimits?: JointLimits;
}) => {
  const datasetNormalized = normalizeJointName(datasetJoint);
  const urdfNormalized = normalizeJointName(urdfJoint);
  const datasetCompact = toCompactJointName(datasetJoint);
  const urdfCompact = toCompactJointName(urdfJoint);
  const datasetTokens = tokenizeJointName(datasetJoint);
  const urdfTokens = tokenizeJointName(urdfJoint);
  const datasetExpanded = expandJointTokens(datasetTokens);
  const urdfExpanded = expandJointTokens(urdfTokens);

  let score = 0;

  if (datasetCompact.length > 0 && datasetCompact === urdfCompact) {
    score += JOINT_AUTO_MAPPING_PARAMS.exactCompactMatchScore;
  }
  if (datasetNormalized.length > 0 && datasetNormalized === urdfNormalized) {
    score += JOINT_AUTO_MAPPING_PARAMS.exactNormalizedMatchScore;
  }
  if (
    datasetCompact.length > 0 &&
    urdfCompact.length > 0 &&
    (urdfCompact.includes(datasetCompact) || datasetCompact.includes(urdfCompact))
  ) {
    score += JOINT_AUTO_MAPPING_PARAMS.containmentMatchScore;
  }

  const sharedExpandedTokenCount = resolveSharedTokenCount(
    datasetExpanded,
    urdfExpanded
  );
  const cappedSharedTokenCount = Math.min(
    sharedExpandedTokenCount,
    JOINT_AUTO_MAPPING_PARAMS.maxSharedTokenCount
  );
  score += cappedSharedTokenCount * JOINT_AUTO_MAPPING_PARAMS.sharedTokenScore;

  if (
    datasetTokens.length > 0 &&
    urdfTokens.length > 0 &&
    datasetTokens[0] === urdfTokens[0]
  ) {
    score += JOINT_AUTO_MAPPING_PARAMS.firstTokenMatchBonus;
  }

  if (isLockedUrdfJoint(urdfJoint, jointLimits)) {
    score -= JOINT_AUTO_MAPPING_PARAMS.lockedJointScorePenalty;
  }

  return score;
};

export const buildInitialJointMappings = ({
  datasetJoints,
  urdfJoints,
  jointLimits,
}: {
  datasetJoints: string[];
  urdfJoints: string[];
  jointLimits?: JointLimits;
}): JointMapping[] => {
  const candidates: JointCandidate[] = [];
  const datasetSemantics = datasetJoints.map((datasetJoint) =>
    resolveCanonicalArmSemantic(datasetJoint)
  );
  datasetJoints.forEach((datasetJoint, datasetIndex) => {
    const datasetSemantic = datasetSemantics[datasetIndex] ?? null;
    urdfJoints.forEach((urdfJoint) => {
      if (
        !isEligibleUrdfJointForDatasetJoint({
          datasetSemantic,
          urdfJoint,
          jointLimits,
        })
      ) {
        return;
      }
      const score = scoreJointPair({
        datasetJoint,
        urdfJoint,
        jointLimits,
      });
      if (score >= JOINT_AUTO_MAPPING_PARAMS.minScoreToAutoAssign) {
        candidates.push({
          datasetIndex,
          urdfJoint,
          score,
        });
      }
    });
  });

  candidates.sort((left, right) => right.score - left.score);

  const assignedDatasetIndexes = new Set<number>();
  const assignedUrdfJoints = new Set<string>();
  const assignedByDatasetIndex = new Map<number, string>();

  candidates.forEach((candidate) => {
    if (assignedDatasetIndexes.has(candidate.datasetIndex)) {
      return;
    }
    if (assignedUrdfJoints.has(candidate.urdfJoint)) {
      return;
    }
    assignedDatasetIndexes.add(candidate.datasetIndex);
    assignedUrdfJoints.add(candidate.urdfJoint);
    assignedByDatasetIndex.set(candidate.datasetIndex, candidate.urdfJoint);
  });

  applyCanonicalArmOrderFallback({
    datasetJoints,
    urdfJoints,
    jointLimits,
    assignedByDatasetIndex,
    assignedUrdfJoints,
  });

  return datasetJoints.map((datasetJoint, datasetIndex) => ({
    datasetJoint,
    urdfJoint: assignedByDatasetIndex.get(datasetIndex) ?? "",
  }));
};

export const reconcileJointMappingsToAvailableUrdfJoints = ({
  datasetJoints,
  urdfJoints,
  mappings,
  jointLimits,
}: {
  datasetJoints: string[];
  urdfJoints: string[];
  mappings: JointMapping[];
  jointLimits?: JointLimits;
}): JointMapping[] => {
  const fallbackMappings = buildInitialJointMappings({
    datasetJoints,
    urdfJoints,
    jointLimits,
  });
  const fallbackByDatasetJoint = new Map(
    fallbackMappings.map((mapping) => [mapping.datasetJoint, mapping])
  );
  const existingByDatasetJoint = new Map(
    mappings.map((mapping) => [mapping.datasetJoint, mapping])
  );
  const usedUrdfJoints = new Set<string>();

  return datasetJoints.map((datasetJoint) => {
    const existingMapping = existingByDatasetJoint.get(datasetJoint);
    if (existingMapping) {
      const reconciledUrdfJoint = resolveAvailableUrdfJoint({
        requestedUrdfJoint: existingMapping.urdfJoint,
        urdfJoints,
      });
      if (
        reconciledUrdfJoint !== null &&
        (reconciledUrdfJoint === "" || !usedUrdfJoints.has(reconciledUrdfJoint))
      ) {
        if (reconciledUrdfJoint) {
          usedUrdfJoints.add(reconciledUrdfJoint);
        }
        if (reconciledUrdfJoint !== existingMapping.urdfJoint.trim()) {
          return {
            datasetJoint,
            urdfJoint: reconciledUrdfJoint,
          };
        }
        return {
          ...existingMapping,
          datasetJoint,
          urdfJoint: reconciledUrdfJoint,
        };
      }
    }

    const fallbackMapping = fallbackByDatasetJoint.get(datasetJoint);
    const fallbackUrdfJoint =
      fallbackMapping?.urdfJoint && !usedUrdfJoints.has(fallbackMapping.urdfJoint)
        ? fallbackMapping.urdfJoint
        : "";
    if (fallbackUrdfJoint) {
      usedUrdfJoints.add(fallbackUrdfJoint);
    }
    return {
      datasetJoint,
      urdfJoint: fallbackUrdfJoint,
    };
  });
};
