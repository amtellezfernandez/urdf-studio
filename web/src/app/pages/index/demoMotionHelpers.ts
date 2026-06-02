import type { JointLimits } from "@/shared/lib/urdfBrowser";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import type { URDFRobot } from "urdf-loader";

type ResolveDemoJointNamesParams = {
  availableJoints: string[];
  jointLimits: JointLimits;
  robot: URDFRobot | null;
  urdfAnalysis: UrdfAnalysis | null;
};

export const resolveDemoJointNames = ({
  availableJoints,
  jointLimits,
  robot,
  urdfAnalysis,
}: ResolveDemoJointNamesParams) => {
  const merged: string[] = [];
  const seen = new Set<string>();

  const pushName = (name: string | null | undefined) => {
    const normalized = typeof name === "string" ? name.trim() : "";
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    merged.push(normalized);
  };

  const pushRobotJoints = (filterFixed: boolean) => {
    Object.entries(robot?.joints ?? {}).forEach(([name, joint]) => {
      if (filterFixed && (joint?.jointType ?? "").toLowerCase() === "fixed") return;
      pushName(name);
    });
  };

  urdfAnalysis?.jointHierarchy?.orderedJoints?.forEach((joint) => {
    if ((joint?.type ?? "").toLowerCase() === "fixed") return;
    pushName(joint?.jointName);
  });

  availableJoints.forEach((name) => pushName(name));
  Object.keys(jointLimits ?? {}).forEach((name) => pushName(name));
  pushRobotJoints(true);
  if (merged.length === 0) {
    // Fallback for edge cases where only fixed joints are exposed initially.
    pushRobotJoints(false);
  }

  return merged;
};
