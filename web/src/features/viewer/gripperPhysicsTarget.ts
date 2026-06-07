import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";

import type { UrdfAnalysis } from "@/shared/lib/urdfCore";

type JointByChildEntry = {
  parentLink?: string;
  type?: string;
};

const EXACT_CONTACT_LINK_PRIORITY = new Map<string, number>([
  ["gripper_frame_link", 1_000],
  ["gripper_frame", 980],
  ["tcp_link", 960],
  ["tcp", 950],
  ["tool0", 940],
  ["tool_tip", 930],
  ["tool_tip_link", 920],
  ["ee_link", 900],
]);

const GRIPPER_BODY_LINK_PATTERN = /(^|[_-])(gripper|wrist|flange)([_-]|$)/i;
const CONTACT_LINK_PATTERN =
  /(^|[_-])((gripper[_-]?frame)|tcp|tool0?|tool|tip|ee|end[_-]?effector)([_-]|$)/i;
const JAW_OR_FINGER_LINK_PATTERN = /(^|[_-])(jaw|finger|claw|moving[_-]?jaw)([_-]|$)/i;

const normalizeLinkName = (linkName: string | null | undefined): string | null => {
  const trimmed = linkName?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

const safeDecodeLinkName = (linkName: string): string => {
  try {
    return decodeURIComponent(linkName);
  } catch {
    return linkName;
  }
};

const resolveRobotLinkObject = (
  robot: URDFRobot | null | undefined,
  linkName: string
): THREE.Object3D | null => {
  if (!robot) return null;
  const robotAny = robot as URDFRobot & {
    links?: Record<string, THREE.Object3D>;
    getObjectByName?: (name: string) => THREE.Object3D | undefined;
  };
  return (
    robotAny.links?.[linkName] ??
    robotAny.getObjectByName?.(linkName) ??
    robotAny.getObjectByName?.(safeDecodeLinkName(linkName)) ??
    null
  );
};

const collectAvailableLinkNames = (
  robot: URDFRobot | null | undefined,
  analysis: UrdfAnalysis | null | undefined
): string[] => {
  const names = new Set<string>();
  analysis?.linkNames?.forEach((linkName) => {
    const normalized = normalizeLinkName(linkName);
    if (normalized) names.add(normalized);
  });
  const robotAny = robot as
    | (URDFRobot & { links?: Record<string, THREE.Object3D> })
    | null
    | undefined;
  Object.keys(robotAny?.links ?? {}).forEach((linkName) => {
    const normalized = normalizeLinkName(linkName);
    if (normalized) names.add(normalized);
  });
  return Array.from(names);
};

const jointByChildLink = (
  analysis: UrdfAnalysis | null | undefined
): Record<string, JointByChildEntry> =>
  ((analysis as { jointByChildLink?: Record<string, JointByChildEntry> } | null | undefined)
    ?.jointByChildLink ?? {});

const fixedPathDepthToAncestor = (
  analysis: UrdfAnalysis | null | undefined,
  descendantLink: string,
  ancestorLink: string
): number | null => {
  if (descendantLink === ancestorLink) return 0;
  const joints = jointByChildLink(analysis);
  let cursor = descendantLink;
  let depth = 0;
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const joint = joints[cursor];
    if (!joint?.parentLink) return null;
    if ((joint.type ?? "").toLowerCase() !== "fixed") return null;
    depth += 1;
    cursor = joint.parentLink;
    if (cursor === ancestorLink) return depth;
  }
  return null;
};

const parentLinkOf = (
  analysis: UrdfAnalysis | null | undefined,
  childLink: string
): string | null => jointByChildLink(analysis)[childLink]?.parentLink ?? null;

const scoreContactLinkName = (linkName: string): number => {
  const lower = linkName.toLowerCase();
  const exactScore = EXACT_CONTACT_LINK_PRIORITY.get(lower);
  if (exactScore !== undefined) return exactScore;
  if (!CONTACT_LINK_PATTERN.test(linkName)) return 0;
  let score = 700;
  if (/gripper[_-]?frame/i.test(linkName)) score += 160;
  if (/(tcp|tool0?)/i.test(linkName)) score += 130;
  if (/(tip|ee|end[_-]?effector)/i.test(linkName)) score += 80;
  if (JAW_OR_FINGER_LINK_PATTERN.test(linkName)) score -= 300;
  return score;
};

