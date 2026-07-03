import { memo, useRef, useState, useCallback, useEffect } from "react";
import { hexToRgba } from "@/shared/lib/color";
import { cn } from "@/shared/lib/utils";
import type { JointLimitInfo } from "@/shared/lib/urdfBrowser";
import jointColors from "@/shared/joint_colors.json";
import { getJointColor } from "@/features/urdf/utils/jointColors";
import { useJointStore } from "@/shared/store/useJointStore";
import { resolveJointValueRange } from "@/features/layout/jointValueRange";
import { JOINT_LIST_ITEM_PARAMS } from "@/features/layout/jointListItemParams";

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
  currentValue?: number;
  onValueChange: (value: number) => void;
  isDeleted?: boolean;
  onHover?: (jointName: string | null) => void;
  isHighlighted?: boolean;
  angleUnit?: "rad" | "deg";
  onClick?: () => void;
  isSelected?: boolean;
  availableJoints?: string[];
  colorJointNames?: string[];
  isVisible?: boolean;
  onVisibilityToggle?: (jointName: string) => void;
  hideColorSquare?: boolean;
  groupLabel?: string | null;
  effortLimit?: number | null;
  compact?: boolean;
}

const toFiniteNumberOrNull = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const formatMetricValue = (value: number | null | undefined): string => {
  const finiteValue = toFiniteNumberOrNull(value);
  return finiteValue === null
    ? JOINT_LIST_ITEM_PARAMS.missingMetricLabel
    : finiteValue.toFixed(JOINT_LIST_ITEM_PARAMS.metricDisplayPrecision);
};

