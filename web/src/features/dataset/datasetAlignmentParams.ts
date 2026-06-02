export const DEFAULT_INDEXED_REPRESENTATION_ID = "rep:joint_pos_abs:indexed:v1" as const;
export const DEFAULT_SEMANTIC_REPRESENTATION_ID = "rep:joint_pos_abs:semantic:v1" as const;

export const NAMING_STATUS_NAMED = "named" as const;
export const NAMING_STATUS_UNNAMED = "unnamed" as const;

export const DATASET_TREATMENT_ACTION_REQUIRES_MAPPING = "requires_mapping" as const;
export const DATASET_TREATMENT_ACTION_REQUIRES_NAMING_REVIEW =
  "requires_naming_review" as const;
export const DATASET_TREATMENT_CODE_ALIGNMENT_ERROR = "alignment_error" as const;

export const LOCAL_MAPPING_STORAGE_KEY = "urdf-studio-joint-mappings.v2" as const;
export const LEGACY_SESSION_MAPPING_STORAGE_KEY = "urdf-studio-joint-mappings" as const;
export const MAPPING_ID_PREFIX = "mapping" as const;
