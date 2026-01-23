/**
 * Model selection component for the training wizard.
 */

import { useEffect, useState } from "react";
import { Info } from "lucide-react";

import { Label } from "@/shared/ui/label";
import { Input } from "@/shared/ui/input";
import { useTrainingStore } from "./useTrainingStore";
import { API_BASE_URL } from "@/shared/config/api";
import type { ModelArchitecture, ModelArchitectureInfo, ModelsListResponse } from "./types";

// Fallback model info if API unavailable
const FALLBACK_MODELS: ModelArchitectureInfo[] = [
  {
    name: "act",
    displayName: "ACT (Action Chunking Transformer)",
    description: "Transformer-based policy that predicts action chunks. Good for manipulation tasks.",
    defaultConfig: {
      chunk_size: 100,
      hidden_dim: 512,
      n_encoder_layers: 4,
      n_decoder_layers: 7,
    },
    configSchema: {},
    recommendedFor: ["manipulation", "bimanual", "precise tasks"],
  },
  {
    name: "diffusion_policy",
    displayName: "Diffusion Policy",
    description: "Denoising diffusion for action prediction. Robust to multimodal demonstrations.",
    defaultConfig: {
      horizon: 16,
      n_obs_steps: 2,
      n_action_steps: 8,
      num_inference_steps: 10,
    },
    configSchema: {},
    recommendedFor: ["diverse demonstrations", "multimodal behavior"],
  },
  {
    name: "tdmpc",
    displayName: "TD-MPC",
    description: "Temporal Difference Model Predictive Control. Good for complex dynamics.",
    defaultConfig: {
      horizon: 5,
      latent_dim: 512,
    },
    configSchema: {},
    recommendedFor: ["long-horizon tasks", "model-based control"],
  },
  {
    name: "vq_bet",
    displayName: "VQ-BeT",
    description: "Vector-Quantized Behavior Transformer. Discrete action space learning.",
    defaultConfig: {
      n_clusters: 512,
      hidden_dim: 384,
    },
    configSchema: {},
    recommendedFor: ["discrete actions", "behavior cloning"],
  },
];

export function ModelSelector() {
  const { modelConfig, setModelConfig } = useTrainingStore();

  const [models, setModels] = useState<ModelArchitectureInfo[]>(FALLBACK_MODELS);
  const [loading, setLoading] = useState(true);
  const [selectedArch, setSelectedArch] = useState<ModelArchitecture | null>(
    modelConfig?.architecture || null
  );
  const [config, setConfig] = useState<Record<string, unknown>>(
    modelConfig?.config || {}
  );

  // Fetch models from API
  useEffect(() => {
    async function fetchModels() {
      try {
        const response = await fetch(`${API_BASE_URL}/training/models`);
        if (response.ok) {
          const data: ModelsListResponse = await response.json();
          if (data.models.length > 0) {
            setModels(data.models);
          }
        }
      } catch (e) {
        console.warn("Failed to fetch models, using fallback", e);
      } finally {
        setLoading(false);
      }
    }
    fetchModels();
  }, []);

  const handleSelectModel = (arch: ModelArchitecture) => {
    setSelectedArch(arch);

    // Get default config for this model
    const modelInfo = models.find((m) => m.name === arch);
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

  const selectedModel = models.find((m) => m.name === selectedArch);

  return (
    <div className="space-y-4">
      {/* Model selection */}
      <div className="space-y-2">
        <Label>Policy Architecture</Label>
        <div className="grid gap-2">
          {models.map((model) => (
            <button
              key={model.name}
              onClick={() => handleSelectModel(model.name as ModelArchitecture)}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${
                selectedArch === model.name
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-muted/50"
              }`}
            >
              <div className="font-medium text-sm">{model.displayName}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {model.description}
              </div>
              {model.recommendedFor.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {model.recommendedFor.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] px-1.5 py-0.5 bg-muted rounded"
                    >
                      {tag}
                    </span>
                  ))}
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
            {models.find((m) => m.name === modelConfig.architecture)?.displayName || modelConfig.architecture}
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
