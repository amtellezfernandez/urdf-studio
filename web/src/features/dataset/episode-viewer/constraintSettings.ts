import { DATASET_CONSTRAINT_SETTINGS_PARAMS } from "@/features/dataset/episode-viewer/constraintSettingsParams";

export const DATASET_CONSTRAINT_AXIS_OPTIONS =
  DATASET_CONSTRAINT_SETTINGS_PARAMS.axisOptions;
export const DATASET_CONSTRAINT_MODES =
  DATASET_CONSTRAINT_SETTINGS_PARAMS.modes;
export const DATASET_CONSTRAINT_WALL_SIDES =
  DATASET_CONSTRAINT_SETTINGS_PARAMS.wallSides;

export type DatasetConstraintMode = (typeof DATASET_CONSTRAINT_MODES)[number];
export type DatasetConstraintAxis = (typeof DATASET_CONSTRAINT_AXIS_OPTIONS)[number];
export type DatasetConstraintWallSide = (typeof DATASET_CONSTRAINT_WALL_SIDES)[number];

export type DatasetConstraintSettings = {
  mode: DatasetConstraintMode;
  heightAxis: DatasetConstraintAxis;
  heightLimit: number;
  boxMin: { x: number; y: number; z: number };
  boxMax: { x: number; y: number; z: number };
  wallAxis: DatasetConstraintAxis;
  wallSide: DatasetConstraintWallSide;
  wallPosition: number;
};

export const DATASET_CONSTRAINT_NUMBER_STEP =
  DATASET_CONSTRAINT_SETTINGS_PARAMS.numberStep;
export const DEFAULT_DATASET_CONSTRAINT_HEIGHT_LIMIT =
  DATASET_CONSTRAINT_SETTINGS_PARAMS.defaultHeightLimit;
export const DEFAULT_DATASET_CONSTRAINT_BOX_MIN =
  DATASET_CONSTRAINT_SETTINGS_PARAMS.defaultBoxMin;
export const DEFAULT_DATASET_CONSTRAINT_BOX_MAX =
  DATASET_CONSTRAINT_SETTINGS_PARAMS.defaultBoxMax;
export const DEFAULT_DATASET_CONSTRAINT_WALL_POSITION =
  DATASET_CONSTRAINT_SETTINGS_PARAMS.defaultWallPosition;

export const createDefaultDatasetConstraintSettings = (): DatasetConstraintSettings => ({
  mode: DATASET_CONSTRAINT_SETTINGS_PARAMS.defaultMode,
  heightAxis: DATASET_CONSTRAINT_SETTINGS_PARAMS.defaultHeightAxis,
  heightLimit: DEFAULT_DATASET_CONSTRAINT_HEIGHT_LIMIT,
  boxMin: { ...DEFAULT_DATASET_CONSTRAINT_BOX_MIN },
  boxMax: { ...DEFAULT_DATASET_CONSTRAINT_BOX_MAX },
  wallAxis: DATASET_CONSTRAINT_SETTINGS_PARAMS.defaultWallAxis,
  wallSide: DATASET_CONSTRAINT_SETTINGS_PARAMS.defaultWallSide,
  wallPosition: DEFAULT_DATASET_CONSTRAINT_WALL_POSITION,
});
