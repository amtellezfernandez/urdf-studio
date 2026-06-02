import { PLAYBACK_JOINT_STORE_SYNC_INTERVAL_MS } from "@/features/viewer/playback/playbackParams";

const hasPlaybackJointSubsetChanged = ({
  frameLockedJoints,
  storeJointValues,
}: {
  frameLockedJoints: Record<string, number>;
  storeJointValues: Record<string, number>;
}) =>
  Object.entries(frameLockedJoints).some(
    ([jointName, jointValue]) => storeJointValues[jointName] !== jointValue
  );

export const shouldSyncPlaybackJointStore = ({
  frameLockedJoints,
  storeJointValues,
  isPlaying,
  reachedPlaybackEnd,
  nowMs,
  lastSyncTimeMs,
}: {
  frameLockedJoints: Record<string, number>;
  storeJointValues: Record<string, number>;
  isPlaying: boolean;
  reachedPlaybackEnd: boolean;
  nowMs: number;
  lastSyncTimeMs: number | null;
}) => {
  if (Object.keys(frameLockedJoints).length === 0) {
    return false;
  }
  if (
    !hasPlaybackJointSubsetChanged({
      frameLockedJoints,
      storeJointValues,
    })
  ) {
    return false;
  }
  if (!isPlaying || reachedPlaybackEnd) {
    return true;
  }
  if (lastSyncTimeMs === null) {
    return true;
  }
  return nowMs - lastSyncTimeMs >= PLAYBACK_JOINT_STORE_SYNC_INTERVAL_MS;
};
