import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { Input } from "@/shared/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/shared/ui/tabs";
import { X, AlertCircle, RotateCcw, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { JointLimits } from "@/shared/lib/urdfBrowser";
import type { JointLimitMode, JointMapping, SavedMapping } from "@/shared/types/feature";
import {
  buildInitialJointMappings,
  reconcileJointMappingsToAvailableUrdfJoints,
} from "@/features/dataset/jointAutoMapping";
import { resolveJointRangeDegToRadConversion } from "@/features/dataset/jointUnitDetection";
import {
  computeJointMappingDiagnostics,
  type MappingDiagnosticExcludedChannel,
} from "@/features/dataset/jointMappingDiagnostics";
import { JOINT_MAPPING_DIAGNOSTICS_PARAMS } from "@/features/dataset/jointMappingDiagnosticsParams";

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
  datasetPath?: string; // Dataset path for loading meta/info.json
  applyLabel?: string;
  signalField?: string | null;
  signalProfileId?: string;
  excludedChannels?: MappingDiagnosticExcludedChannel[];
}

interface DatasetFeature {
  dtype?: string;
  shape?: number[];
  names?: string[] | Record<string, unknown> | null;
  description?: string;
  fps?: number;
  info?: Record<string, unknown>;
}

interface DatasetMetadata {
  codebase_version?: string;
  robot_type?: string;
  fps?: number;
  chunks_size?: number;
  total_episodes?: number;
  total_frames?: number;
  total_tasks?: number;
  files_size_in_mb?: number;
  data_files_size_in_mb?: number;
  video_files_size_in_mb?: number;
  splits?: Record<string, number | string>;
  data_path?: string;
  video_path?: string;
  features?: Record<string, DatasetFeature>;
}

const areNumberRecordsEqual = (
  left: Record<string, number>,
  right: Record<string, number>
) => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (left[key] !== right[key]) return false;
  }
  return true;
};

const areBooleanRecordsEqual = (
  left: Record<string, boolean>,
  right: Record<string, boolean>
) => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (left[key] !== right[key]) return false;
  }
  return true;
};

