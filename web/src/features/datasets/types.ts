/**
 * TypeScript types for the datasets feature.
 */

// ============================================================================
// Dataset Types
// ============================================================================

export type DatasetSource = "huggingface" | "local";

export interface DatasetInfo {
  id: string;
  name: string;
  source: DatasetSource;
  description?: string;
  author?: string;
  tags: string[];
  downloads?: number;
  likes?: number;
  lastModified?: string;
  size?: string;
  numEpisodes?: number;
  robotType?: string;
  taskType?: string;
  version?: string;
  isPrivate?: boolean;
}

export interface DatasetMetadata {
  id: string;
  episodes: EpisodeInfo[];
  features: DatasetFeatures;
  statistics?: DatasetStatistics;
}

export interface EpisodeInfo {
  index: number;
  length: number;
  task?: string;
  success?: boolean;
}

export interface DatasetFeatures {
  observationSpace: FeatureSpec;
  actionSpace: FeatureSpec;
  stateKeys: string[];
  imageKeys: string[];
}

export interface FeatureSpec {
  shape: number[];
  dtype: string;
  min?: number;
  max?: number;
}

export interface DatasetStatistics {
  totalFrames: number;
  meanEpisodeLength: number;
  minEpisodeLength: number;
  maxEpisodeLength: number;
  successRate?: number;
}

// ============================================================================
// Filter Types
// ============================================================================

export interface DatasetFilters {
  source: DatasetSource | "all";
  robotType?: string;
  taskType?: string;
  searchQuery?: string;
  tags?: string[];
  sortBy: "name" | "downloads" | "likes" | "lastModified";
  sortOrder: "asc" | "desc";
}

// ============================================================================
// View Types
// ============================================================================

export type DatasetViewMode = "grid" | "list";

// ============================================================================
// API Types
// ============================================================================

export interface HuggingFaceSearchResponse {
  datasets: DatasetInfo[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface DatasetPreviewResponse {
  id: string;
  episodes: Array<{
    index: number;
    frames: Array<{
      timestamp: number;
      observation: Record<string, unknown>;
      action: number[];
    }>;
  }>;
}

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULT_FILTERS: DatasetFilters = {
  source: "all",
  robotType: undefined,
  taskType: undefined,
  searchQuery: undefined,
  tags: undefined,
  sortBy: "downloads",
  sortOrder: "desc",
};
