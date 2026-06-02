import { V3_DATASET_CODEBASE_VERSION } from "@/features/dataset/v3DatasetParams";

export const LOCAL_DATASET_DEFAULT_SOURCE_NAME = "local_dataset";
export const LOCAL_DATASET_FILE_INPUT_ID = "motion-upload-episodes";
export const LOCAL_DATASET_FILE_EXTENSIONS = [".json", ".csv", ".pos"] as const;
export const LOCAL_DATASET_FILE_INPUT_ACCEPT = LOCAL_DATASET_FILE_EXTENSIONS.join(",");
export const LOCAL_DATASET_INFO_ENTRY_PATH = "meta/info.json";
export const LOCAL_DATASET_TASKS_ENTRY_PATH = "meta/tasks.parquet";
export const LOCAL_DATASET_EPISODES_ENTRY_PREFIX = "meta/episodes/chunk-";
export const LOCAL_DATASET_DATA_ENTRY_PREFIX = "data/chunk-";
export const LOCAL_DATASET_V3_CODEBASE_VERSION = V3_DATASET_CODEBASE_VERSION;
export const LOCAL_DATASET_V3_FORMAT_VERSION = "lerobot_dataset_v3";
