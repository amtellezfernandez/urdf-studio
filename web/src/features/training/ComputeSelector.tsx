/**
 * Compute backend selection for the training wizard.
 */

import { useState, useEffect } from "react";
import { AlertCircle, CheckCircle2, Cloud, Cpu, Info, Loader2, RefreshCw, Server } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { useTrainingStore } from "./useTrainingStore";
import { buildTrainingPayload } from "./buildTrainingPayload";
import { API_BASE_URL } from "@/shared/config/api";
import type {
  ComputeType,
  ComputeInstanceInfo,
  TrainingPreflightResponse,
} from "./types";

interface BackendPreflightCheck {
  name: string;
  label: string;
  status: "pass" | "warn" | "fail";
  message: string;
  details?: Record<string, unknown>;
}

interface BackendPreflightResponse {
  compute_backend: string;
  device: string;
  ready: boolean;
  can_train_locally: boolean;
  cloud_required: boolean;
  recommendation: string;
  checks: BackendPreflightCheck[];
}

interface BackendComputeInstanceInfo {
  name: string;
  device?: string;
  memory_gb?: number;
  cost_per_hour?: number;
  cost_per_hour_spot?: number;
  available: boolean;
  provider?: string;
}

function mapPreflightResponse(data: BackendPreflightResponse): TrainingPreflightResponse {
  return {
    computeBackend: data.compute_backend,
    device: data.device,
    ready: data.ready,
    canTrainLocally: data.can_train_locally,
    cloudRequired: data.cloud_required,
    recommendation: data.recommendation,
    checks: data.checks.map((check) => ({
      name: check.name,
      label: check.label,
      status: check.status,
      message: check.message,
      details: check.details || {},
    })),
  };
}

function mapComputeInstances(
  instances: Record<string, BackendComputeInstanceInfo[]>,
): Record<string, ComputeInstanceInfo[]> {
  return Object.fromEntries(
    Object.entries(instances).map(([backend, items]) => [
      backend,
      items.map((item) => ({
        name: item.name,
        device: item.device,
        memoryGb: item.memory_gb,
        costPerHour: item.cost_per_hour ?? 0,
        costPerHourSpot: item.cost_per_hour_spot,
        available: item.available,
        provider: item.provider,
      })),
    ]),
  );
}

const COMPUTE_BACKENDS = [
  {
    type: "local" as ComputeType,
    name: "This machine",
    description: "Train where the RobotOps backend is running: laptop, workstation, or remote VM",
    icon: Cpu,
    requiresApiKey: false,
  },
];

// Local GPU options
const LOCAL_DEVICES = [
  { value: "cuda", label: "CUDA (NVIDIA GPU)" },
  { value: "mps", label: "MPS (Apple Silicon)" },
  { value: "cpu", label: "CPU (slow)" },
];

