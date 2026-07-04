import { parseAssemblyContactPairKey } from "@/features/assembly/store/assemblyContactPair";
import { buildAssemblyUrdf, createAssemblySpec } from "@/shared/lib/urdfCore";

export type AssemblyInspectorModel = {
  id: string;
  name: string;
  urdfContent: string;
  isPrimary?: boolean;
  role?: "host" | "replacement";
};

export type AssemblyStructureSummary = {
  name: string;
  links: string[];
  joints: string[];
  treeLines: string[];
  rootLinks: string[];
};

export type AssemblyAttachmentSuggestion = {
  id: string;
  parentRobotId: string;
  parentRobotName: string;
  parentLink: string;
  parentLinkOptions: string[];
  childRobotId: string;
  childRobotName: string;
  childLink: string;
  childLinkOptions: string[];
  jointName: string;
  origin: {
    xyz: [number, number, number];
    rpy: [number, number, number];
  };
  confidence: "high" | "medium";
  reason: string;
};

export type AssemblyInspectorData = {
  robots: Array<
    AssemblyStructureSummary & {
      id: string;
      isPrimary: boolean;
      role?: "host" | "replacement";
    }
  >;
  union: AssemblyStructureSummary | null;
  attachmentSuggestions: AssemblyAttachmentSuggestion[];
};

type AssemblyInspectorOptions = {
  allowUnion?: boolean;
  contactPairs?: string[];
  poses?: Record<string, { x: number; y: number; z: number; yaw: number }>;
  primaryRobotId?: string | null;
  proposalRevision?: number;
};

const uniqueNames = (values: string[]) =>
  Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));

const parseInspectorUrdfXml = (urdfContent: string): XMLDocument | null => {
  if (!urdfContent.trim()) return null;
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(urdfContent, "application/xml");
    if (xmlDoc.querySelector("parsererror")) return null;
    if (!xmlDoc.querySelector("robot")) return null;
    return xmlDoc;
  } catch {
    return null;
  }
};

const summarizeUrdf = (name: string, urdfContent: string): AssemblyStructureSummary => {
  const xmlDoc = parseInspectorUrdfXml(urdfContent);
  if (!xmlDoc) {
    return {
      name,
      links: [],
      joints: [],
      treeLines: [],
      rootLinks: [],
    };
  }

  const links = uniqueNames(
    Array.from(xmlDoc.querySelectorAll("link"))
      .map((link) => link.getAttribute("name") ?? "")
      .filter((value) => value.length > 0)
  );
  const joints = uniqueNames(
    Array.from(xmlDoc.querySelectorAll("joint"))
      .map((joint) => joint.getAttribute("name") ?? "")
      .filter((value) => value.length > 0)
  );
  const jointEdges = Array.from(xmlDoc.querySelectorAll("joint"))
    .map((joint) => {
      const jointName = joint.getAttribute("name") || "";
      const parentLink = joint.querySelector("parent")?.getAttribute("link") || "";
      const childLink = joint.querySelector("child")?.getAttribute("link") || "";
      if (!jointName || !parentLink || !childLink) return null;
      return { jointName, parentLink, childLink };
    })
    .filter(
      (edge): edge is { jointName: string; parentLink: string; childLink: string } =>
        edge !== null
    );
  const childLinks = new Set(jointEdges.map((edge) => edge.childLink));
  const rootLinks = links.filter((linkName) => !childLinks.has(linkName));
  const childrenByParent = new Map<string, Array<{ jointName: string; childLink: string }>>();
  jointEdges.forEach((edge) => {
    const bucket = childrenByParent.get(edge.parentLink) || [];
    bucket.push({ jointName: edge.jointName, childLink: edge.childLink });
    childrenByParent.set(edge.parentLink, bucket);
  });
  const treeLines: string[] = [];
  const visited = new Set<string>();
  const visit = (linkName: string, depth: number) => {
    const indent = "  ".repeat(Math.max(depth, 0));
    if (depth === 0) {
      treeLines.push(linkName);
    } else {
      treeLines.push(`${indent}${linkName}`);
    }
    if (visited.has(linkName)) return;
    visited.add(linkName);
    const children = childrenByParent.get(linkName) || [];
    children.forEach((edge) => {
      treeLines.push(`${indent}  ↳ ${edge.jointName}`);
      visit(edge.childLink, depth + 1);
    });
  };
  if (rootLinks.length > 0) {
    rootLinks.forEach((root) => visit(root, 0));
  } else {
    links.forEach((link) => visit(link, 0));
  }

  return {
    name,
    links,
    joints,
    treeLines,
    rootLinks,
  };
};

const sanitizeToken = (value: string, fallback: string): string => {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) return fallback;
  if (/^[0-9]/.test(normalized)) return `m_${normalized}`;
  return normalized;
};

const pickPreferredLink = (links: string[], patterns: RegExp[]): string | null => {
  if (links.length === 0) return null;
  for (const pattern of patterns) {
    const match = links.find((linkName) => pattern.test(linkName));
    if (match) return match;
  }
  return links[0];
};

const normalizeAngle = (value: number): number => {
  let wrapped = value;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
};

const roundTo = (value: number, digits = 4): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const buildFallbackLinkName = (robotName: string): string => {
  const token = sanitizeToken(robotName, "robot");
  return `${token}__base_link`;
};

