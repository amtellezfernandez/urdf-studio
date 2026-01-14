import { useCallback, useState } from "react";

export type DatasetActions = {
  loadFromLocal: () => void;
  loadFromHuggingFace: () => void;
  exportToLocal: () => void;
  exportToHuggingFace: () => void;
  openRerunViewer: () => void;
  isImportingFromHF: boolean;
  isExportingDataset: boolean;
  isUploadingToHF: boolean;
  hasEpisodes: boolean;
  isRerunViewerOpen: boolean;
};

export const useDatasetActions = () => {
  const [datasetActions, setDatasetActions] = useState<DatasetActions | null>(null);

  const handleDatasetActionsReady = useCallback((actions: DatasetActions) => {
    setDatasetActions(actions);
  }, []);

  return { datasetActions, handleDatasetActionsReady };
};
