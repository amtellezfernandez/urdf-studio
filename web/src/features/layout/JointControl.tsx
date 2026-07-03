import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { CustomSlider } from "@/shared/ui/custom-slider";
import { NumberInput } from "@/shared/ui/number-input";
import { Button } from "@/shared/ui/button";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { BlenderPanel, BlenderPropertyRow } from "@/shared/ui/blender-panel";
import { Settings, Trash2, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible";
import { cn } from "@/shared/lib/utils";
import { useJointStore } from "@/shared/store/useJointStore";
import { analyzeUrdf } from "@/shared/lib/urdfCore";
import { OriginRows } from "@/features/urdf/editor/link-editor/OriginRows";
import { parseVector3, updateVector3Value } from "@/features/urdf/editor/link-editor/sizeUtils";
import {
  getJointLinks,
  getUrdfElementByName,
  parseUrdfDocument,
  type JointAxisInfo,
  type JointLimitInfo,
  type UrdfAnalysis,
} from "@/shared/lib/urdfBrowser";
import { JOINT_TYPES, AXIS_PRESETS } from "@/shared/constants/jointConstants";
import { DEG_TO_RAD, RAD_TO_DEG } from "@/shared/lib/angleConversions";
import { getJointLimitsError } from "@/shared/lib/jointLimits";
import { resolveJointValueRange } from "@/features/layout/jointValueRange";
import { JOINT_CONTROL_PARAMS } from "@/features/layout/jointControlParams";
import { LimitAttributeStatusBadge } from "@/features/layout/jointLimitDebug";
import {
  getLimitAttributeInputTitle,
  parseLimitAttributeDebugState,
  parsePositiveScalar,
} from "@/features/layout/jointLimitDebugState";
import type { URDFRobot } from "urdf-loader";

interface JointControlProps {
  jointName: string;
  jointInfo?: JointLimitInfo;
  jointAxis?: JointAxisInfo;
  currentValue?: number;
  onValueChange: (value: number) => void;
  onAxisChange?: (jointName: string, axis: [number, number, number]) => void;
  onOriginChange?: (
    jointName: string,
    xyz: [number, number, number],
    rpy: [number, number, number]
  ) => void;
  onResetAxis?: (jointName: string) => void;
  originalAxis?: JointAxisInfo;
  angleUnit?: "rad" | "deg";
  onDeleteJoint?: (jointName: string) => void;
  isDeleted?: boolean;
  onHover?: (jointName: string | null) => void;
  urdfContent?: string;
  urdfAnalysis?: UrdfAnalysis | null;
  isHighlighted?: boolean;
  onLinkChange?: (jointName: string, parentLink: string, childLink: string) => void;
  onTypeChange?: (newType: string, lowerLimit?: number, upperLimit?: number) => void;
  onNameChange?: (oldName: string, newName: string) => boolean | void;
  onVelocityChange?: (velocity: number | null) => void;
  onEffortChange?: (effort: number | null) => void;
  onLimitsChange?: (lowerLimit?: number | null, upperLimit?: number | null) => void;
  alwaysExpanded?: boolean;
  hideValueDisplay?: boolean;
  robot?: URDFRobot | null; // Three.js robot object for getting link coordinates
  groupLabel?: string | null;
}

type JointLimitMetadata = JointLimitInfo & {
  effort?: number | null;
  velocity?: number | null;
};

const LIGHT_GREEN = "#bbf7d0";
const LIGHT_YELLOW = "#fef3c7";
const LIGHT_RED = "#fecaca";
const JOINT_CONTROL_URDF_PARSE_OPTIONS = {
  onParseError: () => {},
  onRobotMissing: () => {},
  onXacroDetected: () => {},
  onOversize: () => {},
  onDepthExceeded: () => {},
};

const roundToPrecision = (value: number, precision: number): number =>
  Math.round(value * precision) / precision;

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
  onOriginChange,
  onResetAxis,
  originalAxis,
  angleUnit = "rad",
  onDeleteJoint,
  isDeleted = false,
  onHover,
  urdfContent,
  urdfAnalysis,
  isHighlighted = false,
  onLinkChange,
  onTypeChange,
  onNameChange,
  onVelocityChange,
  onEffortChange,
  onLimitsChange,
  alwaysExpanded = false,
  hideValueDisplay = false,
  robot,
  groupLabel = null,
}: JointControlProps) => {
  const currentType = jointInfo?.type || JOINT_CONTROL_PARAMS.defaultJointType;
  const isFixedJoint = currentType === "fixed";

  const needsLimits = currentType === "revolute" || currentType === "prismatic";
  const needsAxis = ["revolute", "continuous", "prismatic", "planar"].includes(currentType);
  const storeJointValue = useJointStore(
    useCallback((s) => s.jointValues[jointName] ?? 0, [jointName])
  );
  const resolvedValue = currentValue ?? storeJointValue;
  const { displayMin: min, displayMax: max, clampLower, clampUpper, hasFiniteHardLimits } =
    resolveJointValueRange({
      jointName,
      jointInfo,
      currentValue: resolvedValue,
      groupLabel,
    });
  const hasBothLimits = hasFiniteHardLimits;

  const degPerRad = RAD_TO_DEG;
  const radPerDeg = DEG_TO_RAD;
  const velocityUnit = angleUnit === "deg" ? "°/s" : "rad/s";
  const velocityStep =
    angleUnit === "deg"
      ? JOINT_CONTROL_PARAMS.velocity.degStep
      : JOINT_CONTROL_PARAMS.velocity.radStep;
  const velocityMin =
    angleUnit === "deg"
      ? JOINT_CONTROL_PARAMS.velocity.minRadPerSec * RAD_TO_DEG
      : JOINT_CONTROL_PARAMS.velocity.minRadPerSec;
  const velocityPrecision =
    angleUnit === "deg"
      ? JOINT_CONTROL_PARAMS.velocity.degPrecision
      : JOINT_CONTROL_PARAMS.velocity.radPrecision;
  const jointLimitMetadata = jointInfo as JointLimitMetadata | undefined;
  const parsedJointLimitAttributes = useMemo(() => {
    if (!urdfContent) {
      return undefined;
    }

    const xmlDoc = parseUrdfDocument(urdfContent, JOINT_CONTROL_URDF_PARSE_OPTIONS);
    if (!xmlDoc) {
      return undefined;
    }
    const joint = getUrdfElementByName(xmlDoc, "joint", jointName, {
      label: "joint",
      onMissing: () => {},
    });
    if (!joint) {
      return undefined;
    }
    const limitElement = joint.querySelector("limit");
    return {
      velocity: parseLimitAttributeDebugState(limitElement?.getAttribute("velocity")),
      effort: parseLimitAttributeDebugState(limitElement?.getAttribute("effort")),
    };
  }, [jointName, urdfContent]);
  const velocityAttribute =
    parsedJointLimitAttributes !== undefined
      ? parsedJointLimitAttributes.velocity
      : parseLimitAttributeDebugState(jointLimitMetadata?.velocity);
  const velocityLimit = velocityAttribute.value;
  const velocityDisplay =
    velocityLimit === null
      ? undefined
      : roundToPrecision(
          angleUnit === "deg" ? velocityLimit * degPerRad : velocityLimit,
          velocityPrecision
        );

  const effortAttribute =
    parsedJointLimitAttributes !== undefined
      ? parsedJointLimitAttributes.effort
      : parseLimitAttributeDebugState(jointLimitMetadata?.effort);
  const effortLimit = effortAttribute.value;
  const effortDisplay =
    effortLimit === null
      ? undefined
      : roundToPrecision(effortLimit, JOINT_CONTROL_PARAMS.effort.precision);
  const hasEffortLimit = effortAttribute.status !== "missing";
  const effortUnit = currentType === "prismatic" ? "N" : "N*m";
  const velocityPlaceholder = velocityAttribute.status === "invalid" ? "bad" : "-";
  const effortPlaceholder = effortAttribute.status === "invalid" ? "bad" : "-";

  const handleJointVelocityChange = useCallback(
    (value: number) => {
      const velocityRad = angleUnit === "deg" ? value * radPerDeg : value;
      const nextVelocity = parsePositiveScalar(velocityRad);
      if (nextVelocity === velocityLimit) return;
      onVelocityChange?.(nextVelocity);
    },
    [angleUnit, onVelocityChange, radPerDeg, velocityLimit]
  );

  const handleJointEffortChange = useCallback(
    (value: number) => {
      const nextEffort = parsePositiveScalar(value);
      if (nextEffort === effortLimit) return;
      onEffortChange?.(nextEffort);
    },
    [effortLimit, onEffortChange]
  );

  const handleClearEffort = useCallback(() => {
    if (effortAttribute.status === "missing") return;
    onEffortChange?.(null);
  }, [effortAttribute.status, onEffortChange]);
  
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

  const jointOrigin = useMemo(() => {
    if (!urdfContent) {
      return { xyz: [0, 0, 0] as [number, number, number], rpy: [0, 0, 0] as [number, number, number] };
    }
    const xmlDoc = parseUrdfDocument(urdfContent, JOINT_CONTROL_URDF_PARSE_OPTIONS);
    if (!xmlDoc) {
      return { xyz: [0, 0, 0] as [number, number, number], rpy: [0, 0, 0] as [number, number, number] };
    }
    const joint = getUrdfElementByName(xmlDoc, "joint", jointName, {
      label: "joint",
      onMissing: () => {},
    });
    const origin = joint?.querySelector("origin");
    return {
      xyz: parseVector3(origin?.getAttribute("xyz") || "", [0, 0, 0]),
      rpy: parseVector3(origin?.getAttribute("rpy") || "", [0, 0, 0]),
    };
  }, [jointName, urdfContent]);

  // Get all available links for selection
  const availableLinks = useMemo(() => {
    if (urdfAnalysis?.isValid) return [...urdfAnalysis.linkNames].sort();
    if (!urdfContent) return [];
    const analysis = analyzeUrdf(urdfContent);
    if (!analysis.isValid) return [];
    return [...analysis.linkNames].sort();
  }, [urdfAnalysis, urdfContent]);

  const parentLinkOptions = useMemo(
    () => availableLinks.filter((link) => link !== jointLinks.childLink),
    [availableLinks, jointLinks.childLink]
  );
  const childLinkOptions = useMemo(
    () => availableLinks.filter((link) => link !== jointLinks.parentLink),
    [availableLinks, jointLinks.parentLink]
  );
  
  // Update local axis when prop changes
  useEffect(() => {
    if (jointAxis?.xyz) {
      setLocalAxisX(String(jointAxis.xyz[0]));
      setLocalAxisY(String(jointAxis.xyz[1]));
      setLocalAxisZ(String(jointAxis.xyz[2]));
    }
  }, [jointAxis?.xyz]);
  
  // Find matching preset for current axis
  const parseAxisValue = useCallback((value: string): number | null => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }, []);

  const resolveAxisComponents = useCallback(() => {
    const fallback = jointAxis?.xyz ?? [0, 0, 1];
    const x = parseAxisValue(localAxisX);
    const y = parseAxisValue(localAxisY);
    const z = parseAxisValue(localAxisZ);
    return [
      x ?? fallback[0],
      y ?? fallback[1],
      z ?? fallback[2],
    ] as [number, number, number];
  }, [jointAxis?.xyz, localAxisX, localAxisY, localAxisZ, parseAxisValue]);

  const getAxisPreset = useCallback((): string => {
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
  }, [jointAxis?.xyz]);

  const [selectedPreset, setSelectedPreset] = useState<string>(getAxisPreset());

  useEffect(() => {
    setSelectedPreset(getAxisPreset());
  }, [getAxisPreset]);

  const commitAxisChange = useCallback(
    (axis: [number, number, number]) => {
      const [x, y, z] = axis;
      if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6 && Math.abs(z) < 1e-6) {
        toast.error("Axis cannot be zero vector");
        return;
      }
      onAxisChange?.(jointName, axis);
    },
    [jointName, onAxisChange]
  );

  const handleAxisPresetChange = (preset: string) => {
    setSelectedPreset(preset);
    if (preset !== "Custom" && AXIS_PRESETS[preset]) {
      const axis = AXIS_PRESETS[preset].axis;
      setLocalAxisX(String(axis[0]));
      setLocalAxisY(String(axis[1]));
      setLocalAxisZ(String(axis[2]));
      commitAxisChange(axis);
    }
  };

  const handleAxisCommit = useCallback(() => {
    const [x, y, z] = resolveAxisComponents();
    commitAxisChange([x, y, z]);
  }, [commitAxisChange, resolveAxisComponents]);

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
      const result = onNameChange(jointName, trimmedName);
      if (result === false) {
        return;
      }
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
  const [localOriginXyz, setLocalOriginXyz] = useState<[number, number, number]>(jointOrigin.xyz);
  const [localOriginRpy, setLocalOriginRpy] = useState<[number, number, number]>(jointOrigin.rpy);
  const resolveLimitValue = useCallback(
    (value: string, fallback?: number | null) => {
      if (value.trim().length > 0) {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
      if (fallback !== null && fallback !== undefined && Number.isFinite(fallback)) {
        return fallback;
      }
      return undefined;
    },
    []
  );
  const parseLimitInput = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }, []);

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

  useEffect(() => {
    setLocalOriginXyz(jointOrigin.xyz);
    setLocalOriginRpy(jointOrigin.rpy);
  }, [jointOrigin]);

  const commitOriginChange = useCallback(
    (field: "xyz" | "rpy", index: number, value: number) => {
      const nextXyz =
        field === "xyz" ? updateVector3Value(localOriginXyz, index, value) : localOriginXyz;
      const nextRpy =
        field === "rpy" ? updateVector3Value(localOriginRpy, index, value) : localOriginRpy;
      if (field === "xyz") {
        setLocalOriginXyz(nextXyz);
      } else {
        setLocalOriginRpy(nextRpy);
      }
      onOriginChange?.(jointName, nextXyz, nextRpy);
    },
    [jointName, localOriginRpy, localOriginXyz, onOriginChange]
  );

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
    if (isFixedJoint) return;
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
      return stepDeg * DEG_TO_RAD;
    },
    [angleUnit]
  );

  const handleValueWheel = useCallback(
    (event: React.WheelEvent<HTMLSpanElement>) => {
      if (isFixedJoint) return;
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
      applyValueChange(resolvedValue + delta);
    },
    [angleUnit, applyValueChange, resolvedValue, getWheelStep, isValueFocused, isFixedJoint]
  );

  const handleValueKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLSpanElement>) => {
      if (isFixedJoint) return;
      const baseStepDeg = event.ctrlKey ? 10 : event.shiftKey ? 0.1 : 1;
      const stepRad = baseStepDeg * DEG_TO_RAD;

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
    [applyValueChange, clampLower, clampUpper, resolvedValue, isFixedJoint]
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
      className="overflow-x-hidden px-1.5 py-1 text-[10px] leading-tight [&_.text-xs]:text-[10px] [&_.text-sm]:text-[11px]"
      onMouseEnter={() => onHover?.(jointName)}
      onMouseLeave={handleMouseLeave}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Blender-style collapsible header - Minimalistic */}
      <Collapsible open={isExpanded} onOpenChange={alwaysExpanded ? undefined : setIsExpanded}>
        {!alwaysExpanded && (
          <CollapsibleTrigger
            className={cn(
              "w-full flex items-center gap-1.5 px-1 py-1 hover:bg-muted/20 rounded-sm transition-colors group",
              isHighlighted && "bg-primary/8 text-primary hover:bg-primary/15"
            )}
          >
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <ChevronRight 
                className={cn(
                  "w-3 h-3 transition-transform duration-200 flex-shrink-0",
                  isExpanded && "rotate-90"
                )} 
              />
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
                    "text-[9px] font-normal leading-none flex-1 min-w-0 text-left bg-background border border-primary rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary",
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
                    "text-[9px] font-normal leading-none truncate flex-1 min-w-0 text-left cursor-text",
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
                  {urdfAnalysis?.isValid && (
                    <span className="ml-1 rounded-sm border border-border/40 px-1 text-[8px] font-mono text-muted-foreground/80">
                      [analysis]
                    </span>
                  )}
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
                tabIndex={isFixedJoint ? -1 : 0}
                role="spinbutton"
                aria-label="Joint value"
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
                aria-valuenow={
                  angleUnit === "deg"
                    ? resolvedValue * RAD_TO_DEG
                    : resolvedValue
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
                  ? `${(resolvedValue * RAD_TO_DEG).toFixed(2)}°`
                  : `${resolvedValue.toFixed(2)}`}
              </span>
            )}
          </CollapsibleTrigger>
        )}

        <CollapsibleContent className={cn(
          "px-1 space-y-1",
          alwaysExpanded ? "pt-0" : "pt-1"
        )}>
          {/* Value Slider */}
          <BlenderPropertyRow label={currentType === "prismatic" ? "Pos" : "Angle"} labelWidth="w-12">
            <div className="flex min-w-0 items-center gap-1">
              <div className="flex-1">
                  <CustomSlider
                    value={[resolvedValue]}
                  onValueChange={(value) => {
                    if (isFixedJoint) return;
                    onValueChange(value[0]);
                  }}
                    min={min}
                    max={max}
                    step={JOINT_CONTROL_PARAMS.valueInput.radStep}
                    disabled={isFixedJoint}
                    jointType={currentType}
                  />
              </div>
                <NumberInput
                  value={angleUnit === "deg" ? resolvedValue * RAD_TO_DEG : resolvedValue}
              onValueChange={(val) => {
                if (isFixedJoint) return;
                const radValue = angleUnit === "deg" ? val * DEG_TO_RAD : val;
                  const clampedValue = clampValue(radValue);
                  onValueChange(clampedValue);
                }}
                step={
                  angleUnit === "deg"
                    ? JOINT_CONTROL_PARAMS.valueInput.degStep
                    : JOINT_CONTROL_PARAMS.valueInput.radStep
                }
                min={
                  Number.isFinite(clampLower)
                    ? angleUnit === "deg"
                      ? (clampLower as number) * RAD_TO_DEG
                      : (clampLower as number)
                    : undefined
                }
                max={
                  Number.isFinite(clampUpper)
                    ? angleUnit === "deg"
                      ? (clampUpper as number) * RAD_TO_DEG
                      : (clampUpper as number)
                    : undefined
                }
                compact
                className="w-12"
                disabled={isFixedJoint}
              />
            </div>
          </BlenderPropertyRow>

          <div className="grid min-w-0 grid-cols-2 gap-x-2 gap-y-0.5">
            <BlenderPropertyRow
              label="Vel"
              labelWidth="w-8"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                <NumberInput
                  value={velocityDisplay}
                  onValueChange={handleJointVelocityChange}
                  step={velocityStep}
                  min={velocityMin}
                  compact
                  allowEmpty
                  className="w-10"
                  aria-label="Max joint velocity"
                  placeholder={velocityPlaceholder}
                  title={getLimitAttributeInputTitle("velocity", velocityAttribute)}
                  disabled={!onVelocityChange}
                />
                <span className="text-[8px] text-muted-foreground">{velocityUnit}</span>
                <LimitAttributeStatusBadge attributeName="velocity" state={velocityAttribute} />
              </div>
            </BlenderPropertyRow>

            <BlenderPropertyRow
              label="Tau"
              labelWidth="w-8"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                <NumberInput
                  value={effortDisplay}
                  onValueChange={handleJointEffortChange}
                  step={JOINT_CONTROL_PARAMS.effort.step}
                  min={JOINT_CONTROL_PARAMS.effort.min}
                  compact
                  allowEmpty
                  className="w-10"
                  aria-label="Joint effort limit"
                  placeholder={effortPlaceholder}
                  title={getLimitAttributeInputTitle("effort", effortAttribute)}
                  disabled={!onEffortChange}
                />
                <span className="text-[8px] text-muted-foreground">{effortUnit}</span>
                <LimitAttributeStatusBadge attributeName="effort" state={effortAttribute} />
                {hasEffortLimit && onEffortChange && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1 text-[9px] flex-shrink-0"
                    onClick={handleClearEffort}
                    title="Clear effort limit"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </BlenderPropertyRow>
          </div>

          {/* Limits for Revolute/Prismatic - Single line */}
          {needsLimits && (
            <BlenderPropertyRow
              label={
                <span className="truncate">
                  Limits
                  <span className="ml-1 text-[8px] text-muted-foreground/80">
                    {currentType === "prismatic" ? "m" : angleUnit}
                  </span>
                </span>
              }
              labelWidth="w-12"
            >
              <div className="space-y-0.5">
                <div className="grid min-w-0 grid-cols-2 gap-1">
                  <div className="flex min-w-0 items-center gap-1">
                    <span className="text-[8px] text-muted-foreground">Min</span>
                    <NumberInput
                      value={angleUnit === "deg"
                        ? (localLowerLimit
                            ? parseFloat(localLowerLimit) * RAD_TO_DEG
                            : jointInfo?.lower !== null && jointInfo?.lower !== undefined
                              ? jointInfo.lower * RAD_TO_DEG
                              : undefined)
                        : (localLowerLimit
                            ? parseFloat(localLowerLimit)
                            : jointInfo?.lower !== null && jointInfo?.lower !== undefined
                              ? jointInfo.lower
                              : undefined)}
                      onValueChange={(val) => {
                        const radValue = angleUnit === "deg" ? val * DEG_TO_RAD : val;
                        setLocalLowerLimit(String(radValue));
                        if (onLimitsChange) {
                          const currentUpper = parseLimitInput(localUpperLimit);
                          const error = getJointLimitsError(radValue, currentUpper);
                          if (error) {
                            toast.error(error);
                            return;
                          }
                          onLimitsChange(radValue, currentUpper);
                        }
                      }}
                      onBlur={() => {
                        if (!onLimitsChange) return;
                        if (localLowerLimit.trim() !== "" && localUpperLimit.trim() !== "") return;
                        const currentLower = parseLimitInput(localLowerLimit);
                        const currentUpper = parseLimitInput(localUpperLimit);
                        if (
                          currentType === "prismatic" &&
                          currentLower === undefined &&
                          currentUpper === undefined
                        ) {
                          toast.error("Prismatic joints require limits.");
                          return;
                        }
                        const error = getJointLimitsError(currentLower, currentUpper);
                        if (error) {
                          toast.error(error);
                          return;
                        }
                        onLimitsChange(currentLower, currentUpper);
                      }}
                      step={angleUnit === "deg" ? 1 : 0.01}
                      compact
                      allowEmpty
                      className="w-full"
                    />
                  </div>
                  <div className="flex min-w-0 items-center gap-1">
                    <span className="text-[8px] text-muted-foreground">Max</span>
                    <NumberInput
                      value={angleUnit === "deg"
                        ? (localUpperLimit
                            ? parseFloat(localUpperLimit) * RAD_TO_DEG
                            : jointInfo?.upper !== null && jointInfo?.upper !== undefined
                              ? jointInfo.upper * RAD_TO_DEG
                              : undefined)
                        : (localUpperLimit
                            ? parseFloat(localUpperLimit)
                            : jointInfo?.upper !== null && jointInfo?.upper !== undefined
                              ? jointInfo.upper
                              : undefined)}
                      onValueChange={(val) => {
                        const radValue = angleUnit === "deg" ? val * DEG_TO_RAD : val;
                        setLocalUpperLimit(String(radValue));
                        if (onLimitsChange) {
                          const currentLower = parseLimitInput(localLowerLimit);
                          const error = getJointLimitsError(currentLower, radValue);
                          if (error) {
                            toast.error(error);
                            return;
                          }
                          onLimitsChange(currentLower, radValue);
                        }
                      }}
                      onBlur={() => {
                        if (!onLimitsChange) return;
                        if (localLowerLimit.trim() !== "" && localUpperLimit.trim() !== "") return;
                        const currentLower = parseLimitInput(localLowerLimit);
                        const currentUpper = parseLimitInput(localUpperLimit);
                        if (
                          currentType === "prismatic" &&
                          currentLower === undefined &&
                          currentUpper === undefined
                        ) {
                          toast.error("Prismatic joints require limits.");
                          return;
                        }
                        const error = getJointLimitsError(currentLower, currentUpper);
                        if (error) {
                          toast.error(error);
                          return;
                        }
                        onLimitsChange(currentLower, currentUpper);
                      }}
                      step={angleUnit === "deg" ? 1 : 0.01}
                      compact
                      allowEmpty
                      className="w-full"
                    />
                  </div>
                </div>
                {(localLowerLimit.trim() === "" || localUpperLimit.trim() === "") && (
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    <span className="text-[8px] text-muted-foreground">
                      {currentType === "revolute" ? "Need limits or set continuous." : "Prismatic needs limits."}
                    </span>
                    {currentType === "revolute" && onTypeChange && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1 text-[8px]"
                        onClick={() => onTypeChange("continuous")}
                      >
                        Continuous
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </BlenderPropertyRow>
          )}

          {/* Joint Type */}
          {onTypeChange && (
            <BlenderPropertyRow label="Type" labelWidth="w-12">
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
                  className="h-5 text-[10px]"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {JOINT_TYPES.map((type) => (
                    <SelectItem key={type} value={type} className="text-[9px]">
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </BlenderPropertyRow>
          )}

          {/* Parent and Child Links */}
          {onLinkChange && urdfContent && (
            <BlenderPropertyRow label="Links" labelWidth="w-12" className="items-start">
              <div className="grid min-w-0 grid-cols-2 gap-1">
                <div className="min-w-0">
                  <div className="mb-0.5 text-[8px] text-muted-foreground">Parent</div>
                  <Select
                    value={jointLinks.parentLink || ""}
                    onValueChange={(value) => {
                      if (jointLinks.childLink && onLinkChange) {
                        onLinkChange(jointName, value, jointLinks.childLink);
                      }
                    }}
                  >
                    <SelectTrigger
                      className="h-5 truncate text-left text-[9px]"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <SelectValue placeholder="Parent" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      {parentLinkOptions.map((link) => (
                        <SelectItem key={link} value={link} className="text-[9px]">
                          <span className="block truncate">{link}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0">
                  <div className="mb-0.5 text-[8px] text-muted-foreground">Child</div>
                  <Select
                    value={jointLinks.childLink || ""}
                    onValueChange={(value) => {
                      if (jointLinks.parentLink && onLinkChange) {
                        onLinkChange(jointName, jointLinks.parentLink, value);
                      }
                    }}
                  >
                    <SelectTrigger
                      className="h-5 truncate text-left text-[9px]"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <SelectValue placeholder="Child" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      {childLinkOptions.map((link) => (
                        <SelectItem key={link} value={link} className="text-[9px]">
                          <span className="block truncate">{link}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </BlenderPropertyRow>
          )}

          {onOriginChange && (
            <OriginRows
              origin={{ xyz: localOriginXyz, rpy: localOriginRpy }}
              onChange={commitOriginChange}
              className="space-y-1"
              inputClassName="h-5 text-[9px]"
              gapClassName="gap-1"
            />
          )}

          {/* Axis */}
          {needsAxis && onAxisChange && (
            <>
              <BlenderPropertyRow label="Axis" labelWidth="w-12">
                <div className="flex min-w-0 items-center gap-1">
                  <Select value={selectedPreset} onValueChange={handleAxisPresetChange}>
                    <SelectTrigger 
                      className="h-5 flex-1 text-[9px]"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <SelectValue>
                        {selectedPreset !== "Custom" && AXIS_PRESETS[selectedPreset] ? (
                          <div className="flex items-center gap-1.5">
                            {AXIS_PRESETS[selectedPreset].icon}
                            <span className="text-[9px]">{AXIS_PRESETS[selectedPreset].label}</span>
                          </div>
                        ) : (
                          "Custom"
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      {Object.entries(AXIS_PRESETS).map(([key, preset]) => (
                        <SelectItem key={key} value={key} className="text-[9px]">
                          <div className="flex items-center gap-1.5">
                            {preset.icon}
                            <span>{preset.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                      <SelectItem value="Custom" className="text-[9px]">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                  {onResetAxis && originalAxis && jointAxis && (
                    JSON.stringify(originalAxis.xyz) !== JSON.stringify(jointAxis.xyz) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1 text-[9px]"
                        onClick={() => onResetAxis(jointName)}
                        title="Reset axis to original value"
                      >
                        Reset
                      </Button>
                    )
                  )}
                </div>
              </BlenderPropertyRow>
              {selectedPreset === "Custom" && (
                <BlenderPropertyRow label="XYZ" labelWidth="w-12">
                  <div className="grid grid-cols-3 gap-1">
                    <NumberInput
                      value={parseAxisValue(localAxisX) ?? jointAxis?.xyz?.[0]}
                      onValueChange={(val) => {
                        setLocalAxisX(String(val));
                      }}
                      onBlur={handleAxisCommit}
                      step={0.01}
                      compact
                      className="w-full"
                    />
                    <NumberInput
                      value={parseAxisValue(localAxisY) ?? jointAxis?.xyz?.[1]}
                      onValueChange={(val) => {
                        setLocalAxisY(String(val));
                      }}
                      onBlur={handleAxisCommit}
                      step={0.01}
                      compact
                      className="w-full"
                    />
                    <NumberInput
                      value={parseAxisValue(localAxisZ) ?? jointAxis?.xyz?.[2]}
                      onValueChange={(val) => {
                        setLocalAxisZ(String(val));
                      }}
                      onBlur={handleAxisCommit}
                      step={0.01}
                      compact
                      className="w-full"
                    />
                  </div>
                </BlenderPropertyRow>
              )}
            </>
          )}

          {/* Delete Button */}
          {onDeleteJoint && (
            <div className="pt-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-0 text-[8px] font-medium text-destructive/80 hover:bg-transparent hover:text-destructive"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="w-3 h-3 mr-1.5" />
                Delete Joint
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
              Are you sure you want to delete the joint "{jointName}"?
              {" It will be removed from the current robot model."}
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
