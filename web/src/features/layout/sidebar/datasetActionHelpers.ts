import { LOCAL_DATASET_FILE_INPUT_ID } from "@/features/layout/sidebar/localDatasetImportParams";

type ClickableElement = {
  click: () => void;
};

export const openLocalDatasetFilePicker = (
  targetDocument: {
    getElementById: (id: string) => ClickableElement | null | undefined;
  },
  fileInputId = LOCAL_DATASET_FILE_INPUT_ID
) => {
  const fileInput = targetDocument.getElementById(fileInputId);
  if (!fileInput || typeof fileInput.click !== "function") {
    return false;
  }
  fileInput.click();
  return true;
};
