/**
 * EvaluationPanel - Panel showing evaluation results
 */

import { useCallback, useState } from "react";
import {
  Play,
  Upload,
  BarChart2,
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  Loader2,
  FileJson,
  Info,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/shared/ui/tabs";
import { cn } from "@/shared/lib/utils";
import { API_BASE_URL } from "@/shared/config/api";

import { EpisodeSelector } from "./EpisodeSelector";
import { RolloutViewer } from "./RolloutViewer";
import { useEvaluationStore } from "./useEvaluationStore";
import type { EvaluateRequest, EvaluateResponse, EvaluationResult, AggregateMetrics } from "./types";

// ============================================================================
// Types
// ============================================================================

interface EvaluationPanelProps {
  className?: string;
  defaultCheckpointPath?: string;
}

// ============================================================================
// Metrics Display
// ============================================================================

interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: "up" | "down";
  highlight?: "success" | "error";
}

function MetricCard({ label, value, icon, trend, highlight }: MetricCardProps) {
  return (
    <div className="bg-muted/30 rounded-lg p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div
        className={cn(
          "text-lg font-semibold",
          highlight === "success" && "text-green-600",
          highlight === "error" && "text-red-600"
        )}
      >
        {typeof value === "number" ? value.toFixed(2) : value}
        {trend && (
          <TrendingUp
            className={cn(
              "inline-block h-4 w-4 ml-1",
              trend === "up" ? "text-green-500" : "text-red-500 rotate-180"
            )}
          />
        )}
      </div>
    </div>
  );
}

function MetricsOverview({ metrics }: { metrics: AggregateMetrics }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
      <MetricCard
        label="Success Rate"
        value={`${(metrics.successRate * 100).toFixed(1)}%`}
        icon={
          metrics.successRate >= 0.5 ? (
            <CheckCircle className="h-4 w-4 text-green-500" />
          ) : (
            <XCircle className="h-4 w-4 text-red-500" />
          )
        }
        highlight={metrics.successRate >= 0.5 ? "success" : "error"}
      />
      <MetricCard
        label="Mean Reward"
        value={metrics.meanReward}
        icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
      />
      <MetricCard
        label="Avg. Episode Length"
        value={Math.round(metrics.meanEpisodeLength)}
        icon={<Clock className="h-4 w-4 text-muted-foreground" />}
      />
      <MetricCard
        label="Total Episodes"
        value={metrics.totalEpisodes}
        icon={<BarChart2 className="h-4 w-4 text-muted-foreground" />}
      />

      {/* Additional metrics */}
      {metrics.custom &&
        Object.entries(metrics.custom).map(([key, value]) => (
          <MetricCard
            key={key}
            label={key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            value={value}
          />
        ))}
    </div>
  );
}

// ============================================================================
// Evaluation Form
// ============================================================================

interface EvaluationFormProps {
  onEvaluate: (request: EvaluateRequest) => void;
  isLoading: boolean;
  defaultCheckpointPath?: string;
}

function EvaluationForm({ onEvaluate, isLoading, defaultCheckpointPath }: EvaluationFormProps) {
  const [checkpointPath, setCheckpointPath] = useState(defaultCheckpointPath || "");
  const [numEpisodes, setNumEpisodes] = useState(10);
  const [maxSteps, setMaxSteps] = useState(1000);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!checkpointPath.trim()) {
        toast.error("Please enter a checkpoint path");
        return;
      }
      onEvaluate({
        checkpointPath: checkpointPath.trim(),
        numEpisodes,
        maxStepsPerEpisode: maxSteps,
      });
    },
    [checkpointPath, numEpisodes, maxSteps, onEvaluate]
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4">
      <div className="space-y-2">
        <Label htmlFor="checkpoint">Checkpoint Path</Label>
        <Input
          id="checkpoint"
          placeholder="/path/to/checkpoint.pt or wandb://..."
          value={checkpointPath}
          onChange={(e) => setCheckpointPath(e.target.value)}
          disabled={isLoading}
        />
        <p className="text-xs text-muted-foreground">
          Local path or remote URL to the trained policy checkpoint
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="episodes">Number of Episodes</Label>
          <Input
            id="episodes"
            type="number"
            min={1}
            max={100}
            value={numEpisodes}
            onChange={(e) => setNumEpisodes(parseInt(e.target.value) || 10)}
            disabled={isLoading}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="maxSteps">Max Steps per Episode</Label>
          <Input
            id="maxSteps"
            type="number"
            min={100}
            max={10000}
            value={maxSteps}
            onChange={(e) => setMaxSteps(parseInt(e.target.value) || 1000)}
            disabled={isLoading}
          />
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={isLoading || !checkpointPath.trim()}>
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Evaluating...
          </>
        ) : (
          <>
            <Play className="h-4 w-4 mr-2" />
            Run Evaluation
          </>
        )}
      </Button>
    </form>
  );
}

// ============================================================================
// Load Results
// ============================================================================

