/**
 * Model selection component for the training wizard.
 * Fetches available policies from /api/policies endpoint.
 */

import { useEffect, useState } from "react";
import { Info } from "lucide-react";

import { Label } from "@/shared/ui/label";
import { Input } from "@/shared/ui/input";
import { useTrainingStore } from "./useTrainingStore";
import { API_BASE_URL } from "@/shared/config/api";
import type { ModelArchitecture } from "./types";

// Policy response from /api/policies
interface PolicyResponse {
  id: string;
  name: string;
  description: string;
  source: string;
  default_config: Record<string, unknown>;
  input_modalities: string[];
  version: string | null;
}

interface PoliciesListResponse {
  policies: PolicyResponse[];
  total: number;
  fallback_used: boolean;
}

// Internal model representation for the UI
interface ModelInfo {
  id: string;
  name: string;
  displayName: string;
  description: string;
  defaultConfig: Record<string, unknown>;
  inputModalities: string[];
  source: string;
  version: string | null;
}

// Fallback model info if API unavailable
const FALLBACK_MODELS: ModelInfo[] = [
  {
    id: "act",
    name: "act",
    displayName: "ACT (Action Chunking Transformer)",
    description: "Transformer-based policy that predicts action chunks. Good for manipulation tasks.",
    defaultConfig: {
      chunk_size: 100,
      hidden_dim: 512,
      n_encoder_layers: 4,
      n_decoder_layers: 7,
    },
    inputModalities: ["state", "image"],
    source: "lerobot",
    version: null,
  },
  {
    id: "diffusion",
    name: "diffusion_policy",
    displayName: "Diffusion Policy",
    description: "Denoising diffusion for action prediction. Robust to multimodal demonstrations.",
    defaultConfig: {
      horizon: 16,
      n_obs_steps: 2,
      n_action_steps: 8,
      num_inference_steps: 10,
    },
    inputModalities: ["state", "image"],
    source: "lerobot",
    version: null,
  },
  {
    id: "tdmpc",
    name: "tdmpc",
    displayName: "TD-MPC",
    description: "Temporal Difference Model Predictive Control. Good for complex dynamics.",
    defaultConfig: {
      horizon: 5,
      latent_dim: 512,
    },
    inputModalities: ["state"],
    source: "lerobot",
    version: null,
  },
  {
    id: "vqbet",
    name: "vq_bet",
    displayName: "VQ-BeT",
    description: "Vector-Quantized Behavior Transformer. Discrete action space learning.",
    defaultConfig: {
      n_clusters: 512,
      hidden_dim: 384,
    },
    inputModalities: ["state", "image"],
    source: "lerobot",
    version: null,
  },
];

// Map policy response to internal model format
function policyToModel(policy: PolicyResponse): ModelInfo {
  return {
    id: policy.id,
    name: policy.id, // Use id for architecture name
    displayName: policy.name,
    description: policy.description,
    defaultConfig: policy.default_config,
    inputModalities: policy.input_modalities,
    source: policy.source,
    version: policy.version,
  };
}

export function ModelSelector() {
  const { modelConfig, setModelConfig } = useTrainingStore();

  const [models, setModels] = useState<ModelInfo[]>(FALLBACK_MODELS);
  const [loading, setLoading] = useState(true);
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const [selectedArch, setSelectedArch] = useState<ModelArchitecture | null>(
    modelConfig?.architecture || null
  );
  const [config, setConfig] = useState<Record<string, unknown>>(
    modelConfig?.config || {}
  );

  // Fetch policies from API
  useEffect(() => {
    async function fetchPolicies() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/policies`);
        if (response.ok) {
          const data: PoliciesListResponse = await response.json();
          if (data.policies.length > 0) {
            setModels(data.policies.map(policyToModel));
            setFallbackUsed(data.fallback_used);
          }
        }
      } catch (e) {
        console.warn("Failed to fetch policies, using fallback", e);
        setFallbackUsed(true);
      } finally {
        setLoading(false);
      }
    }
    fetchPolicies();
  }, []);

  const handleSelectModel = (arch: ModelArchitecture) => {
    setSelectedArch(arch);

    // Get default config for this model
    const modelInfo = models.find((m) => m.id === arch || m.name === arch);
    const defaultConfig = modelInfo?.defaultConfig || {};

    setConfig(defaultConfig);
    setModelConfig({
      architecture: arch,
      config: defaultConfig,
    });
  };

  const handleConfigChange = (key: string, value: unknown) => {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);

    if (selectedArch) {
      setModelConfig({
        architecture: selectedArch,
        config: newConfig,
      });
    }
  };

  const selectedModel = models.find((m) => m.id === selectedArch || m.name === selectedArch);

  return (
    <div className="space-y-4">
      {/* Model selection */}
      <div className="space-y-2">
        <Label>Policy Architecture</Label>
        {fallbackUsed && (
          <div className="text-xs text-amber-600 dark:text-amber-400">
            Using fallback policy list (LeRobot may not be available)
          </div>
        )}
        <div className="grid gap-2">
          {models.map((model) => (
            <button
              key={model.id}
              onClick={() => handleSelectModel(model.id as ModelArchitecture)}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${
                selectedArch === model.id || selectedArch === model.name
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm">{model.displayName}</div>
                {model.version && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded">
                    v{model.version}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {model.description}
              </div>
              {model.inputModalities.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {model.inputModalities.map((modality) => (
                    <span
                      key={modality}
                      className="text-[10px] px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded"
                    >
                      {modality}
                    </span>
                  ))}
                  <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded text-muted-foreground">
                    {model.source}
                  </span>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Model config */}
      {selectedModel && (
        <div className="space-y-3 p-4 bg-muted/30 rounded-lg">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-muted-foreground" />
            <Label>Model Configuration</Label>
          </div>

          <div className="grid gap-3">
            {Object.entries(selectedModel.defaultConfig).map(([key, defaultValue]) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs">{formatConfigKey(key)}</Label>
                <Input
                  type={typeof defaultValue === "number" ? "number" : "text"}
                  value={(config[key] ?? defaultValue) as string | number}
                  onChange={(e) => {
                    const value = typeof defaultValue === "number"
                      ? parseFloat(e.target.value) || 0
                      : e.target.value;
                    handleConfigChange(key, value);
                  }}
                  className="h-8 text-sm"
                />
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            These are the default values. Adjust based on your dataset and compute resources.
          </p>
        </div>
      )}

      {/* Current selection summary */}
      {modelConfig && (
        <div className="p-3 bg-muted/50 rounded-lg">
          <div className="text-xs text-muted-foreground">Selected Model</div>
          <div className="text-sm font-medium mt-1">
            {models.find((m) => m.id === modelConfig.architecture || m.name === modelConfig.architecture)?.displayName || modelConfig.architecture}
          </div>
        </div>
      )}
    </div>
  );
}

// Helper to format config keys nicely
function formatConfigKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
