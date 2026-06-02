export type DemoMotionWorldPolicyInput = {
  hasLoadedFiles: boolean;
  isLeKiwiDemoRobot: boolean;
};

export const shouldPrepareLeKiwiDemoScene = (
  isLeKiwiDemoRobot: boolean
): boolean => isLeKiwiDemoRobot;

export const shouldPreserveScenarioWorldLayoutOnDemoMotion = ({
  hasLoadedFiles,
  isLeKiwiDemoRobot,
}: DemoMotionWorldPolicyInput): boolean => !hasLoadedFiles || isLeKiwiDemoRobot;
