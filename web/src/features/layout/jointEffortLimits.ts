import { parseUrdfDocument } from "@/shared/lib/urdfBrowser";

const parsePositiveJointLimitValue = (value: string | null): number | null => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null;
};

export const parseJointEffortLimits = (
  urdfContent?: string
): Record<string, number | null> => {
  if (!urdfContent) {
    return {};
  }
  const xmlDoc = parseUrdfDocument(urdfContent, {
    onParseError: () => {},
    onRobotMissing: () => {},
    onXacroDetected: () => {},
    onOversize: () => {},
    onDepthExceeded: () => {},
  });
  if (!xmlDoc) {
    return {};
  }

  const jointEffortLimits: Record<string, number | null> = {};
  Array.from(xmlDoc.querySelectorAll("robot > joint[name]")).forEach((joint) => {
    const jointName = joint.getAttribute("name");
    if (!jointName) return;
    jointEffortLimits[jointName] = parsePositiveJointLimitValue(
      joint.querySelector("limit")?.getAttribute("effort") ?? null
    );
  });
  return jointEffortLimits;
};
