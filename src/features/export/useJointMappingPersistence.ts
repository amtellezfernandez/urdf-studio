import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { deleteMapping, getSavedMappings, saveMapping } from "@/features/dataset";
import type { JointMapping, SavedMapping } from "@/features/types";

export type MappingDialogData = {
  datasetJoints: string[];
  jointRanges: Record<string, { min: number; max: number }>;
};

export const useJointMappingPersistence = () => {
  const [showMappingListPanel, setShowMappingListPanel] = useState(false);
  const [showMappingDialog, setShowMappingDialog] = useState(false);
  const [selectedMapping, setSelectedMapping] = useState<SavedMapping | undefined>(undefined);
  const [mappingDialogData, setMappingDialogData] = useState<MappingDialogData | null>(null);
  const [mappingListVersion, setMappingListVersion] = useState(0);

  const savedMappings = useMemo(() => {
    void mappingListVersion; // Trigger refresh when the list changes.
    return getSavedMappings();
  }, [mappingListVersion]);

  const openMappingList = useCallback(() => {
    setMappingListVersion((prev) => prev + 1);
    setShowMappingListPanel(true);
  }, []);

  const closeMappingList = useCallback(() => {
    setShowMappingListPanel(false);
  }, []);

  const selectMapping = useCallback((mapping: SavedMapping) => {
    const datasetJoints = mapping.mappings.map((m) => m.datasetJoint);
    const jointRanges: Record<string, { min: number; max: number }> = mapping.jointRanges || {};

    datasetJoints.forEach((joint) => {
      if (!jointRanges[joint]) {
        jointRanges[joint] = { min: 0, max: 0 };
      }
    });

    setMappingDialogData({
      datasetJoints,
      jointRanges,
    });
    setSelectedMapping(mapping);
    setShowMappingListPanel(false);
    setShowMappingDialog(true);
  }, []);

  const deleteMappingById = useCallback((id: string) => {
    deleteMapping(id);
    toast.success("Mapping deleted");
    setMappingListVersion((prev) => prev + 1);
  }, []);

  const closeMappingDialog = useCallback(() => {
    setShowMappingDialog(false);
    setMappingDialogData(null);
    setSelectedMapping(undefined);
  }, []);

  const applyMapping = useCallback(
    (mappings: JointMapping[], degToRad: boolean) => {
      if (selectedMapping && mappingDialogData) {
        const newOffsets: Record<string, number> = {};
        const newMapping: Record<string, string> = {};
        mappings.forEach((mapping) => {
          if (mapping.urdfJoint && mapping.urdfJoint !== "?") {
            newMapping[mapping.datasetJoint] = mapping.urdfJoint;
            if (mapping.offset !== undefined) {
              newOffsets[mapping.datasetJoint] = mapping.offset;
            }
          }
        });

        const oldMapping: Record<string, string> = {};
        const oldOffsets: Record<string, number> = {};
        selectedMapping.mappings.forEach((mapping) => {
          if (mapping.urdfJoint && mapping.urdfJoint !== "?") {
            oldMapping[mapping.datasetJoint] = mapping.urdfJoint;
            if (mapping.offset !== undefined) {
              oldOffsets[mapping.datasetJoint] = mapping.offset;
            }
          }
        });

        const mappingStructureChanged =
          selectedMapping.degToRad !== degToRad ||
          JSON.stringify(oldMapping) !== JSON.stringify(newMapping);

        saveMapping(selectedMapping.source, mappings, degToRad, mappingDialogData.jointRanges);

        window.dispatchEvent(
          new CustomEvent("mapping:updated", {
            detail: {
              mappingSource: selectedMapping.source,
              newOffsets,
              newMapping,
              oldOffsets,
              oldMapping,
              oldDegToRad: selectedMapping.degToRad,
              newDegToRad: degToRad,
              mappingStructureChanged,
            },
          })
        );

        toast.success(
          mappingStructureChanged
            ? "Joint mapping updated - episodes will be reloaded"
            : "Joint mapping updated"
        );
        closeMappingDialog();
        setMappingListVersion((prev) => prev + 1);
      } else {
        toast.success("Joint mapping applied");
      }
    },
    [closeMappingDialog, mappingDialogData, selectedMapping]
  );

  return {
    mappingDialogData,
    selectedMapping,
    showMappingDialog,
    showMappingListPanel,
    savedMappings,
    openMappingList,
    closeMappingList,
    selectMapping,
    deleteMappingById,
    applyMapping,
    closeMappingDialog,
  };
};
