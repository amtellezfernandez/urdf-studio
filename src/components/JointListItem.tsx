import { useRef, useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { JointLimitInfo } from "@/urdf_corrections/parseJointLimits";
import jointColors from "@/joint_colors.json";
import { getJointColor } from "@/utils/jointColors";

const LIGHT_GREEN = "#bbf7d0";
const LIGHT_YELLOW = "#fef3c7";
const LIGHT_RED = "#fecaca";

const hexToRgb = (hex: string) => {
  const normalized = hex.replace("#", "");
  const bigint = parseInt(normalized, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
};

const rgbToHex = (r: number, g: number, b: number) => {
  const toHex = (value: number) => value.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const interpolateColor = (start: string, end: string, t: number) => {
  const startRgb = hexToRgb(start);
  const endRgb = hexToRgb(end);
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const factor = clamp(t);

  const r = Math.round(startRgb.r + (endRgb.r - startRgb.r) * factor);
  const g = Math.round(startRgb.g + (endRgb.g - startRgb.g) * factor);
  const b = Math.round(startRgb.b + (endRgb.b - startRgb.b) * factor);

  return rgbToHex(r, g, b);
};

const getJointValueColor = (value: number, min: number, max: number, hasBothLimits: boolean) => {
  if (!hasBothLimits || !Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return LIGHT_GREEN;
  }

  const clampedValue = Math.min(Math.max(value, min), max);
  const range = max - min;
  if (range <= 0) {
    return LIGHT_YELLOW;
  }

  const normalized = (clampedValue - min) / range;
  const distanceToEdge = Math.min(normalized, 1 - normalized);
  const closeness = 1 - distanceToEdge / 0.5;
  const clampedCloseness = Math.min(Math.max(closeness, 0), 1);

  if (clampedCloseness <= 0.5) {
    return interpolateColor(LIGHT_GREEN, LIGHT_YELLOW, clampedCloseness * 2);
  }

  return interpolateColor(LIGHT_YELLOW, LIGHT_RED, (clampedCloseness - 0.5) * 2);
};

interface JointListItemProps {
  jointName: string;
  jointInfo?: JointLimitInfo;
  currentValue: number;
  onValueChange: (value: number) => void;
  isDeleted?: boolean;
  onHover?: (jointName: string | null) => void;
  isHighlighted?: boolean;
  angleUnit?: "rad" | "deg";
  onClick?: () => void;
  isSelected?: boolean;
  availableJoints?: string[];
  isVisible?: boolean;
  onVisibilityToggle?: (jointName: string) => void;
}

export const JointListItem = ({
  jointName,
  jointInfo,
  currentValue,
  onValueChange,
  isDeleted = false,
  onHover,
  isHighlighted = false,
  angleUnit = "rad",
  onClick,
  isSelected = false,
  availableJoints = [],
  isVisible = true,
  onVisibilityToggle,
}: JointListItemProps) => {
  const currentType = jointInfo?.type || "continuous";
  const hasLowerLimit = jointInfo?.lower !== null && jointInfo?.lower !== undefined;
  const hasUpperLimit = jointInfo?.upper !== null && jointInfo?.upper !== undefined;
  const fallbackRange = Math.PI * 4;
  const min = hasLowerLimit && jointInfo ? jointInfo.lower ?? -fallbackRange : -fallbackRange;
  const max = hasUpperLimit && jointInfo ? jointInfo.upper ?? fallbackRange : fallbackRange;
  const hasBothLimits = hasLowerLimit && hasUpperLimit;

  const valueColor = getJointValueColor(currentValue, min, max, hasBothLimits);
  const valueDisplayRef = useRef<HTMLSpanElement>(null);
  const [isValueFocused, setIsValueFocused] = useState(false);
  const isDraggingValue = useRef(false);
  const dragDirection = useRef<"vertical" | "horizontal" | "undecided">("undecided");
  const dragState = useRef<{
    startX: number;
    startY: number;
    startValue: number;
    originalCursor: string;
  }>({
    startX: 0,
    startY: 0,
    startValue: currentValue,
    originalCursor: "",
  });

  const clampValue = useCallback(
    (value: number) => {
      let clamped = value;
      if (Number.isFinite(min)) {
        clamped = Math.max(min, clamped);
      }
      if (Number.isFinite(max)) {
        clamped = Math.min(max, clamped);
      }
      return clamped;
    },
    [min, max]
  );

  const snapValueIfNeeded = useCallback(
    (value: number, shouldSnap: boolean) => {
      if (!shouldSnap) return value;
      const snapIncrementDeg = 5;
      const snapIncrementRad = snapIncrementDeg * (Math.PI / 180);
      const snapped = Math.round(value / snapIncrementRad) * snapIncrementRad;
      return snapped;
    },
    []
  );

  const applyValueChange = useCallback(
    (value: number, options?: { snap?: boolean }) => {
      const snapped = snapValueIfNeeded(value, Boolean(options?.snap));
      const clamped = clampValue(snapped);
      if (Number.isFinite(clamped)) {
        if (clamped !== currentValue) {
          onValueChange(clamped);
        }
      } else {
        onValueChange(clamped);
      }
    },
    [clampValue, currentValue, onValueChange, snapValueIfNeeded]
  );

  const getDragSensitivity = useCallback(
    (isFine: boolean) => {
      const range = max - min;
      let baseSensitivity = !Number.isFinite(range) || range === 0 ? 0.005 : range / 800;
      if (angleUnit === "deg") {
        baseSensitivity *= 180 / Math.PI;
      }
      if (isFine) {
        baseSensitivity *= 0.2;
      }
      return baseSensitivity;
    },
    [angleUnit, max, min]
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

      if (dragDirection.current === "undecided") {
        if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
          dragDirection.current =
            Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
          document.body.style.cursor =
            dragDirection.current === "horizontal" ? "ew-resize" : "ns-resize";
        }
      }

      const direction =
        dragDirection.current === "horizontal" ? deltaX : deltaY;
      const sensitivity = getDragSensitivity(event.shiftKey);
      const delta = direction * sensitivity;
      const deltaRad = angleUnit === "deg" ? delta * (Math.PI / 180) : delta;
      const nextValue = dragState.current.startValue + deltaRad;

      applyValueChange(nextValue, { snap: event.ctrlKey });
    },
    [angleUnit, applyValueChange, getDragSensitivity]
  );

  const handleValueMouseUp = useCallback(
    (event: MouseEvent) => {
      if (!isDraggingValue.current) return;
      if (event.type === "mouseup") {
        event.preventDefault();
      }
      window.removeEventListener("mousemove", handleValueMouseMove);
      window.removeEventListener("mouseup", handleValueMouseUp);
      document.body.style.cursor = dragState.current.originalCursor;
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
        document.body.style.cursor = dragState.current.originalCursor;
        isDraggingValue.current = false;
        dragDirection.current = "undecided";
      }
    };
  }, [handleValueMouseMove, handleValueMouseUp]);

  const handleValueMouseDown = (event: React.MouseEvent<HTMLSpanElement>) => {
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
      startValue: currentValue,
      originalCursor: document.body.style.cursor,
    };

    document.body.style.cursor = "ns-resize";
    window.addEventListener("mousemove", handleValueMouseMove);
    window.addEventListener("mouseup", handleValueMouseUp);
  };

  const getWheelStep = useCallback(
    (isFine: boolean, isCoarse: boolean) => {
      let stepDeg = 1;
      if (isFine) stepDeg = 0.1;
      if (isCoarse) stepDeg = 10;
      if (angleUnit === "deg") {
        return stepDeg;
      }
      return stepDeg * (Math.PI / 180);
    },
    [angleUnit]
  );

  const handleValueWheel = useCallback(
    (event: React.WheelEvent<HTMLSpanElement>) => {
      if (!isValueFocused) return;
      event.preventDefault();
      event.stopPropagation();

      if (event.altKey) {
        applyValueChange(0);
        return;
      }

      const step = getWheelStep(event.shiftKey, event.ctrlKey);
      const direction = event.deltaY < 0 ? 1 : -1;
      let delta = step * direction;
      if (angleUnit === "deg") {
        delta *= Math.PI / 180;
      }
      applyValueChange(currentValue + delta);
    },
    [angleUnit, applyValueChange, currentValue, getWheelStep, isValueFocused]
  );

  const handleValueKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLSpanElement>) => {
      const baseStepDeg = event.ctrlKey ? 10 : event.shiftKey ? 0.1 : 1;
      const stepRad = baseStepDeg * (Math.PI / 180);

      if (["ArrowUp", "ArrowRight", "PageUp"].includes(event.key)) {
        event.preventDefault();
        applyValueChange(currentValue + stepRad, { snap: event.ctrlKey });
      } else if (["ArrowDown", "ArrowLeft", "PageDown"].includes(event.key)) {
        event.preventDefault();
        applyValueChange(currentValue - stepRad, { snap: event.ctrlKey });
      } else if (event.key === "Home" && Number.isFinite(min)) {
        event.preventDefault();
        applyValueChange(min, { snap: event.ctrlKey });
      } else if (event.key === "End" && Number.isFinite(max)) {
        event.preventDefault();
        applyValueChange(max, { snap: event.ctrlKey });
      } else if (event.altKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        applyValueChange(0);
      } else if (event.altKey && event.key === "0") {
        event.preventDefault();
        applyValueChange(0);
      }
    },
    [applyValueChange, currentValue, max, min]
  );

  // Get joint type color from joint_colors.json
  const jointTypeColor = jointInfo?.type
    ? (jointColors as Record<string, string>)[jointInfo.type] || jointColors.light_gray
    : jointColors.light_gray;

  // Get joint color from 3D editor color scheme (based on sorted joint names)
  const jointEditorColor = availableJoints.length > 0
    ? getJointColor(jointName, availableJoints)
    : jointTypeColor;

  // Determine square color - grey if hidden, otherwise use editor color
  const squareColor = isVisible ? jointEditorColor : "#71717a";

  // Helper to convert hex to rgba
  const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const handleSquareClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onVisibilityToggle?.(jointName);
  };

  return (
    <div className="flex items-center gap-1.5">
      {/* Color square matching 3D editor colors - outside highlight area */}
      <div
        className="w-3.5 h-3.5 rounded-sm flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
        style={{ backgroundColor: squareColor }}
        title={isVisible ? `Joint visible - click to hide` : `Joint hidden - click to show`}
        onClick={handleSquareClick}
      />
      <div
        className={cn(
          "flex items-center gap-1.5 flex-1 px-2 py-1.5 hover:bg-muted/30 rounded-sm transition-colors cursor-pointer",
          isHighlighted && "hover:bg-muted/40",
          isSelected && "hover:bg-muted/50"
        )}
        style={
          isHighlighted || isSelected
            ? {
                backgroundColor: hexToRgba(jointTypeColor, isSelected ? 0.25 : 0.15),
              }
            : undefined
        }
        onMouseEnter={() => onHover?.(jointName)}
        onMouseLeave={() => onHover?.(null)}
        onClick={onClick}
      >
        <span
          className={cn(
            "text-xs font-medium truncate flex-1 min-w-0 text-left",
            isDeleted && "text-muted-foreground/50",
            !isDeleted && !isHighlighted && !isSelected && "text-foreground"
          )}
          style={
            !isDeleted && (isHighlighted || isSelected)
              ? { color: jointTypeColor }
              : undefined
          }
          title={isDeleted ? "Will be deleted in exported URDF" : undefined}
        >
          {jointName}
          {isDeleted && (
            <span className="ml-1 text-[9px] text-muted-foreground/70">
              (deleted)
            </span>
          )}
        </span>
      <span
        ref={valueDisplayRef}
        tabIndex={0}
        role="spinbutton"
        aria-label="Joint value"
        aria-valuemin={
          Number.isFinite(min)
            ? angleUnit === "deg"
              ? min * (180 / Math.PI)
              : min
            : undefined
        }
        aria-valuemax={
          Number.isFinite(max)
            ? angleUnit === "deg"
              ? max * (180 / Math.PI)
              : max
            : undefined
        }
        aria-valuenow={
          angleUnit === "deg"
            ? currentValue * (180 / Math.PI)
            : currentValue
        }
        className="text-xs blender-number whitespace-nowrap flex-shrink-0 min-w-[50px] text-right"
        style={{ color: valueColor }}
        onFocus={() => setIsValueFocused(true)}
        onBlur={() => setIsValueFocused(false)}
        onMouseDown={handleValueMouseDown}
        onWheel={handleValueWheel}
        onKeyDown={handleValueKeyDown}
      >
        {angleUnit === "deg"
          ? `${(currentValue * (180 / Math.PI)).toFixed(2)}°`
          : `${currentValue.toFixed(2)}`}
      </span>
      </div>
    </div>
  );
};
