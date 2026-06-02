import type { RotationAxis } from "@/shared/types/feature";
import { normalizeJointAxes, type AxisCorrection, type AxisError } from "../utils/normalizeJointAxes";
import {
  canonicalOrderURDF,
  prettyPrintURDF,
  rotateRobot90Degrees,
  type JointAxisMap,
  type JointLimits,
} from "@/shared/lib/urdfBrowser";
import { updateJointOriginInUrdf } from "@/shared/lib/urdfCore";
import { updateJointAxisInURDF } from "./updateJointAxis";
import { updateJointLimitsInURDF } from "./updateJointLimits";
import { updateJointNameInURDF } from "./updateJointName";
import { updateJointTypeInURDF } from "./updateJointType";
import { updateJointEffortInURDF } from "./updateJointEffort";
import { updateJointVelocityInURDF } from "./updateJointVelocity";
import { updateLinkNameInURDF } from "./updateLinkName";
import { getUrdfElementByName, parseUrdfDocument } from "./urdfDocument";

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
  };
};

export const changeJointOrigin = (
  urdfContent: string,
  jointName: string,
  xyz: [number, number, number],
  rpy: [number, number, number]
): UrdfEditResult => {
  if (!urdfContent.trim()) {
    return { success: false, content: urdfContent, error: "No URDF content available" };
  }

  const result = updateJointOriginInUrdf(urdfContent, jointName, xyz, rpy);

  if (!result.success || result.content === urdfContent) {
    return {
      success: false,
      content: urdfContent,
      error: `Unable to update origin for joint "${jointName}"`,
    };
  }

  return {
    success: true,
    content: result.content,
    message: `Updated origin for joint "${jointName}"`,
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
  };
};

export const changeJointVelocity = (
  urdfContent: string,
  jointName: string,
  velocity: number | null
): UrdfEditResult => {
  if (!urdfContent.trim()) {
    return { success: false, content: urdfContent, error: "No URDF content available" };
  }

  const updatedContent = updateJointVelocityInURDF(urdfContent, jointName, velocity);

  if (updatedContent === urdfContent) {
    return {
      success: false,
      content: urdfContent,
      error: `Unable to update joint "${jointName}" velocity`,
    };
  }

  return {
    success: true,
    content: updatedContent,
    message: `Updated joint "${jointName}" velocity`,
  };
};

export const changeJointEffort = (
  urdfContent: string,
  jointName: string,
  effort: number | null
): UrdfEditResult => {
  if (!urdfContent.trim()) {
    return { success: false, content: urdfContent, error: "No URDF content available" };
  }

  const updatedContent = updateJointEffortInURDF(urdfContent, jointName, effort);

  if (updatedContent === urdfContent) {
    return {
      success: false,
      content: urdfContent,
      error: `Unable to update joint "${jointName}" effort`,
    };
  }

  return {
    success: true,
    content: updatedContent,
    message: `Updated joint "${jointName}" effort`,
  };
};

export const changeJointLimits = (
  urdfContent: string,
  jointName: string,
  lowerLimit?: number | null,
  upperLimit?: number | null
): UrdfEditResult => {
  if (!urdfContent.trim()) {
    return { success: false, content: urdfContent, error: "No URDF content available" };
  }

  const jointType = getJointTypeFromUrdf(urdfContent, jointName);
  if (jointType) {
    if (jointType === "fixed" || jointType === "floating" || jointType === "planar") {
      return {
        success: false,
        content: urdfContent,
        error: `Joint "${jointName}" type "${jointType}" does not allow limits`,
      };
    }
    if (jointType === "continuous") {
      return {
        success: false,
        content: urdfContent,
        error: `Joint "${jointName}" is continuous; position limits are not allowed`,
      };
    }
    if (jointType === "revolute" || jointType === "prismatic") {
      const hasLower = Number.isFinite(lowerLimit);
      const hasUpper = Number.isFinite(upperLimit);
      if (!hasLower || !hasUpper) {
        return {
          success: false,
          content: urdfContent,
          error: `Joint "${jointName}" requires both lower and upper limits`,
        };
      }
    }
  }

  const updatedContent = updateJointLimitsInURDF(
    urdfContent,
    jointName,
    lowerLimit,
    upperLimit
  );

  if (updatedContent === urdfContent) {
    return {
      success: false,
      content: urdfContent,
      error: `Unable to update joint "${jointName}" limits`,
    };
  }

  return {
    success: true,
    content: updatedContent,
    message: `Updated joint "${jointName}" limits`,
  };
};

const getJointTypeFromUrdf = (urdfContent: string, jointName: string): string | null => {
  const xmlDoc = parseUrdfDocument(urdfContent);
  if (!xmlDoc) return null;
  const joint = getUrdfElementByName(xmlDoc, "joint", jointName, { label: "joint" });
  if (!joint) return null;
  return joint.getAttribute("type");
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
  };
};
