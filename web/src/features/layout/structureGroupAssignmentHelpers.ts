import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import {
  parseUrdfStructureDirectiveComment,
  type StructureDirectiveTargetType,
} from "@/features/layout/urdfStructureCommentHints";

export type StructureMoveSourceType = "joint" | "link";

export type StructureMoveSource = {
  sourceType: StructureMoveSourceType;
  sourceName: string;
};

const GROUP_LABEL_WHITESPACE_PATTERN = /\s+/g;
const URDF_STRUCTURE_TAG_NAMES = {
  joint: "joint",
  link: "link",
} as const;

export const normalizeStructureGroupLabel = (label: string): string =>
  label.trim().toLowerCase().replace(GROUP_LABEL_WHITESPACE_PATTERN, "");

export const toGroupDirectiveCommentBody = (
  label: string,
  targetType: StructureDirectiveTargetType,
  targetName: string
): string => ` urdf-studio:group label=${label} ${targetType}=${targetName} `;

const isDirectiveTargetElement = (node: Node): node is Element => {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }
  const tagName = (node as Element).tagName.toLowerCase();
  return (
    tagName === URDF_STRUCTURE_TAG_NAMES.link || tagName === URDF_STRUCTURE_TAG_NAMES.joint
  );
};

export const resolveDirectiveNextSiblingElement = (
  commentNode: Comment
): Element | null => {
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

export const resolveMoveTargets = (
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

export const findCommentsToRemoveForTarget = (
  root: ParentNode,
  targetType: StructureDirectiveTargetType,
  targetName: string
): Comment[] => {
  const commentsToRemove: Comment[] = [];
  const walker = root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  if (!walker) {
    return commentsToRemove;
  }

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
