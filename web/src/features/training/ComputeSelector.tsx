/**
 * Compute backend selection for the training wizard.
 */

import { useState, useEffect } from "react";
import { Cpu, Cloud, Zap, Info, ExternalLink } from "lucide-react";

import { Label } from "@/shared/ui/label";
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { useTrainingStore } from "./useTrainingStore";
import { API_BASE_URL } from "@/shared/config/api";
import type { ComputeType, ComputeInstanceInfo, ComputeInstancesResponse } from "./types";

const COMPUTE_BACKENDS = [
  {
    type: "local" as ComputeType,
    name: "Local GPU",
    description: "Train on your local machine's GPU",
    icon: Cpu,
    requiresApiKey: false,
  },
  {
    type: "modal" as ComputeType,
    name: "Modal",
    description: "Serverless GPU cloud. Pay-per-use with fast cold starts.",
    icon: Cloud,
    requiresApiKey: true,
    docsUrl: "https://modal.com/docs",
    signupUrl: "https://modal.com/signup",
  },
  {
    type: "runpod" as ComputeType,
    name: "RunPod",
    description: "GPU cloud with spot instances. Good for long training runs.",
    icon: Zap,
    requiresApiKey: true,
    docsUrl: "https://docs.runpod.io/",
    signupUrl: "https://runpod.io/console/signup",
  },
];

// Local GPU options
const LOCAL_DEVICES = [
  { value: "cuda", label: "CUDA (NVIDIA GPU)" },
  { value: "mps", label: "MPS (Apple Silicon)" },
  { value: "cpu", label: "CPU (slow)" },
];

export function ComputeSelector() {
  const { computeConfig, setComputeConfig } = useTrainingStore();

  const [instances, setInstances] = useState<Record<string, ComputeInstanceInfo[]>>({});
  const [loadingInstances, setLoadingInstances] = useState(false);

  // Fetch available instances
  useEffect(() => {
    async function fetchInstances() {
      setLoadingInstances(true);
      try {
        const response = await fetch(`${API_BASE_URL}/training/compute/instances`);
        if (response.ok) {
          const data: ComputeInstancesResponse = await response.json();
          setInstances(data.instances);
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

  const selectedBackend = COMPUTE_BACKENDS.find((b) => b.type === computeConfig.type);
  const availableGpus = instances[computeConfig.type] || [];

  // Estimate cost
  const estimatedCost = (() => {
    if (computeConfig.type === "local") return null;

    const selectedGpu = availableGpus.find((g) => g.name === computeConfig.gpu);
    if (!selectedGpu) return null;

    const hourlyRate = computeConfig.useSpot
      ? (selectedGpu.costPerHourSpot || selectedGpu.costPerHour)
      : selectedGpu.costPerHour;

    return hourlyRate * computeConfig.timeoutHours;
  })();

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
                      {backend.docsUrl && (
                        <a
                          href={backend.docsUrl}
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
            <Label>Local Configuration</Label>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Device</Label>
            <Select
              value={computeConfig.device}
              onValueChange={(v) => setComputeConfig({ device: v })}
            >
              <SelectTrigger className="h-8 text-sm">
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

          <p className="text-xs text-muted-foreground">
            Training will run on this machine. Ensure sufficient GPU memory.
          </p>
        </div>
      )}

      {(computeConfig.type === "modal" || computeConfig.type === "runpod") && (
        <div className="space-y-3 p-4 bg-muted/30 rounded-lg">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-muted-foreground" />
            <Label>{selectedBackend?.name} Configuration</Label>
          </div>

          {/* API Key */}
          <div className="space-y-1">
            <Label className="text-xs">API Key</Label>
            <Input
              type="password"
              placeholder={`${selectedBackend?.name} API key`}
              value={computeConfig.apiKey || ""}
              onChange={(e) => setComputeConfig({ apiKey: e.target.value })}
              className="h-8 text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              Get your API key from{" "}
              <a
                href={selectedBackend?.signupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                {selectedBackend?.name}
              </a>
            </p>
          </div>

          {/* GPU Selection */}
          <div className="space-y-1">
            <Label className="text-xs">GPU Type</Label>
            <Select
              value={computeConfig.gpu || ""}
              onValueChange={(v) => setComputeConfig({ gpu: v })}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select GPU" />
              </SelectTrigger>
              <SelectContent>
                {loadingInstances ? (
                  <SelectItem value="" disabled>Loading...</SelectItem>
                ) : availableGpus.length > 0 ? (
                  availableGpus.map((gpu) => (
                    <SelectItem key={gpu.name} value={gpu.name}>
                      <div className="flex items-center justify-between w-full gap-4">
                        <span>{gpu.name}</span>
                        <span className="text-muted-foreground text-xs">
                          {gpu.memoryGb}GB • ${gpu.costPerHour}/hr
                        </span>
                      </div>
                    </SelectItem>
                  ))
                ) : (
                  <>
                    <SelectItem value="A10G">A10G (24GB)</SelectItem>
                    <SelectItem value="A100-40GB">A100 40GB</SelectItem>
                    <SelectItem value="A100-80GB">A100 80GB</SelectItem>
                    <SelectItem value="H100">H100 (80GB)</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Spot instances */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs">Use Spot Instances</Label>
              <p className="text-[10px] text-muted-foreground">
                Cheaper but may be interrupted
              </p>
            </div>
            <Switch
              checked={computeConfig.useSpot}
              onCheckedChange={(checked) => setComputeConfig({ useSpot: checked })}
            />
          </div>

          {/* Timeout */}
          <div className="space-y-1">
            <Label className="text-xs">Timeout (hours)</Label>
            <Input
              type="number"
              min={0.5}
              max={24}
              step={0.5}
              value={computeConfig.timeoutHours}
              onChange={(e) => setComputeConfig({ timeoutHours: parseFloat(e.target.value) || 4 })}
              className="h-8 text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              Maximum runtime before auto-termination
            </p>
          </div>
        </div>
      )}

      {/* Cost estimate */}
      {estimatedCost !== null && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <div className="flex items-center gap-2">
            <span className="text-amber-600">💰</span>
            <div>
              <div className="text-sm font-medium">
                Estimated Cost: ${estimatedCost.toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground">
                Based on {computeConfig.timeoutHours}h {computeConfig.useSpot ? "spot" : "on-demand"} pricing
              </div>
            </div>
          </div>
        </div>
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
