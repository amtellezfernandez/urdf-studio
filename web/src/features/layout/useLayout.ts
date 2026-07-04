import { useCallback, useRef, useState } from "react";
import type {
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  DEFAULT_RIGHT_SIDEBAR_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
} from "@/features/layout/jointListSidebarParams";
import { DEFAULT_LEFT_SIDEBAR_TOP_PANEL_HEIGHT } from "@/features/layout/page/constants";
import {
  clampLeftSidebarTopPanelHeight,
  clampRightSidebarWidth,
  clampSidebarWidth,
  getPointerTimestamp,
  resolveExpandedRightSidebarWidth,
  resolveExpandedSidebarWidth,
  resolveResizeDoubleClick,
  type ResizePointerDown,
} from "@/features/layout/layoutResizeHelpers";

const consumeResizeDoubleClick = (
  event: ReactPointerEvent<HTMLDivElement>,
  lastPointerDownRef: MutableRefObject<ResizePointerDown | null>,
  handleDoubleClick: () => void,
): boolean => {
  const result = resolveResizeDoubleClick({
    currentTimestamp: getPointerTimestamp(),
    pointerX: event.clientX,
    previousPointerDown: lastPointerDownRef.current,
  });
  lastPointerDownRef.current = result.nextPointerDown;
  if (result.consumedDoubleClick) {
    lastPointerDownRef.current = null;
    handleDoubleClick();
    return true;
  }
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

  const handleSidebarToggle = useCallback(() => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      if (!next) {
        setSidebarWidth((current) => resolveExpandedSidebarWidth(current));
      }
      return next;
    });
  }, []);

  const handleRightSidebarToggle = useCallback(() => {
    setIsRightSidebarCollapsed((prev) => {
      const next = !prev;
      if (!next) {
        setRightSidebarWidth((current) => resolveExpandedRightSidebarWidth(current));
      }
      return next;
    });
  }, []);

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
    [sidebarWidth],
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
    [rightSidebarWidth],
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
    [leftSidebarTopPanelHeight],
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
