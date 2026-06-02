import {
  buildRobotOrientationCard,
  healthCheckUrdf,
  normalizeRobot,
  type AxisSpec,
  type RobotOrientationCard,
} from "@/shared/lib/urdfCore";
import { fixMeshPaths } from "@/shared/lib/urdfBrowser";

export type IluOrientationAlignment = {
  sourceUpAxis: AxisSpec;
  sourceForwardAxis: AxisSpec;
  targetUpAxis: AxisSpec;
  targetForwardAxis: AxisSpec;
};

export const getIluRobotOrientationCard = (
  urdfContent: string
): RobotOrientationCard => buildRobotOrientationCard(urdfContent);

export const checkIluUrdfPhysicsHealth = (urdfContent: string) =>
  healthCheckUrdf(urdfContent);

export const repairMeshPathsWithIlu = (urdfContent: string) =>
  fixMeshPaths(urdfContent);

export const alignUrdfToStudioOrientation = (
  urdfContent: string,
  alignment: IluOrientationAlignment
): string => {
  const result = normalizeRobot(urdfContent, {
    apply: true,
    sourceUpAxis: alignment.sourceUpAxis,
    sourceForwardAxis: alignment.sourceForwardAxis,
    targetUpAxis: alignment.targetUpAxis,
    targetForwardAxis: alignment.targetForwardAxis,
  });

  if (!result.apply || !result.outputUrdf) {
    throw new Error("i-love-urdf normalization did not produce an output URDF.");
  }

  return result.outputUrdf;
};
