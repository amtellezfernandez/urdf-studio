import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { exportCamerasToJSON, exportCamerasToYAML } from "@/features/camera";
import type { Camera } from "@/shared/types/camera";

type UseExportHandlersParams = {
  vizUrdfContent?: string | null;
  savedVizUrdfContent?: string | null;
  updateUrdfFile: (content: string) => void;
  setSavedVizUrdfContent: Dispatch<SetStateAction<string>>;
  cameras: Camera[];
};

export const useExportHandlers = ({
  vizUrdfContent,
  savedVizUrdfContent,
  updateUrdfFile,
  setSavedVizUrdfContent,
  cameras,
}: UseExportHandlersParams) => {
  const [isExportDialogOpen, setExportDialogOpen] = useState(false);

  const hasCamerasToExport = cameras.length > 0;
  const canRevert = useMemo(
    () => Boolean(savedVizUrdfContent && savedVizUrdfContent !== vizUrdfContent),
    [savedVizUrdfContent, vizUrdfContent]
  );

  const openExportDialog = useCallback(() => setExportDialogOpen(true), []);
  const closeExportDialog = useCallback(() => setExportDialogOpen(false), []);

  const handleSave = useCallback(() => {
    if (!vizUrdfContent) {
      toast.error("No URDF content to save");
      return;
    }

    setSavedVizUrdfContent(vizUrdfContent);
    toast.success("Changes saved");
  }, [setSavedVizUrdfContent, vizUrdfContent]);

  const handleRevert = useCallback(() => {
    if (!savedVizUrdfContent) {
      toast.error("No saved URDF content found");
      return;
    }

    updateUrdfFile(savedVizUrdfContent);
    toast.success("Reverted to last saved file");
  }, [savedVizUrdfContent, updateUrdfFile]);

  const exportCamerasAsJSON = useCallback(() => {
    if (!hasCamerasToExport) {
      toast.error("No cameras to export");
      return;
    }

    try {
      const jsonContent = exportCamerasToJSON(cameras);
      const blob = new Blob([jsonContent], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "camera-config.json";
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${cameras.length} camera(s) to JSON`);
    } catch (error) {
      toast.error("Failed to export cameras");
      console.error(error);
    }
  }, [cameras, hasCamerasToExport]);

  const exportCamerasAsYAML = useCallback(() => {
    if (!hasCamerasToExport) {
      toast.error("No cameras to export");
      return;
    }

    try {
      const yamlContent = exportCamerasToYAML(cameras);
      const blob = new Blob([yamlContent], { type: "text/yaml" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "camera-config.yaml";
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${cameras.length} camera(s) to YAML`);
    } catch (error) {
      toast.error("Failed to export cameras");
      console.error(error);
    }
  }, [cameras, hasCamerasToExport]);

  return {
    isExportDialogOpen,
    openExportDialog,
    closeExportDialog,
    handleSave,
    handleRevert,
    canRevert,
    exportCamerasAsJSON,
    exportCamerasAsYAML,
    hasCamerasToExport,
  };
};
