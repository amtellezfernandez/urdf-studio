/**
 * EpisodeSelector - Select which episode to view
 */

import { useMemo } from "react";
import {
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { cn } from "@/shared/lib/utils";

import { useEvaluationStore, selectCurrentEpisode, selectEpisodeCount } from "./useEvaluationStore";
import type { EvaluationEpisode } from "./types";

// ============================================================================
// Types
// ============================================================================

interface EpisodeSelectorProps {
  className?: string;
  compact?: boolean;
  orientation?: "horizontal" | "vertical";
}

// ============================================================================
// Episode Card
// ============================================================================

interface EpisodeCardProps {
  episode: EvaluationEpisode;
  index: number;
  isSelected: boolean;
  onClick: () => void;
  compact?: boolean;
}

function EpisodeCard({ episode, index, isSelected, onClick, compact }: EpisodeCardProps) {
  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };

  if (compact) {
    return (
      <button
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors",
          "hover:bg-muted/50",
          isSelected && "bg-primary/10 border-primary"
        )}
        onClick={onClick}
      >
        <span className="text-sm font-medium">#{index + 1}</span>
        {episode.success !== undefined && (
          episode.success ? (
            <CheckCircle className="h-4 w-4 text-green-500" />
          ) : (
            <XCircle className="h-4 w-4 text-red-500" />
          )
        )}
        {episode.totalReward !== undefined && (
          <span className="text-xs text-muted-foreground">
            R: {episode.totalReward.toFixed(1)}
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      className={cn(
        "w-full p-3 rounded-lg border text-left transition-colors",
        "hover:bg-muted/50",
        isSelected && "bg-primary/10 border-primary"
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">Episode {index + 1}</span>
        {episode.success !== undefined && (
          <Badge
            className={cn(
              "gap-1",
              episode.success
                ? "bg-green-500/20 text-green-600"
                : "bg-red-500/20 text-red-600"
            )}
          >
            {episode.success ? (
              <CheckCircle className="h-3 w-3" />
            ) : (
              <XCircle className="h-3 w-3" />
            )}
            {episode.success ? "Success" : "Failed"}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatDuration(episode.duration)}
        </div>
        <div className="flex items-center gap-1">
          <span>{episode.steps.length} steps</span>
        </div>
        {episode.totalReward !== undefined && (
          <div className="flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            {episode.totalReward.toFixed(2)}
          </div>
        )}
      </div>
    </button>
  );
}

// ============================================================================
// Episode Navigation
// ============================================================================

function EpisodeNavigation() {
  const { selectedEpisodeIndex, selectEpisode, result } = useEvaluationStore();
  const episodeCount = useEvaluationStore(selectEpisodeCount);

  if (!result || episodeCount <= 1) return null;

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => selectEpisode(selectedEpisodeIndex - 1)}
        disabled={selectedEpisodeIndex === 0}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-sm font-medium min-w-[100px] text-center">
        Episode {selectedEpisodeIndex + 1} of {episodeCount}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => selectEpisode(selectedEpisodeIndex + 1)}
        disabled={selectedEpisodeIndex >= episodeCount - 1}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ============================================================================
// Horizontal Episode List
// ============================================================================

function HorizontalEpisodeList({ compact }: { compact?: boolean }) {
  const { result, selectedEpisodeIndex, selectEpisode } = useEvaluationStore();

  if (!result) return null;

  return (
    <div className="w-full overflow-x-auto">
      <div className="flex gap-2 pb-2 px-2">
        {result.episodes.map((episode, index) => (
          <EpisodeCard
            key={index}
            episode={episode}
            index={index}
            isSelected={selectedEpisodeIndex === index}
            onClick={() => selectEpisode(index)}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Vertical Episode List
// ============================================================================

function VerticalEpisodeList({ compact }: { compact?: boolean }) {
  const { result, selectedEpisodeIndex, selectEpisode } = useEvaluationStore();

  if (!result) return null;

  return (
    <ScrollArea className="h-full">
      <div className="space-y-2 p-2">
        {result.episodes.map((episode, index) => (
          <EpisodeCard
            key={index}
            episode={episode}
            index={index}
            isSelected={selectedEpisodeIndex === index}
            onClick={() => selectEpisode(index)}
            compact={compact}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function EpisodeSelector({
  className,
  compact = false,
  orientation = "vertical",
}: EpisodeSelectorProps) {
  const { result } = useEvaluationStore();
  const episodeCount = useEvaluationStore(selectEpisodeCount);

  if (!result || episodeCount === 0) {
    return (
      <div className={cn("flex items-center justify-center p-4 text-muted-foreground", className)}>
        <p className="text-sm">No episodes to display</p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <h3 className="text-sm font-medium">Episodes</h3>
        <Badge variant="secondary">{episodeCount}</Badge>
      </div>

      {/* Episode list */}
      {orientation === "horizontal" ? (
        <HorizontalEpisodeList compact={compact} />
      ) : (
        <VerticalEpisodeList compact={compact} />
      )}

      {/* Navigation (compact mode) */}
      {compact && episodeCount > 5 && (
        <div className="flex justify-center py-2 border-t">
          <EpisodeNavigation />
        </div>
      )}
    </div>
  );
}

// Export navigation for use elsewhere
export { EpisodeNavigation };
