/**
 * Policy evaluation component.
 * Loads a trained checkpoint and runs inference to generate action sequences
 * that can be visualized in the 3D viewer.
 */

import { useState, useCallback } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Upload,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Download,
} from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { CustomSlider } from "@/shared/ui/custom-slider";
import { API_BASE_URL } from "@/shared/config/api";
import type { EvaluateResponse, EpisodeResult } from "./types";

interface PolicyEvaluatorProps {
  /** Current joint state from viewer */
  currentJointState?: Record<string, number>;
  /** Callback when actions should be applied to viewer */
  onApplyActions?: (actions: number[][]) => void;
  /** Callback for single step action */
  onApplyAction?: (action: number[]) => void;
  /** URDF content for context */
  urdf?: string;
}

export function PolicyEvaluator({
  currentJointState,
  onApplyActions,
  onApplyAction,
  urdf,
}: PolicyEvaluatorProps) {
  // Evaluation config
  const [checkpointPath, setCheckpointPath] = useState("");
  const [numEpisodes, setNumEpisodes] = useState(1);
  const [maxSteps, setMaxSteps] = useState(200);

  // Evaluation state
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EvaluateResponse | null>(null);

  // Playback state
  const [selectedEpisode, setSelectedEpisode] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Get current episode
  const episode = result?.episodes?.[selectedEpisode];
  const totalSteps = episode?.actions?.length || 0;

  // Run evaluation
  const handleEvaluate = useCallback(async () => {
    if (!checkpointPath) {
      setError("Please enter a checkpoint path");
      return;
    }

    setIsEvaluating(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(`${API_BASE_URL}/training/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkpoint_path: checkpointPath,
          num_episodes: numEpisodes,
          max_steps: maxSteps,
          initial_state: currentJointState,
          urdf: urdf,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Evaluation failed");
      }

      const data: EvaluateResponse = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Evaluation failed");
      }

      setResult(data);
      setSelectedEpisode(0);
      setCurrentStep(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsEvaluating(false);
    }
  }, [checkpointPath, numEpisodes, maxSteps, currentJointState, urdf]);

  // Playback controls
  const handleStepChange = useCallback(
    (step: number) => {
      setCurrentStep(step);
      if (episode?.actions?.[step] && onApplyAction) {
        onApplyAction(episode.actions[step]);
      }
    },
    [episode, onApplyAction]
  );

  const handlePlay = useCallback(() => {
    if (!episode?.actions) return;

    setIsPlaying(true);

    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        const next = prev + 1;
        if (next >= episode.actions.length) {
          setIsPlaying(false);
          clearInterval(interval);
          return prev;
        }

        if (onApplyAction) {
          onApplyAction(episode.actions[next]);
        }
        return next;
      });
    }, 20 / playbackSpeed); // 50Hz base rate

    return () => clearInterval(interval);
  }, [episode, playbackSpeed, onApplyAction]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleReset = useCallback(() => {
    setCurrentStep(0);
    if (episode?.actions?.[0] && onApplyAction) {
      onApplyAction(episode.actions[0]);
    }
  }, [episode, onApplyAction]);

  const handleSkipToEnd = useCallback(() => {
    if (!episode?.actions) return;
    const lastStep = episode.actions.length - 1;
    setCurrentStep(lastStep);
    if (onApplyAction) {
      onApplyAction(episode.actions[lastStep]);
    }
  }, [episode, onApplyAction]);

  // Export actions
  const handleExport = useCallback(() => {
    if (!result?.episodes) return;

    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evaluation_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  return (
    <div className="space-y-4">
      {/* Checkpoint input */}
      <div className="space-y-2">
        <Label className="text-xs">Checkpoint Path</Label>
        <div className="flex gap-2">
          <Input
            placeholder="/path/to/checkpoint.pt or .safetensors"
            value={checkpointPath}
            onChange={(e) => setCheckpointPath(e.target.value)}
            className="flex-1 h-8 text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // Would open file picker in electron
              // For now, demo mode
              setCheckpointPath("demo");
            }}
          >
            <Upload className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Enter "demo" to generate a test trajectory
        </p>
      </div>

      {/* Evaluation params */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Episodes</Label>
          <Input
            type="number"
            min={1}
            max={10}
            value={numEpisodes}
            onChange={(e) => setNumEpisodes(parseInt(e.target.value) || 1)}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Max Steps</Label>
          <Input
            type="number"
            min={10}
            max={5000}
            value={maxSteps}
            onChange={(e) => setMaxSteps(parseInt(e.target.value) || 200)}
            className="h-8 text-sm"
          />
        </div>
      </div>

      {/* Run button */}
      <Button
        onClick={handleEvaluate}
        disabled={isEvaluating || !checkpointPath}
        className="w-full"
      >
        {isEvaluating ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Evaluating...
          </>
        ) : (
          <>
            <Play className="w-4 h-4 mr-2" />
            Run Evaluation
          </>
        )}
      </Button>

      {/* Error */}
      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-destructive mt-0.5" />
            <div className="text-sm text-destructive">{error}</div>
          </div>
        </div>
      )}

      {/* Results */}
      {result && result.success && (
        <div className="space-y-4 p-4 bg-muted/30 rounded-lg">
          {/* Success header */}
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span className="text-sm font-medium">Evaluation Complete</span>
          </div>

          {/* Metrics */}
          {result.metrics && Object.keys(result.metrics).length > 0 && (
            <div className="grid grid-cols-3 gap-2 text-xs">
              {Object.entries(result.metrics).map(([key, value]) => (
                <div key={key} className="bg-muted/50 p-2 rounded">
                  <div className="text-muted-foreground">{key}</div>
                  <div className="font-mono">
                    {typeof value === "number" ? value.toFixed(2) : String(value)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Episode selector */}
          {result.episodes && result.episodes.length > 1 && (
            <div className="space-y-1">
              <Label className="text-xs">Episode</Label>
              <select
                value={selectedEpisode}
                onChange={(e) => {
                  setSelectedEpisode(parseInt(e.target.value));
                  setCurrentStep(0);
                }}
                className="w-full h-8 text-sm bg-background border rounded px-2"
              >
                {result.episodes.map((_, idx) => (
                  <option key={idx} value={idx}>
                    Episode {idx + 1} ({result.episodes![idx].actions.length} steps)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Playback controls */}
          {episode && (
            <div className="space-y-3">
              {/* Timeline */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Step {currentStep + 1}</span>
                  <span>/ {totalSteps}</span>
                </div>
                <CustomSlider
                  value={[currentStep]}
                  min={0}
                  max={totalSteps - 1}
                  step={1}
                  onValueChange={([v]) => handleStepChange(v)}
                  className="w-full"
                />
              </div>

              {/* Transport controls */}
              <div className="flex items-center justify-center gap-2">
                <Button variant="outline" size="sm" onClick={handleReset}>
                  <SkipBack className="w-4 h-4" />
                </Button>

                {isPlaying ? (
                  <Button variant="outline" size="sm" onClick={handlePause}>
                    <Pause className="w-4 h-4" />
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={handlePlay}>
                    <Play className="w-4 h-4" />
                  </Button>
                )}

                <Button variant="outline" size="sm" onClick={handleSkipToEnd}>
                  <SkipForward className="w-4 h-4" />
                </Button>
              </div>

              {/* Playback speed */}
              <div className="flex items-center gap-2">
                <Label className="text-xs">Speed</Label>
                <CustomSlider
                  value={[playbackSpeed]}
                  min={0.25}
                  max={4}
                  step={0.25}
                  onValueChange={([v]) => setPlaybackSpeed(v)}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground w-8">
                  {playbackSpeed}x
                </span>
              </div>

              {/* Current action display */}
              {episode.actions[currentStep] && (
                <div className="space-y-1">
                  <Label className="text-xs">Current Action</Label>
                  <div className="font-mono text-xs bg-muted/50 p-2 rounded overflow-x-auto">
                    [{episode.actions[currentStep].map((v) => v.toFixed(3)).join(", ")}]
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Export */}
          <Button variant="outline" size="sm" onClick={handleExport} className="w-full">
            <Download className="w-4 h-4 mr-2" />
            Export Results
          </Button>
        </div>
      )}
    </div>
  );
}
