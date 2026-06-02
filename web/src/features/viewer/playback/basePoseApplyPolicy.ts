import { hasMeaningfulRobotBasePoseDelta } from "@/shared/lib/robotBasePose";
import type { RobotBasePose } from "@/shared/types/feature";

type ShouldApplyPlaybackBasePoseArgs = {
  isPlaying: boolean;
  currentRobotBasePose: RobotBasePose | null | undefined;
  lastAppliedPlaybackBasePose: RobotBasePose | null | undefined;
  targetFrameBasePose: RobotBasePose | null | undefined;
  translationThresholdMeters: number;
  rotationThresholdRad: number;
};

export const shouldApplyPlaybackBasePose = ({
  isPlaying,
  currentRobotBasePose,
  lastAppliedPlaybackBasePose,
  targetFrameBasePose,
  translationThresholdMeters,
  rotationThresholdRad,
}: ShouldApplyPlaybackBasePoseArgs): boolean => {
  if (!targetFrameBasePose) return false;
  // Use the last playback target as primary baseline so we do not keep
  // re-applying an unchanged frame pose every tick while other runtime systems
  // (for example wheel fallback synthesis) are also updating the robot base.
  // Fallback to current robot pose only before any playback pose has been applied.
  const baselinePose = lastAppliedPlaybackBasePose ?? currentRobotBasePose;
  if (!baselinePose) return true;
  return hasMeaningfulRobotBasePoseDelta(
    baselinePose,
    targetFrameBasePose,
    translationThresholdMeters,
    rotationThresholdRad
  );
};
