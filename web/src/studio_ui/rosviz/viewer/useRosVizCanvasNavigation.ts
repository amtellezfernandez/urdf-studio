import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  type RefObject,
} from "react";

import {
  clampPixelsPerMeter,
  INITIAL_VIEW_TRANSFORM,
  ROSVIZ_CANVAS_PIXELS_PER_METER,
  type ViewTransform,
} from "@/studio_core/scene/rosViz2dSceneParams";

type DragState = {
  active: boolean;
  pointerId: number;
  lastClientX: number;
  lastClientY: number;
};

export type RosVizCanvasNavigation = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  viewTransform: ViewTransform;
  isPanning: boolean;
  zoomPercent: number;
  resetView: () => void;
  stopPanning: () => void;
  handleCanvasWheel: (event: ReactWheelEvent<HTMLCanvasElement>) => void;
  handleCanvasPointerDown: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  handleCanvasPointerMove: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  handleCanvasPointerUp: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
};

export const useRosVizCanvasNavigation = (): RosVizCanvasNavigation => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragStateRef = useRef<DragState>({
    active: false,
    pointerId: -1,
    lastClientX: 0,
    lastClientY: 0,
  });

  const [viewTransform, setViewTransform] = useState<ViewTransform>(INITIAL_VIEW_TRANSFORM);
  const [isPanning, setIsPanning] = useState(false);

  const zoomPercent = useMemo(
    () => Math.round((viewTransform.pixelsPerMeter / ROSVIZ_CANVAS_PIXELS_PER_METER) * 100),
    [viewTransform.pixelsPerMeter]
  );

  const resetView = useCallback(() => {
    setViewTransform(INITIAL_VIEW_TRANSFORM);
  }, []);

  const stopPanning = useCallback(() => {
    const dragState = dragStateRef.current;
    dragState.active = false;
    dragState.pointerId = -1;
    setIsPanning(false);
  }, []);

  const handleCanvasWheel = useCallback((event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(canvas.clientWidth));
    const height = Math.max(1, Math.floor(canvas.clientHeight));
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;

    setViewTransform((current) => {
      const nextPixelsPerMeter = clampPixelsPerMeter(current.pixelsPerMeter * zoomFactor);
      if (nextPixelsPerMeter === current.pixelsPerMeter) {
        return current;
      }

      const currentCenterX = width / 2 + current.offsetX;
      const currentCenterY = height / 2 + current.offsetY;
      const worldX = (cursorX - currentCenterX) / current.pixelsPerMeter;
      const worldY = (currentCenterY - cursorY) / current.pixelsPerMeter;

      const nextCenterX = cursorX - worldX * nextPixelsPerMeter;
      const nextCenterY = cursorY + worldY * nextPixelsPerMeter;

      return {
        pixelsPerMeter: nextPixelsPerMeter,
        offsetX: nextCenterX - width / 2,
        offsetY: nextCenterY - height / 2,
      };
    });
  }, []);

  const handleCanvasPointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    dragStateRef.current = {
      active: true,
      pointerId: event.pointerId,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
    };
    canvas.setPointerCapture(event.pointerId);
    setIsPanning(true);
  }, []);

  const handleCanvasPointerMove = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState.active || dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragState.lastClientX;
    const deltaY = event.clientY - dragState.lastClientY;
    dragState.lastClientX = event.clientX;
    dragState.lastClientY = event.clientY;

    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    setViewTransform((current) => ({
      ...current,
      offsetX: current.offsetX + deltaX,
      offsetY: current.offsetY + deltaY,
    }));
  }, []);

  const handleCanvasPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (canvas && canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      stopPanning();
    },
    [stopPanning]
  );

  return {
    canvasRef,
    viewTransform,
    isPanning,
    zoomPercent,
    resetView,
    stopPanning,
    handleCanvasWheel,
    handleCanvasPointerDown,
    handleCanvasPointerMove,
    handleCanvasPointerUp,
  };
};
