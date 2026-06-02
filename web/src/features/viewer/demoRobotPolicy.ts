import type { AnimationFrame } from "@/features/viewer/viewer-types";

const LEKIWI_ROBOT_PATTERN = /lekiwi/i;
const OPENARM_ROBOT_PATTERN = /(^|[^a-z0-9])open[\s_-]?arm([^a-z0-9]|$)/i;

type ResolveRemountPreservedFrameTimestampParams = {
  animationFrames: AnimationFrame[] | null;
  currentFrameIndex: number;
};

export const isLeKiwiRobotAsset = (...candidates: Array<string | null | undefined>): boolean =>
  candidates.some((candidate) => typeof candidate === "string" && LEKIWI_ROBOT_PATTERN.test(candidate));

export const isOpenArmRobotAsset = (
  ...candidates: Array<string | null | undefined>
): boolean =>
  candidates.some((candidate) => typeof candidate === "string" && OPENARM_ROBOT_PATTERN.test(candidate));

export const resolveRemountPreservedFrameTimestamp = ({
  animationFrames,
  currentFrameIndex,
}: ResolveRemountPreservedFrameTimestampParams): number | null => {
  if (!animationFrames || animationFrames.length === 0) {
    return null;
  }

  const clampedIndex = Math.max(0, Math.min(currentFrameIndex, animationFrames.length - 1));
  const timestamp = animationFrames[clampedIndex]?.timestamp;
  return Number.isFinite(timestamp) ? timestamp ?? null : null;
};