const areWarningsEqual = (
  left: Array<{ joint: string; issue: string }>,
  right: Array<{ joint: string; issue: string }>
) => {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index];
    const r = right[index];
    if (!r || l.joint !== r.joint || l.issue !== r.issue) {
      return false;
    }
  }
  return true;
};

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
  datasetPath,
  applyLabel,
  signalField,
  signalProfileId,
  excludedChannels = [],
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
  const [activeTab, setActiveTab] = useState<"mapping" | "metadata">("mapping");
  const [metadata, setMetadata] = useState<DatasetMetadata | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);

  const mappingDiagnostics = useMemo(
    () =>
      computeJointMappingDiagnostics({
        datasetJoints,
        urdfJoints,
        mappings,
        excludedChannels,
      }),
    [datasetJoints, urdfJoints, mappings, excludedChannels]
  );
  
  // Dragging state
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset position when dialog opens
  useEffect(() => {
    if (isOpen) {
      setPosition({ x: 0, y: 0 });
      setActiveTab("mapping");
      setMetadata(null);
      setMetadataError(null);
    }
  }, [isOpen]);

  // Load metadata when metadata tab is active
  useEffect(() => {
    if (isOpen && activeTab === "metadata" && datasetPath && !metadata && !metadataLoading) {
      setMetadataLoading(true);
      setMetadataError(null);
      
      const loadMetadata = async () => {
        try {
          // Try to fetch from Hugging Face
          const infoUrl = `https://huggingface.co/datasets/${datasetPath}/raw/main/meta/info.json`;
          const response = await fetch(infoUrl);
          
          if (!response.ok) {
            throw new Error(`Failed to load metadata: ${response.statusText}`);
          }
          
          const data = (await response.json()) as DatasetMetadata;
          setMetadata(data);
        } catch (error) {
          console.error("Failed to load metadata:", error);
          setMetadataError(error instanceof Error ? error.message : "Failed to load metadata");
        } finally {
          setMetadataLoading(false);
        }
      };
      
      loadMetadata();
    }
  }, [isOpen, activeTab, datasetPath, metadata, metadataLoading]);

  // Auto-detect if values are in degrees and convert
  useEffect(() => {
    if (existingMapping) {
      const reconciledMappings = reconcileJointMappingsToAvailableUrdfJoints({
        datasetJoints,
        urdfJoints,
        mappings: existingMapping.mappings,
        jointLimits,
      });
      setMappings(reconciledMappings);
      const unitResolution = resolveJointRangeDegToRadConversion({
        jointRanges,
        existingDegToRad: existingMapping.degToRad,
      });
      setDegToRad(unitResolution.degToRad);
      setAutoConverted(unitResolution.autoConverted);
      
      // Initialize offsets and inversions from existing mapping
      const offsets: Record<string, number> = {};
      const inversions: Record<string, boolean> = {};
      reconciledMappings.forEach(m => {
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
      // Create initial mappings with robust name scoring + movable-joint preference.
      const initialMappings = buildInitialJointMappings({
        datasetJoints,
        urdfJoints,
        jointLimits,
      });
      setMappings(initialMappings);

      const unitResolution = resolveJointRangeDegToRadConversion({ jointRanges });
      setDegToRad(unitResolution.degToRad);
      setAutoConverted(unitResolution.autoConverted);
    }
  }, [datasetJoints, urdfJoints, existingMapping, jointRanges, jointLimits]);

  // Check joint limits and generate warnings + proposed offset transformations.
  useEffect(() => {
    const warnings: Array<{ joint: string; issue: string }> = [];
    const newOffsets: Record<string, number> = {};
    const newProposedOffsets: Record<string, number> = {};
    
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
      
      const explicitInversion =
        mapping.inverted ?? jointInversions[mapping.datasetJoint] ?? false;
      const effectiveDatasetMin = explicitInversion ? -datasetMax : datasetMin;
      const effectiveDatasetMax = explicitInversion ? -datasetMin : datasetMax;
      
      // Check if dataset values exceed URDF limits (using potentially inverted values)
      const isMinOut = effectiveDatasetMin < urdfLimit.lower;
      const isMaxOut = effectiveDatasetMax > urdfLimit.upper;
      
      // Apply existing offset if user has set one
      const existingOffset = mapping.offset !== undefined 
        ? mapping.offset 
        : (jointOffsets[mapping.datasetJoint] !== undefined ? jointOffsets[mapping.datasetJoint] : undefined);
      
      // Check warnings with offset applied (if any)
      const transformedMin = effectiveDatasetMin + (existingOffset || 0);
      const transformedMax = effectiveDatasetMax + (existingOffset || 0);
      
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

    if (!areWarningsEqual(limitWarnings, warnings)) {
      setLimitWarnings(warnings);
    }

    if (!areNumberRecordsEqual(proposedOffsets, newProposedOffsets)) {
      setProposedOffsets(newProposedOffsets);
    }

    // Only keep user-set offsets (not proposed ones)
    const mergedOffsets: Record<string, number> = {};
    Object.keys(jointOffsets).forEach((key) => {
      const mapping = mappings.find((m) => m.datasetJoint === key);
      if (mapping?.offset !== undefined) {
        mergedOffsets[key] = mapping.offset;
      } else if (jointOffsets[key] !== undefined) {
        mergedOffsets[key] = jointOffsets[key];
      }
    });
    Object.keys(newOffsets).forEach((key) => {
      if (newOffsets[key] !== 0 && newOffsets[key] !== undefined) {
        mergedOffsets[key] = newOffsets[key];
      }
    });
    if (!areNumberRecordsEqual(jointOffsets, mergedOffsets)) {
      setJointOffsets(mergedOffsets);
    }
  }, [
    degToRad,
    jointInversions,
    jointLimits,
    jointOffsets,
    jointRanges,
    limitWarnings,
    mappings,
    proposedOffsets,
  ]);

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
  }, [mappings, urdfJoints]);

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

  const handleLimitModeChange = (datasetJoint: string, mode: JointLimitMode) => {
    setMappings((prev) =>
      prev.map((m) =>
        m.datasetJoint === datasetJoint ? { ...m, limitMode: mode } : m
      )
    );
  };

  const handleUndoConversion = () => {
    setDegToRad(false);
    setAutoConverted(false);
  };

  const buildMappingsWithTransforms = () =>
    mappings.map((mapping) => ({
      ...mapping,
      offset:
        jointOffsets[mapping.datasetJoint] !== undefined
          ? jointOffsets[mapping.datasetJoint]
          : undefined,
      inverted:
        jointInversions[mapping.datasetJoint] !== undefined
          ? jointInversions[mapping.datasetJoint]
          : undefined,
    }));

  const handleApply = () => {
    if (validationErrors.length > 0) {
      return;
    }
    onApply(buildMappingsWithTransforms(), degToRad);
    onClose();
  };

  const handleCloseDialog = () => {
    onClose();
  };

  const formatPreviewList = useCallback((values: string[]) => {
    if (values.length === 0) {
      return "none";
    }
    const previewLimit = JOINT_MAPPING_DIAGNOSTICS_PARAMS.previewListLimit;
    const preview = values.slice(0, previewLimit).join(", ");
    const remaining = values.length - previewLimit;
    if (remaining > 0) {
      return `${preview}, +${remaining} more`;
    }
    return preview;
  }, []);

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

  const dialogContent = (
    <>
      {/* Light overlay - allows seeing background */}
      <div
        className="fixed inset-0 z-[9999] bg-black/30"
        onClick={handleCloseDialog}
      />
      {/* Draggable dialog */}
      <div
        ref={dialogRef}
        className={cn(
          "fixed z-[9999] w-[700px] max-w-[calc(100vw-40px)] max-h-[85vh] overflow-hidden flex flex-col bg-[#2d2d2d] border border-[#3d3d3d] text-[#d4d4d4] p-0 shadow-2xl",
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
        {/* Draggable Header - Compact Blender Style */}
        <div
          className="flex-shrink-0 px-2 py-1 border-b border-[#3d3d3d] cursor-move flex items-center justify-between bg-[#252525]"
          onMouseDown={handleHeaderMouseDown}
        >
          <div className="text-[10px] font-normal text-[#d4d4d4] select-none">
            {source || "Dataset"}
            {hasTooManyJoints && (
              <span className="ml-1.5 text-[#d46d6d] text-[9px]">(nonvalid)</span>
            )}
          </div>
          <button
            onClick={handleCloseDialog}
            className="text-[#9d9d9d] hover:text-[#d4d4d4] transition-colors p-0.5"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        {/* Tabs - Compact */}
        <div className="flex-shrink-0 px-2 py-1 border-b border-[#3d3d3d] bg-[#252525]">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "mapping" | "metadata")} className="w-full">
            <TabsList className="w-full grid grid-cols-2 bg-[#1e1e1e] border border-[#3d3d3d] h-6">
              <TabsTrigger 
                value="mapping" 
                className="text-[9px] h-5 data-[state=active]:bg-[#5d7d9d] data-[state=active]:text-white text-[#9d9d9d] py-0"
              >
                Joint Mapping
              </TabsTrigger>
              <TabsTrigger 
                value="metadata"
                className="text-[9px] h-5 data-[state=active]:bg-[#5d7d9d] data-[state=active]:text-white text-[#9d9d9d] py-0"
              >
                Metadata
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto blender-scrollbar">
          {activeTab === "mapping" ? (
            <>
              {/* Error Banner - Compact */}
              {errors.length > 0 && (
                <div className="flex-shrink-0 px-2 py-1 bg-[#3d1e1e] border-b border-[#5d2e2e] text-[9px]">
                  <div className="flex items-start gap-1">
                    <AlertCircle className="h-2.5 w-2.5 text-[#d46d6d] flex-shrink-0 mt-0.5" />
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

              {/* Deg→Rad Toggle with Auto-convert and Undo - Compact */}
              <div className="flex-shrink-0 flex items-center justify-between gap-2 px-2 py-1 bg-[#252525] border-b border-[#3d3d3d]">
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-[#9d9d9d]">Deg→Rad</span>
                  {autoConverted && degToRad && (
                    <Button
                      onClick={handleUndoConversion}
                      variant="ghost"
                      size="sm"
                      className="h-4 px-1.5 text-[8px] text-[#9d9d9d] hover:text-[#d4d4d4] hover:bg-[#3d3d3d]"
                      title="Undo auto-conversion"
                    >
                      <RotateCcw className="h-2.5 w-2.5 mr-0.5" />
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

              {/* Joint Limit Warnings - Compact */}
              {limitWarnings.length > 0 && (
                <div className="flex-shrink-0 px-2 py-1 bg-[#3d2e1e] border-b border-[#5d4e2e] text-[9px]">
                  <div className="flex items-start gap-1">
                    <AlertTriangle className="h-2.5 w-2.5 text-[#d4a46d] flex-shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-0.5">
                      <div className="text-[#d4a46d] font-medium text-[9px]">Joint limit warnings:</div>
                      {limitWarnings.map((warning, idx) => (
                        <div key={idx} className="text-[#d4a46d] font-mono text-[8px]">
                          {warning.joint}: {warning.issue}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex-shrink-0 px-2 py-1 border-b border-[#3d3d3d] bg-[#222222] text-[8px] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#d4d4d4]">Mapping Diagnostics</span>
                  <span className="text-[#9d9d9d]">
                    Field:{" "}
                    <span className="font-mono text-[#d4d4d4]">
                      {signalField ?? "auto"}
                    </span>
                    {signalProfileId ? (
                      <>
                        {" "}
                        | Profile:{" "}
                        <span className="font-mono text-[#d4d4d4]">
                          {signalProfileId}
                        </span>
                      </>
                    ) : null}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[#9d9d9d]">
                  <div>
                    Dataset mapped:{" "}
                    <span className="font-mono text-[#d4d4d4]">
                      {mappingDiagnostics.mappedDatasetJoints.length}/{datasetJoints.length}
                    </span>
                  </div>
                  <div>
                    URDF used:{" "}
                    <span className="font-mono text-[#d4d4d4]">
                      {mappingDiagnostics.usedUrdfJoints.length}/{urdfJoints.length}
                    </span>
                  </div>
                  <div>
                    Dataset skipped:{" "}
                    <span className="font-mono text-[#d4d4d4]">
                      {mappingDiagnostics.skippedDatasetJoints.length}
                    </span>
                  </div>
                  <div>
                    URDF unused:{" "}
                    <span className="font-mono text-[#d4d4d4]">
                      {mappingDiagnostics.unusedUrdfJoints.length}
                    </span>
                  </div>
                  <div>
                    Duplicate URDF targets:{" "}
                    <span className="font-mono text-[#d4d4d4]">
                      {mappingDiagnostics.duplicateUrdfTargets.length}
                    </span>
                  </div>
                  <div>
                    Excluded non-joint channels:{" "}
                    <span className="font-mono text-[#d4d4d4]">
                      {mappingDiagnostics.excludedChannels.length}
                    </span>
                  </div>
                </div>
                {mappingDiagnostics.invalidMappedDatasetJoints.length > 0 && (
                  <div className="text-[#d46d6d]">
                    Invalid URDF targets:{" "}
                    <span className="font-mono">
                      {formatPreviewList(mappingDiagnostics.invalidMappedDatasetJoints)}
                    </span>
                  </div>
                )}
                <div className="text-[#9d9d9d]">
                  Skipped dataset joints:{" "}
                  <span className="font-mono text-[#d4d4d4]">
                    {formatPreviewList(mappingDiagnostics.skippedDatasetJoints)}
                  </span>
                </div>
                <div className="text-[#9d9d9d]">
                  Unused URDF joints:{" "}
                  <span className="font-mono text-[#d4d4d4]">
                    {formatPreviewList(mappingDiagnostics.unusedUrdfJoints)}
                  </span>
                </div>
                <div className="text-[#9d9d9d]">
                  Excluded base channels:{" "}
                  <span className="font-mono text-[#d4d4d4]">
                    {formatPreviewList(
                      mappingDiagnostics.excludedBaseChannels.map(
                        (channel) => `${channel.name} (${channel.semantic})`
                      )
                    )}
                  </span>
                </div>
                {mappingDiagnostics.excludedOtherChannels.length > 0 && (
                  <div className="text-[#9d9d9d]">
                    Other excluded channels:{" "}
                    <span className="font-mono text-[#d4d4d4]">
                      {formatPreviewList(
                        mappingDiagnostics.excludedOtherChannels.map(
                          (channel) => `${channel.name} (${channel.semantic})`
                        )
                      )}
                    </span>
                  </div>
                )}
                {mappingDiagnostics.wheelLikeDatasetJoints.length > 0 && (
                  <div className="text-[#d4a46d]">
                    Wheel-like dataset joints mapped:{" "}
                    <span className="font-mono">
                      {mappingDiagnostics.mappedWheelLikeDatasetJoints.length}/
                      {mappingDiagnostics.wheelLikeDatasetJoints.length}
                    </span>{" "}
                    (
                    <span className="font-mono">
                      {formatPreviewList(
                        mappingDiagnostics.mappedWheelLikeDatasetJoints
                      )}
                    </span>
                    )
                  </div>
                )}
                {mappingDiagnostics.duplicateUrdfTargets.length > 0 && (
                  <div className="text-[#d4a46d]">
                    Duplicate URDF target detail:{" "}
                    <span className="font-mono">
                      {formatPreviewList(
                        mappingDiagnostics.duplicateUrdfTargets.map(
                          (entry) =>
                            `${entry.urdfJoint} <= [${entry.datasetJoints.join(", ")}]`
                        )
                      )}
                    </span>
                  </div>
                )}
              </div>

              {/* Mapping Table - Compact Blender Style */}
          <table className="w-full text-[9px]">
            <thead className="sticky top-0 bg-[#252525] border-b border-[#3d3d3d] z-10">
              <tr>
                <th className="text-left px-1.5 py-0.5 font-normal text-[#9d9d9d] text-[9px]">Dataset</th>
                <th className="text-left px-1.5 py-0.5 font-normal text-[#9d9d9d] text-[9px]">URDF</th>
                <th className="text-right px-1.5 py-0.5 font-normal text-[#9d9d9d] text-[9px]">Original</th>
                <th className="text-center px-1.5 py-0.5 font-normal text-[#9d9d9d] text-[9px]">Invert</th>
                <th className="text-right px-1.5 py-0.5 font-normal text-[#9d9d9d] text-[9px]">After Invert</th>
                <th className="text-right px-1.5 py-0.5 font-normal text-[#9d9d9d] text-[9px]">Offset</th>
                <th className="text-right px-1.5 py-0.5 font-normal text-[#9d9d9d] text-[9px]">Final</th>
                <th className="text-right px-1.5 py-0.5 font-normal text-[#9d9d9d] text-[9px]">URDF Limits</th>
                <th className="text-right px-1.5 py-0.5 font-normal text-[#9d9d9d] text-[9px]">Limit Mode</th>
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
                    <td className="px-1.5 py-0.5 font-mono text-[#d4d4d4] text-[9px]">
                      {mapping.datasetJoint}
                    </td>
                    <td className="px-1.5 py-0.5">
                      <Select
                        value={mapping.urdfJoint}
                        onValueChange={(value) =>
                          handleMappingChange(mapping.datasetJoint, value)
                        }
                      >
                        <SelectTrigger
                          className={cn(
                            "h-5 text-[9px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] font-mono px-1.5",
                            hasError && "border-[#5d2e2e] bg-[#2d1e1e]"
                          )}
                        >
                          <SelectValue placeholder="?" />
                        </SelectTrigger>
                        <SelectContent className="z-[10010] bg-[#282828] border-[#3d3d3d] max-h-[200px]">
                          <SelectItem
                            value="?"
                            className="text-[9px] text-[#9d9d9d] hover:bg-[#3d3d3d] py-0.5"
                          >
                            (skip)
                          </SelectItem>
                          {urdfJoints.map((joint) => (
                            <SelectItem
                              key={joint}
                              value={joint}
                              className="text-[9px] font-mono text-[#d4d4d4] hover:bg-[#3d3d3d] py-0.5"
                            >
                              {joint}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    {/* Original Range Column */}
                    <td className="px-1.5 py-0.5 text-right">
                      {range ? (() => {
                        const originalMin = degToRad ? (range.min * Math.PI) / 180 : range.min;
                        const originalMax = degToRad ? (range.max * Math.PI) / 180 : range.max;
                        return (
                          <div className="font-mono text-[9px] text-[#9d9d9d]">
                            {originalMin.toFixed(2)} → {originalMax.toFixed(2)}
                          </div>
                        );
                      })() : (
                        <span className="text-[#5d5d5d] text-[9px]">—</span>
                      )}
                    </td>
                    
                    {/* Inversion Column (Yes/No toggle) */}
                    <td className="px-1.5 py-0.5 text-center">
                      {range && mapping.urdfJoint && mapping.urdfJoint !== "?" ? (() => {
                        const currentInversion = mapping.inverted !== undefined 
                          ? mapping.inverted 
                          : (jointInversions[mapping.datasetJoint] !== undefined ? jointInversions[mapping.datasetJoint] : false);
                        
                        return (
                          <div className="flex items-center justify-center">
                            <button
                              onClick={() => handleInversionToggle(mapping.datasetJoint, !currentInversion)}
                              className={cn(
                                "px-1.5 py-0.5 text-[8px] font-mono rounded border transition-colors",
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
                        <span className="text-[#5d5d5d] text-[9px]">—</span>
                      )}
                    </td>
                    
                    {/* Result After Inversion Column */}
                    <td className="px-1.5 py-0.5 text-right">
                      {range && mapping.urdfJoint && mapping.urdfJoint !== "?" ? (() => {
                        const originalMin = degToRad ? (range.min * Math.PI) / 180 : range.min;
                        const originalMax = degToRad ? (range.max * Math.PI) / 180 : range.max;
                        const isInverted = mapping.inverted !== undefined 
                          ? mapping.inverted 
                          : (jointInversions[mapping.datasetJoint] !== undefined ? jointInversions[mapping.datasetJoint] : false);
                        
                        const afterInvertMin = isInverted ? -originalMax : originalMin;
                        const afterInvertMax = isInverted ? -originalMin : originalMax;
                        
                        return (
                          <div className="font-mono text-[9px] text-[#9d9d9d]">
                            {afterInvertMin.toFixed(2)} → {afterInvertMax.toFixed(2)}
                          </div>
                        );
                      })() : (
                        <span className="text-[#5d5d5d] text-[9px]">—</span>
                      )}
                    </td>
                    
                    {/* Offset Column */}
                    <td className="px-1.5 py-0.5 text-right">
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
                          return <span className="text-[#5d5d5d] text-[9px]">—</span>;
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
                              "h-4 text-[9px] font-mono bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-1 w-20 text-right",
                              currentOffset !== undefined && Math.abs(currentOffset) > 0.0001 && "border-[#5d7dad] bg-[#1e2e3e] ring-1 ring-[#5d7dad]/30",
                              !currentOffset && hasProposedOffset && "placeholder:text-[#7d9dcd]/60"
                            )}
                            style={{ textAlign: 'right' }}
                          />
                        );
                      })()}
                    </td>
                    
                    {/* Final Result Column (after inversion + offset) */}
                    <td className="px-1.5 py-0.5 text-right">
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
                          <div className="font-mono text-[9px]">
                            <span className={hasWarning ? "text-[#d4a46d]" : "text-[#9d9d9d]"}>
                              {finalMin.toFixed(2)} → {finalMax.toFixed(2)}
                            </span>
                          </div>
                        );
                      })() : (
                        <span className="text-[#5d5d5d] text-[9px]">—</span>
                      )}
                    </td>
                    
                    {/* URDF Limits Column */}
                    <td className="px-1.5 py-0.5 text-right">
                      {mapping.urdfJoint && mapping.urdfJoint !== "?" ? (() => {
                        const urdfLimit = jointLimits[mapping.urdfJoint];
                        if (!urdfLimit || (urdfLimit.lower === null && urdfLimit.upper === null)) {
                          return <span className="text-[#5d5d5d] text-[9px]">—</span>;
                        }
                        return (
                          <div className="text-[8px] text-[#5d5d5d] font-mono">
                            [{urdfLimit.lower !== null ? urdfLimit.lower.toFixed(2) : "-∞"}, {urdfLimit.upper !== null ? urdfLimit.upper.toFixed(2) : "∞"}]
                          </div>
                        );
                      })() : (
                        <span className="text-[#5d5d5d] text-[9px]">—</span>
                      )}
                    </td>

                    {/* Limit Mode Column */}
                    <td className="px-1.5 py-0.5">
                      {(() => {
                        const urdfLimit = mapping.urdfJoint ? jointLimits[mapping.urdfJoint] : undefined;
                        const hasFiniteLimits =
                          urdfLimit &&
                          urdfLimit.lower !== null &&
                          urdfLimit.upper !== null &&
                          Number.isFinite(urdfLimit.lower) &&
                          Number.isFinite(urdfLimit.upper);
                        if (!hasFiniteLimits || !mapping.urdfJoint || mapping.urdfJoint === "?") {
                          return <span className="text-[#5d5d5d] text-[9px]">—</span>;
                        }
                        const currentMode = mapping.limitMode ?? "report";
                        return (
                          <Select
                            value={currentMode}
                            onValueChange={(value) =>
                              handleLimitModeChange(mapping.datasetJoint, value as JointLimitMode)
                            }
                          >
                            <SelectTrigger className="h-5 text-[9px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] font-mono px-1.5">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="z-[10010] bg-[#282828] border-[#3d3d3d]">
                              <SelectItem
                                value="report"
                                className="text-[9px] text-[#9d9d9d] hover:bg-[#3d3d3d] py-0.5"
                              >
                                Report
                              </SelectItem>
                              <SelectItem
                                value="clamp"
                                className="text-[9px] text-[#d4d4d4] hover:bg-[#3d3d3d] py-0.5"
                              >
                                Clamp
                              </SelectItem>
                              <SelectItem
                                value="shift"
                                className="text-[9px] text-[#d4d4d4] hover:bg-[#3d3d3d] py-0.5"
                              >
                                Shift
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
            </>
          ) : (
            /* Metadata View - Compact */
            <div className="p-2 space-y-2">
              {metadataLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-3 w-3 animate-spin text-[#9d9d9d] mr-1.5" />
                  <span className="text-[9px] text-[#9d9d9d]">Loading metadata...</span>
                </div>
              ) : metadataError ? (
                <div className="flex items-center gap-1.5 p-2 bg-[#3d1e1e] border border-[#5d2e2e] rounded text-[9px] text-[#d46d6d]">
                  <AlertCircle className="h-2.5 w-2.5 flex-shrink-0" />
                  <span>{metadataError}</span>
                </div>
              ) : metadata ? (
                <div className="space-y-2">
                  {/* Basic Info */}
                  <div className="space-y-1">
                    <h3 className="text-[10px] font-semibold text-[#d4d4d4] border-b border-[#3d3d3d] pb-0.5">Basic Information</h3>
                    <div className="grid grid-cols-2 gap-1.5 text-[9px]">
                      <div>
                        <span className="text-[#9d9d9d]">Codebase Version:</span>
                        <span className="ml-1.5 text-[#d4d4d4] font-mono">{metadata.codebase_version}</span>
                      </div>
                      <div>
                        <span className="text-[#9d9d9d]">Robot Type:</span>
                        <span className="ml-1.5 text-[#d4d4d4] font-mono">{metadata.robot_type}</span>
                      </div>
                      <div>
                        <span className="text-[#9d9d9d]">FPS:</span>
                        <span className="ml-1.5 text-[#d4d4d4] font-mono">{metadata.fps}</span>
                      </div>
                      <div>
                        <span className="text-[#9d9d9d]">Chunk Size:</span>
                        <span className="ml-1.5 text-[#d4d4d4] font-mono">{metadata.chunks_size}</span>
                      </div>
                    </div>
                  </div>

                  {/* Statistics */}
                  <div className="space-y-1">
                    <h3 className="text-[10px] font-semibold text-[#d4d4d4] border-b border-[#3d3d3d] pb-0.5">Statistics</h3>
                    <div className="grid grid-cols-2 gap-1.5 text-[9px]">
                      <div>
                        <span className="text-[#9d9d9d]">Total Episodes:</span>
                        <span className="ml-1.5 text-[#d4d4d4] font-mono">{metadata.total_episodes?.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-[#9d9d9d]">Total Frames:</span>
                        <span className="ml-1.5 text-[#d4d4d4] font-mono">{metadata.total_frames?.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-[#9d9d9d]">Total Tasks:</span>
                        <span className="ml-1.5 text-[#d4d4d4] font-mono">{metadata.total_tasks}</span>
                      </div>
                      <div>
                        <span className="text-[#9d9d9d]">Files Size:</span>
                        <span className="ml-1.5 text-[#d4d4d4] font-mono">
                          {metadata.files_size_in_mb ??
                            ((metadata.data_files_size_in_mb ?? 0) +
                              (metadata.video_files_size_in_mb ?? 0))}{" "}
                          MB
                        </span>
                      </div>
                      {metadata.video_files_size_in_mb !== undefined && (
                        <div>
                          <span className="text-[#9d9d9d]">Video Size:</span>
                          <span className="ml-1.5 text-[#d4d4d4] font-mono">
                            {metadata.video_files_size_in_mb} MB
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Splits */}
                  {metadata.splits && (
                    <div className="space-y-1">
                      <h3 className="text-[10px] font-semibold text-[#d4d4d4] border-b border-[#3d3d3d] pb-0.5">Splits</h3>
                      <div className="text-[9px]">
                        {Object.entries(metadata.splits).map(([key, value]) => (
                          <div key={key} className="mb-0.5">
                            <span className="text-[#9d9d9d]">{key}:</span>
                            <span className="ml-1.5 text-[#d4d4d4] font-mono">{String(value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Paths */}
                  <div className="space-y-1">
                    <h3 className="text-[10px] font-semibold text-[#d4d4d4] border-b border-[#3d3d3d] pb-0.5">Paths</h3>
                    <div className="space-y-0.5 text-[9px]">
                      <div>
                        <span className="text-[#9d9d9d]">Data Path:</span>
                        <div className="ml-1.5 mt-0.5 text-[#d4d4d4] font-mono bg-[#1e1e1e] p-1 rounded border border-[#3d3d3d] break-all text-[8px]">
                          {metadata.data_path}
                        </div>
                      </div>
                      <div>
                        <span className="text-[#9d9d9d]">Video Path:</span>
                        <div className="ml-1.5 mt-0.5 text-[#d4d4d4] font-mono bg-[#1e1e1e] p-1 rounded border border-[#3d3d3d] break-all text-[8px]">
                          {metadata.video_path}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Features */}
                  {metadata.features && (
                    <div className="space-y-1">
                      <h3 className="text-[10px] font-semibold text-[#d4d4d4] border-b border-[#3d3d3d] pb-0.5">Features</h3>
                      <div className="space-y-1.5">
                        {Object.entries(metadata.features).map(([key, feature]) => (
                          <div key={key} className="bg-[#1e1e1e] border border-[#3d3d3d] rounded p-1.5">
                            <div className="text-[9px] font-semibold text-[#d4d4d4] mb-1">{key}</div>
                            <div className="space-y-0.5 text-[8px] text-[#9d9d9d]">
                              <div>
                                <span className="text-[#9d9d9d]">Type:</span>
                                <span className="ml-1.5 text-[#d4d4d4] font-mono">{feature.dtype}</span>
                              </div>
                              {feature.shape && (
                                <div>
                                  <span className="text-[#9d9d9d]">Shape:</span>
                                  <span className="ml-1.5 text-[#d4d4d4] font-mono">[{feature.shape.join(", ")}]</span>
                                </div>
                              )}
                              {feature.names && Array.isArray(feature.names) && feature.names.length > 0 && (
                                <div>
                                  <span className="text-[#9d9d9d]">Names:</span>
                                  <div className="ml-1.5 mt-0.5 text-[#d4d4d4] font-mono text-[8px]">
                                    {feature.names.join(", ")}
                                  </div>
                                </div>
                              )}
                              {feature.fps && (
                                <div>
                                  <span className="text-[#9d9d9d]">FPS:</span>
                                  <span className="ml-1.5 text-[#d4d4d4] font-mono">{feature.fps}</span>
                                </div>
                              )}
                              {feature.info && (
                                <div className="mt-1 pt-1 border-t border-[#3d3d3d]">
                                  <div className="text-[8px] text-[#9d9d9d] mb-0.5">Additional Info:</div>
                                  {Object.entries(feature.info).map(([infoKey, infoValue]) => (
                                    <div key={infoKey} className="ml-1.5">
                                      <span className="text-[#9d9d9d]">{infoKey}:</span>
                                      <span className="ml-1.5 text-[#d4d4d4] font-mono">{String(infoValue)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-6 text-[9px] text-[#9d9d9d]">
                  No metadata available
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions - Only show for mapping tab - Compact */}
        {activeTab === "mapping" && (
          <div className="flex-shrink-0 flex items-center justify-between px-2 py-1 border-t border-[#3d3d3d] bg-[#252525]">
            <div className="text-[9px] text-[#9d9d9d]">
              {mappingDiagnostics.mappedDatasetJoints.length}/{datasetJoints.length}
            </div>
            <div className="flex gap-1">
              <Button
                onClick={handleCloseDialog}
                variant="outline"
                className="h-5 px-2 text-[9px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] hover:bg-[#2d2d2d] hover:text-white"
              >
                Cancel
              </Button>
              <Button
                onClick={handleApply}
                disabled={errors.length > 0 || hasTooManyJoints}
                className={cn(
                  "h-5 px-2 text-[9px]",
                  errors.length > 0 || hasTooManyJoints
                    ? "bg-[#3d3d3d] text-[#5d5d5d] cursor-not-allowed"
                    : "bg-[#5d7d9d] text-white hover:bg-[#6d8dad]"
                )}
              >
                {hasTooManyJoints
                  ? "Nonvalid"
                  : applyLabel
                    ? applyLabel
                    : "Apply"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );

  if (typeof document === "undefined") {
    return dialogContent;
  }

  return createPortal(dialogContent, document.body);
};
