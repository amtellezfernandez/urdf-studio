import { OBJECT_TARGET_CLICK_PARAMS } from "@/features/viewer/objectTargetClickParams";

export const isObjectTargetInteractionActive = ({
  isIkRunning,
  isIkTrajectoryApplying,
  isFollowingOrbit,
}: {
  isIkRunning: boolean;
  isIkTrajectoryApplying: boolean;
  isFollowingOrbit: boolean;
}): boolean => isIkRunning || isIkTrajectoryApplying || isFollowingOrbit;

export const shouldShowRoverApproachGuideForSelectedObject = ({
  hasActiveObjectTargetInteraction,
  selectedObject,
}: {
  hasActiveObjectTargetInteraction: boolean;
  selectedObject:
    | {
        isHidden?: boolean;
        source?: string;
      }
    | null;
}): boolean => {
  if (!hasActiveObjectTargetInteraction || !selectedObject) {
    return false;
  }
  if (selectedObject.isHidden === true) {
    return false;
  }
  return false;
};

export const shouldMoveToObjectOnSingleClick = ({
  hasIkTargetClickHandler,
  editable,
  enableObjectActionsInReadOnly,
  allowRetargetOnClick,
}: {
  hasIkTargetClickHandler: boolean;
  editable: boolean;
  enableObjectActionsInReadOnly: boolean;
  allowRetargetOnClick: boolean;
}): boolean => {
  if (!hasIkTargetClickHandler) {
    return false;
  }
  if (!editable && enableObjectActionsInReadOnly) {
    return true;
  }
  return editable && allowRetargetOnClick;
};

export const shouldToggleObjectSelectionOnSingleClick = ({
  hasIkTargetClickHandler,
  selectedObjectId,
  clickedObjectId,
}: {
  hasIkTargetClickHandler: boolean;
  selectedObjectId: string | null;
  clickedObjectId: string;
}): boolean => {
  if (!hasIkTargetClickHandler) {
    return true;
  }
  return selectedObjectId !== clickedObjectId;
};

export const shouldMoveToObjectOnRepeatedClick = ({
  hasIkTargetClickHandler,
  selectedObjectId,
  clickedObjectId,
  clickDetail,
  previousClickedObjectId,
  previousClickTimeMs,
  clickTimeMs,
}: {
  hasIkTargetClickHandler: boolean;
  selectedObjectId: string | null;
  clickedObjectId: string;
  clickDetail: number;
  previousClickedObjectId: string | null;
  previousClickTimeMs: number | null;
  clickTimeMs: number;
}): boolean => {
  if (!hasIkTargetClickHandler || selectedObjectId !== clickedObjectId) {
    return false;
  }
  if (Number.isFinite(clickDetail) && clickDetail >= 2) {
    return true;
  }
  if (
    previousClickedObjectId !== clickedObjectId ||
    !Number.isFinite(previousClickTimeMs) ||
    !Number.isFinite(clickTimeMs)
  ) {
    return false;
  }
  return (
    clickTimeMs - (previousClickTimeMs as number) <=
    OBJECT_TARGET_CLICK_PARAMS.repeatedTouchWindowMs
  );
};
