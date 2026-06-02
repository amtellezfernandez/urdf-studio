import { analyzeUrdf, type UrdfAnalysis } from "@/shared/lib/urdfCore";

const WHEEL_LINK_OR_JOINT_PATTERN = /(wheel|caster|drive|tire)/i;
const SENSOR_LINK_OR_JOINT_PATTERN = /(sensor|camera|lidar|imu|radar|gps)/i;
const END_EFFECTOR_MULTIWORD_PATTERN = /end\s*effector/i;
const END_EFFECTOR_TOKENS = new Set(["ee", "tool", "tcp", "gripper", "wrist", "flange", "tip"]);
const CONTROLLABLE_JOINT_TYPES = new Set(["revolute", "continuous", "prismatic", "planar", "floating"]);
const MIN_AUTO_END_EFFECTOR_SCORE = 1;
const END_EFFECTOR_NAME_SCORE = 100;
const WHEEL_SIGNAL_PENALTY = 40;
const SENSOR_SIGNAL_PENALTY = 30;
const CONTROLLABLE_JOINT_SCORE = 5;
const MAX_CONTROLLABLE_JOINT_SCORE_COUNT = 10;

const buildParentToChildrenMap = (
  analysis: UrdfAnalysis | null | undefined
): Map<string, string[]> => {
  const parentToChildren = new Map<string, string[]>();
  analysis?.jointHierarchy.allJoints.forEach((joint) => {
    const list = parentToChildren.get(joint.parentLink) || [];
    list.push(joint.childLink);
    parentToChildren.set(joint.parentLink, list);
  });
  return parentToChildren;
};

const buildLeafDepthMap = (analysis: UrdfAnalysis | null | undefined): Map<string, number> => {
  if (!analysis?.isValid || analysis.linkNames.length === 0) return new Map<string, number>();
  const parentToChildren = buildParentToChildrenMap(analysis);
  const roots = analysis.rootLinks.length > 0 ? analysis.rootLinks : [analysis.linkNames[0]];
  const depths = new Map<string, number>();

  const dfs = (link: string, depth: number, visiting: Set<string>) => {
    if (visiting.has(link)) return;
    visiting.add(link);
    const children = parentToChildren.get(link) || [];
    if (children.length === 0) {
      const previousDepth = depths.get(link);
      if (previousDepth === undefined || depth > previousDepth) {
        depths.set(link, depth);
      }
    } else {
      children.forEach((child) => dfs(child, depth + 1, visiting));
    }
    visiting.delete(link);
  };

  roots.forEach((root) => dfs(root, 0, new Set<string>()));
  return depths;
};

type LeafCandidateStats = {
  link: string;
  depth: number;
  controllableJointCount: number;
  rootControllableJointName: string | null;
  wheelSignalCount: number;
  sensorSignalCount: number;
  isNamedEndEffector: boolean;
  score: number;
};

const normalizeNameForTokenScan = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const splitNameTokens = (value: string): string[] =>
  normalizeNameForTokenScan(value).split(/[^a-z0-9]+/).filter(Boolean);

const hasEndEffectorNameSignal = (value: string): boolean => {
  const normalized = normalizeNameForTokenScan(value);
  if (!normalized) return false;
  if (END_EFFECTOR_MULTIWORD_PATTERN.test(normalized)) return true;
  const tokens = splitNameTokens(normalized);
  return tokens.some((token) => {
    if (END_EFFECTOR_TOKENS.has(token)) return true;
    return /^ee\d+$/.test(token);
  });
};

const buildLeafCandidateStats = (
  analysis: UrdfAnalysis,
  leafDepths: Map<string, number>
): LeafCandidateStats[] => {
  const childLinkToJointName = new Map<string, string>();
  analysis.jointHierarchy.orderedJoints.forEach((joint) => {
    childLinkToJointName.set(joint.childLink, joint.jointName);
  });

  const candidates: LeafCandidateStats[] = [];
  leafDepths.forEach((depth, link) => {
    let controllableJointCount = 0;
    let rootControllableJointName: string | null = null;
    let wheelSignalCount = WHEEL_LINK_OR_JOINT_PATTERN.test(link) ? 1 : 0;
    let sensorSignalCount = SENSOR_LINK_OR_JOINT_PATTERN.test(link) ? 1 : 0;
    let cursor: string | undefined = link;

    while (cursor) {
      const parentInfo = analysis.jointByChildLink[cursor];
      if (!parentInfo) break;
      const jointName = childLinkToJointName.get(cursor) || "";
      const jointType = (parentInfo.type || "").toLowerCase();
      if (CONTROLLABLE_JOINT_TYPES.has(jointType)) {
        controllableJointCount += 1;
        if (jointName) {
          // Keep the most proximal controllable joint (closest to base/root).
          rootControllableJointName = jointName;
        }
      }
      if (
        WHEEL_LINK_OR_JOINT_PATTERN.test(jointName) ||
        WHEEL_LINK_OR_JOINT_PATTERN.test(parentInfo.parentLink)
      ) {
        wheelSignalCount += 1;
      }
      if (
        SENSOR_LINK_OR_JOINT_PATTERN.test(jointName) ||
        SENSOR_LINK_OR_JOINT_PATTERN.test(parentInfo.parentLink)
      ) {
        sensorSignalCount += 1;
      }
      cursor = parentInfo.parentLink;
    }

    const isNamedEndEffector =
      hasEndEffectorNameSignal(link) &&
      !SENSOR_LINK_OR_JOINT_PATTERN.test(link) &&
      !WHEEL_LINK_OR_JOINT_PATTERN.test(link);
    const controllableScore =
      Math.min(controllableJointCount, MAX_CONTROLLABLE_JOINT_SCORE_COUNT) *
      CONTROLLABLE_JOINT_SCORE;
    const score =
      depth +
      controllableScore +
      (isNamedEndEffector ? END_EFFECTOR_NAME_SCORE : 0) -
      wheelSignalCount * WHEEL_SIGNAL_PENALTY -
      sensorSignalCount * SENSOR_SIGNAL_PENALTY;

    candidates.push({
      link,
      depth,
      controllableJointCount,
      rootControllableJointName,
      wheelSignalCount,
      sensorSignalCount,
      isNamedEndEffector,
      score,
    });
  });

  return candidates;
};

