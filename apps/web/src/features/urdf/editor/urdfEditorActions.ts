import type { RotationAxis } from "@/features/types";
import { canonicalOrderURDF } from "../utils/canonicalOrdering";
import { normalizeJointAxes, type AxisCorrection, type AxisError } from "../utils/normalizeJointAxes";
import { parseJointAxesFromURDF, type JointAxisMap } from "../parsing/parseJointAxis";
import { parseJointLimitsFromURDF, type JointLimits } from "../parsing/parseJointLimits";
import { prettyPrintURDF } from "../utils/prettyPrintURDF";
import { rotateRobot90Degrees } from "../utils/rotateRobot";
import { updateJointAxisInURDF } from "./updateJointAxis";
import { updateJointNameInURDF } from "./updateJointName";
import { updateJointTypeInURDF } from "./updateJointType";
import { updateLinkNameInURDF } from "./updateLinkName";

interface UrdfEditResult {
  success: boolean;
  content: string;
  message?: string;
  error?: string;
  warnings?: string[];
  details?: string[];
  jointLimits?: JointLimits;
  jointAxes?: JointAxisMap;
}

interface NormalizeAxesResult extends UrdfEditResult {
  corrections: AxisCorrection[];
  issues: AxisError[];
}

export const renameJoint = (
  urdfContent: string,
  oldName: string,
  newName: string
): UrdfEditResult => {
  if (!urdfContent.trim()) {
    return { success: false, content: urdfContent, error: "No URDF content available" };
  }

  const updatedContent = updateJointNameInURDF(urdfContent, oldName, newName);

  if (updatedContent === urdfContent) {
    return {
      success: false,
      content: urdfContent,
      error: `Unable to rename joint "${oldName}" to "${newName}"`,
    };
  }

  return {
    success: true,
    content: updatedContent,
    message: `Renamed joint "${oldName}" to "${newName}"`,
  };
};

export const renameLink = (
  urdfContent: string,
  oldName: string,
  newName: string
): UrdfEditResult => {
  if (!urdfContent.trim()) {
    return { success: false, content: urdfContent, error: "No URDF content available" };
  }

  const updatedContent = updateLinkNameInURDF(urdfContent, oldName, newName);

  if (updatedContent === urdfContent) {
    return {
      success: false,
      content: urdfContent,
      error: `Unable to rename link "${oldName}" to "${newName}"`,
    };
  }

  return {
    success: true,
    content: updatedContent,
    message: `Renamed link "${oldName}" to "${newName}"`,
  };
};

export const changeJointAxis = (
  urdfContent: string,
  jointName: string,
  axis: [number, number, number]
): UrdfEditResult => {
  if (!urdfContent.trim()) {
    return { success: false, content: urdfContent, error: "No URDF content available" };
  }

  const updatedContent = updateJointAxisInURDF(urdfContent, jointName, axis);

  if (updatedContent === urdfContent) {
    return {
      success: false,
      content: urdfContent,
      error: `Unable to update axis for joint "${jointName}"`,
    };
  }

  return {
    success: true,
    content: updatedContent,
    message: `Updated axis for joint "${jointName}"`,
    jointLimits: parseJointLimitsFromURDF(updatedContent),
    jointAxes: parseJointAxesFromURDF(updatedContent),
  };
};

export const changeJointType = (
  urdfContent: string,
  jointName: string,
  newType: string,
  lowerLimit?: number,
  upperLimit?: number
): UrdfEditResult => {
  if (!urdfContent.trim()) {
    return { success: false, content: urdfContent, error: "No URDF content available" };
  }

  const updatedContent = updateJointTypeInURDF(urdfContent, jointName, newType, lowerLimit, upperLimit);

  if (updatedContent === urdfContent) {
    return {
      success: false,
      content: urdfContent,
      error: `Unable to update joint "${jointName}" type`,
    };
  }

  return {
    success: true,
    content: updatedContent,
    message: `Updated joint "${jointName}" type to ${newType}`,
    jointLimits: parseJointLimitsFromURDF(updatedContent),
    jointAxes: parseJointAxesFromURDF(updatedContent),
  };
};

export const rotateUrdf = (
  urdfContent: string,
  axis: RotationAxis
): UrdfEditResult => {
  if (!urdfContent.trim()) {
    return { success: false, content: urdfContent, error: "No URDF content available" };
  }

  const rotatedContent = rotateRobot90Degrees(urdfContent, axis);

  if (rotatedContent === urdfContent) {
    return {
      success: false,
      content: urdfContent,
      error: "Rotation did not change the URDF content",
    };
  }

  return {
    success: true,
    content: rotatedContent,
    message: `Rotated robot 90° around ${axis.toUpperCase()}-axis`,
  };
};

export const canonicalizeUrdf = (urdfContent: string): UrdfEditResult => {
  if (!urdfContent.trim()) {
    return { success: false, content: urdfContent, error: "No URDF content available" };
  }

  return {
    success: true,
    content: canonicalOrderURDF(urdfContent),
    message: "URDF elements reordered to canonical format",
  };
};

export const prettifyUrdf = (urdfContent: string, indentSize?: number): UrdfEditResult => {
  if (!urdfContent.trim()) {
    return { success: false, content: urdfContent, error: "No URDF content available" };
  }

  return {
    success: true,
    content: prettyPrintURDF(urdfContent, indentSize),
    message: "URDF formatted with consistent indentation",
  };
};

export const normalizeAxes = (urdfContent: string): NormalizeAxesResult => {
  if (!urdfContent.trim()) {
    return {
      success: false,
      content: urdfContent,
      error: "No URDF content available",
      corrections: [],
      issues: [],
    };
  }

  const result = normalizeJointAxes(urdfContent);
  const warnings = result.errors.map(
    (err) => `Joint "${err.jointName}" (${err.jointType}): ${err.issue}`
  );
  const details = result.corrections.map(
    (correction) => `Joint "${correction.jointName}": ${correction.reason}`
  );

  return {
    success: true,
    content: result.urdfContent,
    message: result.corrections.length > 0 ? `Normalized ${result.corrections.length} joint axis(es)` : undefined,
    warnings,
    details,
    corrections: result.corrections,
    issues: result.errors,
    jointAxes: parseJointAxesFromURDF(result.urdfContent),
  };
};
