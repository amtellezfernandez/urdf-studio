/**
 * Training progress display component.
 * Shows real-time metrics, progress bar, and logs.
 */

import { useState } from "react";
import {
  ExternalLink,
  XCircle,
  CheckCircle2,
  Clock,
  Activity,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from "lucide-react";

import { Button } from "@/shared/ui/button";
import type { TrainingStatusResponse } from "./types";

interface TrainingProgressProps {
  jobId: string;
  status: TrainingStatusResponse;
  onCancel?: () => void;
}

export function TrainingProgress({ jobId, status, onCancel }: TrainingProgressProps) {
  const [showLogs, setShowLogs] = useState(false);

  const getStatusIcon = () => {
    switch (status.status) {
      case "completed":
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case "failed":
        return <XCircle className="w-5 h-5 text-destructive" />;
      case "cancelled":
        return <XCircle className="w-5 h-5 text-muted-foreground" />;
      case "running":
        return <Activity className="w-5 h-5 text-blue-500 animate-pulse" />;
      default:
        return <Clock className="w-5 h-5 text-amber-500" />;
    }
  };

  const getStatusText = () => {
    switch (status.status) {
      case "completed":
        return "Training Completed";
      case "failed":
        return "Training Failed";
      case "cancelled":
        return "Training Cancelled";
      case "running":
        return "Training in Progress";
      case "queued":
        return "Queued";
      case "pending":
        return "Starting...";
      default:
        return status.status;
    }
  };

  const progress = status.progress;
  const metrics = status.metrics;

  return (
    <div className="space-y-4">
      {/* Status header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {getStatusIcon()}
          <div>
            <div className="font-medium">{getStatusText()}</div>
            <div className="text-xs text-muted-foreground font-mono">{jobId}</div>
          </div>
        </div>

        {status.trackerUrl && (
          <a
            href={status.trackerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-sm text-primary hover:underline"
          >
            View in Tracker
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* Error message */}
      {status.error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-destructive mt-0.5" />
            <div className="text-sm text-destructive">{status.error}</div>
          </div>
        </div>
      )}

      {/* Progress bar */}
      {progress && (status.status === "running" || status.status === "completed") && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>
              Epoch {progress.currentEpoch} / {progress.totalEpochs}
            </span>
            <span>{Math.round(progress.overallProgress * 100)}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progress.overallProgress * 100}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            Step {progress.currentStep} / {progress.totalSteps}
          </div>
        </div>
      )}

      {/* Metrics */}
      {metrics && (status.status === "running" || status.status === "completed") && (
        <div className="p-3 bg-muted/30 rounded-lg">
          <div className="text-xs font-medium mb-2">Live Metrics</div>
          <div className="grid grid-cols-3 gap-4">
            {metrics.loss !== undefined && (
              <div>
                <div className="text-xs text-muted-foreground">Loss</div>
                <div className="text-lg font-mono">{metrics.loss.toFixed(4)}</div>
              </div>
            )}
            {metrics.learningRate !== undefined && (
              <div>
                <div className="text-xs text-muted-foreground">Learning Rate</div>
                <div className="text-lg font-mono">{metrics.learningRate.toExponential(2)}</div>
              </div>
            )}
            {metrics.gradNorm !== undefined && (
              <div>
                <div className="text-xs text-muted-foreground">Grad Norm</div>
                <div className="text-lg font-mono">{metrics.gradNorm.toFixed(3)}</div>
              </div>
            )}
          </div>

          {/* Additional metrics */}
          {Object.keys(metrics.additional || {}).length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/50">
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(metrics.additional).map(([key, value]) => (
                  <div key={key} className="text-xs">
                    <span className="text-muted-foreground">{key}: </span>
                    <span className="font-mono">{typeof value === "number" ? value.toFixed(4) : value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Compute info */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>Backend: {status.computeBackend}</span>
        {status.costEstimateUsd !== undefined && (
          <span>Est. cost: ${status.costEstimateUsd.toFixed(2)}</span>
        )}
      </div>

      {/* Lineage info */}
      {status.lineage && (
        <div className="p-3 bg-muted/30 rounded-lg">
          <div className="text-xs font-medium mb-2">Training Lineage</div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Dataset</span>
              <span className="font-mono">{status.lineage.datasetId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Model</span>
              <span className="font-mono">{status.lineage.modelArchitecture}</span>
            </div>
            {status.lineage.robotName && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Robot</span>
                <span className="font-mono">{status.lineage.robotName}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Started</span>
              <span>{new Date(status.lineage.startedAt).toLocaleString()}</span>
            </div>
            {status.lineage.completedAt && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Completed</span>
                <span>{new Date(status.lineage.completedAt).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Logs */}
      {status.logsTail && (
        <div className="space-y-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLogs(!showLogs)}
            className="w-full justify-between"
          >
            <span>Training Logs</span>
            {showLogs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>

          {showLogs && (
            <div className="max-h-48 overflow-y-auto p-3 bg-black/90 rounded-lg">
              <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">
                {status.logsTail}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Cancel button */}
      {(status.status === "running" || status.status === "pending" || status.status === "queued") && onCancel && (
        <Button variant="destructive" onClick={onCancel} className="w-full">
          Cancel Training
        </Button>
      )}
    </div>
  );
}
