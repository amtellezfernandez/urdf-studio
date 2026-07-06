import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { DEG_TO_RAD } from "@/shared/lib/angleConversions";
import { clampNumberToOptionalBounds, toFiniteNumberOrNull } from "@/shared/lib/numeric";
import { lockDocumentBodyInteraction } from "@/features/layout/documentBodyInteractionLock";
import {
  isJointResetShortcut,
  resolveJointDragCursor,
  resolveJointDragDelta,
  resolveJointDragDirection,
  type DragDirection,
} from "@/features/layout/jointValueInteractionHelpers";

const JOINT_VALUE_INTERACTION_PARAMS = {
  drag: {
    defaultSensitivityRad: 0.005,
    rangeSensitivityDivisor: 800,
    fineMultiplier: 0.2,
    initialCursor: "ns-resize",
  },
  step: {
    fineDeg: 0.1,
    defaultDeg: 1,
    coarseDeg: 10,
  },
  snap: {
    incrementDeg: 5,
  },
} as const;

interface JointValueDragState {
  startX: number;
  startY: number;
  startValue: number;
}

interface JointValueInteractionOptions {
  clampLower: number;
  clampUpper: number;
  disabled?: boolean;
  displayMax: number;
  displayMin: number;
  onValueChange: (value: number) => void;
  resolvedValue: number;
}

interface ApplyJointValueOptions {
  snap?: boolean;
}

export const clampJointValue = (value: number, lower: number, upper: number): number => {
  const finiteLower = toFiniteNumberOrNull(lower);
  const finiteUpper = toFiniteNumberOrNull(upper);
  return clampNumberToOptionalBounds(value, {
    min: finiteLower ?? undefined,
    max: finiteUpper ?? undefined,
  });
};

export const snapJointValue = (value: number, shouldSnap: boolean): number => {
  if (!shouldSnap) return value;
  const snapIncrementRad = JOINT_VALUE_INTERACTION_PARAMS.snap.incrementDeg * DEG_TO_RAD;
  return Math.round(value / snapIncrementRad) * snapIncrementRad;
};

export const getJointDragSensitivityRad = (
  displayMin: number,
  displayMax: number,
  isFine: boolean
): number => {
  const displayRange = displayMax - displayMin;
  let sensitivity =
    !Number.isFinite(displayRange) || displayRange === 0
      ? JOINT_VALUE_INTERACTION_PARAMS.drag.defaultSensitivityRad
      : displayRange / JOINT_VALUE_INTERACTION_PARAMS.drag.rangeSensitivityDivisor;

  if (isFine) {
    sensitivity *= JOINT_VALUE_INTERACTION_PARAMS.drag.fineMultiplier;
  }

  return sensitivity;
};

export const getJointStepRad = (isFine: boolean, isCoarse: boolean): number => {
  const stepDeg = isCoarse
    ? JOINT_VALUE_INTERACTION_PARAMS.step.coarseDeg
    : isFine
      ? JOINT_VALUE_INTERACTION_PARAMS.step.fineDeg
      : JOINT_VALUE_INTERACTION_PARAMS.step.defaultDeg;
  return stepDeg * DEG_TO_RAD;
};

