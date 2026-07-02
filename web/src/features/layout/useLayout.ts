import { useCallback, useRef, useState } from "react";
import type React from "react";
import {
  DEFAULT_RIGHT_SIDEBAR_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
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

export const useLayout = () => {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(DEFAULT_RIGHT_SIDEBAR_WIDTH);
  const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(false);
  const [leftSidebarTopPanelHeight, setLeftSidebarTopPanelHeight] = useState(
    DEFAULT_LEFT_SIDEBAR_TOP_PANEL_HEIGHT
  );
  const lastSidebarResizePointerDownRef = useRef<{ t: number; x: number } | null>(null);
  const lastRightSidebarResizePointerDownRef = useRef<{ t: number; x: number } | null>(null);
  const lastExpandedLeftSidebarTopPanelHeightRef = useRef(
    DEFAULT_LEFT_SIDEBAR_TOP_PANEL_HEIGHT
  );

  const clampSidebarWidth = useCallback(
    (width: number) => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)),
    []
  );

  const clampRightSidebarWidth = useCallback(
    (width: number) => Math.min(RIGHT_SIDEBAR_MAX_WIDTH, Math.max(RIGHT_SIDEBAR_MIN_WIDTH, width)),
    []
  );

  const clampLeftSidebarTopPanelHeight = useCallback((height: number, containerHeight: number) => {
    if (!Number.isFinite(height)) {
      return DEFAULT_LEFT_SIDEBAR_TOP_PANEL_HEIGHT;
    }
    if (!Number.isFinite(containerHeight) || containerHeight <= 0) {
      return Math.min(0.95, Math.max(0.05, height));
    }
    const minTopRatio = Math.min(0.95, MIN_LEFT_SIDEBAR_TOP_PANEL_HEIGHT / containerHeight);
    const maxTopRatioFromCamera =
      1 - MIN_LEFT_SIDEBAR_CAMERA_PANEL_HEIGHT / containerHeight;
    const maxTopRatio = Math.max(minTopRatio, Math.min(0.95, maxTopRatioFromCamera));
    return Math.min(maxTopRatio, Math.max(minTopRatio, height));
  }, []);

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
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const lastPointerDown = lastSidebarResizePointerDownRef.current;
      if (
        lastPointerDown &&
        now - lastPointerDown.t <= 320 &&
        Math.abs(event.clientX - lastPointerDown.x) <= 8
      ) {
        lastSidebarResizePointerDownRef.current = null;
        setIsSidebarCollapsed(true);
        return;
      }
      lastSidebarResizePointerDownRef.current = { t: now, x: event.clientX };

      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const startWidth = sidebarWidth;
      const originalCursor = document.body.style.cursor;
      const originalUserSelect = document.body.style.userSelect;

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - startX;
        const nextWidth = clampSidebarWidth(startWidth + delta);
        setSidebarWidth(nextWidth);
      };

      const handlePointerUp = () => {
        document.body.style.cursor = originalCursor;
        document.body.style.userSelect = originalUserSelect;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [sidebarWidth, clampSidebarWidth]
  );

  const handleRightSidebarResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const lastPointerDown = lastRightSidebarResizePointerDownRef.current;
      if (
        lastPointerDown &&
        now - lastPointerDown.t <= 320 &&
        Math.abs(event.clientX - lastPointerDown.x) <= 8
      ) {
        lastRightSidebarResizePointerDownRef.current = null;
        setIsRightSidebarCollapsed(true);
        return;
      }
      lastRightSidebarResizePointerDownRef.current = { t: now, x: event.clientX };

      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const startWidth = rightSidebarWidth;
      const originalCursor = document.body.style.cursor;
      const originalUserSelect = document.body.style.userSelect;

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const delta = startX - moveEvent.clientX;
        const nextWidth = clampRightSidebarWidth(startWidth + delta);
        setRightSidebarWidth(nextWidth);
      };

      const handlePointerUp = () => {
        document.body.style.cursor = originalCursor;
        document.body.style.userSelect = originalUserSelect;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [rightSidebarWidth, clampRightSidebarWidth]
  );

  const handleLeftSidebarVerticalResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const startY = event.clientY;
      const container = event.currentTarget.closest(
        "[data-left-sidebar-split-container='true']"
      ) as HTMLElement | null;
      if (!container) return;

      const containerHeight = container.clientHeight;
      if (containerHeight <= 0) return;

      if (event.detail >= 2) {
        const target = clampLeftSidebarTopPanelHeight(
          DEFAULT_LEFT_SIDEBAR_TOP_PANEL_HEIGHT,
          containerHeight
        );
        setLeftSidebarTopPanelHeight(target);
        lastExpandedLeftSidebarTopPanelHeightRef.current = target;
        return;
      }

      const startHeight = clampLeftSidebarTopPanelHeight(
        leftSidebarTopPanelHeight,
        containerHeight
      );
      const originalCursor = document.body.style.cursor;
      const originalUserSelect = document.body.style.userSelect;

      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientY - startY;
        const deltaRatio = delta / containerHeight;
        const nextHeight = clampLeftSidebarTopPanelHeight(startHeight + deltaRatio, containerHeight);
        setLeftSidebarTopPanelHeight(nextHeight);
        lastExpandedLeftSidebarTopPanelHeightRef.current = nextHeight;
      };

      const handlePointerUp = () => {
        document.body.style.cursor = originalCursor;
        document.body.style.userSelect = originalUserSelect;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [leftSidebarTopPanelHeight, clampLeftSidebarTopPanelHeight]
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
