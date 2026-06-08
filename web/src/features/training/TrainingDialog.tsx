/**
 * Main training dialog component.
 * Provides a wizard-style interface for configuring and launching training jobs.
 */

import { useCallback, useEffect } from "react";
import { X, ChevronLeft, ChevronRight, Play, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/shared/ui/button";
import { useTrainingStore, selectCanStartTraining, selectIsJobRunning } from "./useTrainingStore";
import { DatasetSelector } from "./DatasetSelector";
import { ModelSelector } from "./ModelSelector";
import { HyperparameterForm } from "./HyperparameterForm";
import { TrackerConfig } from "./TrackerConfig";
import { ComputeSelector } from "./ComputeSelector";
import { TrainingReview } from "./TrainingReview";
import { TrainingProgress } from "./TrainingProgress";
import { buildTrainingPayload } from "./buildTrainingPayload";
import { API_BASE_URL } from "@/shared/config/api";
import type { TrainingStartResponse, TrainingStatusResponse } from "./types";

interface BackendTrainingStartResponse {
  success: boolean;
  job_id: string;
  message: string;
  tracker_url?: string | null;
  lineage?: BackendTrainingLineage | null;
}

interface BackendTrainingStatusResponse {
  job_id: string;
  status: TrainingStatusResponse["status"];
  progress?: BackendTrainingProgress | null;
  metrics?: BackendTrainingMetrics | null;
  tracker_url?: string | null;
  lineage?: BackendTrainingLineage | null;
  error?: string | null;
  logs_tail?: string | null;
  compute_backend: string;
  cost_estimate_usd?: number | null;
}

interface BackendTrainingProgress {
  current_epoch: number;
  total_epochs: number;
  current_step: number;
  total_steps: number;
  epoch_progress: number;
  overall_progress: number;
}

interface BackendTrainingMetrics {
  loss?: number | null;
  learning_rate?: number | null;
  grad_norm?: number | null;
  additional?: Record<string, number>;
}

interface BackendTrainingLineage {
  dataset_source: string;
  dataset_id: string;
  dataset_version?: string | null;
  model_architecture: string;
  model_config_hash: string;
  training_config_hash: string;
  robot_name?: string | null;
  urdf_hash?: string | null;
  started_at: string;
  completed_at?: string | null;
}

function mapLineage(lineage?: BackendTrainingLineage | null): TrainingStatusResponse["lineage"] {
  if (!lineage) return undefined;
  return {
    datasetSource: lineage.dataset_source,
    datasetId: lineage.dataset_id,
    datasetVersion: lineage.dataset_version || undefined,
    modelArchitecture: lineage.model_architecture,
    modelConfigHash: lineage.model_config_hash,
    trainingConfigHash: lineage.training_config_hash,
    robotName: lineage.robot_name || undefined,
    urdfHash: lineage.urdf_hash || undefined,
    startedAt: lineage.started_at,
    completedAt: lineage.completed_at || undefined,
  };
}

function mapStatusResponse(status: BackendTrainingStatusResponse): TrainingStatusResponse {
  return {
    jobId: status.job_id,
    status: status.status,
    progress: status.progress
      ? {
          currentEpoch: status.progress.current_epoch,
          totalEpochs: status.progress.total_epochs,
          currentStep: status.progress.current_step,
          totalSteps: status.progress.total_steps,
          epochProgress: status.progress.epoch_progress,
          overallProgress: status.progress.overall_progress,
        }
      : undefined,
    metrics: status.metrics
      ? {
          loss: status.metrics.loss ?? undefined,
          learningRate: status.metrics.learning_rate ?? undefined,
          gradNorm: status.metrics.grad_norm ?? undefined,
          additional: status.metrics.additional || {},
        }
      : undefined,
    trackerUrl: status.tracker_url || undefined,
    lineage: mapLineage(status.lineage),
    error: status.error || undefined,
    logsTail: status.logs_tail || undefined,
    computeBackend: status.compute_backend,
    costEstimateUsd: status.cost_estimate_usd ?? undefined,
  };
}

function mapStartResponse(result: BackendTrainingStartResponse): TrainingStartResponse {
  return {
    success: result.success,
    jobId: result.job_id,
    message: result.message,
    trackerUrl: result.tracker_url || undefined,
    lineage: mapLineage(result.lineage),
  };
}

const STEP_TITLES = {
  dataset: "Select Dataset",
  model: "Choose Model",
  training: "Training Parameters",
  tracker: "Experiment Tracking",
  compute: "Compute Backend",
  review: "Review & Launch",
};

export function TrainingDialog() {
  const {
    isDialogOpen,
    closeDialog,
    currentStep,
    nextStep,
    prevStep,
    setStep,
    datasetConfig,
    modelConfig,
    trainingParams,
    trackerConfig,
    computeConfig,
    preflightResult,
    activeJobId,
    jobStatus,
    isSubmitting,
    error,
    setActiveJobId,
    setJobStatus,
    setIsSubmitting,
    setError,
    setIsPolling,
    setPollIntervalId,
    pollIntervalId,
    resetConfig,
  } = useTrainingStore();

  const canStartTraining = useTrainingStore(selectCanStartTraining);
  const isJobRunning = useTrainingStore(selectIsJobRunning);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
      }
    };
  }, [pollIntervalId]);

  // Poll job status
  const pollStatus = useCallback(async (jobId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/training/status/${jobId}`);
      if (!response.ok) throw new Error("Failed to fetch status");

      const status = mapStatusResponse(await response.json());
      setJobStatus(status);

      // Stop polling if job is done
      if (["completed", "failed", "cancelled"].includes(status.status)) {
        setIsPolling(false);
        if (pollIntervalId) {
          clearInterval(pollIntervalId);
          setPollIntervalId(null);
        }

        if (status.status === "completed") {
          toast.success("Training completed!");
        } else if (status.status === "failed") {
          toast.error(`Training failed: ${status.error || "Unknown error"}`);
        }
      }
    } catch (e) {
      console.error("Failed to poll status:", e);
    }
  }, [pollIntervalId, setJobStatus, setIsPolling, setPollIntervalId]);

  // Start training
  const handleStartTraining = async (smokeRun = false) => {
    if (!datasetConfig || !modelConfig) {
      setError("Please complete dataset and model configuration");
      return;
    }

    if (!preflightResult?.ready) {
      setError("Run compute preflight successfully before starting training");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const request = buildTrainingPayload({
        datasetConfig,
        modelConfig,
        trainingParams,
        trackerConfig,
        computeConfig,
        overrides: smokeRun
          ? {
              training: {
                maxSteps: 2,
                runName: trainingParams.runName
                  ? `${trainingParams.runName}-smoke`
                  : "robotops-smoke",
              },
            }
          : undefined,
      });

      const response = await fetch(`${API_BASE_URL}/training/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to start training");
      }

      const result = mapStartResponse(await response.json());

      if (!result.success) {
        throw new Error(result.message);
      }

      setActiveJobId(result.jobId);
      toast.success(`${smokeRun ? "Smoke training" : "Training"} started: ${result.jobId}`);

      if (result.trackerUrl) {
        toast.info(`Track progress: ${result.trackerUrl}`);
      }

      // Start polling
      setIsPolling(true);
      const intervalId = window.setInterval(() => {
        pollStatus(result.jobId);
      }, 2000);
      setPollIntervalId(intervalId);

      // Initial poll
      pollStatus(result.jobId);

    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setError(message);
      toast.error(`Failed to start training: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Cancel training
  const handleCancelTraining = async () => {
    if (!activeJobId) return;

    try {
      const response = await fetch(`${API_BASE_URL}/training/cancel/${activeJobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) throw new Error("Failed to cancel");

      toast.info("Training cancelled");
      setIsPolling(false);
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
        setPollIntervalId(null);
      }
    } catch (e) {
      toast.error("Failed to cancel training");
    }
  };

  // Check if step is valid for navigation
  const canProceed = (step: string): boolean => {
    switch (step) {
      case "dataset":
        return datasetConfig !== null;
      case "model":
        return modelConfig !== null;
      default:
        return true;
    }
  };

  if (!isDialogOpen) return null;

  // Show progress view if job is running
  if (activeJobId && jobStatus) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-background border rounded-lg shadow-lg w-full max-w-2xl m-4 max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h2 className="text-sm font-medium">Training Progress</h2>
            <Button variant="ghost" size="sm" onClick={closeDialog}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Progress content */}
          <div className="flex-1 overflow-y-auto p-4">
            <TrainingProgress
              jobId={activeJobId}
              status={jobStatus}
              onCancel={handleCancelTraining}
            />
          </div>

          {/* Footer */}
          <div className="border-t px-4 py-3 flex justify-end gap-2">
            {isJobRunning ? (
              <Button variant="destructive" onClick={handleCancelTraining}>
                Cancel Training
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => {
                  setActiveJobId(null);
                  setJobStatus(null);
                  resetConfig();
                }}>
                  New Training
                </Button>
                <Button onClick={closeDialog}>Close</Button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg shadow-lg w-full max-w-2xl m-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h2 className="text-sm font-medium">
              {STEP_TITLES[currentStep]}
            </h2>
            <p className="text-xs text-muted-foreground">
              Step {Object.keys(STEP_TITLES).indexOf(currentStep) + 1} of {Object.keys(STEP_TITLES).length}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={closeDialog}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Step indicator */}
        <div className="flex gap-1 px-4 py-2 border-b bg-muted/30">
          {Object.keys(STEP_TITLES).map((step, index) => (
            <button
              key={step}
              onClick={() => setStep(step as keyof typeof STEP_TITLES)}
              disabled={index > 0 && !canProceed(Object.keys(STEP_TITLES)[index - 1])}
              className={`flex-1 h-1.5 rounded-full transition-colors ${
                step === currentStep
                  ? "bg-primary"
                  : index < Object.keys(STEP_TITLES).indexOf(currentStep)
                  ? "bg-primary/50"
                  : "bg-muted"
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
              {error}
            </div>
          )}

          {currentStep === "dataset" && <DatasetSelector />}
          {currentStep === "model" && <ModelSelector />}
          {currentStep === "training" && <HyperparameterForm />}
          {currentStep === "tracker" && <TrackerConfig />}
          {currentStep === "compute" && <ComputeSelector />}
          {currentStep === "review" && <TrainingReview />}
        </div>

        {/* Footer */}
        <div className="border-t px-4 py-3 flex justify-between">
          <Button
            variant="outline"
            onClick={prevStep}
            disabled={currentStep === "dataset"}
            data-testid="training-back"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back
          </Button>

          {currentStep === "review" ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => handleStartTraining(true)}
                disabled={!canStartTraining || isSubmitting}
                data-testid="training-smoke-test"
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                Smoke Test
              </Button>
              <Button
                onClick={() => handleStartTraining(false)}
                disabled={!canStartTraining || isSubmitting}
                data-testid="training-start"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    Start Training
                  </>
                )}
              </Button>
            </div>
          ) : (
            <Button
              onClick={nextStep}
              disabled={!canProceed(currentStep)}
              data-testid="training-next"
            >
              Next
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
