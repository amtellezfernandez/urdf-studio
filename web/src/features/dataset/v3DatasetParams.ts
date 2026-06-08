export const V3_DATASET_CODEBASE_VERSION = "v3.0";
export const V3_DATASET_DATA_ROWS_PER_CHUNK = 1000;
export const V3_DATASET_EPISODES_PER_CHUNK = 1000;
export const V3_DATASET_INDEX_DIGITS = 3;
export const V3_DATASET_PRIMARY_FILE_INDEX = 0;
export const V3_DATASET_DEFAULT_FILES_SIZE_IN_MB = 0;
export const V3_DATASET_DEFAULT_SPLIT_NAME = "train";
export const V3_DATASET_DEFAULT_TASK_PREFIX = "task";
export const V3_DATASET_JOINT_FEATURE_GROUP = "motors";
export const V3_DATASET_MOTOR_FEATURE_PARAMS = {
  positionSuffix: ".pos",
  nonMotorJointNames: ["gripper_frame_joint"],
} as const;
export const V3_DATASET_DATA_PATH_TEMPLATE =
  "data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet";
export const V3_DATASET_NO_VIDEO_PATH = "";
