import { analyzeUrdf } from "@/shared/lib/urdfCore";
import {
  getUrdfElementByName,
  parseUrdfDocument,
  type JointLimitInfo,
  type UrdfParseOptions,
  type UrdfAnalysis,
} from "@/shared/lib/urdfBrowser";
import { RAD_TO_DEG } from "@/shared/lib/angleConversions";
import { getJointLimitsError } from "@/shared/lib/jointLimits";
import { parseFiniteFloatOrNull } from "@/shared/lib/numeric";
import { parseVector3 } from "@/features/urdf/editor/link-editor/sizeUtils";

export type JointVector3 = [number, number, number];

const DEFAULT_ORIGIN: { xyz: JointVector3; rpy: JointVector3 } = {
  xyz: [0, 0, 0],
  rpy: [0, 0, 0],
};

export const parseJointNumericInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return parseFiniteFloatOrNull(trimmed) ?? undefined;
};

export const resolveJointOriginSnapshot = ({
  jointName,
  parseOptions,
  urdfContent,
}: {
  jointName: string;
  parseOptions: UrdfParseOptions;
  urdfContent?: string;
}): { xyz: JointVector3; rpy: JointVector3 } => {
  if (!urdfContent) {
    return DEFAULT_ORIGIN;
  }
  const xmlDoc = parseUrdfDocument(urdfContent, parseOptions);
  if (!xmlDoc) {
    return DEFAULT_ORIGIN;
  }
  const joint = getUrdfElementByName(xmlDoc, "joint", jointName, {
    label: "joint",
    onMissing: () => {},
  });
  const origin = joint?.querySelector("origin");
  return {
    xyz: parseVector3(origin?.getAttribute("xyz") || "", [0, 0, 0]),
    rpy: parseVector3(origin?.getAttribute("rpy") || "", [0, 0, 0]),
  };
};

export const resolveJointAvailableLinks = ({
  urdfAnalysis,
  urdfContent,
}: {
  urdfAnalysis?: UrdfAnalysis | null;
  urdfContent?: string;
}) => {
  if (urdfAnalysis?.isValid) {
    return [...urdfAnalysis.linkNames].sort();
  }
  if (!urdfContent) {
    return [];
  }
  const analysis = analyzeUrdf(urdfContent);
  if (!analysis.isValid) {
    return [];
  }
  return [...analysis.linkNames].sort();
};

export const parseAxisValue = (value: string): number | null => {
  return parseFiniteFloatOrNull(value);
};

export const jointTypeNeedsLimits = (jointType: string): boolean =>
  jointType === "revolute" || jointType === "prismatic";

export const resolveJointLimitLocalState = ({
  jointInfo,
}: {
  jointInfo?: JointLimitInfo;
}): {
  lower: string;
  upper: string;
} => {
  if (!jointTypeNeedsLimits(jointInfo?.type ?? "")) {
    return { lower: "", upper: "" };
  }

  return {
    lower: jointInfo?.lower !== null && jointInfo?.lower !== undefined ? String(jointInfo.lower) : "",
    upper: jointInfo?.upper !== null && jointInfo?.upper !== undefined ? String(jointInfo.upper) : "",
  };
};

export const resolveJointLimitDisplayValue = ({
  angleUnit,
  fallbackLimit,
  localLimit,
}: {
  angleUnit: "rad" | "deg";
  fallbackLimit: number | null | undefined;
  localLimit: string;
}): number | undefined => {
  const parsedLocalLimit = parseJointNumericInput(localLimit);
  const resolvedLimit = parsedLocalLimit ?? fallbackLimit ?? undefined;
  if (resolvedLimit === undefined || !Number.isFinite(resolvedLimit)) {
    return undefined;
  }
  return angleUnit === "deg" ? resolvedLimit * RAD_TO_DEG : resolvedLimit;
};

export const resolveJointLimitCommitState = ({
  currentType,
  localLowerLimit,
  localUpperLimit,
}: {
  currentType: string;
  localLowerLimit: string;
  localUpperLimit: string;
}):
  | { errorMessage: string }
  | {
      lower: number | undefined;
      upper: number | undefined;
      errorMessage?: undefined;
    } => {
  const lower = parseJointNumericInput(localLowerLimit);
  const upper = parseJointNumericInput(localUpperLimit);
  if (currentType === "prismatic" && lower === undefined && upper === undefined) {
    return { errorMessage: "Prismatic joints require limits." };
  }
  const errorMessage = getJointLimitsError(lower, upper);
  if (errorMessage) {
    return { errorMessage };
  }
  return { lower, upper };
};

export const resolveJointTypeChangeLimits = ({
  jointInfo,
  localLowerLimit,
  localUpperLimit,
  newType,
}: {
  jointInfo?: JointLimitInfo;
  localLowerLimit: string;
  localUpperLimit: string;
  newType: string;
}): {
  lower: number | undefined;
  upper: number | undefined;
} => {
  if (!jointTypeNeedsLimits(newType)) {
    return { lower: undefined, upper: undefined };
  }

  return {
    lower:
      parseJointNumericInput(localLowerLimit) ??
      (jointInfo?.lower !== null && jointInfo?.lower !== undefined ? jointInfo.lower : undefined),
    upper:
      parseJointNumericInput(localUpperLimit) ??
      (jointInfo?.upper !== null && jointInfo?.upper !== undefined ? jointInfo.upper : undefined),
  };
};

export const resolveAxisComponents = ({
  fallbackAxis,
  localAxisX,
  localAxisY,
  localAxisZ,
}: {
  fallbackAxis: JointVector3;
  localAxisX: string;
  localAxisY: string;
  localAxisZ: string;
}): JointVector3 => {
  const x = parseAxisValue(localAxisX);
  const y = parseAxisValue(localAxisY);
  const z = parseAxisValue(localAxisZ);
  return [x ?? fallbackAxis[0], y ?? fallbackAxis[1], z ?? fallbackAxis[2]];
};

export const resolveJointAxisPresetLabel = ({
  axis,
  axisPresets,
  tolerance = 0.001,
}: {
  axis?: JointVector3;
  axisPresets: Record<string, { axis: JointVector3 }>;
  tolerance?: number;
}) => {
  if (!axis) return "Custom";
  const [x, y, z] = axis;
  for (const [label, preset] of Object.entries(axisPresets)) {
    if (
      Math.abs(preset.axis[0] - x) < tolerance &&
      Math.abs(preset.axis[1] - y) < tolerance &&
      Math.abs(preset.axis[2] - z) < tolerance
    ) {
      return label;
    }
  }
  return "Custom";
};
