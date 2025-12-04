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
import { X, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

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
}: JointMappingDialogProps) => {
  // Check if dataset has more joints than URDF
  const hasTooManyJoints = datasetJoints.length > urdfJoints.length;
  const [mappings, setMappings] = useState<JointMapping[]>([]);
  const [degToRad, setDegToRad] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // Initialize mappings from existing or create empty mappings for each dataset joint
  useEffect(() => {
    if (existingMapping) {
      setMappings(existingMapping.mappings);
      setDegToRad(existingMapping.degToRad);
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
    }
  }, [datasetJoints, urdfJoints, existingMapping]);

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

        {/* Deg→Rad Toggle */}
        <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 bg-[#252525] border-b border-[#3d3d3d]">
          <span className="text-[10px] text-[#9d9d9d]">Deg→Rad</span>
          <Switch
            checked={degToRad}
            onCheckedChange={setDegToRad}
            className="h-4 w-7 data-[state=checked]:bg-[#5d7d9d]"
          />
        </div>

        {/* Mapping Table */}
        <div className="flex-1 overflow-y-auto blender-scrollbar">
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-[#252525] border-b border-[#3d3d3d]">
              <tr>
                <th className="text-left px-2 py-1 font-normal text-[#9d9d9d]">Dataset</th>
                <th className="text-left px-2 py-1 font-normal text-[#9d9d9d]">URDF</th>
                <th className="text-right px-2 py-1 font-normal text-[#9d9d9d]">Range</th>
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
                      {range ? (
                        <div className="flex items-center justify-end gap-1 font-mono text-[10px]">
                          <span className="text-[#9d9d9d]">
                            {range.min.toFixed(2)}
                          </span>
                          <span className="text-[#5d5d5d]">→</span>
                          <span className="text-[#9d9d9d]">
                            {range.max.toFixed(2)}
                          </span>
                        </div>
                      ) : (
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
