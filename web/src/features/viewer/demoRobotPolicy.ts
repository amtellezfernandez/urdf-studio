import type { AnimationFrame } from "@/features/viewer/viewer-types";
export {
  isLeKiwiRobotAsset,
  isOpenArmRobotAsset,
} from "@/shared/lib/robotAssetIdentity";

type ResolveRemountPreservedFrameTimestampParams = {
  animationFrames: AnimationFrame[] | null;
  currentFrameIndex: number;
};

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
