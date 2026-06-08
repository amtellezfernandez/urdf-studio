/**
 * JobDetails component - Detailed view of a single training job
 */

import { useCallback, useState } from "react";
import {
  X,
  ExternalLink,
  Copy,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Ban,
  Play,
  StopCircle,
  RefreshCw,
  Terminal,
  BarChart2,
  Info,
  Upload,
  Database,
  FileArchive,
} from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/shared/ui/tabs";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { API_BASE_URL } from "@/shared/config/api";
import { cn } from "@/shared/lib/utils";

import { useExperimentStore } from "./useExperimentStore";
import { ExportToHFDialog } from "./ExportToHFDialog";
import type { TrainingJob, JobStatus } from "./types";

interface BackendTrainingStatusResponse {
  job_id: string;
  status: JobStatus;
  progress?: {
    current_epoch: number;
    total_epochs: number;
    current_step: number;
    total_steps: number;
    epoch_progress: number;
    overall_progress: number;
  } | null;
  metrics?: {
    loss?: number | null;
    learning_rate?: number | null;
    grad_norm?: number | null;
    additional?: Record<string, number>;
  } | null;
  tracker_url?: string | null;
  error?: string | null;
  logs_tail?: string | null;
  compute_backend?: string | null;
  cost_estimate_usd?: number | null;
  lineage?: {
    dataset_source?: "huggingface" | "local" | null;
    dataset_id?: string | null;
    model_architecture?: string | null;
    started_at?: string | null;
  } | null;
  config?: TrainingJob["config"];
  started_at?: string | null;
  finished_at?: string | null;
}

interface BackendTrainingArtifact {
  path: string;
  name: string;
  type: string;
  size_bytes: number;
  modified_at: string;
}

interface BackendTrainingArtifactsResponse {
  job_id: string;
  artifacts: BackendTrainingArtifact[];
  total: number;
}

function mapBackendStatusToJob(data: BackendTrainingStatusResponse): TrainingJob {
  return {
    id: data.job_id,
    name: data.config?.training?.run_name as string || data.job_id,
    status: data.status,
    modelArchitecture:
      data.lineage?.model_architecture ||
      data.config?.model?.architecture ||
      "unknown",
    datasetId:
      data.lineage?.dataset_id ||
      data.config?.dataset?.repo_id ||
      data.config?.dataset?.local_path ||
      "unknown",
    datasetSource: data.lineage?.dataset_source || "huggingface",
    computeBackend: data.compute_backend || "local",
    startedAt: data.started_at || data.lineage?.started_at || new Date(0).toISOString(),
    finishedAt: data.finished_at || undefined,
    progress: data.progress
      ? {
          currentEpoch: data.progress.current_epoch,
          totalEpochs: data.progress.total_epochs,
          currentStep: data.progress.current_step,
          totalSteps: data.progress.total_steps,
          epochProgress: data.progress.epoch_progress,
          overallProgress: data.progress.overall_progress,
        }
      : undefined,
    metrics: data.metrics
      ? {
          loss: data.metrics.loss ?? undefined,
          learningRate: data.metrics.learning_rate ?? undefined,
          gradNorm: data.metrics.grad_norm ?? undefined,
          additional: data.metrics.additional || {},
        }
      : undefined,
    error: data.error || undefined,
    logsTail: data.logs_tail || undefined,
    trackerUrl: data.tracker_url || undefined,
    costEstimateUsd: data.cost_estimate_usd ?? undefined,
    config: data.config,
  };
}

// ============================================================================
// Status Configuration
// ============================================================================

const STATUS_CONFIG: Record<JobStatus, { icon: typeof Play; color: string; bgColor: string }> = {
  pending: { icon: Clock, color: "text-yellow-600", bgColor: "bg-yellow-500/20" },
  queued: { icon: Clock, color: "text-yellow-600", bgColor: "bg-yellow-500/20" },
  running: { icon: Loader2, color: "text-blue-600", bgColor: "bg-blue-500/20" },
  completed: { icon: CheckCircle, color: "text-green-600", bgColor: "bg-green-500/20" },
  failed: { icon: XCircle, color: "text-red-600", bgColor: "bg-red-500/20" },
  cancelled: { icon: Ban, color: "text-gray-600", bgColor: "bg-gray-500/20" },
};

