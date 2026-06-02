import { IK_DRAG_HANDLE_VISUAL_CONFIG } from "@/features/viewer/config";

type IkDragHandleVisualState = {
  affectsHardware: boolean;
  isClamped: boolean;
  isDragging: boolean;
  isHovered: boolean;
};

export const resolveIkDragHandleColor = ({
  affectsHardware,
  isClamped,
  isDragging,
  isHovered,
}: IkDragHandleVisualState): string => {
  const { colors } = IK_DRAG_HANDLE_VISUAL_CONFIG;

  if (isClamped) return colors.clamped;
  if (affectsHardware) {
    return isHovered || isDragging ? colors.hardwareHover : colors.hardwareActive;
  }
  if (isDragging) return colors.dragging;
  if (isHovered) return colors.hover;
  return colors.default;
};

export const resolveIkDragHandleOpacity = ({
  isClamped,
  isDragging,
  isHovered,
}: IkDragHandleVisualState): number => {
  const { opacity } = IK_DRAG_HANDLE_VISUAL_CONFIG;

  if (isClamped || isDragging) return opacity.draggingOrClamped;
  if (isHovered) return opacity.hover;
  return opacity.idle;
};
