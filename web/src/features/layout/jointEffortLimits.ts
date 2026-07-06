import { parsePositiveScalar } from "@/features/layout/jointLimitDebugState";
import { parseUrdfDocument } from "@/shared/lib/urdfBrowser";

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
    jointEffortLimits[jointName] = parsePositiveScalar(
      joint.querySelector("limit")?.getAttribute("effort") ?? null
    );
  });
  return jointEffortLimits;
};
