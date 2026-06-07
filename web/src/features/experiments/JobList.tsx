/**
 * JobList component - Table of training jobs with filters
 */

import { useCallback, useEffect } from "react";
import {
  Play,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Ban,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Badge } from "@/shared/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { API_BASE_URL } from "@/shared/config/api";
import { cn } from "@/shared/lib/utils";

import { useExperimentStore, selectFilteredJobs } from "./useExperimentStore";
import type { TrainingJob, JobStatus, JobFilterStatus, JobsListResponse } from "./types";

interface BackendTrainingJobSummary {
  job_id: string;
  status: JobStatus;
  run_name?: string | null;
  model_architecture?: string | null;
  dataset_id?: string | null;
  dataset_source?: "huggingface" | "local" | null;
  started_at?: string | null;
  finished_at?: string | null;
  compute_backend?: string | null;
}

interface BackendJobsListResponse {
  jobs: BackendTrainingJobSummary[];
  total: number;
}

function mapBackendJob(job: BackendTrainingJobSummary): TrainingJob {
  return {
    id: job.job_id,
    name: job.run_name || job.job_id,
    status: job.status,
    modelArchitecture: job.model_architecture || "unknown",
    datasetId: job.dataset_id || "unknown",
    datasetSource: job.dataset_source || "huggingface",
    computeBackend: job.compute_backend || "local",
    startedAt: job.started_at || new Date(0).toISOString(),
    finishedAt: job.finished_at || undefined,
  };
}

// ============================================================================
// Status Helpers
// ============================================================================

const STATUS_CONFIG: Record<JobStatus, { icon: typeof Play; color: string; label: string }> = {
  pending: { icon: Clock, color: "bg-yellow-500/20 text-yellow-600", label: "Pending" },
  queued: { icon: Clock, color: "bg-yellow-500/20 text-yellow-600", label: "Queued" },
  running: { icon: Loader2, color: "bg-blue-500/20 text-blue-600", label: "Running" },
  completed: { icon: CheckCircle, color: "bg-green-500/20 text-green-600", label: "Completed" },
  failed: { icon: XCircle, color: "bg-red-500/20 text-red-600", label: "Failed" },
  cancelled: { icon: Ban, color: "bg-gray-500/20 text-gray-600", label: "Cancelled" },
};

function StatusBadge({ status }: { status: JobStatus }) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  const isAnimated = status === "running";

  return (
    <Badge className={cn("gap-1.5", config.color)}>
      <Icon className={cn("h-3 w-3", isAnimated && "animate-spin")} />
      {config.label}
    </Badge>
  );
}

// ============================================================================
// Filter Bar
// ============================================================================

function FilterBar() {
  const { filters, setFilters, setStatusFilter, clearFilters } = useExperimentStore();

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFilters({ searchQuery: e.target.value || undefined });
    },
    [setFilters]
  );

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search jobs..."
          value={filters.searchQuery || ""}
          onChange={handleSearchChange}
          className="pl-9"
        />
      </div>

      {/* Status filter */}
      <Select
        value={filters.status}
        onValueChange={(value) => setStatusFilter(value as JobFilterStatus)}
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="running">Running</SelectItem>
          <SelectItem value="completed">Completed</SelectItem>
          <SelectItem value="failed">Failed</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="cancelled">Cancelled</SelectItem>
        </SelectContent>
      </Select>

      {/* Model filter */}
      <Select
        value={filters.modelArchitecture || "all"}
        onValueChange={(value) =>
          setFilters({ modelArchitecture: value === "all" ? undefined : value })
        }
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Model" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Models</SelectItem>
          <SelectItem value="act">ACT</SelectItem>
          <SelectItem value="diffusion_policy">Diffusion Policy</SelectItem>
          <SelectItem value="tdmpc">TD-MPC</SelectItem>
          <SelectItem value="vq_bet">VQ-BeT</SelectItem>
        </SelectContent>
      </Select>

      {/* Clear filters */}
      {(filters.status !== "all" || filters.modelArchitecture || filters.searchQuery) && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          Clear filters
        </Button>
      )}
    </div>
  );
}

// ============================================================================
// Job Row
// ============================================================================

interface JobRowProps {
  job: TrainingJob;
  isSelected: boolean;
  onSelect: (jobId: string) => void;
}