const JointListItemBase = ({
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
  colorJointNames,
  isVisible = true,
  onVisibilityToggle,
  hideColorSquare = false,
  groupLabel = null,
  effortLimit = null,
  compact = false,
}: JointListItemProps) => {
  const storeJointValue = useJointStore(
    useCallback((s) => s.jointValues[jointName] ?? 0, [jointName])
  );
  const rawResolvedValue = currentValue ?? storeJointValue;
  const resolvedValue = Number.isFinite(rawResolvedValue) ? rawResolvedValue : 0;
  const { displayMin: min, displayMax: max, clampLower, clampUpper, hasFiniteHardLimits } =
    resolveJointValueRange({
      jointName,
      jointInfo,
      currentValue: resolvedValue,
      groupLabel,
    });
  const hasBothLimits = hasFiniteHardLimits;
  const angleDisplayValue = angleUnit === "deg" ? resolvedValue * (180 / Math.PI) : resolvedValue;
  const angleDisplay = angleDisplayValue.toFixed(JOINT_LIST_ITEM_PARAMS.angleDisplayPrecision);
  const velocityDisplay = formatMetricValue(jointInfo?.velocity);
  const effortDisplay = formatMetricValue(effortLimit);

  const valueColor = getJointValueColor(resolvedValue, min, max, hasBothLimits);
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
    startValue: resolvedValue,
    originalCursor: "",
  });

  const clampValue = useCallback(
    (value: number) => {
      let clamped = value;
      if (Number.isFinite(clampLower)) {
        clamped = Math.max(clampLower as number, clamped);
      }
      if (Number.isFinite(clampUpper)) {
        clamped = Math.min(clampUpper as number, clamped);
      }
      return clamped;
    },
    [clampLower, clampUpper]
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
        if (clamped !== resolvedValue) {
          onValueChange(clamped);
        }
      } else {
        onValueChange(clamped);
      }
    },
    [clampValue, onValueChange, resolvedValue, snapValueIfNeeded]
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
      startValue: resolvedValue,
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
      applyValueChange(resolvedValue + delta);
    },
    [angleUnit, applyValueChange, resolvedValue, getWheelStep, isValueFocused]
  );

  const handleValueKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLSpanElement>) => {
      const baseStepDeg = event.ctrlKey ? 10 : event.shiftKey ? 0.1 : 1;
      const stepRad = baseStepDeg * (Math.PI / 180);

      if (["ArrowUp", "ArrowRight", "PageUp"].includes(event.key)) {
        event.preventDefault();
        applyValueChange(resolvedValue + stepRad, { snap: event.ctrlKey });
      } else if (["ArrowDown", "ArrowLeft", "PageDown"].includes(event.key)) {
        event.preventDefault();
        applyValueChange(resolvedValue - stepRad, { snap: event.ctrlKey });
      } else if (event.key === "Home" && Number.isFinite(clampLower)) {
        event.preventDefault();
        applyValueChange(clampLower as number, { snap: event.ctrlKey });
      } else if (event.key === "End" && Number.isFinite(clampUpper)) {
        event.preventDefault();
        applyValueChange(clampUpper as number, { snap: event.ctrlKey });
      } else if (event.altKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        applyValueChange(0);
      } else if (event.altKey && event.key === "0") {
        event.preventDefault();
        applyValueChange(0);
      }
    },
    [applyValueChange, clampLower, clampUpper, resolvedValue]
  );

  const isFixedJoint = jointInfo?.type === "fixed";

  // Get joint type color from joint_colors.json
  const jointTypeColor = isFixedJoint
    ? jointColors.light_gray
    : jointInfo?.type
      ? (jointColors as Record<string, string>)[jointInfo.type] || jointColors.light_gray
      : jointColors.light_gray;

  const colorReferenceJoints = colorJointNames?.length ? colorJointNames : availableJoints;

  // Get joint color from 3D editor color scheme (based on sorted joint names)
  const jointEditorColor = isFixedJoint
    ? jointColors.light_gray
    : colorReferenceJoints.length > 0
      ? getJointColor(jointName, colorReferenceJoints)
      : jointTypeColor;

  // Keep non-fixed joints colored even when hidden; fixed hidden joints stay grey.
  const squareColor = isFixedJoint
    ? "#52525b"
    : jointEditorColor;

  const handleSquareClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onVisibilityToggle?.(jointName);
  };

  return (
    <div className={cn("flex min-w-0 items-center", compact ? "gap-1" : "gap-1.5")}>
      {/* Color square matching 3D editor colors - outside highlight area */}
      {!hideColorSquare && (
        <div
          className={cn(
            compact ? "h-3 w-3" : "h-3.5 w-3.5",
            "rounded-sm flex-shrink-0 transition-opacity",
            isFixedJoint ? "cursor-default opacity-90" : "cursor-pointer hover:opacity-80"
          )}
          style={{ backgroundColor: squareColor }}
          title={isVisible ? `Joint visible - click to hide` : `Joint hidden - click to show`}
          onClick={handleSquareClick}
        />
      )}
      <div
        className={cn(
          "flex min-w-0 items-center flex-1 rounded-sm transition-colors",
          compact ? "gap-1 px-1 py-1" : "gap-1.5 px-2 py-1.5",
          !isFixedJoint && "cursor-pointer hover:bg-muted/30",
          !isFixedJoint && isHighlighted && "hover:bg-muted/40",
          isFixedJoint && "cursor-default",
          isSelected && "bg-muted/25 hover:bg-muted/35"
        )}
        style={
          isHighlighted && !isSelected
            ? {
                backgroundColor: hexToRgba(jointTypeColor, 0.15),
              }
            : undefined
        }
        onMouseEnter={() => onHover?.(jointName)}
        onMouseLeave={() => onHover?.(null)}
        onClick={onClick}
      >
        <span
          className={cn(
            compact ? "text-[10px]" : "text-xs",
            "font-medium truncate flex-1 min-w-0 text-left",
            isFixedJoint && "text-muted-foreground/55",
            isDeleted && "text-muted-foreground/50",
            !isDeleted && !isHighlighted && !isSelected && !isFixedJoint && "text-foreground",
            !isDeleted && isSelected && "text-foreground"
          )}
          style={
            !isDeleted && !isFixedJoint && isHighlighted && !isSelected
              ? { color: jointTypeColor }
              : undefined
          }
          title={
            isDeleted
              ? `${jointName} (will be deleted in exported URDF)`
              : jointName
          }
        >
          {jointName}
          {isDeleted && (
            <span className="ml-1 text-[9px] text-muted-foreground/70">
              (deleted)
            </span>
          )}
        </span>
      <div className="grid w-[112px] shrink-0 grid-cols-3 gap-1 text-right leading-tight">
        <span
          ref={valueDisplayRef}
          tabIndex={0}
          role="spinbutton"
          aria-label="Joint angle"
          aria-valuemin={
            Number.isFinite(clampLower)
              ? angleUnit === "deg"
                ? (clampLower as number) * (180 / Math.PI)
                : (clampLower as number)
              : undefined
          }
          aria-valuemax={
            Number.isFinite(clampUpper)
              ? angleUnit === "deg"
                ? (clampUpper as number) * (180 / Math.PI)
                : (clampUpper as number)
              : undefined
          }
          aria-valuenow={angleDisplayValue}
          className="blender-number whitespace-nowrap text-[10px]"
          style={{ color: valueColor }}
          title={`Angle ${angleDisplay}${angleUnit === "deg" ? " deg" : " rad"}`}
          onFocus={() => setIsValueFocused(true)}
          onBlur={() => setIsValueFocused(false)}
          onMouseDown={handleValueMouseDown}
          onWheel={handleValueWheel}
          onKeyDown={handleValueKeyDown}
        >
          <span className="block text-[8px] uppercase text-muted-foreground/70">Angle</span>
          {angleDisplay}
        </span>
        <span
          className="blender-number whitespace-nowrap text-[10px] text-muted-foreground"
          title={`Velocity ${velocityDisplay}`}
        >
          <span className="block text-[8px] uppercase text-muted-foreground/70">Vel</span>
          {velocityDisplay}
        </span>
        <span
          className="blender-number whitespace-nowrap text-[10px] text-muted-foreground"
          title={`Tau ${effortDisplay}`}
        >
          <span className="block text-[8px] uppercase text-muted-foreground/70">Tau</span>
          {effortDisplay}
        </span>
      </div>
      </div>
    </div>
  );
};

export const JointListItem = memo(JointListItemBase);
