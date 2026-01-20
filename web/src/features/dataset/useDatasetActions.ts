import { useCallback, useState } from "react";
import type { Episode } from "./episodes";

type DatasetActions = {
  loadFromLocal: () => void;
  loadFromHuggingFace: () => void;
  exportToLocal: () => void;
  exportToHuggingFace: () => void;
  openRerunViewer: () => void;
  loadDemoEpisodes: (episodes: Episode[]) => void;
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
