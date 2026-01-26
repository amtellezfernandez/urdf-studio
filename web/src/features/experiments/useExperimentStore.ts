/**
 * Zustand store for experiment/jobs dashboard state management.
 */

import { create } from "zustand";
import type { TrainingJob, JobFilters, JobFilterStatus } from "./types";

// ============================================================================
// Types
// ============================================================================

interface ExperimentState {
  // Jobs list
  jobs: TrainingJob[];
  isLoading: boolean;
  error: string | null;

  // Pagination
  page: number;
  pageSize: number;
  total: number;

  // Filters
  filters: JobFilters;

  // Selected job
  selectedJobId: string | null;
  selectedJob: TrainingJob | null;

  // Polling
  isPolling: boolean;
  pollIntervalId: number | null;

  // Tab state
  activeTab: "jobs" | "metrics" | "logs";

  // Actions
  setJobs: (jobs: TrainingJob[], total: number) => void;
  addJob: (job: TrainingJob) => void;
  updateJob: (jobId: string, updates: Partial<TrainingJob>) => void;
  removeJob: (jobId: string) => void;

  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  setPage: (page: number) => void;
  setPageSize: (size: number) => void;

  setFilters: (filters: Partial<JobFilters>) => void;
  setStatusFilter: (status: JobFilterStatus) => void;
  clearFilters: () => void;

  selectJob: (jobId: string | null) => void;
  setSelectedJob: (job: TrainingJob | null) => void;

  setIsPolling: (polling: boolean) => void;
  setPollIntervalId: (id: number | null) => void;

  setActiveTab: (tab: "jobs" | "metrics" | "logs") => void;

  reset: () => void;
}

// ============================================================================
// Default Values
// ============================================================================

const defaultFilters: JobFilters = {
  status: "all",
  modelArchitecture: undefined,
  dateRange: undefined,
  searchQuery: undefined,
};

// ============================================================================
// Store
// ============================================================================

export const useExperimentStore = create<ExperimentState>((set, get) => ({
  // Initial state
  jobs: [],
  isLoading: false,
  error: null,

  page: 1,
  pageSize: 10,
  total: 0,

  filters: { ...defaultFilters },

  selectedJobId: null,
  selectedJob: null,

  isPolling: false,
  pollIntervalId: null,

  activeTab: "jobs",

  // Actions
  setJobs: (jobs, total) => set({ jobs, total }),

  addJob: (job) => set((state) => ({
    jobs: [job, ...state.jobs],
    total: state.total + 1,
  })),

  updateJob: (jobId, updates) => set((state) => ({
    jobs: state.jobs.map((job) =>
      job.id === jobId ? { ...job, ...updates } : job
    ),
    selectedJob: state.selectedJob?.id === jobId
      ? { ...state.selectedJob, ...updates }
      : state.selectedJob,
  })),

  removeJob: (jobId) => set((state) => ({
    jobs: state.jobs.filter((job) => job.id !== jobId),
    total: state.total - 1,
    selectedJobId: state.selectedJobId === jobId ? null : state.selectedJobId,
    selectedJob: state.selectedJob?.id === jobId ? null : state.selectedJob,
  })),

  setIsLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize, page: 1 }),

  setFilters: (filters) => set((state) => ({
    filters: { ...state.filters, ...filters },
    page: 1,
  })),

  setStatusFilter: (status) => set((state) => ({
    filters: { ...state.filters, status },
    page: 1,
  })),

  clearFilters: () => set({ filters: { ...defaultFilters }, page: 1 }),

  selectJob: (jobId) => {
    const { jobs } = get();
    const job = jobId ? jobs.find((j) => j.id === jobId) || null : null;
    set({ selectedJobId: jobId, selectedJob: job });
  },

  setSelectedJob: (job) => set({
    selectedJobId: job?.id || null,
    selectedJob: job,
  }),

  setIsPolling: (isPolling) => set({ isPolling }),

  setPollIntervalId: (pollIntervalId) => set({ pollIntervalId }),

  setActiveTab: (activeTab) => set({ activeTab }),

  reset: () => {
    const { pollIntervalId } = get();
    if (pollIntervalId) {
      clearInterval(pollIntervalId);
    }
    set({
      jobs: [],
      isLoading: false,
      error: null,
      page: 1,
      total: 0,
      filters: { ...defaultFilters },
      selectedJobId: null,
      selectedJob: null,
      isPolling: false,
      pollIntervalId: null,
      activeTab: "jobs",
    });
  },
}));

// ============================================================================
// Selectors
// ============================================================================

export const selectFilteredJobs = (state: ExperimentState): TrainingJob[] => {
  let filtered = state.jobs;

  // Filter by status
  if (state.filters.status !== "all") {
    filtered = filtered.filter((job) => job.status === state.filters.status);
  }

  // Filter by model architecture
  if (state.filters.modelArchitecture) {
    filtered = filtered.filter(
      (job) => job.modelArchitecture === state.filters.modelArchitecture
    );
  }

  // Filter by search query
  if (state.filters.searchQuery) {
    const query = state.filters.searchQuery.toLowerCase();
    filtered = filtered.filter(
      (job) =>
        job.name.toLowerCase().includes(query) ||
        job.id.toLowerCase().includes(query) ||
        job.datasetId.toLowerCase().includes(query)
    );
  }

  // Filter by date range
  if (state.filters.dateRange) {
    const { start, end } = state.filters.dateRange;
    filtered = filtered.filter((job) => {
      const jobDate = new Date(job.startedAt);
      return jobDate >= new Date(start) && jobDate <= new Date(end);
    });
  }

  return filtered;
};

export const selectRunningJobs = (state: ExperimentState): TrainingJob[] => {
  return state.jobs.filter(
    (job) => job.status === "running" || job.status === "pending" || job.status === "queued"
  );
};

export const selectHasActiveJobs = (state: ExperimentState): boolean => {
  return selectRunningJobs(state).length > 0;
};
