import { useCallback, useRef, useState } from "react";
import type {
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
} from "react";
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

type ResizePointerDown = { t: number; x: number };

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const getPointerTimestamp = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

const consumeResizeDoubleClick = (
  event: ReactPointerEvent<HTMLDivElement>,
  lastPointerDownRef: MutableRefObject<ResizePointerDown | null>,
  onDoubleClick: () => void,
): boolean => {
  const now = getPointerTimestamp();
  const lastPointerDown = lastPointerDownRef.current;
  if (
    lastPointerDown &&
    now - lastPointerDown.t <=
      JOINT_LIST_SIDEBAR_PARAMS.resizeDoubleClick.maxIntervalMs &&
    Math.abs(event.clientX - lastPointerDown.x) <=
      JOINT_LIST_SIDEBAR_PARAMS.resizeDoubleClick.maxDeltaPx
  ) {
    lastPointerDownRef.current = null;
    onDoubleClick();
    return true;
  }
  lastPointerDownRef.current = { t: now, x: event.clientX };
  return false;
};

const bindWindowResizeDrag = ({
  event,
  cursor,
  onPointerMove,
}: {
  event: ReactPointerEvent<HTMLDivElement>;
  cursor: string;
  onPointerMove: (moveEvent: PointerEvent) => void;
}) => {
  event.preventDefault();
  event.stopPropagation();

  const originalCursor = document.body.style.cursor;
  const originalUserSelect = document.body.style.userSelect;

  document.body.style.cursor = cursor;
  document.body.style.userSelect = "none";

  const handlePointerUp = () => {
    document.body.style.cursor = originalCursor;
    document.body.style.userSelect = originalUserSelect;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", handlePointerUp);
};

export const useLayout = () => {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(
    DEFAULT_RIGHT_SIDEBAR_WIDTH,
  );
  const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(false);
  const [leftSidebarTopPanelHeight, setLeftSidebarTopPanelHeight] = useState(
    DEFAULT_LEFT_SIDEBAR_TOP_PANEL_HEIGHT,
  );
  const lastSidebarResizePointerDownRef = useRef<{
    t: number;
    x: number;
  } | null>(null);
  const lastRightSidebarResizePointerDownRef = useRef<{
    t: number;
    x: number;
  } | null>(null);
  const lastExpandedLeftSidebarTopPanelHeightRef = useRef(
    DEFAULT_LEFT_SIDEBAR_TOP_PANEL_HEIGHT,
  );

  const clampSidebarWidth = useCallback(
    (width: number) => clampNumber(width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH),
    [],
  );

  const clampRightSidebarWidth = useCallback(
    (width: number) =>
      clampNumber(width, RIGHT_SIDEBAR_MIN_WIDTH, RIGHT_SIDEBAR_MAX_WIDTH),
    [],
  );

  const clampLeftSidebarTopPanelHeight = useCallback(
    (height: number, containerHeight: number) => {
      if (!Number.isFinite(height)) {
        return DEFAULT_LEFT_SIDEBAR_TOP_PANEL_HEIGHT;
      }
      if (!Number.isFinite(containerHeight) || containerHeight <= 0) {
        return Math.min(0.95, Math.max(0.05, height));
      }
      const minTopRatio = Math.min(
        0.95,
        MIN_LEFT_SIDEBAR_TOP_PANEL_HEIGHT / containerHeight,
      );
      const maxTopRatioFromCamera =
        1 - MIN_LEFT_SIDEBAR_CAMERA_PANEL_HEIGHT / containerHeight;
      const maxTopRatio = Math.max(
        minTopRatio,
        Math.min(0.95, maxTopRatioFromCamera),
      );
      return Math.min(maxTopRatio, Math.max(minTopRatio, height));
    },
    [],
  );

  const handleSidebarToggle = useCallback(() => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      if (!next) {
        setSidebarWidth((current) => clampSidebarWidth(current));
      }
      return next;
    });
  }, [clampSidebarWidth]);

  const handleRightSidebarToggle = useCallback(() => {
    setIsRightSidebarCollapsed((prev) => {
      const next = !prev;
      if (!next) {
        setRightSidebarWidth((current) => clampRightSidebarWidth(current));
      }
      return next;
    });
  }, [clampRightSidebarWidth]);

  const handleSidebarResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      if (
        consumeResizeDoubleClick(event, lastSidebarResizePointerDownRef, () => {
          setIsSidebarCollapsed(true);
        })
      ) {
        return;
      }

      const startX = event.clientX;
      const startWidth = sidebarWidth;
      bindWindowResizeDrag({
        event,
        cursor: "col-resize",
        onPointerMove: (moveEvent) => {
          const delta = moveEvent.clientX - startX;
          const nextWidth = clampSidebarWidth(startWidth + delta);
          setSidebarWidth(nextWidth);
        },
      });
    },
    [sidebarWidth, clampSidebarWidth],
  );

  const handleRightSidebarResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      if (
        consumeResizeDoubleClick(
          event,
          lastRightSidebarResizePointerDownRef,
          () => {
            setIsRightSidebarCollapsed(true);
          },
        )
      ) {
        return;
      }

      const startX = event.clientX;
      const startWidth = rightSidebarWidth;
      bindWindowResizeDrag({
        event,
        cursor: "col-resize",
        onPointerMove: (moveEvent) => {
          const delta = startX - moveEvent.clientX;
          const nextWidth = clampRightSidebarWidth(startWidth + delta);
          setRightSidebarWidth(nextWidth);
        },
      });
    },
    [rightSidebarWidth, clampRightSidebarWidth],
  );

  const handleLeftSidebarVerticalResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const startY = event.clientY;
      const container = event.currentTarget.closest(
        "[data-left-sidebar-split-container='true']",
      ) as HTMLElement | null;
      if (!container) return;

      const containerHeight = container.clientHeight;
      if (containerHeight <= 0) return;

      if (event.detail >= 2) {
        const target = clampLeftSidebarTopPanelHeight(
          DEFAULT_LEFT_SIDEBAR_TOP_PANEL_HEIGHT,
          containerHeight,
        );
        setLeftSidebarTopPanelHeight(target);
        lastExpandedLeftSidebarTopPanelHeightRef.current = target;
        return;
      }

      const startHeight = clampLeftSidebarTopPanelHeight(
        leftSidebarTopPanelHeight,
        containerHeight,
      );
      bindWindowResizeDrag({
        event,
        cursor: "row-resize",
        onPointerMove: (moveEvent) => {
          const delta = moveEvent.clientY - startY;
          const deltaRatio = delta / containerHeight;
          const nextHeight = clampLeftSidebarTopPanelHeight(
            startHeight + deltaRatio,
            containerHeight,
          );
          setLeftSidebarTopPanelHeight(nextHeight);
          lastExpandedLeftSidebarTopPanelHeightRef.current = nextHeight;
        },
      });
    },
    [leftSidebarTopPanelHeight, clampLeftSidebarTopPanelHeight],
  );

  return {
    sidebarWidth,
    setSidebarWidth,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    rightSidebarWidth,
    setRightSidebarWidth,
    isRightSidebarCollapsed,
    setIsRightSidebarCollapsed,
    leftSidebarTopPanelHeight,
    setLeftSidebarTopPanelHeight,
    clampLeftSidebarTopPanelHeight,
    handleSidebarToggle,
    handleRightSidebarToggle,
    handleSidebarResizeStart,
    handleRightSidebarResizeStart,
    handleLeftSidebarVerticalResizeStart,
  };
};
