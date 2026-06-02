import { JointMappingDialog } from "@/features/dataset/JointMappingDialog";
import { getMappingForSource } from "@/features/dataset";
import type {
  HfDatasetPartitionOption,
  HfMappingDialogData,
} from "@/features/layout/sidebar/hfDatasetImportHelpers";
import type { JointLimits } from "@/shared/lib/urdfBrowser";
import type { JointMapping } from "@/shared/types/feature";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

type HfDatasetImportDialogsProps = {
  availableJoints: string[];
  jointLimits: JointLimits;
  mappingDialog: {
    isOpen: boolean;
    mode: "first" | "remap";
    data: HfMappingDialogData | null;
    onClose: () => void;
    onApply: (mappings: JointMapping[], degToRad: boolean) => void;
  };
  partitionDialog: {
    isOpen: boolean;
    options: HfDatasetPartitionOption[];
    selectedId: string;
    onSelectedIdChange: (nextId: string) => void;
    onCancel: () => void;
    onConfirm: () => void;
  };
};

export const HfDatasetImportDialogs = ({
  availableJoints,
  jointLimits,
  mappingDialog,
  partitionDialog,
}: HfDatasetImportDialogsProps) => (
  <>
    {mappingDialog.data && (
      <JointMappingDialog
        isOpen={mappingDialog.isOpen}
        onClose={mappingDialog.onClose}
        datasetJoints={mappingDialog.data.datasetJoints}
        urdfJoints={availableJoints}
        jointRanges={mappingDialog.data.jointRanges}
        existingMapping={getMappingForSource(mappingDialog.data.source)}
        source={mappingDialog.data.source}
        datasetPath={mappingDialog.data.datasetPath}
        signalField={mappingDialog.data.signalField}
        signalProfileId={mappingDialog.data.signalProfileId}
        excludedChannels={mappingDialog.data.excludedChannels}
        jointLimits={jointLimits}
        onApply={mappingDialog.onApply}
        applyLabel={
          mappingDialog.mode === "remap"
            ? "Apply Remapping"
            : "Load First Episode"
        }
      />
    )}

    <Dialog
      open={partitionDialog.isOpen}
      onOpenChange={(open) => {
        if (!open) {
          partitionDialog.onCancel();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Select Dataset Partition</DialogTitle>
          <DialogDescription>
            Choose one config/split partition to load. Episodes are loaded from
            this partition only.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label
            htmlFor="hf-partition-select"
            className="text-xs text-muted-foreground"
          >
            Partition
          </label>
          <Select
            value={partitionDialog.selectedId}
            onValueChange={partitionDialog.onSelectedIdChange}
          >
            <SelectTrigger id="hf-partition-select">
              <SelectValue placeholder="Choose partition" />
            </SelectTrigger>
            <SelectContent>
              {partitionDialog.options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.config}/{option.split}
                  {option.numExamples > 0
                    ? ` (${option.numExamples.toLocaleString()} rows)`
                    : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={partitionDialog.onCancel}>
            Cancel
          </Button>
          <Button
            onClick={partitionDialog.onConfirm}
            disabled={!partitionDialog.selectedId}
          >
            Load Partition
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
);