export const useJointValueInteraction = ({
  clampLower,
  clampUpper,
  disabled = false,
  displayMax,
  displayMin,
  onValueChange,
  resolvedValue,
}: JointValueInteractionOptions) => {
  const valueDisplayRef = useRef<HTMLSpanElement>(null);
  const [isValueFocused, setIsValueFocused] = useState(false);
  const isDraggingValue = useRef(false);
  const dragDirection = useRef<DragDirection>("undecided");
  const releaseDocumentBodyInteractionRef = useRef<(() => void) | null>(null);
  const dragState = useRef<JointValueDragState>({
    startX: 0,
    startY: 0,
    startValue: resolvedValue,
  });

  const clampValue = useCallback(
    (value: number) => clampJointValue(value, clampLower, clampUpper),
    [clampLower, clampUpper]
  );

  const applyValueChange = useCallback(
    (value: number, options?: ApplyJointValueOptions) => {
      const snapped = snapJointValue(value, Boolean(options?.snap));
      const clamped = clampValue(snapped);
      if (Number.isFinite(clamped) && clamped === resolvedValue) return;
      onValueChange(clamped);
    },
    [clampValue, onValueChange, resolvedValue]
  );

  const handleValueMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!isDraggingValue.current) return;
      event.preventDefault();

      if (event.altKey) {
        applyValueChange(0);
        return;
      }

      const deltaX = event.clientX - dragState.current.startX;
      const deltaY = dragState.current.startY - event.clientY;

      const nextDirection = resolveJointDragDirection({
        deltaX,
        deltaY,
        previousDirection: dragDirection.current,
      });
      if (nextDirection !== dragDirection.current) {
        dragDirection.current = nextDirection;
        if (nextDirection !== "undecided") {
          releaseDocumentBodyInteractionRef.current?.();
          releaseDocumentBodyInteractionRef.current = lockDocumentBodyInteraction({
            cursor: resolveJointDragCursor(nextDirection),
          });
        }
      }

      const dragDelta = resolveJointDragDelta({
        deltaX,
        deltaY,
        direction: dragDirection.current,
      });
      const sensitivity = getJointDragSensitivityRad(displayMin, displayMax, event.shiftKey);
      applyValueChange(dragState.current.startValue + dragDelta * sensitivity, {
        snap: event.ctrlKey,
      });
    },
    [applyValueChange, displayMax, displayMin]
  );

  const handleValueMouseUp = useCallback(
    (event: MouseEvent) => {
      if (!isDraggingValue.current) return;
      if (event.type === "mouseup") {
        event.preventDefault();
      }
      window.removeEventListener("mousemove", handleValueMouseMove);
      window.removeEventListener("mouseup", handleValueMouseUp);
      releaseDocumentBodyInteractionRef.current?.();
      releaseDocumentBodyInteractionRef.current = null;
      isDraggingValue.current = false;
      dragDirection.current = "undecided";
    },
    [handleValueMouseMove]
  );

  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", handleValueMouseMove);
      window.removeEventListener("mouseup", handleValueMouseUp);
      if (isDraggingValue.current) {
        releaseDocumentBodyInteractionRef.current?.();
        releaseDocumentBodyInteractionRef.current = null;
        isDraggingValue.current = false;
        dragDirection.current = "undecided";
      }
    };
  }, [handleValueMouseMove, handleValueMouseUp]);

  const handleValueMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLSpanElement>) => {
      if (disabled) return;
      if (event.button !== 0 && event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();

      if (event.altKey) {
        applyValueChange(0);
        return;
      }

      valueDisplayRef.current?.focus();

      isDraggingValue.current = true;
      dragDirection.current = "undecided";
      dragState.current = {
        startX: event.clientX,
        startY: event.clientY,
        startValue: resolvedValue,
      };

      releaseDocumentBodyInteractionRef.current?.();
      releaseDocumentBodyInteractionRef.current = lockDocumentBodyInteraction({
        cursor: JOINT_VALUE_INTERACTION_PARAMS.drag.initialCursor,
      });
      window.addEventListener("mousemove", handleValueMouseMove);
      window.addEventListener("mouseup", handleValueMouseUp);
    },
    [applyValueChange, disabled, handleValueMouseMove, handleValueMouseUp, resolvedValue]
  );

  const handleValueWheel = useCallback(
    (event: ReactWheelEvent<HTMLSpanElement>) => {
      if (disabled || !isValueFocused) return;
      event.preventDefault();
      event.stopPropagation();

      if (event.altKey) {
        applyValueChange(0);
        return;
      }

      const direction = event.deltaY < 0 ? 1 : -1;
      applyValueChange(resolvedValue + getJointStepRad(event.shiftKey, event.ctrlKey) * direction);
    },
    [applyValueChange, disabled, isValueFocused, resolvedValue]
  );

  const handleValueKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLSpanElement>) => {
      if (disabled) return;

      if (["ArrowUp", "ArrowRight", "PageUp"].includes(event.key)) {
        event.preventDefault();
        applyValueChange(resolvedValue + getJointStepRad(event.shiftKey, event.ctrlKey), {
          snap: event.ctrlKey,
        });
      } else if (["ArrowDown", "ArrowLeft", "PageDown"].includes(event.key)) {
        event.preventDefault();
        applyValueChange(resolvedValue - getJointStepRad(event.shiftKey, event.ctrlKey), {
          snap: event.ctrlKey,
        });
      } else if (event.key === "Home" && Number.isFinite(clampLower)) {
        event.preventDefault();
        applyValueChange(clampLower, { snap: event.ctrlKey });
      } else if (event.key === "End" && Number.isFinite(clampUpper)) {
        event.preventDefault();
        applyValueChange(clampUpper, { snap: event.ctrlKey });
      } else if (isJointResetShortcut({ altKey: event.altKey, key: event.key })) {
        event.preventDefault();
        applyValueChange(0);
      }
    },
    [applyValueChange, clampLower, clampUpper, disabled, resolvedValue]
  );

  return {
    clampValue,
    handleValueKeyDown,
    handleValueMouseDown,
    handleValueWheel,
    setIsValueFocused,
    valueDisplayRef,
  };
};