export function ComputeSelector() {
  const {
    datasetConfig,
    modelConfig,
    trainingParams,
    trackerConfig,
    computeConfig,
    preflightResult,
    setComputeConfig,
    setPreflightResult,
    setError,
  } = useTrainingStore();

  const [instances, setInstances] = useState<Record<string, ComputeInstanceInfo[]>>({});
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [runningPreflight, setRunningPreflight] = useState(false);

  // Fetch available instances
  useEffect(() => {
    async function fetchInstances() {
      setLoadingInstances(true);
      try {
        const response = await fetch(`${API_BASE_URL}/training/compute/instances`);
        if (response.ok) {
          const data = await response.json() as { instances: Record<string, BackendComputeInstanceInfo[]> };
          setInstances(mapComputeInstances(data.instances));
        }
      } catch (e) {
        console.warn("Failed to fetch compute instances", e);
      } finally {
        setLoadingInstances(false);
      }
    }
    fetchInstances();
  }, []);

  const handleSelectBackend = (type: ComputeType) => {
    setComputeConfig({ type });
  };

  const runPreflight = async () => {
    if (!datasetConfig || !modelConfig) {
      setError("Select a dataset and model before running compute preflight");
      return;
    }

    setRunningPreflight(true);
    setError(null);

    try {
      const payload = buildTrainingPayload({
        datasetConfig,
        modelConfig,
        trainingParams,
        trackerConfig,
        computeConfig,
      });
      const response = await fetch(`${API_BASE_URL}/training/preflight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to run preflight");
      }
      setPreflightResult(mapPreflightResponse(await response.json()));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown preflight error";
      setError(message);
    } finally {
      setRunningPreflight(false);
    }
  };

  const selectedBackend = COMPUTE_BACKENDS.find((b) => b.type === computeConfig.type);
  const localInstances = instances.local || [];
  const statusVariant = preflightResult?.ready ? "default" : "outline";

  return (
    <div className="space-y-4">
      {/* Backend selection */}
      <div className="space-y-2">
        <Label>Compute Backend</Label>
        <div className="grid gap-2">
          {COMPUTE_BACKENDS.map((backend) => {
            const Icon = backend.icon;
            return (
              <button
                key={backend.type}
                onClick={() => handleSelectBackend(backend.type)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  computeConfig.type === backend.type
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50 hover:bg-muted/50"
                }`}
              >
                <div className="flex items-start gap-3">
                  <Icon className="w-5 h-5 mt-0.5 text-muted-foreground" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{backend.name}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {backend.description}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Backend-specific config */}
      {computeConfig.type === "local" && (
        <div className="space-y-3 p-4 bg-muted/30 rounded-lg">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-muted-foreground" />
            <Label>Backend Machine</Label>
          </div>

          <div className="space-y-1">
            <Label htmlFor="training-compute-device" className="text-xs">Device</Label>
            <Select
              value={computeConfig.device}
              onValueChange={(v) => setComputeConfig({ device: v })}
            >
              <SelectTrigger id="training-compute-device" className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCAL_DEVICES.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loadingInstances ? (
            <div className="text-xs text-muted-foreground">Checking available devices...</div>
          ) : (
            <div className="grid gap-2">
              {localInstances.map((instance) => (
                <div key={instance.name} className="flex items-center justify-between rounded border bg-background px-3 py-2 text-xs">
                  <div>
                    <div className="font-medium">{instance.name}</div>
                    <div className="text-muted-foreground">
                      {instance.device || "Detected compute"}
                      {instance.memoryGb ? ` • ${instance.memoryGb.toFixed(1)} GB` : ""}
                    </div>
                  </div>
                  <Badge variant={instance.available ? "secondary" : "outline"}>
                    {instance.available ? "Available" : "Unavailable"}
                  </Badge>
                </div>
              ))}
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={runPreflight}
            disabled={runningPreflight || !datasetConfig || !modelConfig}
            className="w-full"
            data-testid="training-run-preflight"
          >
            {runningPreflight ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Run Preflight
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <Label>Cloud / Remote</Label>
        <div className="grid gap-2">
          <div className="flex items-start gap-3 rounded-lg border bg-muted/20 p-3 opacity-70">
            <Server className="w-5 h-5 mt-0.5 text-muted-foreground" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Existing GPU machine</span>
                <Badge variant="outline">Next adapter</Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                SSH Docker launch with the same trainer image, logs, metrics, and artifacts.
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-lg border bg-muted/20 p-3 opacity-70">
            <Cloud className="w-5 h-5 mt-0.5 text-muted-foreground" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">AWS EC2</span>
                <Badge variant="outline">Next adapter</Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Instance discovery will reuse the existing-machine Docker adapter.
              </div>
            </div>
          </div>
        </div>
      </div>

      {preflightResult && (
        <Alert className={preflightResult.ready ? "border-green-500/40" : "border-amber-500/40"}>
          {preflightResult.ready ? (
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          ) : (
            <AlertCircle className="w-4 h-4 text-amber-500" />
          )}
          <AlertTitle className="flex items-center gap-2">
            Preflight
            <Badge variant={statusVariant}>{preflightResult.ready ? "Ready" : "Blocked"}</Badge>
          </AlertTitle>
          <AlertDescription>
            <div className="mb-2">{preflightResult.recommendation}</div>
            <div className="space-y-1">
              {preflightResult.checks.map((check) => (
                <div key={check.name} className="flex items-start gap-2 text-xs">
                  {check.status === "pass" ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <AlertCircle className={`mt-0.5 h-3.5 w-3.5 ${check.status === "fail" ? "text-destructive" : "text-amber-500"}`} />
                  )}
                  <div>
                    <span className="font-medium">{check.label}: </span>
                    <span className="text-muted-foreground">{check.message}</span>
                  </div>
                </div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Current config summary */}
      <div className="p-3 bg-muted/50 rounded-lg">
        <div className="text-xs text-muted-foreground">Selected Compute</div>
        <div className="text-sm font-medium mt-1">
          {selectedBackend?.name}
          {computeConfig.type === "local" && (
            <span className="text-muted-foreground font-normal ml-2">
              → {computeConfig.device}
            </span>
          )}
          {computeConfig.type !== "local" && computeConfig.gpu && (
            <span className="text-muted-foreground font-normal ml-2">
              → {computeConfig.gpu} {computeConfig.useSpot ? "(spot)" : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
