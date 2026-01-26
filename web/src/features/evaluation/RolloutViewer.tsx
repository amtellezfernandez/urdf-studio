/**
 * RolloutViewer - Timeline-based replay of robot actions
 */

import { useCallback, useEffect, useRef, useMemo } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  Repeat,
  Repeat1,
  RotateCcw,
} from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { cn } from "@/shared/lib/utils";

import {
  useEvaluationStore,
  selectCurrentEpisode,
  selectCurrentStep,
  selectProgress,
  selectStepCount,
} from "./useEvaluationStore";
import { PLAYBACK_SPEEDS } from "./types";

// ============================================================================
// Types
// ============================================================================

interface RolloutViewerProps {
  className?: string;
  showActions?: boolean;
  showObservations?: boolean;
  showRewards?: boolean;
}

// ============================================================================
// Playback Controls
// ============================================================================

function PlaybackControls() {
  const {
    playback,
    play,
    pause,
    stop,
    stepForward,
    stepBackward,
    setPlaybackSpeed,
    setLoopMode,
  } = useEvaluationStore();

  const handlePlayPause = useCallback(() => {
    if (playback.isPlaying) {
      pause();
    } else {
      play();
    }
  }, [playback.isPlaying, play, pause]);

  return (
    <div className="flex items-center gap-2">
      {/* Reset */}
      <Button variant="ghost" size="sm" onClick={stop} title="Reset">
        <RotateCcw className="h-4 w-4" />
      </Button>

      {/* Step back */}
      <Button variant="ghost" size="sm" onClick={stepBackward} title="Step back">
        <StepBack className="h-4 w-4" />
      </Button>

      {/* Play/Pause */}
      <Button
        variant="default"
        size="sm"
        onClick={handlePlayPause}
        className="w-10"
      >
        {playback.isPlaying ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
      </Button>

      {/* Step forward */}
      <Button variant="ghost" size="sm" onClick={stepForward} title="Step forward">
        <StepForward className="h-4 w-4" />
      </Button>

      {/* Loop mode */}
      <Button
        variant={playback.loopMode !== "none" ? "secondary" : "ghost"}
        size="sm"
        onClick={() => {
          const modes: Array<"none" | "episode" | "all"> = ["none", "episode", "all"];
          const currentIndex = modes.indexOf(playback.loopMode);
          setLoopMode(modes[(currentIndex + 1) % modes.length]);
        }}
        title={`Loop: ${playback.loopMode}`}
      >
        {playback.loopMode === "episode" ? (
          <Repeat1 className="h-4 w-4" />
        ) : (
          <Repeat className="h-4 w-4" />
        )}
      </Button>

      {/* Speed selector */}
      <Select
        value={String(playback.playbackSpeed)}
        onValueChange={(value) => setPlaybackSpeed(parseFloat(value))}
      >
        <SelectTrigger className="w-[80px] h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PLAYBACK_SPEEDS.map((speed) => (
            <SelectItem key={speed} value={String(speed)}>
              {speed}x
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ============================================================================
// Timeline Scrubber
// ============================================================================

function TimelineScrubber() {
  const { selectedStepIndex, seekToStep } = useEvaluationStore();
  const episode = useEvaluationStore(selectCurrentEpisode);
  const progress = useEvaluationStore(selectProgress);
  const stepCount = useEvaluationStore(selectStepCount);

  const scrubberRef = useRef<HTMLDivElement>(null);

  const handleScrub = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!scrubberRef.current || stepCount === 0) return;

      const rect = scrubberRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, x / rect.width));
      const newStep = Math.floor(percentage * (stepCount - 1));
      seekToStep(newStep);
    },
    [stepCount, seekToStep]
  );

  // Create reward markers if available
  const rewardMarkers = useMemo(() => {
    if (!episode) return [];
    return episode.steps
      .map((step, index) => ({
        index,
        reward: step.reward,
        position: (index / (stepCount - 1)) * 100,
      }))
      .filter((m) => m.reward !== undefined && m.reward !== 0);
  }, [episode, stepCount]);

  if (!episode) return null;

  return (
    <div className="w-full">
      {/* Scrubber track */}
      <div
        ref={scrubberRef}
        className="relative h-6 bg-muted rounded cursor-pointer"
        onClick={handleScrub}
      >
        {/* Progress bar */}
        <div
          className="absolute top-0 left-0 h-full bg-primary/30 rounded-l"
          style={{ width: `${progress}%` }}
        />

        {/* Reward markers */}
        {rewardMarkers.map((marker) => (
          <div
            key={marker.index}
            className={cn(
              "absolute top-1 bottom-1 w-0.5 rounded",
              marker.reward! > 0 ? "bg-green-500" : "bg-red-500"
            )}
            style={{ left: `${marker.position}%` }}
            title={`Step ${marker.index}: ${marker.reward!.toFixed(2)}`}
          />
        ))}

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-1 bg-primary rounded shadow"
          style={{ left: `${progress}%`, transform: "translateX(-50%)" }}
        />
      </div>

      {/* Step info */}
      <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
        <span>Step {selectedStepIndex + 1}</span>
        <span>{stepCount} total</span>
      </div>
    </div>
  );
}

