import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, MutableRefObject } from "react";

import {
  SIMULATION_PREP_PANEL_WIDTH_PX,
  clampSimulationPrepPanelPosition,
  getSimulationPrepPanelInitialPosition,
  getSimulationPrepPanelWidthPx,
  type SimulationPrepPanelPosition,
} from "@/features/layout/page/simulationPrepPanelParams";

type DragState = {
  originLeft: number;
  originTop: number;
  startX: number;
  startY: number;
};

export type UseSimulationPrepPanelDragResult = {
  handlePanelDragStart: (event: ReactMouseEvent<HTMLDivElement>) => void;
  isDragging: boolean;
  panelPosition: SimulationPrepPanelPosition;
  panelRef: MutableRefObject<HTMLDivElement | null>;
};

const getCurrentViewportWidth = (): number =>
  typeof window === "undefined" ? SIMULATION_PREP_PANEL_WIDTH_PX : window.innerWidth;

const resolvePanelSize = ({
  panelElement,
  viewportWidth,
}: {
  panelElement: HTMLDivElement | null;
  viewportWidth: number;
}) => {
  const panelRect = panelElement?.getBoundingClientRect();
  return {
    width:
      panelRect && panelRect.width > 0
        ? panelRect.width
        : getSimulationPrepPanelWidthPx(viewportWidth),
    height: panelRect?.height ?? 0,
  };
};

export const useSimulationPrepPanelDrag = (
  open: boolean
): UseSimulationPrepPanelDragResult => {
  const [panelPosition, setPanelPosition] = useState<SimulationPrepPanelPosition>(() =>
    getSimulationPrepPanelInitialPosition(getCurrentViewportWidth())
  );
  const [isDragging, setIsDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (!open) {
      setIsDragging(false);
      dragStateRef.current = null;
      return;
    }

    setPanelPosition(getSimulationPrepPanelInitialPosition(getCurrentViewportWidth()));
  }, [open]);

  useEffect(() => {
    if (!open || typeof window === "undefined") {
      return;
    }

    const syncPanelPositionToViewport = () => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const panelSize = resolvePanelSize({
        panelElement: panelRef.current,
        viewportWidth,
      });

      setPanelPosition((currentPosition) =>
        clampSimulationPrepPanelPosition({
          nextLeft: currentPosition.left,
          nextTop: currentPosition.top,
          panelWidth: panelSize.width,
          panelHeight: panelSize.height,
          viewportWidth,
          viewportHeight,
        })
      );
    };

    syncPanelPositionToViewport();
    window.addEventListener("resize", syncPanelPositionToViewport);
    return () => window.removeEventListener("resize", syncPanelPositionToViewport);
  }, [open]);

  useEffect(() => {
    if (!isDragging || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";

    const handleMouseMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const panelSize = resolvePanelSize({
        panelElement: panelRef.current,
        viewportWidth,
      });

      setPanelPosition(
        clampSimulationPrepPanelPosition({
          nextLeft: dragState.originLeft + event.clientX - dragState.startX,
          nextTop: dragState.originTop + event.clientY - dragState.startY,
          panelWidth: panelSize.width,
          panelHeight: panelSize.height,
          viewportWidth,
          viewportHeight,
        })
      );
    };

    const stopDragging = () => {
      dragStateRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopDragging);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopDragging);
    };
  }, [isDragging]);

  const handlePanelDragStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target?.closest("button, a, input, textarea, select")) {
        return;
      }

      event.preventDefault();
      dragStateRef.current = {
        originLeft: panelPosition.left,
        originTop: panelPosition.top,
        startX: event.clientX,
        startY: event.clientY,
      };
      setIsDragging(true);
    },
    [panelPosition.left, panelPosition.top]
  );

  return {
    handlePanelDragStart,
    isDragging,
    panelPosition,
    panelRef,
  };
};
