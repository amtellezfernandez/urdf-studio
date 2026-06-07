/**
 * TypeScript types for the experiments feature.
 */

// ============================================================================
// Enums
// ============================================================================

export type JobStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type JobFilterStatus = JobStatus | "all";

// ============================================================================
// Job Types
// ============================================================================

export interface TrainingJob {
  id: string;
  name: string;
  status: JobStatus;
  modelArchitecture: string;
  datasetId: string;
  datasetSource: "huggingface" | "local";
  computeBackend: string;
  startedAt: string;
  finishedAt?: string;
  progress?: {
    currentEpoch: number;
    totalEpochs: number;
    currentStep: number;
    totalSteps: number;
    epochProgress: number;
    overallProgress: number;
  };
  metrics?: {
    loss?: number;
    learningRate?: number;
    gradNorm?: number;
    additional: Record<string, number>;
  };
  trackerUrl?: string;
  error?: string;
  logsTail?: string;
  costEstimateUsd?: number;
  config?: {
    dataset?: {
      source?: string;
      repo_id?: string;
      local_path?: string;
      version?: string;
      resolved_revision?: string;
    };
    model?: {
      architecture?: string;
      config?: Record<string, unknown>;
    };
    training?: Record<string, unknown>;
    tracker?: Record<string, unknown>;
  };
}

// ============================================================================
// Filter Types
// ============================================================================

export interface JobFilters {
  status: JobFilterStatus;
  modelArchitecture?: string;
  dateRange?: {
    start: string;
    end: string;
  };
  searchQuery?: string;
}

// ============================================================================
// API Types
// ============================================================================

export interface JobsListResponse {
  jobs: TrainingJob[];
  total: number;
  page: number;
  pageSize: number;
}

export interface JobLogsResponse {
  jobId: string;
  logs: string;
  hasMore: boolean;
}
