import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import { parseUrdfDocument, serializeUrdfDocument } from "@/features/urdf/editor/urdfDocument";
import {
  parseUrdfStructureDirectiveComment,
  type StructureDirectiveTargetType,
} from "@/features/layout/urdfStructureCommentHints";

export type StructureMoveSourceType = "joint" | "link";

type StructureMoveSource = {
  sourceType: StructureMoveSourceType;
  sourceName: string;
};

type StructureMoveArgs = StructureMoveSource & {
  urdfContent: string;
  targetGroupLabel: string;
  analysis?: UrdfAnalysis | null;
};

const GROUP_LABEL_WHITESPACE_PATTERN = /\s+/g;
const URDF_STUDIO_GROUP_DIRECTIVE_PREFIX = "urdf-studio:group";
const URDF_LINK_TAG_NAME = "link";
const URDF_JOINT_TAG_NAME = "joint";

export const normalizeStructureGroupLabel = (label: string): string =>
  label.trim().toLowerCase().replace(GROUP_LABEL_WHITESPACE_PATTERN, "");

const toGroupDirectiveCommentBody = (
  label: string,
  targetType: StructureDirectiveTargetType,
  targetName: string
): string => ` ${URDF_STUDIO_GROUP_DIRECTIVE_PREFIX} label=${label} ${targetType}=${targetName} `;

const findNamedElement = (
  root: Document | Element,
  tagName: StructureDirectiveTargetType,
  elementName: string
): Element | null => {
  const candidates = Array.from(root.getElementsByTagName(tagName));
  for (const node of candidates) {
    if (node.getAttribute("name") === elementName) {
      return node;
    }
  }
  return null;
};

const isDirectiveTargetElement = (node: Node): node is Element => {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const tagName = (node as Element).tagName.toLowerCase();
  return tagName === URDF_LINK_TAG_NAME || tagName === URDF_JOINT_TAG_NAME;
};

const resolveDirectiveNextSiblingElement = (commentNode: Comment): Element | null => {
  let cursor: Node | null = commentNode.nextSibling;
  while (cursor) {
    if (isDirectiveTargetElement(cursor)) {
      return cursor;
    }
    if (cursor.nodeType === Node.TEXT_NODE) {
      const textContent = cursor.textContent ?? "";
      if (textContent.trim().length > 0) {
        return null;
      }
      cursor = cursor.nextSibling;
      continue;
    }
    if (cursor.nodeType === Node.COMMENT_NODE) {
      cursor = cursor.nextSibling;
      continue;
    }
    return null;
  }
  return null;
};

const findCommentsToRemoveForTarget = (
  root: ParentNode,
  targetType: StructureDirectiveTargetType,
  targetName: string
): Comment[] => {
  const commentsToRemove: Comment[] = [];
  const walker = root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  if (!walker) return commentsToRemove;

  let node = walker.nextNode();
  while (node) {
    const commentNode = node as Comment;
    const directive = parseUrdfStructureDirectiveComment(commentNode.data);
    if (directive) {
      const explicitMatch =
        directive.targetType === targetType && directive.targetName === targetName;
      if (explicitMatch) {
        commentsToRemove.push(commentNode);
      } else if (directive.targetType === null) {
        const nextElement = resolveDirectiveNextSiblingElement(commentNode);
        const nextTag = nextElement?.tagName?.toLowerCase();
        const nextName = nextElement?.getAttribute("name");
        if (nextTag === targetType && nextName === targetName) {
          commentsToRemove.push(commentNode);
        }
      }
    }
    node = walker.nextNode();
  }

  return commentsToRemove;
};

const resolveMoveTargets = (
  source: StructureMoveSource,
  analysis?: UrdfAnalysis | null
): Array<{ type: StructureDirectiveTargetType; name: string }> => {
  if (source.sourceType === "joint") {
    return [{ type: "joint", name: source.sourceName }];
  }

  const orderedJoints = analysis?.isValid ? analysis.jointHierarchy.orderedJoints : [];
  const inboundJoint = orderedJoints?.find((joint) => joint.childLink === source.sourceName);
  if (inboundJoint?.jointName) {
    return [{ type: "joint", name: inboundJoint.jointName }];
  }

  return [{ type: "link", name: source.sourceName }];
};

const applyGroupDirectiveToTarget = ({
  urdfContent,
  targetType,
  targetName,
  groupLabel,
}: {
  urdfContent: string;
  targetType: StructureDirectiveTargetType;
  targetName: string;
  groupLabel: string;
}): string => {
  const xmlDoc = parseUrdfDocument(urdfContent);
  if (!xmlDoc) {
    return urdfContent;
  }
  const robot = xmlDoc.querySelector("robot");
  if (!robot) {
    return urdfContent;
  }
  const targetElement = findNamedElement(robot, targetType, targetName);
  if (!targetElement) {
    return urdfContent;
  }

  const commentsToRemove = findCommentsToRemoveForTarget(robot, targetType, targetName);
  commentsToRemove.forEach((commentNode) => {
    commentNode.parentNode?.removeChild(commentNode);
  });

  const targetParent = targetElement.parentNode;
  if (!targetParent) {
    return urdfContent;
  }
  const commentNode = xmlDoc.createComment(
    toGroupDirectiveCommentBody(groupLabel, targetType, targetName)
  );
  targetParent.insertBefore(commentNode, targetElement);

  return serializeUrdfDocument(xmlDoc);
};

export const moveStructureItemToGroup = ({
  urdfContent,
  sourceType,
  sourceName,
  targetGroupLabel,
  analysis,
}: StructureMoveArgs): string => {
  const normalizedLabel = normalizeStructureGroupLabel(targetGroupLabel);
  if (!normalizedLabel) {
    return urdfContent;
  }
  const targets = resolveMoveTargets({ sourceType, sourceName }, analysis);
  if (targets.length === 0) {
    return urdfContent;
  }

  return targets.reduce((nextUrdfContent, target) => {
    return applyGroupDirectiveToTarget({
      urdfContent: nextUrdfContent,
      targetType: target.type,
      targetName: target.name,
      groupLabel: normalizedLabel,
    });
  }, urdfContent);
};
