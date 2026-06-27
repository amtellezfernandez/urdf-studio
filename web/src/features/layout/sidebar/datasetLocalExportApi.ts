import { API_BASE_URL } from "@/shared/config/runtime";

export type DatasetLocalExportResponse = {
  datasetPath: string;
  datasetName: string;
  fileCount: number;
};

export const uploadDatasetArchiveForOps = async ({
  archive,
  datasetName,
}: {
  archive: Blob;
  datasetName: string;
}): Promise<DatasetLocalExportResponse> => {
  const formData = new FormData();
  formData.append("archive", archive, `${datasetName}.zip`);
  formData.append("dataset_name", datasetName);

  const response = await fetch(`${API_BASE_URL}/datasets/local-exports`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { detail?: unknown };
      detail = typeof payload.detail === "string" ? payload.detail : "";
    } catch {
      detail = "";
    }
    throw new Error(detail || `Local dataset export failed: ${response.status}`);
  }

  return (await response.json()) as DatasetLocalExportResponse;
};
