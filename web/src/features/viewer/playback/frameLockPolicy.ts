type ResolveManualFrameLockApplyArgs = {
  isPlaying: boolean;
  consumedPreservedFrameTime: boolean;
  pausedManualFrameTimeChanged: boolean;
};

export const shouldApplyManualFrameLock = ({
  isPlaying,
  consumedPreservedFrameTime,
  pausedManualFrameTimeChanged,
}: ResolveManualFrameLockApplyArgs): boolean => {
  if (isPlaying) {
    return true;
  }
  return consumedPreservedFrameTime || pausedManualFrameTimeChanged;
};
