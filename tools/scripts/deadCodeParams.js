export const DEAD_CODE_CLUSTER_FILE_POINTS = 3;
export const DEAD_CODE_DEFAULT_PATH_RISK = {
  label: "general",
  score: 4,
};
export const DEAD_CODE_EXPORTS_PER_POINT = 4;
export const DEAD_CODE_FILE_LINES_PER_POINT = 20;
export const DEAD_CODE_MAX_FILE_EXPORT_POINTS = 6;
export const DEAD_CODE_MAX_FILE_SIZE_POINTS = 8;
export const DEAD_CODE_MAX_UNUSED_EXPORT_POINTS = 6;
export const DEAD_CODE_ORPHAN_FILE_POINTS = 5;
export const DEAD_CODE_REPORT_ITEM_LIMIT = 10;
export const DEAD_CODE_TEST_ONLY_FILE_POINTS = 1;
export const DEAD_CODE_UNUSED_DEPENDENCY_POINTS = 8;

export const DEAD_CODE_PATH_RISK_RULES = [
  {
    prefix: "backend/api/",
    label: "backend-api",
    score: 10,
  },
  {
    prefix: "backend/world_bridge/",
    label: "world-bridge",
    score: 10,
  },
  {
    prefix: "backend/services/",
    label: "backend-service",
    score: 8,
  },
  {
    prefix: "web/src/runtime_engine/",
    label: "runtime-engine",
    score: 9,
  },
  {
    prefix: "web/src/features/layout/",
    label: "layout-control",
    score: 8,
  },
  {
    prefix: "web/src/features/dataset/",
    label: "dataset",
    score: 8,
  },
  {
    prefix: "web/src/features/viewer/",
    label: "viewer",
    score: 8,
  },
  {
    prefix: "web/src/features/urdf/",
    label: "urdf",
    score: 7,
  },
  {
    prefix: "web/src/features/camera/",
    label: "camera",
    score: 7,
  },
  {
    prefix: "tools/scripts/",
    label: "tooling",
    score: 5,
  },
];
