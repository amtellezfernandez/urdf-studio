import { useCallback } from "react";
import { toast } from "sonner";
import { exportCamerasToJSON, exportCamerasToYAML } from "@/features/camera";
import type { Camera } from "@/shared/types/camera";
import { downloadTextDocument } from "@/app/pages/index/useWorldSceneManager";

type DownloadDocument = (content: string, filename: string, mimeType: string) => void;

type UseCameraExportActionsParams = {
  cameras: Camera[];
  downloadDocument?: DownloadDocument;
};

export const useCameraExportActions = ({
  cameras,
  downloadDocument = downloadTextDocument,
}: UseCameraExportActionsParams) => {
  const hasCamerasToExport = cameras.length > 0;

  const exportCamerasAsJSON = useCallback(() => {
    if (!hasCamerasToExport) {
      toast.error("No cameras to export");
      return;
    }
    downloadDocument(exportCamerasToJSON(cameras), "camera-config.json", "application/json");
    toast.success(`Exported ${cameras.length} camera(s) to JSON`);
  }, [cameras, downloadDocument, hasCamerasToExport]);

  const exportCamerasAsYAML = useCallback(() => {
    if (!hasCamerasToExport) {
      toast.error("No cameras to export");
      return;
    }
    downloadDocument(exportCamerasToYAML(cameras), "camera-config.yaml", "text/yaml");
    toast.success(`Exported ${cameras.length} camera(s) to YAML`);
  }, [cameras, downloadDocument, hasCamerasToExport]);

  return {
    exportCamerasAsJSON,
    exportCamerasAsYAML,
    hasCamerasToExport,
  };
};
