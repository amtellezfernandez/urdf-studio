/**
 * TypeScript types for the training feature.
 * These mirror the Pydantic models in backend/models/training.py
 */

// ============================================================================
// Enums
// ============================================================================

export type DatasetSource = "huggingface" | "local";

export type ModelArchitecture =
  | "act"
  | "diffusion_policy"
  | "tdmpc"
  | "vq_bet"
  | "custom";

export type TrackerType = "mlflow" | "wandb" | "none";

export type ComputeType = "local" | "modal" | "runpod";

export type JobStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

// ============================================================================
// Configuration Types
// ============================================================================

export interface DatasetConfig {
  source: DatasetSource;
  repoId?: string;
  localPath?: string;
  version?: string;
  episodes?: number[];
}

export interface ModelConfig {
  architecture: ModelArchitecture;
  config: Record<string, unknown>;
  pretrainedPath?: string;
  customConfigPath?: string;
}

export interface TrainingParams {
  batchSize: number;
  learningRate: number;
  epochs: number;
  maxSteps?: number;
  seed: number;
  gradientAccumulationSteps: number;
  maxGradNorm?: number;
  weightDecay: number;
  lrScheduler: string;
  warmupSteps: number;
  checkpointInterval: number;
  keepLastNCheckpoints: number;
  earlyStoppingPatience?: number;
  earlyStoppingMetric: string;
  outputDir: string;
  runName?: string;
}

export interface TrackerConfig {
  type: TrackerType;
  trackingUri?: string;
  experimentName?: string;
  project?: string;
  entity?: string;
}

export interface ComputeConfig {
  type: ComputeType;
  gpu?: string;
  device: string;
  apiKey?: string;
  useSpot: boolean;
  timeoutHours: number;
}

// ============================================================================
// Request/Response Types
// ============================================================================

export interface TrainingStartRequest {
  dataset: DatasetConfig;
  model: ModelConfig;
  training: TrainingParams;
  tracker: TrackerConfig;
  compute: ComputeConfig;
  urdf?: string;
  robotName?: string;
}

export interface TrainingProgress {
  currentEpoch: number;
  totalEpochs: number;
  currentStep: number;
  totalSteps: number;
  epochProgress: number;
  overallProgress: number;
}

export interface TrainingMetrics {
  loss?: number;
  learningRate?: number;
  gradNorm?: number;
  additional: Record<string, number>;
}

export interface TrainingLineage {
  datasetSource: string;
  datasetId: string;
  datasetVersion?: string;
  modelArchitecture: string;
  modelConfigHash: string;
  trainingConfigHash: string;
  robotName?: string;
  urdfHash?: string;
  startedAt: string;
  completedAt?: string;
}

export interface TrainingStartResponse {
  success: boolean;
  jobId: string;
  message: string;
  trackerUrl?: string;
  lineage?: TrainingLineage;
}

export interface TrainingStatusResponse {
  jobId: string;
  status: JobStatus;
  progress?: TrainingProgress;
  metrics?: TrainingMetrics;
  trackerUrl?: string;
  lineage?: TrainingLineage;
  error?: string;
  logsTail?: string;
  computeBackend: string;
  costEstimateUsd?: number;
}

export interface TrainingJobSummary {
  jobId: string;
  status: JobStatus;
  runName?: string;
  modelArchitecture: string;
  datasetId: string;
  startedAt: string;
  finishedAt?: string;
  computeBackend: string;
}

export interface TrainingJobsListResponse {
  jobs: TrainingJobSummary[];
  total: number;
}

// ============================================================================
// Model Architecture Info
// ============================================================================

export interface ModelArchitectureInfo {
  name: string;
  displayName: string;
  description: string;
  defaultConfig: Record<string, unknown>;
  configSchema: Record<string, ConfigFieldSchema>;
  recommendedFor: string[];
}

export interface ConfigFieldSchema {
  type: "int" | "float" | "string" | "bool";
  min?: number;
  max?: number;
  default?: unknown;
  options?: unknown[];
  description?: string;
}

export interface ModelsListResponse {
  models: ModelArchitectureInfo[];
}

// ============================================================================
// Compute Instance Info
// ============================================================================

export interface ComputeInstanceInfo {
  name: string;
  device?: string;
  memoryGb?: number;
  costPerHour: number;
  costPerHourSpot?: number;
  available: boolean;
  provider?: string;
}

export interface ComputeInstancesResponse {
  instances: Record<string, ComputeInstanceInfo[]>;
}

// ============================================================================
// Evaluation Types
// ============================================================================

export interface EvaluateRequest {
  checkpointPath: string;
  numEpisodes: number;
  maxSteps: number;
  urdf?: string;
  initialState?: Record<string, number>;
}

export interface EvaluateResponse {
  success: boolean;
  episodes: EpisodeResult[];
  metrics: Record<string, number>;
  error?: string;
}

export interface EpisodeResult {
  episodeIndex: number;
  actions: number[][];
  observations?: number[][];
  rewards?: number[];
  timestamps?: number[];
}

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULT_TRAINING_PARAMS: TrainingParams = {
  batchSize: 32,
  learningRate: 1e-4,
  epochs: 100,
  maxSteps: undefined,
  seed: 42,
  gradientAccumulationSteps: 1,
  maxGradNorm: 1.0,
  weightDecay: 0.01,
  lrScheduler: "cosine",
  warmupSteps: 500,
  checkpointInterval: 10,
  keepLastNCheckpoints: 3,
  earlyStoppingMetric: "loss",
  outputDir: "./outputs",
};

export const DEFAULT_TRACKER_CONFIG: TrackerConfig = {
  type: "none",
};

export const DEFAULT_COMPUTE_CONFIG: ComputeConfig = {
  type: "local",
  device: "cuda",
  useSpot: true,
  timeoutHours: 4.0,
};
