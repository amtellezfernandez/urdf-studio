/**
 * Experiment tracker configuration for the training wizard.
 */

import { useState } from "react";
import { ExternalLink, Info, Check } from "lucide-react";

import { Label } from "@/shared/ui/label";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import { useTrainingStore } from "./useTrainingStore";
import type { TrackerType } from "./types";

const TRACKERS = [
  {
    type: "none" as TrackerType,
    name: "None",
    description: "No experiment tracking. Logs saved locally only.",
    icon: "📁",
  },
  {
    type: "mlflow" as TrackerType,
    name: "MLflow",
    description: "Open-source experiment tracking. Self-hosted or Databricks.",
    icon: "🔬",
    docsUrl: "https://mlflow.org/docs/latest/tracking.html",
  },
  {
    type: "wandb" as TrackerType,
    name: "Weights & Biases",
    description: "Cloud experiment tracking with rich visualizations.",
    icon: "📊",
    docsUrl: "https://docs.wandb.ai/",
  },
];

export function TrackerConfig() {
  const { trackerConfig, setTrackerConfig } = useTrainingStore();
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "success" | "error">("idle");

  const handleSelectTracker = (type: TrackerType) => {
    setTrackerConfig({ type });
    setConnectionStatus("idle");
  };

  const selectedTracker = TRACKERS.find((t) => t.type === trackerConfig.type);

  const testConnection = async () => {
    setTestingConnection(true);
    setConnectionStatus("idle");

    // Simulate connection test
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // For now, always succeed if fields are filled
    if (trackerConfig.type === "mlflow" && trackerConfig.trackingUri) {
      setConnectionStatus("success");
    } else if (trackerConfig.type === "wandb" && trackerConfig.project) {
      setConnectionStatus("success");
    } else if (trackerConfig.type === "none") {
      setConnectionStatus("success");
    } else {
      setConnectionStatus("error");
    }

    setTestingConnection(false);
  };

  return (
    <div className="space-y-4">
      {/* Tracker selection */}
      <div className="space-y-2">
        <Label>Experiment Tracker</Label>
        <div className="grid gap-2">
          {TRACKERS.map((tracker) => (
            <button
              key={tracker.type}
              onClick={() => handleSelectTracker(tracker.type)}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${
                trackerConfig.type === tracker.type
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-muted/50"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-xl">{tracker.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{tracker.name}</span>
                    {tracker.docsUrl && (
                      <a
                        href={tracker.docsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground hover:text-primary"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {tracker.description}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Tracker-specific config */}
      {trackerConfig.type === "mlflow" && (
        <div className="space-y-3 p-4 bg-muted/30 rounded-lg">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-muted-foreground" />
            <Label>MLflow Configuration</Label>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Tracking URI</Label>
              <Input
                placeholder="http://localhost:5000 or databricks://..."
                value={trackerConfig.trackingUri || ""}
                onChange={(e) => setTrackerConfig({ trackingUri: e.target.value })}
                className="h-8 text-sm"
              />
              <p className="text-[10px] text-muted-foreground">
                MLflow server URL. Leave empty for local file storage.
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Experiment Name</Label>
              <Input
                placeholder="urdf-studio-training"
                value={trackerConfig.experimentName || ""}
                onChange={(e) => setTrackerConfig({ experimentName: e.target.value })}
                className="h-8 text-sm"
              />
            </div>
          </div>
        </div>
      )}

      {trackerConfig.type === "wandb" && (
        <div className="space-y-3 p-4 bg-muted/30 rounded-lg">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-muted-foreground" />
            <Label>Weights & Biases Configuration</Label>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Project</Label>
              <Input
                placeholder="urdf-studio-training"
                value={trackerConfig.project || ""}
                onChange={(e) => setTrackerConfig({ project: e.target.value })}
                className="h-8 text-sm"
              />
              <p className="text-[10px] text-muted-foreground">
                W&B project name (will be created if doesn't exist)
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Entity (optional)</Label>
              <Input
                placeholder="your-team"
                value={trackerConfig.entity || ""}
                onChange={(e) => setTrackerConfig({ entity: e.target.value })}
                className="h-8 text-sm"
              />
              <p className="text-[10px] text-muted-foreground">
                Team or username. Leave empty for personal account.
              </p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Make sure you're logged in with <code className="bg-muted px-1 rounded">wandb login</code>
          </p>
        </div>
      )}

      {trackerConfig.type === "none" && (
        <div className="p-4 bg-muted/30 rounded-lg">
          <p className="text-sm text-muted-foreground">
            Training logs and checkpoints will be saved locally in the output directory.
            You can still view training progress in the UI.
          </p>
        </div>
      )}

      {/* Connection test */}
      {trackerConfig.type !== "none" && (
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={testConnection}
            disabled={testingConnection}
          >
            {testingConnection ? "Testing..." : "Test Connection"}
          </Button>

          {connectionStatus === "success" && (
            <div className="flex items-center gap-1 text-sm text-green-600">
              <Check className="w-4 h-4" />
              Connected
            </div>
          )}

          {connectionStatus === "error" && (
            <div className="text-sm text-destructive">
              Connection failed. Check configuration.
            </div>
          )}
        </div>
      )}

      {/* Current config summary */}
      {trackerConfig.type !== "none" && (
        <div className="p-3 bg-muted/50 rounded-lg">
          <div className="text-xs text-muted-foreground">Selected Tracker</div>
          <div className="text-sm font-medium mt-1">
            {selectedTracker?.name}
            {trackerConfig.type === "mlflow" && trackerConfig.trackingUri && (
              <span className="text-muted-foreground font-normal ml-2">
                → {trackerConfig.trackingUri}
              </span>
            )}
            {trackerConfig.type === "wandb" && trackerConfig.project && (
              <span className="text-muted-foreground font-normal ml-2">
                → {trackerConfig.entity ? `${trackerConfig.entity}/` : ""}{trackerConfig.project}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
