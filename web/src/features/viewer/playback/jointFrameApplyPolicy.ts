type ShouldApplyFrameLockedJointsArgs = {
  shouldApplyAnimation: boolean;
  shouldForceApplyDataZeroOffset: boolean;
  skipForManualDragOverride: boolean;
  hasManualJointChanges: boolean;
  isPlaying: boolean;
};

export const shouldApplyFrameLockedJoints = ({
  shouldApplyAnimation,
  shouldForceApplyDataZeroOffset,
  skipForManualDragOverride,
  hasManualJointChanges,
  isPlaying,
}: ShouldApplyFrameLockedJointsArgs): boolean => {
  if (skipForManualDragOverride) {
    return false;
  }
  if (hasManualJointChanges && !isPlaying && !shouldForceApplyDataZeroOffset) {
    return false;
  }
  return shouldApplyAnimation || shouldForceApplyDataZeroOffset;
};