function LoadResults({ onLoad }: { onLoad: (result: EvaluationResult) => void }) {
  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target?.result as string);
          onLoad(data);
          toast.success("Evaluation results loaded");
        } catch {
          toast.error("Failed to parse evaluation results");
        }
      };
      reader.readAsText(file);
    },
    [onLoad]
  );

  return (
    <div className="p-4">
      <Label
        htmlFor="load-results"
        className="flex flex-col items-center justify-center h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
      >
        <Upload className="h-8 w-8 text-muted-foreground mb-2" />
        <span className="text-sm text-muted-foreground">
          Click to upload evaluation results (JSON)
        </span>
        <input
          id="load-results"
          type="file"
          accept=".json"
          onChange={handleFileUpload}
          className="hidden"
        />
      </Label>
    </div>
  );
}

// ============================================================================
// Empty State
// ============================================================================

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <BarChart2 className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-medium mb-2">No evaluation results</h3>
      <p className="text-sm text-muted-foreground max-w-sm">
        Run an evaluation on a trained policy checkpoint or load existing results to view rollouts
        and metrics.
      </p>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function EvaluationPanel({ className, defaultCheckpointPath }: EvaluationPanelProps) {
  const [activeTab, setActiveTab] = useState<"evaluate" | "load">("evaluate");

  const { result, isLoading, error, setResult, setIsLoading, setError, reset } =
    useEvaluationStore();

  // Evaluate mutation
  const evaluateMutation = useMutation({
    mutationFn: async (request: EvaluateRequest): Promise<EvaluateResponse> => {
      const response = await fetch(`${API_BASE_URL}/training/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkpoint_path: request.checkpointPath,
          num_episodes: request.numEpisodes,
          max_steps: request.maxStepsPerEpisode,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Evaluation failed");
      }

      return response.json();
    },
    onMutate: () => {
      setIsLoading(true);
      setError(null);
    },
    onSuccess: (data) => {
      // Convert API response to EvaluationResult
      const result: EvaluationResult = {
        evaluationId: data.evaluationId,
        checkpointPath: "",
        evaluatedAt: new Date().toISOString(),
        episodes: data.episodes.map((ep) => ({
          index: ep.index,
          steps: (ep.actions || []).map((action, i) => ({
            timestamp: ep.timestamps?.[i] || i * 0.1,
            observation: ep.observations?.[i] || {},
            action,
            reward: ep.rewards?.[i],
          })),
          success: ep.success,
          totalReward: ep.rewards?.reduce((a, b) => a + b, 0),
          duration: ((ep.timestamps?.[ep.timestamps.length - 1] || 0) - (ep.timestamps?.[0] || 0)) * 1000,
        })),
        aggregateMetrics: {
          meanReward: data.metrics.mean_reward || 0,
          stdReward: data.metrics.std_reward || 0,
          minReward: data.metrics.min_reward || 0,
          maxReward: data.metrics.max_reward || 0,
          successRate: data.metrics.success_rate || 0,
          meanEpisodeLength: data.metrics.mean_episode_length || 0,
          totalEpisodes: data.episodes.length,
        },
      };

      setResult(result);
      toast.success("Evaluation completed");
    },
    onError: (err: Error) => {
      setError(err.message);
      toast.error(`Evaluation failed: ${err.message}`);
    },
    onSettled: () => {
      setIsLoading(false);
    },
  });

  const handleEvaluate = useCallback(
    (request: EvaluateRequest) => {
      evaluateMutation.mutate(request);
    },
    [evaluateMutation]
  );

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <h2 className="text-lg font-semibold">Policy Evaluation</h2>
          <p className="text-xs text-muted-foreground">
            Evaluate trained policies and visualize rollouts
          </p>
        </div>
        {result && (
          <Button variant="outline" size="sm" onClick={reset}>
            New Evaluation
          </Button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Content */}
      {!result ? (
        <>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <TabsList className="mx-4 mt-4">
              <TabsTrigger value="evaluate">
                <Play className="h-4 w-4 mr-2" />
                Run Evaluation
              </TabsTrigger>
              <TabsTrigger value="load">
                <FileJson className="h-4 w-4 mr-2" />
                Load Results
              </TabsTrigger>
            </TabsList>

            <TabsContent value="evaluate">
              <EvaluationForm
                onEvaluate={handleEvaluate}
                isLoading={isLoading}
                defaultCheckpointPath={defaultCheckpointPath}
              />
            </TabsContent>

            <TabsContent value="load">
              <LoadResults onLoad={setResult} />
            </TabsContent>
          </Tabs>

          <div className="flex-1">
            <EmptyState />
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Metrics */}
          <div className="flex-shrink-0 border-b">
            <MetricsOverview metrics={result.aggregateMetrics} />
          </div>

          {/* Episodes and Rollout */}
          <div className="flex-1 flex overflow-hidden">
            {/* Episode selector */}
            <div className="w-64 border-r overflow-hidden">
              <EpisodeSelector />
            </div>

            {/* Rollout viewer */}
            <div className="flex-1 overflow-hidden">
              <RolloutViewer />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
