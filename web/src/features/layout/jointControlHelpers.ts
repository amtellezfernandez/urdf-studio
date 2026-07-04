import { analyzeUrdf } from "@/shared/lib/urdfCore";
import {
  getUrdfElementByName,
  parseUrdfDocument,
  type UrdfParseOptions,
  type UrdfAnalysis,
} from "@/shared/lib/urdfBrowser";
import { parseVector3 } from "@/features/urdf/editor/link-editor/sizeUtils";

export type JointVector3 = [number, number, number];

const DEFAULT_ORIGIN: { xyz: JointVector3; rpy: JointVector3 } = {
  xyz: [0, 0, 0],
  rpy: [0, 0, 0],
};

export const parseJointNumericInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
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
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
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
