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
            {Math.round(overallProgress)}%
          </span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${overallProgress}%` }}
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
            {Math.round(epochProgress)}%
          </span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${epochProgress}%` }}
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
// Main Component
// ============================================================================

export function JobDetails() {
  const { selectedJob, selectJob, updateJob } = useExperimentStore();
  const [showExportDialog, setShowExportDialog] = useState(false);

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
      if (selectedJob) {
        updateJob(selectedJob.id, { status: "cancelled" });
      }
    },
    onError: () => {
      toast.error("Failed to cancel job");
    },
  });

  if (!selectedJob) {
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

  const statusConfig = STATUS_CONFIG[selectedJob.status];
  const StatusIcon = statusConfig.icon;
  const isRunning = selectedJob.status === "running" || selectedJob.status === "pending" || selectedJob.status === "queued";

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
                  selectedJob.status === "running" && "animate-spin"
                )}
              />
            </div>
            <div>
              <h2 className="text-lg font-semibold truncate">{selectedJob.name}</h2>
              <p className="text-sm text-muted-foreground font-mono">{selectedJob.id}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => cancelMutation.mutate(selectedJob.id)}
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
          {selectedJob.status === "completed" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowExportDialog(true)}
            >
              <Upload className="h-4 w-4 mr-2" />
              Export to HuggingFace
            </Button>
          )}
          {selectedJob.trackerUrl && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(selectedJob.trackerUrl, "_blank")}
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
          <TabsTrigger value="metrics">Metrics</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex-1 overflow-auto p-4 space-y-6">
          {/* Progress */}
          <div>
            <h3 className="text-sm font-medium mb-3">Progress</h3>
            <ProgressSection job={selectedJob} />
          </div>

          {/* Job Info */}
          <div>
            <h3 className="text-sm font-medium mb-3">Details</h3>
            <div className="bg-muted/30 rounded-lg p-3">
              <InfoRow label="Job ID" value={selectedJob.id} copyable />
              <InfoRow label="Model" value={selectedJob.modelArchitecture.toUpperCase()} />
              <InfoRow label="Dataset" value={selectedJob.datasetId} copyable />
              <InfoRow label="Compute" value={selectedJob.computeBackend} />
              <InfoRow label="Started" value={formatDate(selectedJob.startedAt)} />
              {selectedJob.finishedAt && (
                <InfoRow label="Finished" value={formatDate(selectedJob.finishedAt)} />
              )}
              {selectedJob.costEstimateUsd !== undefined && (
                <InfoRow
                  label="Estimated Cost"
                  value={`$${selectedJob.costEstimateUsd.toFixed(2)}`}
                />
              )}
            </div>
          </div>

          {/* Error */}
          {selectedJob.error && (
            <div>
              <h3 className="text-sm font-medium mb-3 text-destructive">Error</h3>
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                <pre className="text-sm text-destructive whitespace-pre-wrap">
                  {selectedJob.error}
                </pre>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="metrics" className="flex-1 overflow-auto p-4">
          <MetricsSection job={selectedJob} />
        </TabsContent>

        <TabsContent value="logs" className="flex-1 overflow-hidden p-4">
          <LogsSection job={selectedJob} />
        </TabsContent>
      </Tabs>

      {/* Export to HuggingFace Dialog */}
      <ExportToHFDialog
        open={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        runId={selectedJob.id}
        checkpoints={["final_model"]}
      />
    </div>
  );
}
