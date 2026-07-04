import { memo, useCallback } from "react";
import { hexToRgba } from "@/shared/lib/color";
import { cn } from "@/shared/lib/utils";
import type { JointLimitInfo } from "@/shared/lib/urdfBrowser";
import { useJointStore } from "@/shared/store/useJointStore";
import { RAD_TO_DEG } from "@/shared/lib/angleConversions";
import { resolveJointValueRange } from "@/features/layout/jointValueRange";
import { getJointValueColor } from "@/features/layout/jointValueColor";
import { useJointValueInteraction } from "@/features/layout/jointValueInteraction";
import { JOINT_LIST_ITEM_PARAMS } from "@/features/layout/jointListItemParams";
import { resolveJointListItemDisplayState } from "@/features/layout/jointListItemDisplayState";

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
  const {
    angleDisplay,
    angleDisplayValue,
    effortDisplay,
    isFixedJoint,
    jointTypeColor,
    squareColor,
    velocityDisplay,
  } = resolveJointListItemDisplayState({
    angleUnit,
    availableJoints,
    colorJointNames,
    effortLimit,
    jointInfo,
    jointName,
    resolvedValue,
  });
  const metricGridWidthClassName = compact
    ? JOINT_LIST_ITEM_PARAMS.compactMetricGridWidthClassName
    : JOINT_LIST_ITEM_PARAMS.metricGridWidthClassName;
  const metricLabelClassName = JOINT_LIST_ITEM_PARAMS.metricLabelClassName;
  const metricValueClassName = JOINT_LIST_ITEM_PARAMS.metricValueClassName;

  const valueColor = getJointValueColor(resolvedValue, min, max, hasBothLimits);
  const {
    handleValueKeyDown,
    handleValueMouseDown,
    handleValueWheel,
    setIsValueFocused,
    valueDisplayRef,
  } = useJointValueInteraction({
    clampLower,
    clampUpper,
    disabled: isFixedJoint,
    displayMax: max,
    displayMin: min,
    onValueChange,
    resolvedValue,
  });

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
          "grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center rounded-sm transition-colors",
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
            "block min-w-0 truncate text-left font-medium",
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
      <div
        className={cn(
          "grid shrink-0 grid-cols-3 gap-[2px] text-right leading-none",
          metricGridWidthClassName
        )}
      >
        <span
          ref={valueDisplayRef}
          tabIndex={isFixedJoint ? -1 : 0}
          role="spinbutton"
          aria-label="Joint angle"
          aria-valuemin={
            Number.isFinite(clampLower)
              ? angleUnit === "deg"
                ? (clampLower as number) * RAD_TO_DEG
                : (clampLower as number)
              : undefined
          }
          aria-valuemax={
            Number.isFinite(clampUpper)
              ? angleUnit === "deg"
                ? (clampUpper as number) * RAD_TO_DEG
                : (clampUpper as number)
              : undefined
          }
          aria-valuenow={angleDisplayValue}
          className={cn("blender-number min-w-0", metricValueClassName)}
          style={{ color: valueColor }}
          title={`Angle ${angleDisplay}${angleUnit === "deg" ? " deg" : " rad"}`}
          onFocus={() => setIsValueFocused(true)}
          onBlur={() => setIsValueFocused(false)}
          onMouseDown={handleValueMouseDown}
          onWheel={handleValueWheel}
          onKeyDown={handleValueKeyDown}
        >
          <span className={metricLabelClassName}>Angle</span>
          {angleDisplay}
        </span>
        <span
          className={cn("blender-number min-w-0 text-muted-foreground", metricValueClassName)}
          title={`Velocity ${velocityDisplay}`}
        >
          <span className={metricLabelClassName}>Vel</span>
          {velocityDisplay}
        </span>
        <span
          className={cn("blender-number min-w-0 text-muted-foreground", metricValueClassName)}
          title={`Tau ${effortDisplay}`}
        >
          <span className={metricLabelClassName}>Tau</span>
          {effortDisplay}
        </span>
      </div>
      </div>
    </div>
  );
};

export const JointListItem = memo(JointListItemBase);
