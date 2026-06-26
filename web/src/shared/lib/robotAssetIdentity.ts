const LEKIWI_ROBOT_PATTERN = /lekiwi/i;
const OPENARM_ROBOT_PATTERN = /(^|[^a-z0-9])open[\s_-]?arm([^a-z0-9]|$)/i;

export const isLeKiwiRobotAsset = (
  ...candidates: Array<string | null | undefined>
): boolean =>
  candidates.some(
    (candidate) => typeof candidate === "string" && LEKIWI_ROBOT_PATTERN.test(candidate)
  );

export const isOpenArmRobotAsset = (
  ...candidates: Array<string | null | undefined>
): boolean =>
  candidates.some(
    (candidate) => typeof candidate === "string" && OPENARM_ROBOT_PATTERN.test(candidate)
  );