const findBestFixedContactDescendant = (
  analysis: UrdfAnalysis | null | undefined,
  linkNames: readonly string[],
  rootLink: string
): string | null => {
  let best: { linkName: string; score: number; depth: number } | null = null;
  for (const linkName of linkNames) {
    if (linkName === rootLink) continue;
    const score = scoreContactLinkName(linkName);
    if (score <= 0) continue;
    const depth = fixedPathDepthToAncestor(analysis, linkName, rootLink);
    if (depth === null) continue;
    if (
      !best ||
      score > best.score ||
      (score === best.score && depth > best.depth) ||
      (score === best.score && depth === best.depth && linkName.localeCompare(best.linkName) < 0)
    ) {
      best = { linkName, score, depth };
    }
  }
  return best?.linkName ?? null;
};

export const resolveLivePhysicsGripperTargetLink = ({
  requestedLink,
  robot,
  urdfAnalysis,
}: {
  requestedLink: string | null | undefined;
  robot?: URDFRobot | null;
  urdfAnalysis?: UrdfAnalysis | null;
}): string | null => {
  const normalizedRequested = normalizeLinkName(requestedLink);
  if (!normalizedRequested) return null;
  const linkNames = collectAvailableLinkNames(robot, urdfAnalysis);
  const availableLinks =
    linkNames.length > 0 ? linkNames : [normalizedRequested];
  const requestedKnown =
    availableLinks.includes(normalizedRequested) ||
    Boolean(resolveRobotLinkObject(robot, normalizedRequested));
  if (!requestedKnown) return normalizedRequested;

  if (scoreContactLinkName(normalizedRequested) >= 850) {
    return normalizedRequested;
  }

  const descendant = findBestFixedContactDescendant(
    urdfAnalysis,
    availableLinks,
    normalizedRequested
  );
  if (descendant && GRIPPER_BODY_LINK_PATTERN.test(normalizedRequested)) {
    return descendant;
  }

  const parent = parentLinkOf(urdfAnalysis, normalizedRequested);
  if (parent && JAW_OR_FINGER_LINK_PATTERN.test(normalizedRequested)) {
    const siblingContact = findBestFixedContactDescendant(
      urdfAnalysis,
      availableLinks,
      parent
    );
    if (siblingContact) return siblingContact;
  }

  return normalizedRequested;
};

export const buildLivePhysicsGripperTargetPose = ({
  robot,
  endEffectorLink,
  physicsTargetLink,
  targetPositionXyz,
  targetQuatWxyz,
}: {
  robot: URDFRobot | null;
  endEffectorLink: string;
  physicsTargetLink: string | null | undefined;
  targetPositionXyz: [number, number, number];
  targetQuatWxyz: [number, number, number, number];
}): {
  endEffectorLink: string;
  positionXyz: [number, number, number];
  quatWxyz: [number, number, number, number];
} => {
  const resolvedPhysicsLink = normalizeLinkName(physicsTargetLink) ?? endEffectorLink;
  if (resolvedPhysicsLink === endEffectorLink || !robot) {
    return {
      endEffectorLink: resolvedPhysicsLink,
      positionXyz: targetPositionXyz,
      quatWxyz: targetQuatWxyz,
    };
  }

  const selectedLink = resolveRobotLinkObject(robot, endEffectorLink);
  const physicsLink = resolveRobotLinkObject(robot, resolvedPhysicsLink);
  if (!selectedLink || !physicsLink) {
    return {
      endEffectorLink,
      positionXyz: targetPositionXyz,
      quatWxyz: targetQuatWxyz,
    };
  }

  robot.updateMatrixWorld?.(true);
  selectedLink.updateWorldMatrix?.(true, false);
  physicsLink.updateWorldMatrix?.(true, false);

  const selectedToPhysics = selectedLink.matrixWorld
    .clone()
    .invert()
    .multiply(physicsLink.matrixWorld);
  const targetMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...targetPositionXyz),
    new THREE.Quaternion(
      targetQuatWxyz[1],
      targetQuatWxyz[2],
      targetQuatWxyz[3],
      targetQuatWxyz[0]
    ).normalize(),
    new THREE.Vector3(1, 1, 1)
  );
  targetMatrix.multiply(selectedToPhysics);

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  targetMatrix.decompose(position, quaternion, scale);
  quaternion.normalize();

  return {
    endEffectorLink: resolvedPhysicsLink,
    positionXyz: [position.x, position.y, position.z],
    quatWxyz: [quaternion.w, quaternion.x, quaternion.y, quaternion.z],
  };
};
