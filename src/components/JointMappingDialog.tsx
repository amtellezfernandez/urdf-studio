import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { Input } from "@/components/ui/input";
import { X, AlertCircle, RotateCcw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JointLimits } from "@/urdf_corrections/parseJointLimits";

export interface JointMapping {
  datasetJoint: string;
  urdfJoint: string;
  offset?: number; // Offset transformation to apply to all values for this joint
  inverted?: boolean; // Whether the joint axis is inverted/flipped
}

export interface SavedMapping {
  id: string;
  source: string;
  mappings: JointMapping[];
  degToRad: boolean;
  timestamp: number;
  jointRanges?: Record<string, { min: number; max: number }>; // Store ranges for editing with alerts
}

interface JointMappingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  datasetJoints: string[];
  urdfJoints: string[];
  jointRanges: Record<string, { min: number; max: number }>;
  existingMapping?: SavedMapping;
  onApply: (mappings: JointMapping[], degToRad: boolean) => void;
  source?: string; // Dataset source name for display
  jointLimits?: JointLimits; // URDF joint limits for comparison
}

export const JointMappingDialog = ({
  isOpen,
  onClose,
  datasetJoints,
  urdfJoints,
  jointRanges,
  existingMapping,
  onApply,
  source,
  jointLimits = {},
}: JointMappingDialogProps) => {
  // Check if dataset has more joints than URDF
  const hasTooManyJoints = datasetJoints.length > urdfJoints.length;
  const [mappings, setMappings] = useState<JointMapping[]>([]);
  const [degToRad, setDegToRad] = useState(false);
  const [autoConverted, setAutoConverted] = useState(false); // Track if auto-converted
  const [errors, setErrors] = useState<string[]>([]);
  const [limitWarnings, setLimitWarnings] = useState<Array<{ joint: string; issue: string }>>([]);
  const [jointOffsets, setJointOffsets] = useState<Record<string, number>>({}); // Offset transformations per joint
  const [proposedOffsets, setProposedOffsets] = useState<Record<string, number>>({}); // Proposed offsets (not yet applied)
  const [offsetInputValues, setOffsetInputValues] = useState<Record<string, string>>({}); // Raw input values for free editing
  const [jointInversions, setJointInversions] = useState<Record<string, boolean>>({}); // Track which joints are inverted
  
  // Dragging state
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset position when dialog opens
  useEffect(() => {
    if (isOpen) {
      setPosition({ x: 0, y: 0 });
    }
  }, [isOpen]);

  // Auto-detect if values are in degrees and convert
  useEffect(() => {
    if (existingMapping) {
      setMappings(existingMapping.mappings);
      setDegToRad(existingMapping.degToRad);
      setAutoConverted(false);
      
      // Initialize offsets and inversions from existing mapping
      const offsets: Record<string, number> = {};
      const inversions: Record<string, boolean> = {};
      existingMapping.mappings.forEach(m => {
        if (m.offset !== undefined) {
          offsets[m.datasetJoint] = m.offset;
        }
        if (m.inverted !== undefined) {
          inversions[m.datasetJoint] = m.inverted;
        }
      });
      setJointOffsets(offsets);
      setJointInversions(inversions);
    } else {
      // Create initial mappings (try to auto-match by name)
      const initialMappings = datasetJoints.map((datasetJoint) => {
        // Try to find matching URDF joint by name
        const matchingUrdf = urdfJoints.find(
          (urdfJoint) =>
            urdfJoint.toLowerCase() === datasetJoint.toLowerCase() ||
            urdfJoint.toLowerCase().includes(datasetJoint.toLowerCase()) ||
            datasetJoint.toLowerCase().includes(urdfJoint.toLowerCase())
        );
        return {
          datasetJoint,
          urdfJoint: matchingUrdf || "",
        };
      });
      setMappings(initialMappings);

      // Auto-detect degrees: if max absolute value > π (≈3.14), likely degrees
      const maxAbsValue = Math.max(
        ...Object.values(jointRanges).map(r => Math.max(Math.abs(r.min), Math.abs(r.max)))
      );
      const likelyDegrees = maxAbsValue > Math.PI;
      
      if (likelyDegrees) {
        setDegToRad(true);
        setAutoConverted(true);
      } else {
        setDegToRad(false);
        setAutoConverted(false);
      }
    }
  }, [datasetJoints, urdfJoints, existingMapping, jointRanges]);

  // Helper function to detect joint inversion using Range Overlap Test
  const detectInversion = (
    datasetMin: number,
    datasetMax: number,
    urdfLower: number,
    urdfUpper: number
  ): boolean => {
    // Compute flipped dataset range
    const flippedMin = -datasetMax;
    const flippedMax = -datasetMin;
    
    // Calculate how much of each range fits inside URDF limits
    const originalFit = Math.max(0, Math.min(datasetMax, urdfUpper) - Math.max(datasetMin, urdfLower));
    const flippedFit = Math.max(0, Math.min(flippedMax, urdfUpper) - Math.max(flippedMin, urdfLower));
    
    // Calculate overlap ratios
    const originalRangeSize = datasetMax - datasetMin;
    const flippedRangeSize = flippedMax - flippedMin;
    const urdfRangeSize = urdfUpper - urdfLower;
    
    const originalOverlapRatio = originalRangeSize > 0 ? originalFit / originalRangeSize : 0;
    const flippedOverlapRatio = flippedRangeSize > 0 ? flippedFit / flippedRangeSize : 0;
    const originalFitRatio = urdfRangeSize > 0 ? originalFit / urdfRangeSize : 0;
    const flippedFitRatio = urdfRangeSize > 0 ? flippedFit / urdfRangeSize : 0;
    
    // If flipped range fits significantly better, joint is inverted
    // Use multiple criteria: overlap ratio and fit ratio
    const flippedIsBetter = 
      flippedOverlapRatio > originalOverlapRatio + 0.1 || // 10% better overlap
      (flippedOverlapRatio > 0 && originalOverlapRatio === 0) || // Flipped fits, original doesn't
      (flippedFitRatio > originalFitRatio + 0.15); // 15% better fit within URDF range
    
    return flippedIsBetter;
  };

  // Check joint limits and generate warnings + detect inversion + detect offset transformations
  useEffect(() => {
    const warnings: Array<{ joint: string; issue: string }> = [];
    const newOffsets: Record<string, number> = {};
    const newProposedOffsets: Record<string, number> = {};
    const newInversions: Record<string, boolean> = {};
    
    for (const mapping of mappings) {
      if (!mapping.urdfJoint || mapping.urdfJoint === "?") continue;
      
      const range = jointRanges[mapping.datasetJoint];
      if (!range) continue;
      
      const urdfLimit = jointLimits[mapping.urdfJoint];
      if (!urdfLimit || urdfLimit.lower === null || urdfLimit.upper === null) continue;
      
      // Convert dataset range to radians if degToRad is enabled
      let datasetMin = range.min;
      let datasetMax = range.max;
      if (degToRad) {
        datasetMin = (range.min * Math.PI) / 180;
        datasetMax = (range.max * Math.PI) / 180;
      }
      
      // Always detect inversion for ALL joints FIRST (before checking limits)
      // Check if user has manually set inversion
      const userSetInversion = mapping.inverted !== undefined 
        ? mapping.inverted 
        : undefined;
      
      const stateInversion = jointInversions[mapping.datasetJoint];
      const existingInversion = userSetInversion !== undefined ? userSetInversion : stateInversion;
      
      // Auto-detect inversion if not manually set
      let detectedInversion = false;
      if (existingInversion === undefined) {
        // No user override - auto-detect for ALL cases
        detectedInversion = detectInversion(datasetMin, datasetMax, urdfLimit.lower, urdfLimit.upper);
        newInversions[mapping.datasetJoint] = detectedInversion;
      } else {
        // User has manually set inversion state - use it
        detectedInversion = existingInversion;
        newInversions[mapping.datasetJoint] = existingInversion;
      }
      
      // Apply inversion if detected or set by user
      let effectiveDatasetMin = datasetMin;
      let effectiveDatasetMax = datasetMax;
      if (detectedInversion) {
        effectiveDatasetMin = -datasetMax;
        effectiveDatasetMax = -datasetMin;
      } else {
        // Explicitly set to false if not inverted
        if (existingInversion === undefined) {
          newInversions[mapping.datasetJoint] = false;
        }
      }
      
      // Check if dataset values exceed URDF limits (using potentially inverted values)
      const isMinOut = effectiveDatasetMin < urdfLimit.lower;
      const isMaxOut = effectiveDatasetMax > urdfLimit.upper;
      
      // Apply existing offset if user has set one
      const existingOffset = mapping.offset !== undefined 
        ? mapping.offset 
        : (jointOffsets[mapping.datasetJoint] !== undefined ? jointOffsets[mapping.datasetJoint] : undefined);
      
      // Check warnings with offset applied (if any)
      let transformedMin = effectiveDatasetMin + (existingOffset || 0);
      let transformedMax = effectiveDatasetMax + (existingOffset || 0);
      
      // Check if transformed values (with user-set offset) still have issues
      const isMinOutAfterOffset = transformedMin < urdfLimit.lower;
      const isMaxOutAfterOffset = transformedMax > urdfLimit.upper;
      
      // Show warnings based on current state (with offset if applied)
      if (isMinOutAfterOffset) {
        warnings.push({
          joint: mapping.urdfJoint,
          issue: `Min value ${transformedMin.toFixed(3)} < URDF limit ${urdfLimit.lower.toFixed(3)}`,
        });
      }
      if (isMaxOutAfterOffset) {
        warnings.push({
          joint: mapping.urdfJoint,
          issue: `Max value ${transformedMax.toFixed(3)} > URDF limit ${urdfLimit.upper.toFixed(3)}`,
        });
      }
      
      // Only propose offsets if there are warnings (values out of limits) AND user hasn't set one
      if ((isMinOut || isMaxOut) && existingOffset === undefined) {
        // Check if range is completely out but same size (offset detection)
        const datasetRangeSize = Math.abs(range.max - range.min);
        let datasetRangeSizeTransformed = datasetRangeSize;
        if (degToRad) {
          datasetRangeSizeTransformed = datasetRangeSize * (Math.PI / 180);
        }
        const urdfRangeSize = Math.abs(urdfLimit.upper - urdfLimit.lower);
        
        // Check if ranges are similar in size (within 10% tolerance)
        const rangeSizeRatio = datasetRangeSizeTransformed / urdfRangeSize;
        const isSimilarSize = rangeSizeRatio > 0.90 && rangeSizeRatio < 1.10;
        
        // Check if range is completely outside limits (using inverted values if needed)
        const isCompletelyOut = (effectiveDatasetMax < urdfLimit.lower) || (effectiveDatasetMin > urdfLimit.upper);
        
        let proposedOffset = 0;
        
        if (isSimilarSize && isCompletelyOut) {
          // Range is similar size but completely offset - center it
          const datasetCenter = (effectiveDatasetMin + effectiveDatasetMax) / 2;
          const urdfCenter = (urdfLimit.lower + urdfLimit.upper) / 2;
          proposedOffset = urdfCenter - datasetCenter;
        } else {
          // Range partially overlaps but has issues - propose offset to fit within limits
          if (isMinOut && !isMaxOut) {
            // Only min is out, shift up
            proposedOffset = urdfLimit.lower - effectiveDatasetMin;
          } else if (isMaxOut && !isMinOut) {
            // Only max is out, shift down
            proposedOffset = urdfLimit.upper - effectiveDatasetMax;
          } else if (isMinOut && isMaxOut) {
            // Both are out, center the range
            const datasetCenter = (effectiveDatasetMin + effectiveDatasetMax) / 2;
            const urdfCenter = (urdfLimit.lower + urdfLimit.upper) / 2;
            proposedOffset = urdfCenter - datasetCenter;
          }
        }
        
        // Store proposed offset (will be shown as suggestion, not applied)
        newProposedOffsets[mapping.datasetJoint] = proposedOffset;
      }
      
      // Keep existing offset if user has set one
      if (existingOffset !== undefined && existingOffset !== 0) {
        newOffsets[mapping.datasetJoint] = existingOffset;
      }
    }
    
    // Update inversions state
    setJointInversions(prev => ({ ...prev, ...newInversions }));
    
    
    setLimitWarnings(warnings);
    
    // Update proposed offsets (only for joints with warnings)
    setProposedOffsets(newProposedOffsets);
    
    // Only keep user-set offsets (not proposed ones)
    setJointOffsets(prev => {
      const merged: Record<string, number> = {};
      // Keep only user-set offsets
      Object.keys(prev).forEach(key => {
        const mapping = mappings.find(m => m.datasetJoint === key);
        if (mapping?.offset !== undefined) {
          merged[key] = mapping.offset;
        } else if (prev[key] !== undefined) {
          merged[key] = prev[key];
        }
      });
      // Add any new user-set offsets from mappings
      Object.keys(newOffsets).forEach(key => {
        if (newOffsets[key] !== 0 && newOffsets[key] !== undefined) {
          merged[key] = newOffsets[key];
        }
      });
      return merged;
    });
  }, [mappings, jointRanges, jointLimits, degToRad, jointOffsets, jointInversions]);

  // Validate mappings
  const validationErrors = useMemo(() => {
    const errors: string[] = [];

    // Check for duplicate URDF joints (excluding empty)
    const usedUrdfJoints = mappings
      .map((m) => m.urdfJoint)
      .filter((j) => j && j !== "?");
    const uniqueUrdfJoints = new Set(usedUrdfJoints);
    if (usedUrdfJoints.length !== uniqueUrdfJoints.size) {
      errors.push("Duplicate URDF joints detected");
    }

    // Check for invalid URDF joints
    const invalidUrdfJoints = mappings
      .filter((m) => m.urdfJoint && m.urdfJoint !== "?" && !urdfJoints.includes(m.urdfJoint))
      .map((m) => m.urdfJoint);
    if (invalidUrdfJoints.length > 0) {
      errors.push(`Invalid URDF joints: ${invalidUrdfJoints.join(", ")}`);
    }

    // Check for unmapped dataset joints (unless explicitly set to "?")
    const unmappedDatasetJoints = mappings
      .filter((m) => !m.urdfJoint || m.urdfJoint === "")
      .map((m) => m.datasetJoint);
    if (unmappedDatasetJoints.length > 0) {
      errors.push(`Unmapped dataset joints: ${unmappedDatasetJoints.join(", ")}`);
    }

    // Check if dataset joints > URDF joints
    const mappedCount = mappings.filter((m) => m.urdfJoint && m.urdfJoint !== "?").length;
    if (mappedCount > urdfJoints.length) {
      errors.push("Cannot map more dataset joints than available URDF joints");
    }

    return errors;
  }, [mappings, urdfJoints, hasTooManyJoints, datasetJoints.length, urdfJoints.length]);

  useEffect(() => {
    setErrors(validationErrors);
  }, [validationErrors]);

  const handleMappingChange = (datasetJoint: string, urdfJoint: string) => {
    setMappings((prev) =>
      prev.map((m) =>
        m.datasetJoint === datasetJoint ? { ...m, urdfJoint } : m
      )
    );
  };

  const handleOffsetChange = (datasetJoint: string, offset: number | undefined) => {
    const newOffsets = { ...jointOffsets };
    if (offset !== undefined && !isNaN(offset)) {
      newOffsets[datasetJoint] = offset;
    } else {
      delete newOffsets[datasetJoint];
    }
    setJointOffsets(newOffsets);
    
    // Update mappings with offset (allow 0 as valid value)
    setMappings((prev) =>
      prev.map((m) =>
        m.datasetJoint === datasetJoint 
          ? { ...m, offset: offset !== undefined && !isNaN(offset) ? offset : undefined } 
          : m
      )
    );
  };

  const handleInversionToggle = (datasetJoint: string, inverted: boolean) => {
    const newInversions = { ...jointInversions };
    newInversions[datasetJoint] = inverted;
    setJointInversions(newInversions);
    
    // Update mappings with inversion (store false as undefined to allow auto-detection later)
    setMappings((prev) =>
      prev.map((m) =>
        m.datasetJoint === datasetJoint 
          ? { ...m, inverted: inverted ? true : undefined } 
          : m
      )
    );
  };

  const handleUndoConversion = () => {
    setDegToRad(false);
    setAutoConverted(false);
  };

  const handleApply = () => {
    if (validationErrors.length > 0) {
      return;
    }
    // Include offsets and inversions in mappings
    const mappingsWithOffsets = mappings.map(m => ({
      ...m,
      offset: jointOffsets[m.datasetJoint] !== undefined ? jointOffsets[m.datasetJoint] : undefined,
      inverted: jointInversions[m.datasetJoint] !== undefined ? jointInversions[m.datasetJoint] : undefined
    }));
    onApply(mappingsWithOffsets, degToRad);
    onClose();
  };

  const getSampleValue = (datasetJoint: string) => {
    const range = jointRanges[datasetJoint];
    if (!range) return "N/A";
    // Return the first value (min) as sample
    return range.min.toFixed(3);
  };

  // Drag handlers
  const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if (!dialogRef.current) return;
    e.preventDefault();
    const rect = dialogRef.current.getBoundingClientRect();
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    // Initialize position if not set
    if (position.x === 0 && position.y === 0) {
      setPosition({
        x: rect.left,
        y: rect.top,
      });
    }
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  if (!isOpen) return null;

  return (
    <>
      {/* Light overlay - allows seeing background */}
      <div
        className="fixed inset-0 z-50 bg-black/30"
        onClick={onClose}
      />
      {/* Draggable dialog */}
      <div
        ref={dialogRef}
        className={cn(
          "fixed z-50 w-[600px] max-w-[90vw] max-h-[75vh] overflow-hidden flex flex-col bg-[#2d2d2d] border border-[#3d3d3d] text-[#d4d4d4] p-0 shadow-lg",
          position.x === 0 && position.y === 0 ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" : ""
        )}
        style={
          position.x !== 0 || position.y !== 0
            ? {
                left: `${position.x}px`,
                top: `${position.y}px`,
              }
            : undefined
        }
        onClick={(e) => e.stopPropagation()}
      >
        {/* Draggable Header */}
        <div
          className="flex-shrink-0 px-3 py-2 border-b border-[#3d3d3d] cursor-move flex items-center justify-between"
          onMouseDown={handleHeaderMouseDown}
        >
          <div className="text-xs font-normal text-[#d4d4d4] select-none">
            Joint Mapping{source && ` - ${source}`}
            {hasTooManyJoints && (
              <span className="ml-2 text-[#d46d6d]">(nonvalid)</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-[#9d9d9d] hover:text-[#d4d4d4] transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        {/* Error Banner */}
        {errors.length > 0 && (
          <div className="flex-shrink-0 px-3 py-1.5 bg-[#3d1e1e] border-b border-[#5d2e2e] text-[10px]">
            <div className="flex items-start gap-1.5">
              <AlertCircle className="h-3 w-3 text-[#d46d6d] flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-0.5">
                {errors.map((error, idx) => (
                  <div key={idx} className="text-[#d46d6d]">
                    {error}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Deg→Rad Toggle with Auto-convert and Undo */}
        <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 bg-[#252525] border-b border-[#3d3d3d]">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#9d9d9d]">Deg→Rad</span>
            {autoConverted && degToRad && (
              <Button
                onClick={handleUndoConversion}
                variant="ghost"
                size="sm"
                className="h-5 px-2 text-[9px] text-[#9d9d9d] hover:text-[#d4d4d4] hover:bg-[#3d3d3d]"
                title="Undo auto-conversion"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Undo
              </Button>
            )}
          </div>
          {/* Custom compact switch */}
          <SwitchPrimitives.Root
            checked={degToRad}
            onCheckedChange={(checked) => {
              setDegToRad(checked);
              // Clear auto-converted flag if user manually toggles
              if (!checked || (checked && !autoConverted)) {
                setAutoConverted(false);
              }
            }}
            className="h-3 w-6 rounded-full bg-[#3d3d3d] data-[state=checked]:bg-[#5d7d9d] transition-colors cursor-pointer relative outline-none"
          >
            <SwitchPrimitives.Thumb className="block h-2 w-2 rounded-full bg-white transition-transform duration-100 will-change-transform data-[state=checked]:translate-x-[14px] data-[state=unchecked]:translate-x-[2px] absolute" />
          </SwitchPrimitives.Root>
        </div>

        {/* Joint Limit Warnings */}
        {limitWarnings.length > 0 && (
          <div className="flex-shrink-0 px-3 py-1.5 bg-[#3d2e1e] border-b border-[#5d4e2e] text-[10px]">
            <div className="flex items-start gap-1.5">
              <AlertTriangle className="h-3 w-3 text-[#d4a46d] flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-0.5">
                <div className="text-[#d4a46d] font-medium">Joint limit warnings:</div>
                {limitWarnings.map((warning, idx) => (
                  <div key={idx} className="text-[#d4a46d] font-mono text-[9px]">
                    {warning.joint}: {warning.issue}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Mapping Table */}
        <div className="flex-1 overflow-y-auto blender-scrollbar">
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-[#252525] border-b border-[#3d3d3d]">
              <tr>
                <th className="text-left px-2 py-1 font-normal text-[#9d9d9d]">Dataset</th>
                <th className="text-left px-2 py-1 font-normal text-[#9d9d9d]">URDF</th>
                <th className="text-right px-2 py-1 font-normal text-[#9d9d9d]">Original</th>
                <th className="text-center px-2 py-1 font-normal text-[#9d9d9d]">Invert</th>
                <th className="text-right px-2 py-1 font-normal text-[#9d9d9d]">After Invert</th>
                <th className="text-right px-2 py-1 font-normal text-[#9d9d9d]">Offset</th>
                <th className="text-right px-2 py-1 font-normal text-[#9d9d9d]">Final</th>
                <th className="text-right px-2 py-1 font-normal text-[#9d9d9d]">URDF Limits</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping, idx) => {
                const range = jointRanges[mapping.datasetJoint];
                const hasError =
                  (!mapping.urdfJoint || mapping.urdfJoint === "") ||
                  (mapping.urdfJoint !== "?" && !urdfJoints.includes(mapping.urdfJoint));

                return (
                  <tr
                    key={mapping.datasetJoint}
                    className={cn(
                      "border-b border-[#3d3d3d] hover:bg-[#2d2d2d] transition-colors",
                      idx % 2 === 0 ? "bg-[#252525]" : "bg-[#2a2a2a]",
                      hasError && "bg-[#2d1e1e]"
                    )}
                  >
                    <td className="px-2 py-1 font-mono text-[#d4d4d4] text-[10px]">
                      {mapping.datasetJoint}
                    </td>
                    <td className="px-2 py-1">
                      <Select
                        value={mapping.urdfJoint}
                        onValueChange={(value) =>
                          handleMappingChange(mapping.datasetJoint, value)
                        }
                      >
                        <SelectTrigger
                          className={cn(
                            "h-6 text-[10px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] font-mono px-2",
                            hasError && "border-[#5d2e2e] bg-[#2d1e1e]"
                          )}
                        >
                          <SelectValue placeholder="?" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#282828] border-[#3d3d3d] max-h-[200px]">
                          <SelectItem
                            value="?"
                            className="text-[10px] text-[#9d9d9d] hover:bg-[#3d3d3d] py-1"
                          >
                            (skip)
                          </SelectItem>
                          {urdfJoints.map((joint) => (
                            <SelectItem
                              key={joint}
                              value={joint}
                              className="text-[10px] font-mono text-[#d4d4d4] hover:bg-[#3d3d3d] py-1"
                            >
                              {joint}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    {/* Original Range Column */}
                    <td className="px-2 py-1 text-right">
                      {range ? (() => {
                        const originalMin = degToRad ? (range.min * Math.PI) / 180 : range.min;
                        const originalMax = degToRad ? (range.max * Math.PI) / 180 : range.max;
                        return (
                          <div className="font-mono text-[10px] text-[#9d9d9d]">
                            {originalMin.toFixed(2)} → {originalMax.toFixed(2)}
                          </div>
                        );
                      })() : (
                        <span className="text-[#5d5d5d] text-[10px]">—</span>
                      )}
                    </td>
                    
                    {/* Inversion Column (Yes/No toggle) */}
                    <td className="px-2 py-1 text-center">
                      {range && mapping.urdfJoint && mapping.urdfJoint !== "?" ? (() => {
                        const currentInversion = mapping.inverted !== undefined 
                          ? mapping.inverted 
                          : (jointInversions[mapping.datasetJoint] !== undefined ? jointInversions[mapping.datasetJoint] : false);
                        
                        return (
                          <div className="flex items-center justify-center">
                            <button
                              onClick={() => handleInversionToggle(mapping.datasetJoint, !currentInversion)}
                              className={cn(
                                "px-2 py-0.5 text-[9px] font-mono rounded border transition-colors",
                                currentInversion 
                                  ? "bg-[#5d7dad] border-[#5d7dad] text-white" 
                                  : "bg-[#1e1e1e] border-[#3d3d3d] text-[#9d9d9d] hover:bg-[#2d2d2d]"
                              )}
                            >
                              {currentInversion ? "Yes" : "No"}
                            </button>
                          </div>
                        );
                      })() : (
                        <span className="text-[#5d5d5d] text-[10px]">—</span>
                      )}
                    </td>
                    
                    {/* Result After Inversion Column */}
                    <td className="px-2 py-1 text-right">
                      {range && mapping.urdfJoint && mapping.urdfJoint !== "?" ? (() => {
                        const originalMin = degToRad ? (range.min * Math.PI) / 180 : range.min;
                        const originalMax = degToRad ? (range.max * Math.PI) / 180 : range.max;
                        const isInverted = mapping.inverted !== undefined 
                          ? mapping.inverted 
                          : (jointInversions[mapping.datasetJoint] !== undefined ? jointInversions[mapping.datasetJoint] : false);
                        
                        const afterInvertMin = isInverted ? -originalMax : originalMin;
                        const afterInvertMax = isInverted ? -originalMin : originalMax;
                        
                        return (
                          <div className="font-mono text-[10px] text-[#9d9d9d]">
                            {afterInvertMin.toFixed(2)} → {afterInvertMax.toFixed(2)}
                          </div>
                        );
                      })() : (
                        <span className="text-[#5d5d5d] text-[10px]">—</span>
                      )}
                    </td>
                    
                    {/* Offset Column */}
                    <td className="px-2 py-1 text-right">
                      {(() => {
                        const hasWarning = limitWarnings.some(w => w.joint === mapping.urdfJoint);
                        const hasMapping = mapping.urdfJoint && mapping.urdfJoint !== "?";
                        
                        // Get offset from state or mapping, prioritizing state
                        const userSetOffset = jointOffsets[mapping.datasetJoint] !== undefined 
                          ? jointOffsets[mapping.datasetJoint] 
                          : mapping.offset;
                        
                        // Get proposed offset if available
                        const proposedOffset = proposedOffsets[mapping.datasetJoint];
                        
                        // Always show input field when there's a mapping
                        if (!hasMapping) {
                          return <span className="text-[#5d5d5d] text-[10px]">—</span>;
                        }
                        
                        // Get current offset
                        const currentOffset = userSetOffset !== undefined ? userSetOffset : undefined;
                        const hasProposedOffset = proposedOffset !== undefined && Math.abs(proposedOffset) > 0.0001;
                        const inputKey = `offset-${mapping.datasetJoint}`;
                        
                        // Default to "0" if no offset is set and no warning (no proposal needed)
                        // For joints that don't need offset, always show "0"
                        const showDefaultZero = !hasWarning && currentOffset === undefined;
                        const rawInputValue = offsetInputValues[inputKey] !== undefined 
                          ? offsetInputValues[inputKey] 
                          : (currentOffset !== undefined ? currentOffset.toString() : (showDefaultZero ? "0" : ""));
                        
                        return (
                          <Input
                            type="number"
                            step="any"
                            value={rawInputValue}
                            onChange={(e) => {
                              const rawValue = e.target.value;
                              // Store raw value for free typing - don't parse or save yet
                              setOffsetInputValues(prev => ({
                                ...prev,
                                [inputKey]: rawValue
                              }));
                            }}
                            onBlur={(e) => {
                              // On blur, validate and save the offset
                              const rawValue = e.target.value.trim();
                              const val = rawValue === "" || rawValue === "-" || rawValue === "0"
                                ? undefined 
                                : parseFloat(rawValue);
                              
                              if (val !== undefined && !isNaN(val) && Math.abs(val) > 0.0001) {
                                // Save the valid offset
                                handleOffsetChange(mapping.datasetJoint, val);
                                setOffsetInputValues(prev => ({
                                  ...prev,
                                  [inputKey]: val.toString()
                                }));
                              } else {
                                // Clear invalid or empty input (0 means no offset)
                                handleOffsetChange(mapping.datasetJoint, undefined);
                                setOffsetInputValues(prev => {
                                  const updated = { ...prev };
                                  delete updated[inputKey];
                                  return updated;
                                });
                              }
                            }}
                            onKeyDown={(e) => {
                              // Allow keyboard navigation and editing
                              e.stopPropagation();
                            }}
                            placeholder={hasProposedOffset ? proposedOffset.toFixed(4) : ""}
                            className={cn(
                              "h-5 text-[10px] font-mono bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-1.5 w-24 text-right",
                              currentOffset !== undefined && Math.abs(currentOffset) > 0.0001 && "border-[#5d7dad] bg-[#1e2e3e] ring-1 ring-[#5d7dad]/30",
                              !currentOffset && hasProposedOffset && "placeholder:text-[#7d9dcd]/60"
                            )}
                            style={{ textAlign: 'right' }}
                          />
                        );
                      })()}
                    </td>
                    
                    {/* Final Result Column (after inversion + offset) */}
                    <td className="px-2 py-1 text-right">
                      {range && mapping.urdfJoint && mapping.urdfJoint !== "?" ? (() => {
                        const originalMin = degToRad ? (range.min * Math.PI) / 180 : range.min;
                        const originalMax = degToRad ? (range.max * Math.PI) / 180 : range.max;
                        const isInverted = mapping.inverted !== undefined 
                          ? mapping.inverted 
                          : (jointInversions[mapping.datasetJoint] !== undefined ? jointInversions[mapping.datasetJoint] : false);
                        
                        const afterInvertMin = isInverted ? -originalMax : originalMin;
                        const afterInvertMax = isInverted ? -originalMin : originalMax;
                        
                        const offset = mapping.offset !== undefined 
                          ? mapping.offset 
                          : (jointOffsets[mapping.datasetJoint] !== undefined ? jointOffsets[mapping.datasetJoint] : undefined);
                        
                        const finalMin = afterInvertMin + (offset || 0);
                        const finalMax = afterInvertMax + (offset || 0);
                        
                        const hasWarning = limitWarnings.some(w => w.joint === mapping.urdfJoint);
                        
                        return (
                          <div className="font-mono text-[10px]">
                            <span className={hasWarning ? "text-[#d4a46d]" : "text-[#9d9d9d]"}>
                              {finalMin.toFixed(2)} → {finalMax.toFixed(2)}
                            </span>
                          </div>
                        );
                      })() : (
                        <span className="text-[#5d5d5d] text-[10px]">—</span>
                      )}
                    </td>
                    
                    {/* URDF Limits Column */}
                    <td className="px-2 py-1 text-right">
                      {mapping.urdfJoint && mapping.urdfJoint !== "?" ? (() => {
                        const urdfLimit = jointLimits[mapping.urdfJoint];
                        if (!urdfLimit || (urdfLimit.lower === null && urdfLimit.upper === null)) {
                          return <span className="text-[#5d5d5d] text-[10px]">—</span>;
                        }
                        return (
                          <div className="text-[8px] text-[#5d5d5d] font-mono">
                            [{urdfLimit.lower !== null ? urdfLimit.lower.toFixed(2) : "-∞"}, {urdfLimit.upper !== null ? urdfLimit.upper.toFixed(2) : "∞"}]
                          </div>
                        );
                      })() : (
                        <span className="text-[#5d5d5d] text-[10px]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer Actions */}
        <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-t border-[#3d3d3d] bg-[#252525]">
          <div className="text-[10px] text-[#9d9d9d]">
            {mappings.filter((m) => m.urdfJoint && m.urdfJoint !== "?").length}/{datasetJoints.length}
          </div>
          <div className="flex gap-1.5">
            <Button
              onClick={onClose}
              variant="outline"
              className="h-6 px-3 text-[10px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] hover:bg-[#2d2d2d] hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={handleApply}
              disabled={errors.length > 0 || hasTooManyJoints}
              className={cn(
                "h-6 px-3 text-[10px]",
                errors.length > 0 || hasTooManyJoints
                  ? "bg-[#3d3d3d] text-[#5d5d5d] cursor-not-allowed"
                  : "bg-[#5d7d9d] text-white hover:bg-[#6d8dad]"
              )}
            >
              {hasTooManyJoints ? "Nonvalid" : "Apply"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};
