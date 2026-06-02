export type DatasetSourceType = "hf" | "local" | "github" | "recorded";

export type DatasetSourceRecord = {
  type: DatasetSourceType;
  name: string;
  timestamp: number;
};

export const createDatasetSourceRecord = (
  type: DatasetSourceType,
  name: string,
  timestamp = Date.now()
): DatasetSourceRecord => ({
  type,
  name,
  timestamp,
});

export const appendDatasetSourceRecord = (
  existingSources: readonly DatasetSourceRecord[],
  type: DatasetSourceType,
  name: string,
  timestamp = Date.now()
) => [...existingSources, createDatasetSourceRecord(type, name, timestamp)];
