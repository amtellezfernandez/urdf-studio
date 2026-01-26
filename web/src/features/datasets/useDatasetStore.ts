/**
 * Zustand store for dataset browser state management.
 */

import { create } from "zustand";
import type { DatasetInfo, DatasetFilters, DatasetViewMode, DatasetMetadata } from "./types";
import { DEFAULT_FILTERS } from "./types";

// ============================================================================
// Types
// ============================================================================

interface DatasetState {
  // Dataset list
  datasets: DatasetInfo[];
  isLoading: boolean;
  error: string | null;

  // Pagination
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;

  // Filters
  filters: DatasetFilters;

  // View mode
  viewMode: DatasetViewMode;

  // Selected dataset
  selectedDatasetId: string | null;
  selectedDataset: DatasetInfo | null;
  datasetMetadata: DatasetMetadata | null;
  isLoadingMetadata: boolean;

  // Recent datasets
  recentDatasets: DatasetInfo[];

  // Actions
  setDatasets: (datasets: DatasetInfo[], total: number, hasMore: boolean) => void;
  appendDatasets: (datasets: DatasetInfo[]) => void;
  clearDatasets: () => void;

  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  setPage: (page: number) => void;
  nextPage: () => void;

  setFilters: (filters: Partial<DatasetFilters>) => void;
  setSearchQuery: (query: string) => void;
  clearFilters: () => void;

  setViewMode: (mode: DatasetViewMode) => void;

  selectDataset: (datasetId: string | null) => void;
  setSelectedDataset: (dataset: DatasetInfo | null) => void;
  setDatasetMetadata: (metadata: DatasetMetadata | null) => void;
  setIsLoadingMetadata: (loading: boolean) => void;

  addToRecent: (dataset: DatasetInfo) => void;
  clearRecent: () => void;

  reset: () => void;
}

// ============================================================================
// Store
// ============================================================================

export const useDatasetStore = create<DatasetState>((set, get) => ({
  // Initial state
  datasets: [],
  isLoading: false,
  error: null,

  page: 1,
  pageSize: 20,
  total: 0,
  hasMore: true,

  filters: { ...DEFAULT_FILTERS },

  viewMode: "grid",

  selectedDatasetId: null,
  selectedDataset: null,
  datasetMetadata: null,
  isLoadingMetadata: false,

  recentDatasets: [],

  // Actions
  setDatasets: (datasets, total, hasMore) => set({
    datasets,
    total,
    hasMore,
  }),

  appendDatasets: (newDatasets) => set((state) => ({
    datasets: [...state.datasets, ...newDatasets],
  })),

  clearDatasets: () => set({ datasets: [], total: 0, page: 1, hasMore: true }),

  setIsLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  setPage: (page) => set({ page }),
  nextPage: () => set((state) => ({ page: state.page + 1 })),

  setFilters: (filters) => set((state) => ({
    filters: { ...state.filters, ...filters },
    page: 1,
    datasets: [],
    hasMore: true,
  })),

  setSearchQuery: (searchQuery) => set((state) => ({
    filters: { ...state.filters, searchQuery: searchQuery || undefined },
    page: 1,
    datasets: [],
    hasMore: true,
  })),

  clearFilters: () => set({
    filters: { ...DEFAULT_FILTERS },
    page: 1,
    datasets: [],
    hasMore: true,
  }),

  setViewMode: (viewMode) => set({ viewMode }),

  selectDataset: (datasetId) => {
    const { datasets, recentDatasets } = get();
    const dataset = datasetId
      ? datasets.find((d) => d.id === datasetId) ||
        recentDatasets.find((d) => d.id === datasetId) ||
        null
      : null;
    set({
      selectedDatasetId: datasetId,
      selectedDataset: dataset,
      datasetMetadata: null,
    });
  },

  setSelectedDataset: (dataset) => set({
    selectedDatasetId: dataset?.id || null,
    selectedDataset: dataset,
    datasetMetadata: null,
  }),

  setDatasetMetadata: (datasetMetadata) => set({ datasetMetadata }),
  setIsLoadingMetadata: (isLoadingMetadata) => set({ isLoadingMetadata }),

  addToRecent: (dataset) => set((state) => {
    const filtered = state.recentDatasets.filter((d) => d.id !== dataset.id);
    return {
      recentDatasets: [dataset, ...filtered].slice(0, 10),
    };
  }),

  clearRecent: () => set({ recentDatasets: [] }),

  reset: () => set({
    datasets: [],
    isLoading: false,
    error: null,
    page: 1,
    total: 0,
    hasMore: true,
    filters: { ...DEFAULT_FILTERS },
    selectedDatasetId: null,
    selectedDataset: null,
    datasetMetadata: null,
    isLoadingMetadata: false,
  }),
}));

// ============================================================================
// Selectors
// ============================================================================

export const selectFilteredDatasets = (state: DatasetState): DatasetInfo[] => {
  let filtered = state.datasets;

  // Filter by source
  if (state.filters.source !== "all") {
    filtered = filtered.filter((d) => d.source === state.filters.source);
  }

  // Filter by robot type
  if (state.filters.robotType) {
    filtered = filtered.filter((d) => d.robotType === state.filters.robotType);
  }

  // Filter by task type
  if (state.filters.taskType) {
    filtered = filtered.filter((d) => d.taskType === state.filters.taskType);
  }

  // Filter by tags
  if (state.filters.tags && state.filters.tags.length > 0) {
    filtered = filtered.filter((d) =>
      state.filters.tags!.some((tag) => d.tags.includes(tag))
    );
  }

  // Sort
  const { sortBy, sortOrder } = state.filters;
  filtered = [...filtered].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case "name":
        comparison = a.name.localeCompare(b.name);
        break;
      case "downloads":
        comparison = (a.downloads || 0) - (b.downloads || 0);
        break;
      case "likes":
        comparison = (a.likes || 0) - (b.likes || 0);
        break;
      case "lastModified":
        comparison = new Date(a.lastModified || 0).getTime() - new Date(b.lastModified || 0).getTime();
        break;
    }

    return sortOrder === "desc" ? -comparison : comparison;
  });

  return filtered;
};

export const selectHasActiveFilters = (state: DatasetState): boolean => {
  const { filters } = state;
  return (
    filters.source !== "all" ||
    !!filters.robotType ||
    !!filters.taskType ||
    !!filters.searchQuery ||
    (filters.tags && filters.tags.length > 0) ||
    filters.sortBy !== DEFAULT_FILTERS.sortBy
  );
};
