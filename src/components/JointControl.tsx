import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { CustomSlider } from "@/components/ui/custom-slider";
import { NumberInput } from "@/components/ui/number-input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BlenderPanel, BlenderPropertyRow } from "@/components/ui/blender-panel";
import { Settings, Trash2, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { JointLimitInfo } from "@/urdf_corrections/parseJointLimits";
import type { JointAxisInfo } from "@/urdf_corrections/parseJointAxis";
import { useJointStore } from "@/store/useJointStore";
import { getJointLinks } from "@/urdf_corrections/getJointLinks";
import { JOINT_TYPES, AXIS_PRESETS } from "@/constants/jointConstants";
import { DEG_TO_RAD, RAD_TO_DEG } from "@/utils/angleConversions";

interface JointControlProps {
  jointName: string;
  jointInfo?: JointLimitInfo;
  jointAxis?: JointAxisInfo;
  currentValue: number;
  onValueChange: (value: number) => void;
  onAxisChange?: (jointName: string, axis: [number, number, number]) => void;
  onResetAxis?: (jointName: string) => void;
  originalAxis?: JointAxisInfo;
  angleUnit?: "rad" | "deg";
  onDeleteJoint?: (jointName: string) => void;
  isDeleted?: boolean;
  onHover?: (jointName: string | null) => void;
  urdfContent?: string;
  isHighlighted?: boolean;
  onLinkChange?: (jointName: string, parentLink: string, childLink: string) => void;
  onTypeChange?: (newType: string, lowerLimit?: number, upperLimit?: number) => void;
  onNameChange?: (oldName: string, newName: string) => void;
  alwaysExpanded?: boolean;
  hideValueDisplay?: boolean;
}


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

export const JointControl = ({
  jointName,
  jointInfo,
  jointAxis,
  currentValue,
  onValueChange,
  onAxisChange,
  onResetAxis,
  originalAxis,
  angleUnit = "rad",
  onDeleteJoint,
  isDeleted = false,
  onHover,
  urdfContent,
  isHighlighted = false,
  onLinkChange,
  onTypeChange,
  onNameChange,
  alwaysExpanded = false,
  hideValueDisplay = false,
}: JointControlProps) => {
  const currentType = jointInfo?.type || "continuous";
  const hasLowerLimit = jointInfo?.lower !== null && jointInfo?.lower !== undefined;
  const hasUpperLimit = jointInfo?.upper !== null && jointInfo?.upper !== undefined;
  const fallbackRange = Math.PI * 4;
  const min = hasLowerLimit && jointInfo ? jointInfo.lower ?? -fallbackRange : -fallbackRange;
  const max = hasUpperLimit && jointInfo ? jointInfo.upper ?? fallbackRange : fallbackRange;
  const hasBothLimits = hasLowerLimit && hasUpperLimit;
  
  const needsLimits = currentType === "revolute" || currentType === "prismatic";
  const needsAxis = ["revolute", "continuous", "prismatic", "planar"].includes(currentType);

  const jointMaxVelocityOverride = useJointStore(
    (s) => s.jointVelocityLimits[jointName]
  );
  const globalMaxJointVelocity = useJointStore((s) => s.globalMaxJointVelocity);
  const setJointMaxVelocity = useJointStore((s) => s.setJointMaxVelocity);
  const velocityLimitEnabled = useJointStore((s) => s.velocityLimitEnabled);
  const degPerRad = RAD_TO_DEG;
  const radPerDeg = DEG_TO_RAD;
  const hasCustomVelocity =
    jointMaxVelocityOverride !== undefined && jointMaxVelocityOverride !== null;
  const effectiveJointVelocity =
    jointMaxVelocityOverride !== undefined && jointMaxVelocityOverride !== null
      ? jointMaxVelocityOverride
      : globalMaxJointVelocity;
  const velocityUnit = angleUnit === "deg" ? "°/s" : "rad/s";
  const velocityStep = angleUnit === "deg" ? 0.5 : 0.05;
  const velocityMin = angleUnit === "deg" ? 0.01 * RAD_TO_DEG : 0.01;
  const velocityDisplayRaw =
    angleUnit === "deg" ? effectiveJointVelocity * degPerRad : effectiveJointVelocity;
  const velocityPrecision = angleUnit === "deg" ? 100 : 1000;
  const velocityDisplay = Math.round(velocityDisplayRaw * velocityPrecision) / velocityPrecision;

  const handleJointVelocityChange = useCallback(
    (value: number) => {
      const velocityRad = angleUnit === "deg" ? value * radPerDeg : value;
      setJointMaxVelocity(jointName, velocityRad);
    },
    [angleUnit, jointName, setJointMaxVelocity, radPerDeg]
  );

  const handleResetVelocity = useCallback(() => {
    setJointMaxVelocity(jointName, null);
  }, [jointName, setJointMaxVelocity]);
  
  // Delete confirmation dialog state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Name editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(jointName);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Sync editedName when jointName prop changes (e.g., after successful rename)
  useEffect(() => {
    setEditedName(jointName);
  }, [jointName]);

  // Axis state
  const [localAxisX, setLocalAxisX] = useState<string>(
    jointAxis?.xyz ? String(jointAxis.xyz[0]) : "0"
  );
  const [localAxisY, setLocalAxisY] = useState<string>(
    jointAxis?.xyz ? String(jointAxis.xyz[1]) : "0"
  );
  const [localAxisZ, setLocalAxisZ] = useState<string>(
    jointAxis?.xyz ? String(jointAxis.xyz[2]) : "1"
  );

  // Get parent and child links from URDF
  const jointLinks = useMemo(() => {
    if (!urdfContent) return { parentLink: null, childLink: null };
    return getJointLinks(urdfContent, jointName);
  }, [urdfContent, jointName]);

  // Get all available links for selection
  const availableLinks = useMemo(() => {
    if (!urdfContent) return [];
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(urdfContent, "text/xml");
      const parserError = xmlDoc.querySelector("parsererror");
      if (parserError) return [];
      
      const robot = xmlDoc.querySelector("robot");
      if (!robot) return [];
      
      const linkElements = xmlDoc.querySelectorAll("link");
      const links: string[] = [];
      linkElements.forEach((link) => {
        const name = link.getAttribute("name");
        if (name) links.push(name);
      });
      return links.sort();
    } catch (error) {
      console.error("Error parsing links:", error);
      return [];
    }
  }, [urdfContent]);
  
  // Update local axis when prop changes
  useEffect(() => {
    if (jointAxis?.xyz) {
      setLocalAxisX(String(jointAxis.xyz[0]));
      setLocalAxisY(String(jointAxis.xyz[1]));
      setLocalAxisZ(String(jointAxis.xyz[2]));
    }
  }, [jointAxis?.xyz]);
  
  // Find matching preset for current axis
  const getAxisPreset = (): string => {
    if (!jointAxis?.xyz) return "Custom";
    const [x, y, z] = jointAxis.xyz;
    const tolerance = 0.001;
    for (const [label, preset] of Object.entries(AXIS_PRESETS)) {
      if (
        Math.abs(preset.axis[0] - x) < tolerance &&
        Math.abs(preset.axis[1] - y) < tolerance &&
        Math.abs(preset.axis[2] - z) < tolerance
      ) {
        return label;
      }
    }
    return "Custom";
  };

  const [selectedPreset, setSelectedPreset] = useState<string>(getAxisPreset());

  useEffect(() => {
    setSelectedPreset(getAxisPreset());
  }, [jointAxis?.xyz]);

  const handleAxisPresetChange = (preset: string) => {
    setSelectedPreset(preset);
    if (preset !== "Custom" && AXIS_PRESETS[preset]) {
      const axis = AXIS_PRESETS[preset].axis;
      setLocalAxisX(String(axis[0]));
      setLocalAxisY(String(axis[1]));
      setLocalAxisZ(String(axis[2]));
      onAxisChange?.(jointName, axis);
    }
  };

  const handleAxisBlur = () => {
    const x = parseFloat(localAxisX) || 0;
    const y = parseFloat(localAxisY) || 0;
    const z = parseFloat(localAxisZ) || 0;
    onAxisChange?.(jointName, [x, y, z]);
  };

  // Name editing handlers
  const handleNameDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!onNameChange) return;
    e.stopPropagation();
    setEditedName(jointName);
    setIsEditingName(true);
  }, [onNameChange, jointName]);

  const handleNameSubmit = useCallback(() => {
    const trimmedName = editedName.trim();
    if (trimmedName && trimmedName !== jointName && onNameChange) {
      onNameChange(jointName, trimmedName);
    }
    setIsEditingName(false);
  }, [editedName, jointName, onNameChange]);

  const handleNameCancel = useCallback(() => {
    setEditedName(jointName);
    setIsEditingName(false);
  }, [jointName]);

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleNameSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleNameCancel();
    }
  }, [handleNameSubmit, handleNameCancel]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  const [localLowerLimit, setLocalLowerLimit] = useState<string>(
    jointInfo?.lower !== null ? String(jointInfo.lower) : ""
  );
  const [localUpperLimit, setLocalUpperLimit] = useState<string>(
    jointInfo?.upper !== null ? String(jointInfo.upper) : ""
  );

  // State for showing/hiding advanced options
  const [isExpanded, setIsExpanded] = useState(alwaysExpanded);
  
  // Update isExpanded when alwaysExpanded changes
  useEffect(() => {
    if (alwaysExpanded) {
      setIsExpanded(true);
    }
  }, [alwaysExpanded]);

  // Update local limits when jointInfo changes (including type changes)
  useEffect(() => {
    const newType = jointInfo?.type || "continuous";
    const needsLimits = newType === "revolute" || newType === "prismatic";
    
    if (needsLimits) {
      // For joints that need limits, sync from jointInfo
      const lower = jointInfo?.lower !== null && jointInfo?.lower !== undefined 
        ? String(jointInfo.lower) 
        : "";
      const upper = jointInfo?.upper !== null && jointInfo?.upper !== undefined 
        ? String(jointInfo.upper) 
        : "";
      setLocalLowerLimit(lower);
      setLocalUpperLimit(upper);
    } else {
      // For fixed/continuous joints, clear the local limit state
      setLocalLowerLimit("");
      setLocalUpperLimit("");
    }
  }, [jointInfo?.lower, jointInfo?.upper, jointInfo?.type]);

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
      const snapIncrementRad = snapIncrementDeg * DEG_TO_RAD;
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
        baseSensitivity *= RAD_TO_DEG;
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
      const deltaRad = angleUnit === "deg" ? delta * DEG_TO_RAD : delta;
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
      return stepDeg * DEG_TO_RAD;
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
        delta *= DEG_TO_RAD;
      }
      applyValueChange(currentValue + delta);
    },
    [angleUnit, applyValueChange, currentValue, getWheelStep, isValueFocused]
  );

  const handleValueKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLSpanElement>) => {
      const baseStepDeg = event.ctrlKey ? 10 : event.shiftKey ? 0.1 : 1;
      const stepRad = baseStepDeg * DEG_TO_RAD;

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

  const handleMouseLeave = useCallback((e: React.MouseEvent) => {
    // Only clear hover if mouse actually leaves the component
    // Don't clear if moving to a child element (like Select dropdown)
    const relatedTarget = e.relatedTarget as Node | null;
    if (relatedTarget && e.currentTarget.contains(relatedTarget)) {
      return; // Mouse moved to a child element, don't clear hover
    }
    onHover?.(null);
  }, [onHover]);

  return (
    <div 
      className="px-1.5 py-1"
      onMouseEnter={() => onHover?.(jointName)}
      onMouseLeave={handleMouseLeave}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Blender-style collapsible header - Minimalistic */}
      <Collapsible open={isExpanded} onOpenChange={alwaysExpanded ? undefined : setIsExpanded}>
        <CollapsibleTrigger
          className={cn(
            "w-full flex items-center gap-1.5 px-1 py-1 hover:bg-muted/20 rounded-sm transition-colors group",
            isHighlighted && "bg-primary/8 text-primary hover:bg-primary/15",
            alwaysExpanded && "cursor-default"
          )}
          disabled={alwaysExpanded}
        >
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            {!alwaysExpanded && (
              <ChevronRight 
                className={cn(
                  "w-3 h-3 transition-transform duration-200 flex-shrink-0",
                  isExpanded && "rotate-90"
                )} 
              />
            )}
            {isEditingName ? (
              <input
                ref={nameInputRef}
                type="text"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                onBlur={handleNameSubmit}
                onKeyDown={handleNameKeyDown}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "text-xs font-medium flex-1 min-w-0 text-left bg-background border border-primary rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary",
                  isDeleted
                    ? "text-muted-foreground/50"
                    : isHighlighted
                      ? "text-primary"
                      : "text-foreground"
                )}
              />
            ) : (
              <label
                className={cn(
                  "text-xs font-medium truncate flex-1 min-w-0 text-left cursor-text",
                  isDeleted
                    ? "text-muted-foreground/50"
                    : isHighlighted
                      ? "text-primary"
                      : "text-foreground",
                  onNameChange && "hover:text-primary/80"
                )}
                title={isDeleted ? "Will be deleted in exported URDF" : onNameChange ? "Double-click to rename" : undefined}
                onDoubleClick={handleNameDoubleClick}
              >
                {jointName}
                {isDeleted && (
                  <span className="ml-1 text-[9px] text-muted-foreground/70">
                    (deleted)
                  </span>
                )}
              </label>
            )}
          </div>
          {!hideValueDisplay && (
            <span
              ref={valueDisplayRef}
              tabIndex={0}
              role="spinbutton"
              aria-label="Joint value"
              aria-valuemin={
                Number.isFinite(min)
                  ? angleUnit === "deg"
                    ? min * RAD_TO_DEG
                    : min
                  : undefined
              }
              aria-valuemax={
                Number.isFinite(max)
                  ? angleUnit === "deg"
                    ? max * RAD_TO_DEG
                    : max
                  : undefined
              }
              aria-valuenow={
                angleUnit === "deg"
                  ? currentValue * RAD_TO_DEG
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
                ? `${(currentValue * RAD_TO_DEG).toFixed(2)}°`
                : `${currentValue.toFixed(2)}`}
            </span>
          )}
        </CollapsibleTrigger>

        <CollapsibleContent className="px-1 pt-1.5 space-y-1.5">
          {/* Value Slider */}
          <BlenderPropertyRow label="Value">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <CustomSlider
                  value={[currentValue]}
                  onValueChange={(value) => onValueChange(value[0])}
                  min={min}
                  max={max}
                  step={0.01}
                  disabled={currentType === "fixed"}
                  jointType={currentType}
                />
              </div>
              <NumberInput
                value={angleUnit === "deg" ? currentValue * RAD_TO_DEG : currentValue}
              onValueChange={(val) => {
                const radValue = angleUnit === "deg" ? val * DEG_TO_RAD : val;
                  const clampedValue = Math.max(min, Math.min(max, radValue));
                  onValueChange(clampedValue);
                }}
                step={angleUnit === "deg" ? 1 : 0.01}
                min={angleUnit === "deg" ? min * RAD_TO_DEG : min}
                max={angleUnit === "deg" ? max * RAD_TO_DEG : max}
                compact
                className="w-16"
              />
            </div>
          </BlenderPropertyRow>

          <BlenderPropertyRow label={`Max velocity ${hasCustomVelocity ? "(Custom)" : "(Global)"}`}>
            <div className="flex items-center gap-2">
              <NumberInput
                value={velocityDisplay}
                onValueChange={handleJointVelocityChange}
                step={velocityStep}
                min={velocityMin}
                compact
                className="w-20"
                aria-label="Max joint velocity"
              />
              <span className="text-[10px] text-muted-foreground">{velocityUnit}</span>
              {hasCustomVelocity && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px] flex-shrink-0"
                  onClick={handleResetVelocity}
                  title="Reset to global velocity"
                >
                  Reset
                </Button>
              )}
            </div>
          </BlenderPropertyRow>

          {/* Limits for Revolute/Prismatic - Single line */}
          {needsLimits && (
            <BlenderPropertyRow label={`Angle limits (${angleUnit === "deg" ? "deg" : "rad"})`}>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">Min:</span>
                  <NumberInput
                    value={angleUnit === "deg" 
                      ? (localLowerLimit ? parseFloat(localLowerLimit) * RAD_TO_DEG : (jointInfo?.lower ?? 0) * RAD_TO_DEG)
                      : (localLowerLimit ? parseFloat(localLowerLimit) : (jointInfo?.lower ?? 0))}
                    onValueChange={(val) => {
                      const radValue = angleUnit === "deg" ? val * DEG_TO_RAD : val;
                      setLocalLowerLimit(String(radValue));
                    }}
                    step={angleUnit === "deg" ? 1 : 0.01}
                    compact
                    className="w-20"
                  />
                </div>
                <span className="text-xs text-muted-foreground">/</span>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">Max:</span>
                  <NumberInput
                    value={angleUnit === "deg"
                      ? (localUpperLimit ? parseFloat(localUpperLimit) * RAD_TO_DEG : (jointInfo?.upper ?? 0) * RAD_TO_DEG)
                      : (localUpperLimit ? parseFloat(localUpperLimit) : (jointInfo?.upper ?? 0))}
                    onValueChange={(val) => {
                      const radValue = angleUnit === "deg" ? val * DEG_TO_RAD : val;
                      setLocalUpperLimit(String(radValue));
                    }}
                    step={angleUnit === "deg" ? 1 : 0.01}
                    compact
                    className="w-20"
                  />
                </div>
              </div>
            </BlenderPropertyRow>
          )}

          {/* Joint Type */}
          {onTypeChange && (
            <BlenderPropertyRow label="Type">
              <Select
                value={currentType}
                onValueChange={(newType) => {
                  const newTypeNeedsLimits = newType === "revolute" || newType === "prismatic";
                  let lower: number | undefined = undefined;
                  let upper: number | undefined = undefined;
                  
                  if (newTypeNeedsLimits) {
                    // Try to get limits from local state first, then fall back to jointInfo
                    if (localLowerLimit && localLowerLimit.trim() !== "") {
                      const parsed = parseFloat(localLowerLimit);
                      if (!isNaN(parsed)) lower = parsed;
                    } else if (jointInfo?.lower !== null && jointInfo?.lower !== undefined) {
                      lower = jointInfo.lower;
                    }
                    
                    if (localUpperLimit && localUpperLimit.trim() !== "") {
                      const parsed = parseFloat(localUpperLimit);
                      if (!isNaN(parsed)) upper = parsed;
                    } else if (jointInfo?.upper !== null && jointInfo?.upper !== undefined) {
                      upper = jointInfo.upper;
                    }
                  }
                  
                  onTypeChange(newType, lower, upper);
                }}
              >
                <SelectTrigger 
                  className="h-7 text-xs"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {JOINT_TYPES.map((type) => (
                    <SelectItem key={type} value={type} className="text-xs">
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </BlenderPropertyRow>
          )}

          {/* Parent and Child Links */}
          {onLinkChange && urdfContent && (
            <>
              <BlenderPropertyRow label="Parent Link">
                <Select
                  value={jointLinks.parentLink || ""}
                  onValueChange={(value) => {
                    if (jointLinks.childLink && onLinkChange) {
                      onLinkChange(jointName, value, jointLinks.childLink);
                    }
                  }}
                >
                  <SelectTrigger 
                    className="h-7 text-xs truncate text-left"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <SelectValue placeholder="Select parent link" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {availableLinks.map((link) => (
                      <SelectItem key={link} value={link} className="text-xs">
                        <span className="truncate block">{link}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </BlenderPropertyRow>
              <BlenderPropertyRow label="Child Link">
                <Select
                  value={jointLinks.childLink || ""}
                  onValueChange={(value) => {
                    if (jointLinks.parentLink && onLinkChange) {
                      onLinkChange(jointName, jointLinks.parentLink, value);
                    }
                  }}
                >
                  <SelectTrigger 
                    className="h-7 text-xs truncate text-left"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <SelectValue placeholder="Select child link" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {availableLinks.map((link) => (
                      <SelectItem key={link} value={link} className="text-xs">
                        <span className="truncate block">{link}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </BlenderPropertyRow>
            </>
          )}

          {/* Axis */}
          {needsAxis && onAxisChange && (
            <>
              <BlenderPropertyRow label="Axis">
                <div className="flex items-center gap-1.5">
                  <Select value={selectedPreset} onValueChange={handleAxisPresetChange}>
                    <SelectTrigger 
                      className="h-7 text-xs flex-1"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <SelectValue>
                        {selectedPreset !== "Custom" && AXIS_PRESETS[selectedPreset] ? (
                          <div className="flex items-center gap-1.5">
                            {AXIS_PRESETS[selectedPreset].icon}
                            <span className="text-xs">{AXIS_PRESETS[selectedPreset].label}</span>
                          </div>
                        ) : (
                          "Custom"
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      {Object.entries(AXIS_PRESETS).map(([key, preset]) => (
                        <SelectItem key={key} value={key} className="text-xs">
                          <div className="flex items-center gap-1.5">
                            {preset.icon}
                            <span>{preset.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                      <SelectItem value="Custom" className="text-xs">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                  {onResetAxis && originalAxis && jointAxis && (
                    JSON.stringify(originalAxis.xyz) !== JSON.stringify(jointAxis.xyz) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => onResetAxis(jointName)}
                        title="Reset axis to original value"
                      >
                        Reset
                      </Button>
                    )
                  )}
                </div>
              </BlenderPropertyRow>
              {/* Info text based on joint type */}
              <div className="text-[10px] text-muted-foreground pl-6 pb-1">
                {currentType === "revolute" || currentType === "continuous" 
                  ? "Rotation around axis"
                  : currentType === "prismatic"
                  ? "Slides along axis"
                  : ""}
              </div>
              {selectedPreset === "Custom" && (
                <>
                  <BlenderPropertyRow label="X">
                    <NumberInput
                      value={parseFloat(localAxisX) || 0}
                      onValueChange={(val) => {
                        setLocalAxisX(String(val));
                        const x = val;
                        const y = parseFloat(localAxisY) || 0;
                        const z = parseFloat(localAxisZ) || 0;
                        onAxisChange?.(jointName, [x, y, z]);
                      }}
                      step={0.01}
                      compact
                      className="w-20"
                    />
                  </BlenderPropertyRow>
                  <BlenderPropertyRow label="Y">
                    <NumberInput
                      value={parseFloat(localAxisY) || 0}
                      onValueChange={(val) => {
                        setLocalAxisY(String(val));
                        const x = parseFloat(localAxisX) || 0;
                        const y = val;
                        const z = parseFloat(localAxisZ) || 0;
                        onAxisChange?.(jointName, [x, y, z]);
                      }}
                      step={0.01}
                      compact
                      className="w-20"
                    />
                  </BlenderPropertyRow>
                  <BlenderPropertyRow label="Z">
                    <NumberInput
                      value={parseFloat(localAxisZ) || 0}
                      onValueChange={(val) => {
                        setLocalAxisZ(String(val));
                        const x = parseFloat(localAxisX) || 0;
                        const y = parseFloat(localAxisY) || 0;
                        const z = val;
                        onAxisChange?.(jointName, [x, y, z]);
                      }}
                      step={0.01}
                      compact
                      className="w-20"
                    />
                  </BlenderPropertyRow>
                </>
              )}
            </>
          )}

          {/* Delete Button */}
          {onDeleteJoint && (
            <div className="pt-2">
              <Button
                variant="destructive"
                size="sm"
                className="w-full h-7 text-xs"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="w-3 h-3 mr-1.5" />
                {isDeleted ? "Restore Joint" : "Delete Joint"}
              </Button>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Joint</DialogTitle>
            <DialogDescription>
              Are you sure you want to {isDeleted ? "restore" : "delete"} the joint "{jointName}"?
              {!isDeleted && " It will be removed from the exported URDF."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
            >
              No
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onDeleteJoint?.(jointName);
                setShowDeleteDialog(false);
              }}
            >
              Yes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