// ============================================================================
// Step Data Display
// ============================================================================

interface StepDataProps {
  showActions?: boolean;
  showObservations?: boolean;
  showRewards?: boolean;
}

function StepData({ showActions, showObservations, showRewards }: StepDataProps) {
  const step = useEvaluationStore(selectCurrentStep);

  if (!step) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">No step data</p>
      </div>
    );
  }

  const formatValue = (value: unknown): string => {
    if (Array.isArray(value)) {
      if (value.length > 6) {
        return `[${value.slice(0, 3).map((v) => (typeof v === "number" ? v.toFixed(3) : v)).join(", ")}, ..., ${value.slice(-3).map((v) => (typeof v === "number" ? v.toFixed(3) : v)).join(", ")}]`;
      }
      return `[${value.map((v) => (typeof v === "number" ? v.toFixed(3) : v)).join(", ")}]`;
    }
    if (typeof value === "number") {
      return value.toFixed(4);
    }
    return String(value);
  };

  return (
    <div className="space-y-4 p-4 overflow-auto">
      {/* Timestamp */}
      <div>
        <h4 className="text-xs font-medium text-muted-foreground mb-1">Timestamp</h4>
        <p className="text-sm font-mono">{step.timestamp.toFixed(3)}s</p>
      </div>

      {/* Reward */}
      {showRewards && step.reward !== undefined && (
        <div>
          <h4 className="text-xs font-medium text-muted-foreground mb-1">Reward</h4>
          <p
            className={cn(
              "text-sm font-mono",
              step.reward > 0 ? "text-green-600" : step.reward < 0 ? "text-red-600" : ""
            )}
          >
            {step.reward.toFixed(4)}
          </p>
        </div>
      )}

      {/* Action */}
      {showActions && (
        <div>
          <h4 className="text-xs font-medium text-muted-foreground mb-1">Action</h4>
          <div className="bg-muted/50 rounded p-2">
            <p className="text-xs font-mono break-all">{formatValue(step.action)}</p>
          </div>
        </div>
      )}

      {/* Observations */}
      {showObservations && Object.keys(step.observation).length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-muted-foreground mb-1">Observations</h4>
          <div className="space-y-2">
            {Object.entries(step.observation).map(([key, value]) => (
              <div key={key} className="bg-muted/50 rounded p-2">
                <p className="text-xs text-muted-foreground mb-1">{key}</p>
                <p className="text-xs font-mono break-all">{formatValue(value)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info */}
      {step.info && Object.keys(step.info).length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-muted-foreground mb-1">Info</h4>
          <div className="space-y-2">
            {Object.entries(step.info).map(([key, value]) => (
              <div key={key} className="bg-muted/50 rounded p-2">
                <p className="text-xs text-muted-foreground mb-1">{key}</p>
                <p className="text-xs font-mono break-all">{formatValue(value)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function RolloutViewer({
  className,
  showActions = true,
  showObservations = true,
  showRewards = true,
}: RolloutViewerProps) {
  const { result, playback } = useEvaluationStore();
  const episode = useEvaluationStore(selectCurrentEpisode);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      useEvaluationStore.getState().pause();
    };
  }, []);

  if (!result) {
    return (
      <div className={cn("flex items-center justify-center text-muted-foreground", className)}>
        <p className="text-sm">No evaluation data loaded</p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">Rollout Viewer</h3>
          {episode && (
            <span className="text-xs text-muted-foreground">
              Episode {useEvaluationStore.getState().selectedEpisodeIndex + 1}
              {episode.success !== undefined && (
                <span className={episode.success ? "text-green-600" : "text-red-600"}>
                  {" "}
                  - {episode.success ? "Success" : "Failed"}
                </span>
              )}
            </span>
          )}
        </div>

        {/* Timeline */}
        <TimelineScrubber />
      </div>

      {/* Playback controls */}
      <div className="flex-shrink-0 flex items-center justify-center px-4 py-3 border-b bg-muted/30">
        <PlaybackControls />
      </div>

      {/* Step data */}
      <div className="flex-1 overflow-hidden">
        <StepData
          showActions={showActions}
          showObservations={showObservations}
          showRewards={showRewards}
        />
      </div>
    </div>
  );
}
