import {
  DEFAULT_RIGHT_SIDEBAR_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  JOINT_LIST_SIDEBAR_PARAMS,
  RIGHT_SIDEBAR_MAX_WIDTH,
  RIGHT_SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "@/features/layout/jointListSidebarParams";
import {
  DEFAULT_LEFT_SIDEBAR_TOP_PANEL_HEIGHT,
  MIN_LEFT_SIDEBAR_CAMERA_PANEL_HEIGHT,
  MIN_LEFT_SIDEBAR_TOP_PANEL_HEIGHT,
} from "@/features/layout/page/constants";

export type ResizePointerDown = { t: number; x: number };

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const clampSidebarWidth = (width: number): number =>
  clampNumber(width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);

export const clampRightSidebarWidth = (width: number): number =>
  clampNumber(width, RIGHT_SIDEBAR_MIN_WIDTH, RIGHT_SIDEBAR_MAX_WIDTH);

export const clampLeftSidebarTopPanelHeight = (
  height: number,
  containerHeight: number
): number => {
  if (!Number.isFinite(height)) {
    return DEFAULT_LEFT_SIDEBAR_TOP_PANEL_HEIGHT;
  }
  if (!Number.isFinite(containerHeight) || containerHeight <= 0) {
    return Math.min(0.95, Math.max(0.05, height));
  }

  const minTopRatio = Math.min(
    0.95,
    MIN_LEFT_SIDEBAR_TOP_PANEL_HEIGHT / containerHeight
  );
  const maxTopRatioFromCamera = 1 - MIN_LEFT_SIDEBAR_CAMERA_PANEL_HEIGHT / containerHeight;
  const maxTopRatio = Math.max(minTopRatio, Math.min(0.95, maxTopRatioFromCamera));

  return Math.min(maxTopRatio, Math.max(minTopRatio, height));
};

export const getPointerTimestamp = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

export const resolveResizeDoubleClick = ({
  currentTimestamp,
  pointerX,
  previousPointerDown,
}: {
  currentTimestamp: number;
  pointerX: number;
  previousPointerDown: ResizePointerDown | null;
}): {
  consumedDoubleClick: boolean;
  nextPointerDown: ResizePointerDown | null;
} => {
  if (
    previousPointerDown &&
    currentTimestamp - previousPointerDown.t <=
      JOINT_LIST_SIDEBAR_PARAMS.resizeDoubleClick.maxIntervalMs &&
    Math.abs(pointerX - previousPointerDown.x) <=
      JOINT_LIST_SIDEBAR_PARAMS.resizeDoubleClick.maxDeltaPx
  ) {
    return {
      consumedDoubleClick: true,
      nextPointerDown: null,
    };
  }

  return {
    consumedDoubleClick: false,
    nextPointerDown: { t: currentTimestamp, x: pointerX },
  };
};

export const resolveExpandedSidebarWidth = (width: number): number =>
  clampSidebarWidth(width || DEFAULT_SIDEBAR_WIDTH);

export const resolveExpandedRightSidebarWidth = (width: number): number =>
  clampRightSidebarWidth(width || DEFAULT_RIGHT_SIDEBAR_WIDTH);
