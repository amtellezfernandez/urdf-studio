import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import { parseUrdfDocument, serializeUrdfDocument } from "@/features/urdf/editor/urdfDocument";
import { type StructureDirectiveTargetType } from "@/features/layout/urdfStructureCommentHints";
import {
  findCommentsToRemoveForTarget,
  normalizeStructureGroupLabel,
  resolveMoveTargets,
  toGroupDirectiveCommentBody,
  type StructureMoveSource,
  type StructureMoveSourceType,
} from "@/features/layout/structureGroupAssignmentHelpers";

export { normalizeStructureGroupLabel, type StructureMoveSourceType };

type StructureMoveArgs = StructureMoveSource & {
  urdfContent: string;
  targetGroupLabel: string;
  analysis?: UrdfAnalysis | null;
};

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
