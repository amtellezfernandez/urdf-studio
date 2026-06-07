/**
 * Compute backend selection for the training wizard.
 */

import { useState, useEffect } from "react";
import { Cpu, Info } from "lucide-react";

import { Label } from "@/shared/ui/label";
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