function JobRow({ job, isSelected, onSelect }: JobRowProps) {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatDuration = (start: string, end?: string) => {
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : new Date();
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffHours > 0) {
      return `${diffHours}h ${diffMins % 60}m`;
    }
    return `${diffMins}m`;
  };

  return (
    <tr
      className={cn(
        "border-b cursor-pointer transition-colors hover:bg-muted/50",
        isSelected && "bg-muted/70"
      )}
      onClick={() => onSelect(job.id)}
    >
      <td className="px-4 py-3">
        <div className="font-medium text-sm">{job.name}</div>
        <div className="text-xs text-muted-foreground font-mono">{job.id.slice(0, 8)}</div>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={job.status} />
      </td>
      <td className="px-4 py-3">
        <div className="text-sm">{job.modelArchitecture.toUpperCase()}</div>
      </td>
      <td className="px-4 py-3">
        <div className="text-sm truncate max-w-[200px]" title={job.datasetId}>
          {job.datasetId}
        </div>
        <div className="text-xs text-muted-foreground">{job.datasetSource}</div>
      </td>
      <td className="px-4 py-3">
        <div className="text-sm">{formatDate(job.startedAt)}</div>
        <div className="text-xs text-muted-foreground">
          {formatDuration(job.startedAt, job.finishedAt)}
        </div>
      </td>
      <td className="px-4 py-3">
        {job.progress && (
          <div className="w-full max-w-[100px]">
            <div className="flex justify-between text-xs mb-1">
              <span>{Math.round(job.progress.overallProgress * 100)}%</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${job.progress.overallProgress * 100}%` }}
              />
            </div>
          </div>
        )}
        {!job.progress && job.status === "completed" && (
          <span className="text-sm text-muted-foreground">100%</span>
        )}
      </td>
    </tr>
  );
}

// ============================================================================
// Pagination
// ============================================================================

function Pagination() {
  const { page, pageSize, total, setPage } = useExperimentStore();
  const totalPages = Math.ceil(total / pageSize);

  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t">
      <div className="text-sm text-muted-foreground">
        Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total} jobs
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage(page - 1)}
          disabled={page <= 1}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage(page + 1)}
          disabled={page >= totalPages}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Empty State
// ============================================================================

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  const { clearFilters } = useExperimentStore();

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
        <Play className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-medium mb-2">
        {hasFilters ? "No matching jobs" : "No training jobs yet"}
      </h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-4">
        {hasFilters
          ? "Try adjusting your filters to find what you're looking for."
          : "Start a new training job to see it appear here."}
      </p>
      {hasFilters && (
        <Button variant="outline" size="sm" onClick={clearFilters}>
          Clear filters
        </Button>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function JobList() {
  const {
    jobs,
    isLoading,
    error,
    page,
    pageSize,
    filters,
    selectedJobId,
    setJobs,
    setIsLoading,
    setError,
    selectJob,
    isPolling,
    setIsPolling,
    setPollIntervalId,
    pollIntervalId,
  } = useExperimentStore();

  const filteredJobs = useExperimentStore(selectFilteredJobs);
  const hasFilters =
    filters.status !== "all" ||
    !!filters.modelArchitecture ||
    !!filters.searchQuery;

  // Fetch jobs
  const { data, refetch, isFetching } = useQuery<JobsListResponse>({
    queryKey: ["jobs", page, pageSize],
    queryFn: async () => {
      const response = await fetch(
        `${API_BASE_URL}/training/jobs?page=${page}&page_size=${pageSize}`
      );
      if (!response.ok) throw new Error("Failed to fetch jobs");
      const data: BackendJobsListResponse = await response.json();
      return {
        jobs: data.jobs.map(mapBackendJob),
        total: data.total,
        page,
        pageSize,
      };
    },
    staleTime: 10000,
  });

  // Update store when data changes
  useEffect(() => {
    if (data) {
      setJobs(data.jobs, data.total);
    }
  }, [data, setJobs]);

  // Start polling for active jobs
  useEffect(() => {
    const hasActiveJobs = jobs.some(
      (j) => j.status === "running" || j.status === "pending" || j.status === "queued"
    );

    if (hasActiveJobs && !isPolling) {
      setIsPolling(true);
      const id = window.setInterval(() => {
        refetch();
      }, 5000);
      setPollIntervalId(id);
    } else if (!hasActiveJobs && isPolling) {
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
        setPollIntervalId(null);
      }
      setIsPolling(false);
    }

    return () => {
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
      }
    };
  }, [jobs, isPolling, pollIntervalId, refetch, setIsPolling, setPollIntervalId]);

  return (
    <div className="flex flex-col h-full">
      {/* Header with filters */}
      <div className="px-4 pt-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Training Jobs</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
        <FilterBar />
      </div>

      {/* Error state */}
      {error && (
        <div className="mx-4 mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Loading state */}
      {isLoading && !jobs.length && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filteredJobs.length === 0 && <EmptyState hasFilters={hasFilters} />}

      {/* Jobs table */}
      {filteredJobs.length > 0 && (
        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <thead className="bg-muted/30 sticky top-0">
              <tr className="text-left text-sm text-muted-foreground">
                <th className="px-4 py-3 font-medium">Job</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-4 py-3 font-medium">Dataset</th>
                <th className="px-4 py-3 font-medium">Started</th>
                <th className="px-4 py-3 font-medium">Progress</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  isSelected={selectedJobId === job.id}
                  onSelect={selectJob}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <Pagination />
    </div>
  );
}