const sortLeafCandidates = (lhs: LeafCandidateStats, rhs: LeafCandidateStats): number => {
  if (lhs.depth !== rhs.depth) return rhs.depth - lhs.depth;
  return lhs.link.localeCompare(rhs.link);
};

const compareCandidatePriority = (lhs: LeafCandidateStats, rhs: LeafCandidateStats): number => {
  if (lhs.score !== rhs.score) return rhs.score - lhs.score;
  if (lhs.depth !== rhs.depth) return rhs.depth - lhs.depth;
  if (lhs.controllableJointCount !== rhs.controllableJointCount) {
    return rhs.controllableJointCount - lhs.controllableJointCount;
  }
  return lhs.link.localeCompare(rhs.link);
};

const collapseCandidatesByManipulatorRootJoint = (
  candidates: LeafCandidateStats[]
): LeafCandidateStats[] => {
  if (candidates.length <= 1) return candidates;
  const selectedByRootJoint = new Map<string, LeafCandidateStats>();
  const candidatesWithoutRootJoint: LeafCandidateStats[] = [];

  candidates.forEach((candidate) => {
    const rootJoint = candidate.rootControllableJointName?.trim();
    if (!rootJoint) {
      candidatesWithoutRootJoint.push(candidate);
      return;
    }
    const currentSelected = selectedByRootJoint.get(rootJoint);
    if (!currentSelected || compareCandidatePriority(candidate, currentSelected) < 0) {
      selectedByRootJoint.set(rootJoint, candidate);
    }
  });

  return [...selectedByRootJoint.values(), ...candidatesWithoutRootJoint];
};

const findDeepestLeafLinkFromAnalysis = (
  analysis: UrdfAnalysis | null | undefined
): string | null => {
  return findDeepestLeafLinksFromAnalysis(analysis)[0] ?? null;
};

export const findDeepestLeafLinksFromAnalysis = (
  analysis: UrdfAnalysis | null | undefined
): string[] => {
  const leafDepths = buildLeafDepthMap(analysis);
  if (leafDepths.size === 0) return [];
  const maxDepth = Math.max(...leafDepths.values());
  return Array.from(leafDepths.entries())
    .filter(([, depth]) => depth === maxDepth)
    .map(([link]) => link)
    .sort((a, b) => a.localeCompare(b));
};

/**
 * Finds likely end-effector links for interactive control.
 * This prefers arm/tool tips and filters wheel/caster/sensor leaf links.
 */
export const findAutoEndEffectorLinksFromAnalysis = (
  analysis: UrdfAnalysis | null | undefined
): string[] => {
  if (!analysis?.isValid) return [];
  const leafDepths = buildLeafDepthMap(analysis);
  if (leafDepths.size === 0) return [];

  const stats = buildLeafCandidateStats(analysis, leafDepths);
  const namedCandidates = collapseCandidatesByManipulatorRootJoint(
    stats.filter(
      (candidate) =>
        candidate.isNamedEndEffector &&
        candidate.controllableJointCount > 0 &&
        candidate.wheelSignalCount === 0
    )
  )
    .sort(sortLeafCandidates)
    .map((candidate) => candidate.link);
  if (namedCandidates.length > 0) {
    return namedCandidates;
  }

  const genericCandidates = collapseCandidatesByManipulatorRootJoint(
    stats.filter(
      (candidate) =>
        candidate.controllableJointCount > 0 &&
        candidate.wheelSignalCount === 0 &&
        candidate.score >= MIN_AUTO_END_EFFECTOR_SCORE
    )
  )
    .sort(sortLeafCandidates)
    .map((candidate) => candidate.link);
  if (genericCandidates.length > 0) {
    return genericCandidates;
  }

  return findDeepestLeafLinksFromAnalysis(analysis);
};

/**
 * Finds the deepest leaf link in a URDF document. Used as a heuristic
 * to auto-select an end-effector when the user has not yet specified one.
 */
export const findDeepestLeafLink = (urdfContent: string): string | null => {
  const analysis = analyzeUrdf(urdfContent);
  return findDeepestLeafLinkFromAnalysis(analysis);
};