const buildAttachmentSuggestions = (
  robots: Array<AssemblyStructureSummary & { id: string; isPrimary: boolean }>,
  options: AssemblyInspectorOptions
): AssemblyAttachmentSuggestion[] => {
  if (robots.length < 2) return [];

  const robotsById = new Map(robots.map((robot) => [robot.id, robot] as const));
  const pairKeys = new Set<string>();
  (options.contactPairs ?? []).forEach((pairKey) => {
    const parsed = parseAssemblyContactPairKey(pairKey);
    if (!parsed) return;
    const [lhs, rhs] = parsed;
    if (!robotsById.has(lhs) || !robotsById.has(rhs) || lhs === rhs) return;
    pairKeys.add(lhs < rhs ? `${lhs}::${rhs}` : `${rhs}::${lhs}`);
  });
  if (pairKeys.size === 0) {
    const preferredParent =
      robots.find((robot) => robot.id === options.primaryRobotId) ||
      robots.find((robot) => robot.isPrimary) ||
      robots[0];
    robots
      .filter((robot) => robot.id !== preferredParent.id)
      .forEach((robot) => {
        pairKeys.add(
          preferredParent.id < robot.id
            ? `${preferredParent.id}::${robot.id}`
            : `${robot.id}::${preferredParent.id}`
        );
      });
  }

  const parentPatterns = [
    /mount/i,
    /base_link/i,
    /base_footprint/i,
    /base/i,
    /chassis/i,
    /body/i,
    /root/i,
  ];
  const childPatterns = [/base_link/i, /base_footprint/i, /base/i, /chassis/i, /root/i, /body/i];
  const suggestions: AssemblyAttachmentSuggestion[] = [];

  Array.from(pairKeys).forEach((pairKey, index) => {
    const parsed = parseAssemblyContactPairKey(pairKey);
    if (!parsed) return;
    const lhs = robotsById.get(parsed[0]);
    const rhs = robotsById.get(parsed[1]);
    if (!lhs || !rhs) return;

    const lhsPreferred = lhs.id === options.primaryRobotId || lhs.isPrimary;
    const rhsPreferred = rhs.id === options.primaryRobotId || rhs.isPrimary;
    const parent =
      lhsPreferred && !rhsPreferred
        ? lhs
        : rhsPreferred && !lhsPreferred
          ? rhs
          : lhs.links.length >= rhs.links.length
            ? lhs
            : rhs;
    const child = parent.id === lhs.id ? rhs : lhs;

    const parentRawOptions = [...parent.rootLinks, ...parent.links].filter(
      (value, index, array) => array.indexOf(value) === index
    );
    const childRawOptions = [...child.rootLinks, ...child.links].filter(
      (value, index, array) => array.indexOf(value) === index
    );
    const parentLinkOptions =
      parentRawOptions.length > 0 ? parentRawOptions : [buildFallbackLinkName(parent.name)];
    const childLinkOptions =
      childRawOptions.length > 0 ? childRawOptions : [buildFallbackLinkName(child.name)];
    const parentLink =
      pickPreferredLink(parentLinkOptions, parentPatterns) ?? parentLinkOptions[0];
    const childLink =
      pickPreferredLink(childLinkOptions, childPatterns) ?? childLinkOptions[0];
    if (!parentLink || !childLink) return;

    const parentPose = options.poses?.[parent.id];
    const childPose = options.poses?.[child.id];
    const xyz: [number, number, number] =
      parentPose && childPose
        ? [
            roundTo(childPose.x - parentPose.x),
            roundTo(childPose.y - parentPose.y),
            roundTo(childPose.z - parentPose.z),
          ]
        : [0, 0, 0];
    const rpy: [number, number, number] =
      parentPose && childPose ? [0, 0, roundTo(normalizeAngle(childPose.yaw - parentPose.yaw))] : [0, 0, 0];
    const confidence: "high" | "medium" = parentPose && childPose ? "high" : "medium";

    suggestions.push({
      id: `suggestion_${index + 1}_${sanitizeToken(parent.id, "parent")}_${sanitizeToken(child.id, "child")}`,
      parentRobotId: parent.id,
      parentRobotName: parent.name,
      parentLink,
      parentLinkOptions,
      childRobotId: child.id,
      childRobotName: child.name,
      childLink,
      childLinkOptions,
      jointName: `${sanitizeToken(parent.name, "parent")}__to__${sanitizeToken(child.name, "child")}`,
      origin: { xyz, rpy },
      confidence,
      reason:
        confidence === "high"
          ? "Based on current robot placement and detected contact."
          : "Based on detected contact and base-link heuristics.",
    });
  });

  return suggestions;
};

export const buildAssemblyInspectorData = (
  models: AssemblyInspectorModel[],
  options: AssemblyInspectorOptions = {}
): AssemblyInspectorData => {
  const validModels = models.filter((model) => model.urdfContent.trim().length > 0);

  const robots = validModels.map((model) => ({
      id: model.id,
      isPrimary: model.isPrimary === true,
      role: model.role,
      ...summarizeUrdf(model.name, model.urdfContent),
    }));
  const attachmentSuggestions = buildAttachmentSuggestions(robots, options);

  if (validModels.length === 0 || options?.allowUnion === false) {
    return { robots, union: null, attachmentSuggestions };
  }

  try {
    const unionUrdf = buildAssemblyUrdf(
      createAssemblySpec(
        validModels.map((model) => ({
          id: model.id,
          name: model.name,
          urdfContent: model.urdfContent,
          isPrimary: model.isPrimary,
        })),
        {
          poses: options.poses,
          primaryRobotId: options.primaryRobotId,
        }
      )
    );
    return {
      robots,
      union: summarizeUrdf("Proposed Union", unionUrdf),
      attachmentSuggestions,
    };
  } catch {
    return {
      robots,
      union: null,
      attachmentSuggestions,
    };
  }
};