// ============================================================================
// Info Section
// ============================================================================

interface InfoRowProps {
  label: string;
  value: React.ReactNode;
  copyable?: boolean;
}

function InfoRow({ label, value, copyable }: InfoRowProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (typeof value === "string") {
      navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [value]);

  return (
    <div className="flex items-start justify-between py-2 border-b last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-right max-w-[200px] truncate">
          {value}
        </span>
        {copyable && typeof value === "string" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={handleCopy}
          >
            {copied ? (
              <CheckCircle className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Progress Section
// ============================================================================

function ProgressSection({ job }: { job: TrainingJob }) {
  if (!job.progress) {
    if (job.status === "completed") {
      return (
        <div className="p-4 bg-muted/30 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span className="font-medium">Training Complete</span>
          </div>
          <p className="text-sm text-muted-foreground">
            This job finished successfully.
          </p>
        </div>
      );
    }
    return null;
  }

  const { currentEpoch, totalEpochs, currentStep, totalSteps, epochProgress, overallProgress } = job.progress;

  return (
    <div className="space-y-4">
      {/* Overall progress */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Overall Progress</span>
          <span className="text-sm text-muted-foreground">
            {Math.round(overallProgress * 100)}%
          </span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${overallProgress * 100}%` }}
          />
        </div>
      </div>

      {/* Epoch progress */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">
            Epoch {currentEpoch} of {totalEpochs}
          </span>
          <span className="text-sm text-muted-foreground">
            {Math.round(epochProgress * 100)}%
          </span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${epochProgress * 100}%` }}
          />
        </div>
      </div>

      {/* Step info */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Step {currentStep.toLocaleString()}</span>
        <span>of {totalSteps.toLocaleString()}</span>
      </div>
    </div>
  );
}

// ============================================================================
// Metrics Section
// ============================================================================

function MetricsSection({ job }: { job: TrainingJob }) {
  if (!job.metrics) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <BarChart2 className="h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">
          Metrics will appear here once training starts.
        </p>
      </div>
    );
  }

  const { loss, learningRate, gradNorm, additional } = job.metrics;

  return (
    <div className="space-y-3">
      {loss !== undefined && (
        <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
          <span className="text-sm font-medium">Loss</span>
          <span className="text-sm font-mono">{loss.toExponential(4)}</span>
        </div>
      )}
      {learningRate !== undefined && (
        <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
          <span className="text-sm font-medium">Learning Rate</span>
          <span className="text-sm font-mono">{learningRate.toExponential(4)}</span>
        </div>
      )}
      {gradNorm !== undefined && (
        <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
          <span className="text-sm font-medium">Gradient Norm</span>
          <span className="text-sm font-mono">{gradNorm.toFixed(4)}</span>
        </div>
      )}
      {Object.entries(additional).map(([key, value]) => (
        <div key={key} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
          <span className="text-sm font-medium capitalize">{key.replace(/_/g, " ")}</span>
          <span className="text-sm font-mono">
            {typeof value === "number" ? value.toFixed(4) : value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Logs Section
// ============================================================================

function LogsSection({ job }: { job: TrainingJob }) {
  const [autoScroll, setAutoScroll] = useState(true);

  const { data: logsData, refetch, isFetching } = useQuery({
    queryKey: ["job-logs", job.id],
    queryFn: async () => {
      const response = await fetch(`${API_BASE_URL}/training/logs/${job.id}`);
      if (!response.ok) throw new Error("Failed to fetch logs");
      return response.json();
    },
    enabled: job.status === "running",
    refetchInterval: job.status === "running" ? 3000 : false,
  });

  const logs = logsData?.logs || job.logsTail || "";

  if (!logs) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Terminal className="h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">
          Logs will appear here once training starts.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="rounded"
          />
          Auto-scroll
        </label>
      </div>
      <ScrollArea className="flex-1 bg-muted/30 rounded-lg p-3">
        <pre className="text-xs font-mono whitespace-pre-wrap break-all">
          {logs}
        </pre>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// Artifacts Section
// ============================================================================

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function ArtifactsSection({ job }: { job: TrainingJob }) {
  const { data, isFetching, refetch } = useQuery<BackendTrainingArtifactsResponse>({
    queryKey: ["job-artifacts", job.id],
    queryFn: async () => {
      const response = await fetch(`${API_BASE_URL}/training/artifacts/${job.id}`);
      if (!response.ok) throw new Error("Failed to fetch artifacts");
      return response.json();
    },
    enabled: job.status === "completed" || job.status === "running",
    refetchInterval: job.status === "running" ? 5000 : false,
  });

  const artifacts = data?.artifacts || [];

  if (!artifacts.length) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <FileArchive className="h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">
          Artifacts will appear here after checkpoints or final models are saved.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{data?.total || artifacts.length} files</p>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
        </Button>
      </div>
      <div className="space-y-2">
        {artifacts.map((artifact) => (
          <div key={artifact.path} className="flex items-start justify-between gap-3 rounded-lg bg-muted/30 p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] uppercase">
                  {artifact.type}
                </Badge>
                <span className="truncate text-sm font-medium">{artifact.name}</span>
              </div>
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                {artifact.path}
              </p>
            </div>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {formatBytes(artifact.size_bytes)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function JobDetails() {
  const { selectedJobId, selectedJob, selectJob, updateJob, setSelectedJob } = useExperimentStore();
  const [showExportDialog, setShowExportDialog] = useState(false);

  // Fetch live job details for the selected job.
  const { data: fetchedJob, isLoading: isLoadingJob } = useQuery({
    queryKey: ["job-details", selectedJobId],
    queryFn: async () => {
      const response = await fetch(`${API_BASE_URL}/training/status/${selectedJobId}`);
      if (!response.ok) throw new Error("Failed to fetch job");
      return mapBackendStatusToJob(await response.json());
    },
    enabled: !!selectedJobId,
    staleTime: 5000,
  });

  const job = fetchedJob || selectedJob;

  // Cancel job mutation
  const cancelMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await fetch(`${API_BASE_URL}/training/cancel/${jobId}`, {
        method: "POST",
      });
      if (!response.ok) throw new Error("Failed to cancel job");
      return response.json();
    },
    onSuccess: () => {
      toast.success("Job cancelled");
      if (job) {
        updateJob(job.id, { status: "cancelled" });
      }
    },
    onError: () => {
      toast.error("Failed to cancel job");
    },
  });

  // No job ID selected at all
  if (!selectedJobId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <Info className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">No job selected</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Select a job from the list to view its details, progress, metrics, and logs.
        </p>
      </div>
    );
  }

  // Loading state
  if (isLoadingJob && !job) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <Loader2 className="h-12 w-12 text-muted-foreground mb-4 animate-spin" />
        <h3 className="text-lg font-medium mb-2">Loading job details...</h3>
      </div>
    );
  }

  // Job not found
  if (!job) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <XCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-medium mb-2">Job not found</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          The selected job could not be found. It may have been deleted.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => selectJob(null)}>
          Clear selection
        </Button>
      </div>
    );
  }

  // Alias for easier refactoring - use 'job' which could be from store or fetched
  const selectedJobData = job;

  const statusConfig = STATUS_CONFIG[selectedJobData.status];
  const StatusIcon = statusConfig.icon;
  const isRunning = selectedJobData.status === "running" || selectedJobData.status === "pending" || selectedJobData.status === "queued";

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <div className={cn("p-2 rounded-lg", statusConfig.bgColor)}>
              <StatusIcon
                className={cn(
                  "h-5 w-5",
                  statusConfig.color,
                  selectedJobData.status === "running" && "animate-spin"
                )}
              />
            </div>
            <div>
              <h2 className="text-lg font-semibold truncate">{selectedJobData.name}</h2>
              <p className="text-sm text-muted-foreground font-mono">{selectedJobData.id}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => cancelMutation.mutate(selectedJobData.id)}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <StopCircle className="h-4 w-4" />
              )}
              <span className="ml-2">Cancel</span>
            </Button>
          )}
          {selectedJobData.status === "completed" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowExportDialog(true)}
            >
              <Upload className="h-4 w-4 mr-2" />
              Export to HuggingFace
            </Button>
          )}
          {selectedJobData.trackerUrl && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(selectedJobData.trackerUrl, "_blank")}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              View in Tracker
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => selectJob(null)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <Tabs defaultValue="overview" className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="dataset">Dataset</TabsTrigger>
          <TabsTrigger value="metrics">Metrics</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex-1 overflow-auto p-4 space-y-6">
          {/* Progress */}
          <div>
            <h3 className="text-sm font-medium mb-3">Progress</h3>
            <ProgressSection job={selectedJobData} />
          </div>

          {/* Job Info */}
          <div>
            <h3 className="text-sm font-medium mb-3">Details</h3>
            <div className="bg-muted/30 rounded-lg p-3">
              <InfoRow label="Job ID" value={selectedJobData.id} copyable />
              <InfoRow label="Model" value={selectedJobData.modelArchitecture.toUpperCase()} />
              <InfoRow label="Dataset" value={selectedJobData.datasetId} copyable />
              <InfoRow label="Compute" value={selectedJobData.computeBackend} />
              <InfoRow label="Started" value={formatDate(selectedJobData.startedAt)} />
              {selectedJobData.finishedAt && (
                <InfoRow label="Finished" value={formatDate(selectedJobData.finishedAt)} />
              )}
              {selectedJobData.costEstimateUsd !== undefined && (
                <InfoRow
                  label="Estimated Cost"
                  value={`$${selectedJobData.costEstimateUsd.toFixed(2)}`}
                />
              )}
            </div>
          </div>

          {/* Error */}
          {selectedJobData.error && (
            <div>
              <h3 className="text-sm font-medium mb-3 text-destructive">Error</h3>
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                <pre className="text-sm text-destructive whitespace-pre-wrap">
                  {selectedJobData.error}
                </pre>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="dataset" className="flex-1 overflow-auto p-4">
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Database className="h-5 w-5 text-muted-foreground" />
              <h3 className="text-sm font-medium">Dataset Information</h3>
            </div>
            <div className="bg-muted/30 rounded-lg p-3">
              <InfoRow label="Dataset ID" value={selectedJobData.datasetId} copyable />
              <InfoRow
                label="Source"
                value={selectedJobData.config?.dataset?.source || "huggingface"}
              />
              <InfoRow
                label="Version"
                value={selectedJobData.config?.dataset?.version || "latest"}
              />
              {selectedJobData.config?.dataset?.resolved_revision && (
                <InfoRow
                  label="Commit SHA"
                  value={selectedJobData.config.dataset.resolved_revision}
                  copyable
                />
              )}
              {selectedJobData.config?.dataset?.local_path && (
                <InfoRow
                  label="Local Path"
                  value={selectedJobData.config.dataset.local_path}
                  copyable
                />
              )}
            </div>
            {selectedJobData.config?.dataset?.repo_id && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`https://huggingface.co/datasets/${selectedJobData.config?.dataset?.repo_id}`, "_blank")}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                View on HuggingFace
              </Button>
            )}
          </div>
        </TabsContent>

        <TabsContent value="metrics" className="flex-1 overflow-auto p-4">
          <MetricsSection job={selectedJobData} />
        </TabsContent>

        <TabsContent value="artifacts" className="flex-1 overflow-auto p-4">
          <ArtifactsSection job={selectedJobData} />
        </TabsContent>

        <TabsContent value="logs" className="flex-1 overflow-hidden p-4">
          <LogsSection job={selectedJobData} />
        </TabsContent>
      </Tabs>

      {/* Export to HuggingFace Dialog */}
      <ExportToHFDialog
        open={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        runId={selectedJobData.id}
        checkpoints={["final_model"]}
      />
    </div>
  );
}
