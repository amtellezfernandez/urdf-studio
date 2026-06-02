type WheelLocomotionGateInput = {
  isWheelLocomotionArmed: boolean;
  isManualDragActive: boolean;
  isPlaybackActive: boolean;
  isAutoApproachActive: boolean;
};

export const isWheelLocomotionAllowed = ({
  isWheelLocomotionArmed,
  isManualDragActive,
  isPlaybackActive,
  isAutoApproachActive,
}: WheelLocomotionGateInput): boolean =>
  isWheelLocomotionArmed &&
  isManualDragActive &&
  !isPlaybackActive &&
  !isAutoApproachActive;
