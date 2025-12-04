import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { X, AlertCircle, RotateCcw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JointLimits } from "@/urdf_corrections/parseJointLimits";

export interface JointMapping {
  datasetJoint: string;
  urdfJoint: string;
}

export interface SavedMapping {
  id: string;
  source: string;
  mappings: JointMapping[];
  degToRad: boolean;
  timestamp: number;
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

  // Auto-detect if values are in degrees and convert
  useEffect(() => {
    if (existingMapping) {
      setMappings(existingMapping.mappings);
      setDegToRad(existingMapping.degToRad);
      setAutoConverted(false);
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

  // Check joint limits and generate warnings
  useEffect(() => {
    const warnings: Array<{ joint: string; issue: string }> = [];
    
    for (const mapping of mappings) {
      if (!mapping.urdfJoint || mapping.urdfJoint === "?") continue;
      
      const range = jointRanges[mapping.datasetJoint];
      if (!range) continue;
      
      const urdfLimit = jointLimits[mapping.urdfJoint];
      if (!urdfLimit) continue;
      
      // Convert dataset range to radians if degToRad is enabled
      let datasetMin = range.min;
      let datasetMax = range.max;
      if (degToRad) {
        datasetMin = (range.min * Math.PI) / 180;
        datasetMax = (range.max * Math.PI) / 180;
      }
      
      // Check if dataset values exceed URDF limits
      if (urdfLimit.lower !== null && datasetMin < urdfLimit.lower) {
        warnings.push({
          joint: mapping.urdfJoint,
          issue: `Min value ${datasetMin.toFixed(3)} < URDF limit ${urdfLimit.lower.toFixed(3)}`,
        });
      }
      if (urdfLimit.upper !== null && datasetMax > urdfLimit.upper) {
        warnings.push({
          joint: mapping.urdfJoint,
          issue: `Max value ${datasetMax.toFixed(3)} > URDF limit ${urdfLimit.upper.toFixed(3)}`,
        });
      }
    }
    
    setLimitWarnings(warnings);
  }, [mappings, jointRanges, jointLimits, degToRad]);

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

  const handleUndoConversion = () => {
    setDegToRad(false);
    setAutoConverted(false);
  };

  const handleApply = () => {
    if (validationErrors.length > 0) {
      return;
    }
    onApply(mappings, degToRad);
    onClose();
  };

  const getSampleValue = (datasetJoint: string) => {
    const range = jointRanges[datasetJoint];
    if (!range) return "N/A";
    // Return the first value (min) as sample
    return range.min.toFixed(3);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[75vh] overflow-hidden flex flex-col bg-[#2d2d2d] border border-[#3d3d3d] text-[#d4d4d4] p-0">
        <DialogHeader className="flex-shrink-0 px-3 py-2 border-b border-[#3d3d3d]">
          <DialogTitle className="text-xs font-normal text-[#d4d4d4]">
            Joint Mapping{source && ` - ${source}`}
            {hasTooManyJoints && (
              <span className="ml-2 text-[#d46d6d]">(nonvalid)</span>
            )}
          </DialogTitle>
        </DialogHeader>

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
          <Switch
            checked={degToRad}
            onCheckedChange={(checked) => {
              setDegToRad(checked);
              // Clear auto-converted flag if user manually toggles
              if (!checked || (checked && !autoConverted)) {
                setAutoConverted(false);
              }
            }}
            className="h-4 w-7 data-[state=checked]:bg-[#5d7d9d]"
          />
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
                <th className="text-right px-2 py-1 font-normal text-[#9d9d9d]">Range [URDF Limits]</th>
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
                    <td className="px-2 py-1 text-right">
                      {range ? (() => {
                        // Show converted values if degToRad is enabled
                        const displayMin = degToRad ? (range.min * Math.PI) / 180 : range.min;
                        const displayMax = degToRad ? (range.max * Math.PI) / 180 : range.max;
                        
                        // Check if this joint has limit warnings
                        const hasWarning = limitWarnings.some(w => w.joint === mapping.urdfJoint);
                        const urdfLimit = mapping.urdfJoint && mapping.urdfJoint !== "?" ? jointLimits[mapping.urdfJoint] : null;
                        
                        return (
                          <div className="flex flex-col items-end gap-0.5">
                            <div className="flex items-center justify-end gap-1 font-mono text-[10px]">
                              <span className={hasWarning ? "text-[#d4a46d]" : "text-[#9d9d9d]"}>
                                {displayMin.toFixed(2)}
                              </span>
                              <span className="text-[#5d5d5d]">→</span>
                              <span className={hasWarning ? "text-[#d4a46d]" : "text-[#9d9d9d]"}>
                                {displayMax.toFixed(2)}
                              </span>
                            </div>
                            {urdfLimit && (urdfLimit.lower !== null || urdfLimit.upper !== null) && (
                              <div className="text-[8px] text-[#5d5d5d] font-mono">
                                [{urdfLimit.lower !== null ? urdfLimit.lower.toFixed(2) : "-∞"}, {urdfLimit.upper !== null ? urdfLimit.upper.toFixed(2) : "∞"}]
                              </div>
                            )}
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
      </DialogContent>
    </Dialog>
  );
};
