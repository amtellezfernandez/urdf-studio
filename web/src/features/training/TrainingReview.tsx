/**
 * Training review component - final step before launching.
 * Shows a summary of all configuration and validates readiness.
 */

import { AlertCircle, CheckCircle2 } from "lucide-react";

import { useTrainingStore } from "./useTrainingStore";

interface ReviewSectionProps {
  title: string;
  valid: boolean;
  children: React.ReactNode;
}

function ReviewSection({ title, valid, children }: ReviewSectionProps) {
  return (
    <div className="p-3 rounded-lg border bg-card">
      <div className="flex items-center gap-2 mb-2">
        {valid ? (
          <CheckCircle2 className="w-4 h-4 text-green-500" />
        ) : (
          <AlertCircle className="w-4 h-4 text-amber-500" />
        )}
        <span className="text-sm font-medium">{title}</span>
      </div>
      <div className="text-sm text-muted-foreground pl-6">{children}</div>
    </div>
  );
}

export function TrainingReview() {
  const {
    datasetConfig,
    modelConfig,
    trainingParams,
    trackerConfig,
    computeConfig,
    preflightResult,
  } = useTrainingStore();

  // Get model display name
  const getModelDisplayName = (arch: string) => {
    const names: Record<string, string> = {
      act: "ACT (Action Chunking Transformer)",
      diffusion_policy: "Diffusion Policy",
      tdmpc: "TD-MPC",
      vq_bet: "VQ-BeT",
      custom: "Custom Model",
    };
    return names[arch] || arch;
  };

  // Get tracker display name
  const getTrackerDisplayName = (type: string) => {
    const names: Record<string, string> = {
      none: "None (Local only)",
      mlflow: "MLflow",
      wandb: "Weights & Biases",
    };
    return names[type] || type;
  };

  // Get compute display name
  const getComputeDisplayName = (type: string) => {
    const names: Record<string, string> = {
      local: "Backend machine",
      modal: "Modal (Cloud)",
      runpod: "RunPod (Cloud)",
    };
    return names[type] || type;
  };

  const computeReady = computeConfig.type === "local" && preflightResult?.ready === true;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground mb-4">
        Review your configuration before starting training.
      </p>

      {/* Dataset */}
      <ReviewSection title="Dataset" valid={datasetConfig !== null}>
        {datasetConfig ? (
          <div className="space-y-1">
            <div className="font-mono text-xs">
              {datasetConfig.source === "huggingface"
                ? datasetConfig.repoId
                : datasetConfig.localPath}
            </div>
            <div className="text-xs opacity-75">
              Source: {datasetConfig.source === "huggingface" ? "HuggingFace Hub" : "Local"}
            </div>
          </div>
        ) : (
          <span className="text-amber-500">No dataset selected</span>
        )}
      </ReviewSection>

      {/* Model */}
      <ReviewSection title="Model" valid={modelConfig !== null}>
        {modelConfig ? (
          <div className="space-y-1">
            <div>{getModelDisplayName(modelConfig.architecture)}</div>
            {Object.keys(modelConfig.config).length > 0 && (
              <div className="text-xs opacity-75">
                Config: {Object.entries(modelConfig.config)
                  .slice(0, 3)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(", ")}
                {Object.keys(modelConfig.config).length > 3 && " ..."}
              </div>
            )}
          </div>
        ) : (
          <span className="text-amber-500">No model selected</span>
        )}
      </ReviewSection>

      {/* Training Parameters */}
      <ReviewSection title="Training Parameters" valid={true}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div>Batch size: {trainingParams.batchSize}</div>
          <div>Learning rate: {trainingParams.learningRate}</div>
          <div>Epochs: {trainingParams.epochs}</div>
          <div>Max steps: {trainingParams.maxSteps || "Full epochs"}</div>
          <div>Scheduler: {trainingParams.lrScheduler}</div>
          <div>Warmup: {trainingParams.warmupSteps} steps</div>
          <div>Checkpoints: every {trainingParams.checkpointInterval} epochs</div>
        </div>
        {trainingParams.runName && (
          <div className="mt-1 text-xs">
            Run name: <span className="font-mono">{trainingParams.runName}</span>
          </div>
        )}
      </ReviewSection>

      {/* Experiment Tracking */}
      <ReviewSection title="Experiment Tracking" valid={true}>
        <div>
          {getTrackerDisplayName(trackerConfig.type)}
          {trackerConfig.type === "mlflow" && trackerConfig.trackingUri && (
            <div className="text-xs opacity-75 mt-1">
              URI: {trackerConfig.trackingUri}
            </div>
          )}
          {trackerConfig.type === "wandb" && trackerConfig.project && (
            <div className="text-xs opacity-75 mt-1">
              Project: {trackerConfig.entity ? `${trackerConfig.entity}/` : ""}{trackerConfig.project}
            </div>
          )}
        </div>
      </ReviewSection>

      {/* Compute */}
      <ReviewSection
        title="Compute"
        valid={computeReady}
      >
        <div className="space-y-1">
          <div>{getComputeDisplayName(computeConfig.type)}</div>
          {computeConfig.type === "local" ? (
            <>
              <div className="text-xs opacity-75">Device: {computeConfig.device}</div>
              <div className={`text-xs ${computeReady ? "text-green-600" : "text-amber-600"}`}>
                {computeReady ? "Preflight passed" : "Preflight required"}
              </div>
            </>
          ) : (
            <>
              {computeConfig.gpu && (
                <div className="text-xs opacity-75">GPU: {computeConfig.gpu}</div>
              )}
              <div className="text-xs opacity-75">
                {computeConfig.useSpot ? "Spot" : "On-demand"} • {computeConfig.timeoutHours}h timeout
              </div>
              {!computeConfig.apiKey && (
                <div className="text-amber-500 text-xs">⚠️ API key required</div>
              )}
            </>
          )}
        </div>
      </ReviewSection>

      {/* Warnings */}
      {!computeReady && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5" />
            <div>
              <div className="text-sm font-medium text-amber-600">Preflight Required</div>
              <div className="text-xs text-muted-foreground">
                Go back to the Compute step and run preflight successfully before launch.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ready to start */}
      {datasetConfig && modelConfig && computeReady && (
        <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5" />
            <div>
              <div className="text-sm font-medium text-green-600">Ready to Start</div>
              <div className="text-xs text-muted-foreground">
                All required configuration is complete. Click "Start Training" to begin.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
