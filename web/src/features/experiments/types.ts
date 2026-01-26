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
