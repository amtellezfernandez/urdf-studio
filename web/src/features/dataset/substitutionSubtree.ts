import { parseUrdfDocument, serializeUrdfDocument } from "@/shared/lib/urdfCore";
import { normalizeMeshPathForMatch } from "@/shared/lib/urdfBrowser";

export type SubstitutionPreview = {
  hostRootLink: string;
  replacementRootLink: string;
  replacedLinkCount: number;
  replacedJointCount: number;
  importedLinkCount: number;
  importedJointCount: number;
  renamedLinks: Array<{ from: string; to: string }>;
  renamedJoints: Array<{ from: string; to: string }>;
  renamedMaterials: Array<{ from: string; to: string }>;
  rewrittenMeshPaths: Array<{ from: string; to: string }>;
  importedMaterialCount: number;
  importedTransmissionCount: number;
  importedGazeboCount: number;
};

export type ApplySubstitutionSubtreeResult = {
  urdfContent: string;
  preview: SubstitutionPreview;
};

type ApplySubstitutionSubtreeParams = {
  hostUrdfContent: string;
  replacementUrdfContent: string;
  hostRootLink: string;
  replacementRootLink: string;
  replacementUrdfPath: string;
  packageRoots?: Record<string, string[]>;
};

type JointEdge = {
  element: Element;
  name: string;
  parentLink: string;
  childLink: string;
};

const UNIQUE_NAME_SUFFIX_LIMIT = 10_000;

const normalizePath = (value: string): string => value.replace(/\\/g, "/");

const getUrdfDir = (urdfPath: string): string => {
  const normalizedPath = normalizeMeshPathForMatch(urdfPath) || normalizePath(urdfPath);
  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return "";
  }
  segments.pop();
  return segments.join("/");
};

const isRelativeMeshPath = (value: string): boolean => {
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    !trimmed.startsWith("/") &&
    !trimmed.startsWith("package://") &&
    !trimmed.startsWith("file://") &&
    !/^[a-z]+:\/\//i.test(trimmed)
  );
};

const resolveReplacementPackageRoot = (
  packageName: string,
  replacementUrdfPath: string,
  packageRoots?: Record<string, string[]>
): string | null => {
  const candidates = packageRoots?.[packageName] ?? [];
  if (candidates.length === 0) {
    return null;
  }
  const normalizedReplacementPath = normalizeMeshPathForMatch(replacementUrdfPath) || normalizePath(replacementUrdfPath);
  const matchingCandidate =
    candidates.find((candidate) => {
      const normalizedCandidate = normalizeMeshPathForMatch(candidate) || normalizePath(candidate);
      return normalizedReplacementPath.startsWith(`${normalizedCandidate}/`);
    }) || null;
  return matchingCandidate || candidates[0] || null;
};

const qualifyReplacementMeshPath = (
  meshPath: string,
  replacementUrdfPath: string,
  packageRoots?: Record<string, string[]>
): string => {
  if (meshPath.startsWith("package://")) {
    const withoutPrefix = meshPath.replace(/^package:\/\//, "");
    const separatorIndex = withoutPrefix.indexOf("/");
    if (separatorIndex <= 0) {
      return meshPath;
    }
    const packageName = withoutPrefix.slice(0, separatorIndex);
    const assetPath = withoutPrefix.slice(separatorIndex + 1);
    const replacementPackageRoot = resolveReplacementPackageRoot(
      packageName,
      replacementUrdfPath,
      packageRoots
    );
    return replacementPackageRoot ? `${replacementPackageRoot}/${assetPath}` : meshPath;
  }
  if (!isRelativeMeshPath(meshPath)) {
    return meshPath;
  }
  const replacementDir = getUrdfDir(replacementUrdfPath);
  return replacementDir ? `${replacementDir}/${normalizePath(meshPath).replace(/^\/+/, "")}` : meshPath;
};

const sanitizeToken = (value: string, fallback: string): string => {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
};

const getNamedElements = (robot: Element, tagName: "link" | "joint"): Element[] =>
  Array.from(robot.getElementsByTagName(tagName));

const getJointEdges = (robot: Element): JointEdge[] =>
  getNamedElements(robot, "joint")
    .map((joint) => {
      const name = joint.getAttribute("name") || "";
      const parentLink = joint.querySelector("parent")?.getAttribute("link") || "";
      const childLink = joint.querySelector("child")?.getAttribute("link") || "";
      if (!name || !parentLink || !childLink) {
        return null;
      }
      return { element: joint, name, parentLink, childLink };
    })
    .filter((joint): joint is JointEdge => joint !== null);

const collectSubtreeLinks = (robot: Element, rootLink: string): Set<string> => {
  const edges = getJointEdges(robot);
  const childrenByParent = new Map<string, string[]>();
  edges.forEach((edge) => {
    const bucket = childrenByParent.get(edge.parentLink) || [];
    bucket.push(edge.childLink);
    childrenByParent.set(edge.parentLink, bucket);
  });

  const visited = new Set<string>();
  const stack = [rootLink];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    (childrenByParent.get(current) || []).forEach((childLink) => {
      stack.push(childLink);
    });
  }
  return visited;
};

