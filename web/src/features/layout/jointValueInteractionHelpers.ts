const JOINT_VALUE_INTERACTION_PARAMS = {
  drag: {
    directionThresholdPx: 3,
    horizontalCursor: "ew-resize",
    verticalCursor: "ns-resize",
  },
} as const;

export type DragDirection = "vertical" | "horizontal" | "undecided";

export const resolveJointDragDirection = ({
  deltaX,
  deltaY,
  previousDirection,
}: {
  deltaX: number;
  deltaY: number;
  previousDirection: DragDirection;
}): DragDirection => {
  if (previousDirection !== "undecided") {
    return previousDirection;
  }

  const passedThreshold =
    Math.abs(deltaX) > JOINT_VALUE_INTERACTION_PARAMS.drag.directionThresholdPx ||
    Math.abs(deltaY) > JOINT_VALUE_INTERACTION_PARAMS.drag.directionThresholdPx;
  if (!passedThreshold) {
    return "undecided";
  }

  return Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
};

export const resolveJointDragCursor = (direction: DragDirection): string =>
  direction === "horizontal"
    ? JOINT_VALUE_INTERACTION_PARAMS.drag.horizontalCursor
    : JOINT_VALUE_INTERACTION_PARAMS.drag.verticalCursor;

export const resolveJointDragDelta = ({
  deltaX,
  deltaY,
  direction,
}: {
  deltaX: number;
  deltaY: number;
  direction: DragDirection;
}): number => (direction === "horizontal" ? deltaX : deltaY);

export const isJointResetShortcut = ({
  altKey,
  key,
}: {
  altKey: boolean;
  key: string;
}): boolean => altKey && (key.toLowerCase() === "r" || key === "0");
