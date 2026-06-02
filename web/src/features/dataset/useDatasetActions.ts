import { useCallback, useState } from "react";
import type { DatasetActions } from "@/features/dataset/datasetActions";

export const useDatasetActions = () => {
  const [datasetActions, setDatasetActions] = useState<DatasetActions | null>(null);

  const handleDatasetActionsReady = useCallback((actions: DatasetActions) => {
    setDatasetActions(actions);
  }, []);

  return { datasetActions, handleDatasetActionsReady };
};