const requireRobot = (urdfContent: string, label: string): Element => {
  const xmlDoc = parseUrdfDocument(urdfContent);
  const robot = xmlDoc?.querySelector("robot");
  if (!xmlDoc || !robot) {
    throw new Error(`Invalid ${label} URDF.`);
  }
  return robot;
};

const requireLink = (robot: Element, linkName: string, label: string): Element => {
  const link = getNamedElements(robot, "link").find((candidate) => candidate.getAttribute("name") === linkName);
  if (!link) {
    throw new Error(`${label} link "${linkName}" was not found.`);
  }
  return link;
};

const buildUniqueName = (preferredName: string, usedNames: Set<string>, namespace: string): string => {
  if (!usedNames.has(preferredName)) {
    usedNames.add(preferredName);
    return preferredName;
  }
  let suffix = 1;
  while (suffix < UNIQUE_NAME_SUFFIX_LIMIT) {
    const candidate = `${preferredName}__${namespace}_${suffix}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    suffix += 1;
  }
  throw new Error(`Could not generate a unique name for "${preferredName}".`);
};

const getDirectChildElements = (robot: Element, tagName: string): Element[] =>
  Array.from(robot.children).filter((child) => child.tagName.toLowerCase() === tagName);

export const applySubstitutionSubtree = ({
  hostUrdfContent,
  replacementUrdfContent,
  hostRootLink,
  replacementRootLink,
  replacementUrdfPath,
  packageRoots,
}: ApplySubstitutionSubtreeParams): ApplySubstitutionSubtreeResult => {
  const hostRobot = requireRobot(hostUrdfContent, "host");
  const replacementRobot = requireRobot(replacementUrdfContent, "replacement");
  requireLink(hostRobot, hostRootLink, "Host");
  requireLink(replacementRobot, replacementRootLink, "Replacement");

  const hostSubtreeLinks = collectSubtreeLinks(hostRobot, hostRootLink);
  const replacementSubtreeLinks = collectSubtreeLinks(replacementRobot, replacementRootLink);
  const hostJoints = getJointEdges(hostRobot);
  const replacementJoints = getJointEdges(replacementRobot);
  const hostInboundJoint =
    hostJoints.find((joint) => joint.childLink === hostRootLink && !hostSubtreeLinks.has(joint.parentLink)) ||
    null;
  const hostRemovedJoints = hostJoints.filter(
    (joint) => hostSubtreeLinks.has(joint.childLink) && joint.name !== hostInboundJoint?.name
  );
  const hostSubtreeJoints = hostJoints.filter((joint) => hostSubtreeLinks.has(joint.childLink));
  const replacementSubtreeJoints = replacementJoints.filter(
    (joint) =>
      replacementSubtreeLinks.has(joint.childLink) &&
      replacementSubtreeLinks.has(joint.parentLink)
  );

  const usedLinkNames = new Set(
    getNamedElements(hostRobot, "link")
      .map((link) => link.getAttribute("name") || "")
      .filter((name) => name.length > 0 && !hostSubtreeLinks.has(name))
  );
  const usedJointNames = new Set(
    hostJoints
      .filter((joint) => !hostRemovedJoints.some((removedJoint) => removedJoint.name === joint.name))
      .map((joint) => joint.name)
      .filter((name) => name.length > 0)
  );
  const usedMaterialNames = new Set(
    getDirectChildElements(hostRobot, "material")
      .map((material) => material.getAttribute("name") || "")
      .filter((name) => name.length > 0)
  );
  const replacementNamespace = sanitizeToken(replacementRootLink, "replacement");

  const linkRenameMap = new Map<string, string>();
  replacementSubtreeLinks.forEach((linkName) => {
    linkRenameMap.set(linkName, buildUniqueName(linkName, usedLinkNames, replacementNamespace));
  });
  const jointRenameMap = new Map<string, string>();
  replacementSubtreeJoints.forEach((joint) => {
    jointRenameMap.set(joint.name, buildUniqueName(joint.name, usedJointNames, replacementNamespace));
  });
  const materialRenameMap = new Map<string, string>();
  const referencedMaterialNames = new Set<string>();

  hostRemovedJoints.forEach((joint) => {
    joint.element.parentNode?.removeChild(joint.element);
  });
  Array.from(hostSubtreeLinks).forEach((linkName) => {
    const link = getNamedElements(hostRobot, "link").find((candidate) => candidate.getAttribute("name") === linkName);
    link?.parentNode?.removeChild(link);
  });

  const hostDocument = hostRobot.ownerDocument;
  const rewrittenMeshPaths: Array<{ from: string; to: string }> = [];

  Array.from(replacementSubtreeLinks).forEach((linkName) => {
    const sourceLink = getNamedElements(replacementRobot, "link").find(
      (candidate) => candidate.getAttribute("name") === linkName
    );
    if (!sourceLink) {
      return;
    }
    const importedLink = hostDocument.importNode(sourceLink, true) as Element;
    importedLink.setAttribute("name", linkRenameMap.get(linkName) || linkName);
    Array.from(importedLink.querySelectorAll("visual material, collision material")).forEach(
      (materialNode) => {
        const materialName = materialNode.getAttribute("name");
        if (!materialName) return;
        referencedMaterialNames.add(materialName);
      }
    );
    Array.from(importedLink.getElementsByTagName("mesh")).forEach((meshNode) => {
      const filename = meshNode.getAttribute("filename");
      if (!filename) return;
      const rewritten = qualifyReplacementMeshPath(filename, replacementUrdfPath, packageRoots);
      if (rewritten !== filename) {
        meshNode.setAttribute("filename", rewritten);
        rewrittenMeshPaths.push({ from: filename, to: rewritten });
      }
    });
    hostRobot.appendChild(importedLink);
  });

  const importedMaterials: Element[] = [];
  getDirectChildElements(replacementRobot, "material").forEach((material) => {
    const materialName = material.getAttribute("name") || "";
    if (!materialName || !referencedMaterialNames.has(materialName)) {
      return;
    }
    const nextMaterialName = buildUniqueName(
      materialName,
      usedMaterialNames,
      replacementNamespace
    );
    materialRenameMap.set(materialName, nextMaterialName);
    const importedMaterial = hostDocument.importNode(material, true) as Element;
    importedMaterial.setAttribute("name", nextMaterialName);
    importedMaterials.push(importedMaterial);
    hostRobot.appendChild(importedMaterial);
  });

  Array.from(hostRobot.querySelectorAll("visual material, collision material")).forEach((materialNode) => {
    const materialName = materialNode.getAttribute("name");
    if (!materialName) return;
    const renamedMaterial = materialRenameMap.get(materialName);
    if (renamedMaterial) {
      materialNode.setAttribute("name", renamedMaterial);
    }
  });

  replacementSubtreeJoints.forEach((joint) => {
    const importedJoint = hostDocument.importNode(joint.element, true) as Element;
    importedJoint.setAttribute("name", jointRenameMap.get(joint.name) || joint.name);
    importedJoint.querySelector("parent")?.setAttribute(
      "link",
      linkRenameMap.get(joint.parentLink) || joint.parentLink
    );
    importedJoint.querySelector("child")?.setAttribute(
      "link",
      linkRenameMap.get(joint.childLink) || joint.childLink
    );
    hostRobot.appendChild(importedJoint);
  });

  const importedTransmissions: Element[] = [];
  getDirectChildElements(replacementRobot, "transmission").forEach((transmission) => {
    const jointName = transmission.querySelector("joint")?.getAttribute("name") || "";
    if (!jointName || !jointRenameMap.has(jointName)) {
      return;
    }
    const importedTransmission = hostDocument.importNode(transmission, true) as Element;
    importedTransmission.querySelector("joint")?.setAttribute(
      "name",
      jointRenameMap.get(jointName) || jointName
    );
    importedTransmissions.push(importedTransmission);
    hostRobot.appendChild(importedTransmission);
  });

  const importedGazeboBlocks: Element[] = [];
  getDirectChildElements(replacementRobot, "gazebo").forEach((gazeboNode) => {
    const reference = gazeboNode.getAttribute("reference");
    if (reference && !linkRenameMap.has(reference)) {
      return;
    }
    const importedGazebo = hostDocument.importNode(gazeboNode, true) as Element;
    if (reference) {
      importedGazebo.setAttribute("reference", linkRenameMap.get(reference) || reference);
    }
    Array.from(importedGazebo.querySelectorAll("joint_name")).forEach((jointNameNode) => {
      const jointName = (jointNameNode.textContent || "").trim();
      if (!jointName) return;
      const renamedJoint = jointRenameMap.get(jointName);
      if (renamedJoint) {
        jointNameNode.textContent = renamedJoint;
      }
    });
    importedGazeboBlocks.push(importedGazebo);
    hostRobot.appendChild(importedGazebo);
  });

  if (hostInboundJoint) {
    hostInboundJoint.element
      .querySelector("child")
      ?.setAttribute("link", linkRenameMap.get(replacementRootLink) || replacementRootLink);
  }

  const renamedLinks = Array.from(linkRenameMap.entries())
    .filter(([from, to]) => from !== to)
    .map(([from, to]) => ({ from, to }));
  const renamedJoints = Array.from(jointRenameMap.entries())
    .filter(([from, to]) => from !== to)
    .map(([from, to]) => ({ from, to }));
  const renamedMaterials = Array.from(materialRenameMap.entries())
    .filter(([from, to]) => from !== to)
    .map(([from, to]) => ({ from, to }));

  return {
    urdfContent: serializeUrdfDocument(hostDocument),
    preview: {
      hostRootLink,
      replacementRootLink,
      replacedLinkCount: hostSubtreeLinks.size,
      replacedJointCount: hostSubtreeJoints.length,
      importedLinkCount: replacementSubtreeLinks.size,
      importedJointCount: replacementSubtreeJoints.length,
      renamedLinks,
      renamedJoints,
      renamedMaterials,
      rewrittenMeshPaths,
      importedMaterialCount: importedMaterials.length,
      importedTransmissionCount: importedTransmissions.length,
      importedGazeboCount: importedGazeboBlocks.length,
    },
  };
};
