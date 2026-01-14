import { JointMappingDialog } from "@/features/dataset/JointMappingDialog";
import { MappingListPanel } from "@/features/layout/MappingListPanel";
import type { JointMapping, SavedMapping } from "@/shared/types/feature";
import type { MappingDialogData } from "@/features/dataset/exports";
import type { JointLimits } from "@/features/urdf";

type MappingPanelsProps = {
  showMappingListPanel: boolean;
  onCloseMappingList: () => void;
  savedMappings: SavedMapping[];
  onSelectMapping: (mapping: SavedMapping) => void;
  onDeleteMapping: (mappingId: string) => void;
  mappingDialogData: MappingDialogData | null;
  showMappingDialog: boolean;
  onCloseMappingDialog: () => void;
  availableJoints: string[];
  selectedMapping?: SavedMapping;
  jointLimits: JointLimits;
  onApplyMapping: (mappings: JointMapping[], degToRad: boolean) => void;
};

export const MappingPanels = ({
  showMappingListPanel,
  onCloseMappingList,
  savedMappings,
  onSelectMapping,
  onDeleteMapping,
  mappingDialogData,
  showMappingDialog,
  onCloseMappingDialog,
  availableJoints,
  selectedMapping,
  jointLimits,
  onApplyMapping,
}: MappingPanelsProps) => (
  <>
    <MappingListPanel
      isOpen={showMappingListPanel}
      onClose={onCloseMappingList}
      mappings={savedMappings}
      onSelectMapping={onSelectMapping}
      onDeleteMapping={onDeleteMapping}
    />

    {mappingDialogData && (
      <JointMappingDialog
        isOpen={showMappingDialog}
        onClose={onCloseMappingDialog}
        datasetJoints={mappingDialogData.datasetJoints}
        urdfJoints={availableJoints}
        jointRanges={mappingDialogData.jointRanges}
        existingMapping={selectedMapping}
        source={selectedMapping?.source}
        jointLimits={jointLimits}
        onApply={onApplyMapping}
      />
    )}
  </>
);
