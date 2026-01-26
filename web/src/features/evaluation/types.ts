/**
 * TypeScript types for the evaluation feature.
 */

// ============================================================================
// Episode Types
// ============================================================================

export interface EvaluationEpisode {
  index: number;
  steps: EvaluationStep[];
  totalReward?: number;
  success?: boolean;
  duration: number;
  metadata?: Record<string, unknown>;
}

export interface EvaluationStep {
  timestamp: number;
  observation: Record<string, unknown>;
  action: number[];
  reward?: number;
  info?: Record<string, unknown>;
}

// ============================================================================
// Evaluation Result Types
// ============================================================================

export interface EvaluationResult {
  evaluationId: string;
  checkpointPath: string;
  episodes: EvaluationEpisode[];
  aggregateMetrics: AggregateMetrics;
  evaluatedAt: string;
  modelConfig?: Record<string, unknown>;
}

export interface AggregateMetrics {
  meanReward: number;
  stdReward: number;
  minReward: number;
  maxReward: number;
  successRate: number;
  meanEpisodeLength: number;
  totalEpisodes: number;
  custom?: Record<string, number>;
}

// ============================================================================
// Playback Types
// ============================================================================

export interface PlaybackState {
  isPlaying: boolean;
  currentEpisodeIndex: number;
  currentStepIndex: number;
  playbackSpeed: number;
  loopMode: "none" | "episode" | "all";
}

// ============================================================================
// API Types
// ============================================================================

export interface EvaluateRequest {
  checkpointPath: string;
  numEpisodes: number;
  maxStepsPerEpisode: number;
  renderMode?: "rgb_array" | "none";
  seed?: number;
}

export interface EvaluateResponse {
  success: boolean;
  evaluationId: string;
  episodes: Array<{
    index: number;
    actions: number[][];
    observations?: Record<string, unknown>[];
    rewards?: number[];
    timestamps?: number[];
    success?: boolean;
  }>;
  metrics: Record<string, number>;
  error?: string;
}

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULT_PLAYBACK_STATE: PlaybackState = {
  isPlaying: false,
  currentEpisodeIndex: 0,
  currentStepIndex: 0,
  playbackSpeed: 1.0,
  loopMode: "none",
};

export const PLAYBACK_SPEEDS = [0.25, 0.5, 1.0, 1.5, 2.0, 4.0];
