import type React from "react";
import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { BlenderPanel } from "@/shared/ui/blender-panel";
import { NumberInput } from "@/shared/ui/number-input";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/utils";
import type { Episode } from "@/features/dataset";
import {
  ArrowDown,
  ArrowUp,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Trash2,
  Circle,
} from "lucide-react";

type EpisodesPanelProps = {
  episodes: Episode[];
  episodesViewHeight?: number;
  isRecording: boolean;
  recordingStats: { frames: number; seconds: number };
  recordingFps: number;
  setRecordingFps: (fps: number) => void;
  fpsTarget: number;
  setFpsTarget: (fps: number) => void;
  applyFpsTarget: () => void;
  getEpisodeFps: (episode: Episode) => number;
  fpsTolerance?: number;
  getEpisodeVelocityStatus: (episode: Episode) => { overCount: number; maxRatio: number };
  velocityTolerance?: number;
  startRecording: () => void;
  stopRecording: () => void;
  handleFileUpload: (files: FileList | null) => void | Promise<void>;
  playAllEpisodes: (overrideFrame?: number) => void;
  stopAllPlayback: () => void;
  setEpisodeAndFrame: (episodeIndex: number, frameIndex: number) => void;
  setCurrentPlayingEpisodeIndex: (index: number | null) => void;
  playEpisode: (episode: Episode) => void;
  moveEpisode: (episodeId: string, direction: "up" | "down") => void;
  retakeEpisode: (episodeId: string) => void;
  exportEpisodeToDataFile: (episode: Episode) => void;
  deleteEpisode: (episodeId: string) => void;
  onFrameChange?: (frame: number) => void;
  isPlayingAll: boolean;
  currentFrame?: number;
  currentPlayingEpisodeIndex: number | null;
  playbackSpeed: number;
  setPlaybackSpeed: (speed: number) => void;
  onToggleCollapse?: () => void;
  isCollapsed?: boolean;
};

export const EpisodesPanel = ({
  episodes,
  episodesViewHeight = 0.4,
  isRecording,
  recordingStats,
  recordingFps,
  setRecordingFps,
  fpsTarget,
  setFpsTarget,
  applyFpsTarget,
  getEpisodeFps,
  fpsTolerance = 0.5,
  getEpisodeVelocityStatus,
  velocityTolerance = 0.05,
  startRecording,
  stopRecording,
  handleFileUpload,
  playAllEpisodes,
  stopAllPlayback,
  setEpisodeAndFrame,
  setCurrentPlayingEpisodeIndex,
  playEpisode,
  moveEpisode,
  retakeEpisode,
  exportEpisodeToDataFile,
  deleteEpisode,
  onFrameChange,
  isPlayingAll,
  currentFrame,
  currentPlayingEpisodeIndex,
  playbackSpeed,
  setPlaybackSpeed,
  onToggleCollapse,
  isCollapsed,
}: EpisodesPanelProps) => {
  const fpsMismatchCount = episodes.reduce((count, episode) => {
    const fps = getEpisodeFps(episode);
    if (fps <= 0 || fpsTarget <= 0) return count;
    return Math.abs(fps - fpsTarget) > fpsTolerance ? count + 1 : count;
  }, 0);
  const velocityMismatchCount = episodes.reduce((count, episode) => {
    const status = getEpisodeVelocityStatus(episode);
    return status.overCount > 0 ? count + 1 : count;
  }, 0);

  return (
    <div
      className="overflow-hidden flex flex-col p-1.5 border-b border-border/20"
      style={{
        flex: `0 0 ${((1 - episodesViewHeight) * 100)}%`,
        minHeight: "50px",
      }}
    >
      <div className="flex-1 overflow-y-auto blender-scrollbar">
      {/* Blender-style Menu Bar */}
      <div className="flex items-center gap-1.5 border-b border-border/50 pb-1 mb-1.5">
        {/* Record Button - Always Visible */}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs flex-shrink-0 border-red-500/50 text-red-500 hover:bg-red-500/10 hover:border-red-500"
              onClick={isRecording ? stopRecording : startRecording}
            >
              <div className="flex items-center gap-1.5">
                <Circle
                  className={`w-3 h-3 fill-current ${isRecording ? "animate-pulse" : ""}`}
                />
                <span>{isRecording ? "Stop" : "Record"}</span>
              </div>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <p className="font-medium">
              {isRecording ? "Stop Recording" : "Start Recording"}
            </p>
            <p className="text-muted-foreground">
              {isRecording
                ? "Stop recording the current episode"
                : "Record a new episode by moving the robot"}
            </p>
          </TooltipContent>
        </Tooltip>

        {/* Recording Stats - Always Reserved Space */}
        <div className="flex items-center gap-1.5 text-[10px] font-mono min-w-[60px]">
          {isRecording ? (
            <>
              <span className="text-muted-foreground">{recordingStats.frames}</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-muted-foreground">
                {recordingStats.seconds.toFixed(1)}s
              </span>
            </>
          ) : (
            <>
              <span className="text-muted-foreground/40">0</span>
              <span className="text-muted-foreground/40">/</span>
              <span className="text-muted-foreground/40">0.0s</span>
            </>
          )}
        </div>

        {/* FPS Input */}
        <div className="flex items-center gap-1">
          <label className="text-[10px] text-muted-foreground whitespace-nowrap">FPS:</label>
          <NumberInput
            value={recordingFps}
            onValueChange={setRecordingFps}
            min={1}
            max={120}
            step={1}
            compact={true}
            disabled={isRecording}
            className="w-14"
          />
        </div>

        {/* Hidden file input for dataset loading - triggered from top menu */}
        <input
          type="file"
          id="motion-upload-episodes"
          accept=".json,.csv,.pos"
          multiple
          {...({
            webkitdirectory: "",
            directory: "",
            mozdirectory: "",
          } as React.InputHTMLAttributes<HTMLInputElement>)}
          onChange={(e) => {
            void handleFileUpload(e.target.files);
            e.target.value = "";
          }}
          className="hidden"
        />
      </div>

      <div className="flex items-center gap-2 px-1.5 py-1 border-b border-border/50 mb-1.5">
        <span className="text-[10px] text-muted-foreground">Target FPS</span>
        <NumberInput
          value={fpsTarget}
          onValueChange={setFpsTarget}
          min={1}
          max={240}
          step={1}
          compact={true}
          className="w-14"
        />
        <Button
          size="sm"
          variant="secondary"
          className="h-6 px-2 text-xs"
          onClick={applyFpsTarget}
          disabled={episodes.length === 0}
        >
          Apply All
        </Button>
        {fpsMismatchCount > 0 && (
          <Badge
            variant="outline"
            className="text-[9px] px-1.5 py-0 h-4 border-amber-500/40 text-amber-400 bg-amber-500/10"
          >
            {fpsMismatchCount} fps
          </Badge>
        )}
        {velocityMismatchCount > 0 && (
          <Badge
            variant="outline"
            className="text-[9px] px-1.5 py-0 h-4 border-amber-500/40 text-amber-400 bg-amber-500/10"
          >
            {velocityMismatchCount} vel
          </Badge>
        )}
      </div>

      {/* Blender-style Timeline Controls */}
      <BlenderPanel title="Timeline" defaultOpen={true}>
        {/* Playback and Speed on same row */}
        <div className="flex items-center gap-1.5 mb-1">
          {/* Previous Episode */}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => {
              if (episodes.length === 0) return;
              const currentIndex = currentPlayingEpisodeIndex ?? 0;
              const prevIndex =
                currentIndex > 0 ? currentIndex - 1 : episodes.length - 1;
              setEpisodeAndFrame(prevIndex, 0);
              setCurrentPlayingEpisodeIndex(prevIndex);
            }}
            disabled={episodes.length === 0}
            title="Previous Episode"
          >
            <SkipBack className="w-3 h-3" />
          </Button>

          {/* Play/Pause */}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => playAllEpisodes()}
            disabled={episodes.length === 0}
            title={isPlayingAll ? "Pause" : "Play"}
          >
            {isPlayingAll ? (
              <Pause className="w-3 h-3" />
            ) : (
              <Play className="w-3 h-3 fill-current" />
            )}
          </Button>

          {/* Next Episode */}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => {
              if (episodes.length === 0) return;
              stopAllPlayback();
              const currentIndex = currentPlayingEpisodeIndex ?? 0;
              const nextIndex = (currentIndex + 1) % episodes.length;

              setEpisodeAndFrame(nextIndex, 0);
              setCurrentPlayingEpisodeIndex(nextIndex);
              onFrameChange?.(0);
            }}
            disabled={episodes.length === 0}
            title="Next Episode"
          >
            <SkipForward className="w-3 h-3" />
          </Button>

          {/* Speed Control - Blender style (Number Input) */}
          <div className="flex items-center gap-1.5 flex-1">
            <label className="text-[10px] text-muted-foreground whitespace-nowrap">
              Speed:
            </label>
            <NumberInput
              value={playbackSpeed}
              onValueChange={(value) => {
                const newSpeed = value ?? 1.0;
                setPlaybackSpeed(newSpeed);
              }}
              min={0.25}
              max={6}
              step={0.25}
              compact={true}
              className="w-16"
            />
            <span className="text-[10px] font-mono text-foreground tabular-nums">
              x{playbackSpeed % 1 === 0 ? playbackSpeed.toFixed(0) : playbackSpeed.toFixed(2)}
            </span>
          </div>
        </div>
      </BlenderPanel>

      {/* Episodes List */}
      <BlenderPanel title={`Episodes (${episodes.length})`} defaultOpen={true}>
        <div className="flex-1 overflow-y-auto max-h-[400px] blender-scrollbar -mx-1.5">
          {episodes.length === 0 ? (
            <div className="py-2 text-center">
              <p className="text-xs text-muted-foreground">No episodes</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Load JSON data or record new
              </p>
            </div>
          ) : (
            <div className="space-y-0">
              {episodes.map((episode, index) => {
                const duration =
                  episode.frames.length > 0
                    ? episode.frames[episode.frames.length - 1].timestamp
                    : 0;
                const durationSeconds = (duration / 1000).toFixed(1);
                const episodeFps = getEpisodeFps(episode);
                const isFpsMismatch =
                  fpsTarget > 0 &&
                  episodeFps > 0 &&
                  Math.abs(episodeFps - fpsTarget) > fpsTolerance;
                const velocityStatus = getEpisodeVelocityStatus(episode);
                const isVelocityMismatch = velocityStatus.overCount > 0;
                const isPlaying =
                  currentPlayingEpisodeIndex === index && isPlayingAll;
                const episodeCurrentFrame =
                  currentPlayingEpisodeIndex === index && currentFrame !== undefined
                    ? currentFrame
                    : 0;
                const totalFrames = episode.frames.length;
                const lastFrameIndex = Math.max(0, totalFrames - 1);
                const displayFrame = Math.max(
                  0,
                  Math.min(episodeCurrentFrame, lastFrameIndex)
                );
                const sourceTypeRaw = episode.metadata?.additional?.sourceType;
                const sourceType =
                  typeof sourceTypeRaw === "string" ? sourceTypeRaw : undefined;
                const sourceNameRaw = episode.metadata?.additional?.sourceName;
                const sourceName =
                  typeof sourceNameRaw === "string" ? sourceNameRaw : undefined;

                return (
                  <div
                    key={episode.id}
                    className={cn(
                      "group relative border rounded px-0.25 py-0.5 transition-all",
                      isPlaying
                        ? "border-primary shadow-lg shadow-primary/20 bg-primary/5"
                        : "border-border bg-background hover:bg-muted/30"
                    )}
                  >
                    {/* Main Row */}
                    <div className="flex items-start gap-1">
                      {/* Play/Pause Button - Prominent like Blender's video strips */}
                      <Button
                        size="sm"
                        variant={isPlaying ? "default" : "ghost"}
                        className={cn(
                          "h-6 w-6 p-0 flex-shrink-0 mt-0.5",
                          isPlaying && "bg-primary hover:bg-primary/90"
                        )}
                        onClick={() => {
                          playEpisode(episode);
                        }}
                        title={isPlaying ? "Pause" : "Play"}
                      >
                        {isPlaying ? (
                          <Pause className="w-3 h-3" />
                        ) : (
                          <Play className="w-3 h-3 fill-current" />
                        )}
                      </Button>

                      {/* Episode Number */}
                      <div className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-[10px] font-bold text-primary">
                          {episode.number}
                        </span>
                      </div>

                      {/* Episode Info - Blender Style */}
                      <div className="flex-1 min-w-0">
                        {/* First Row: Stats */}
                        <div className="flex items-center gap-1 mb-0.5">
                          <span className="text-xs font-medium text-foreground">
                            {episode.frames.length} frames
                          </span>
                          <span className="text-[10px] text-muted-foreground">•</span>
                          <span className="text-[10px] text-muted-foreground">
                            {durationSeconds}s
                          </span>
                          {isFpsMismatch && (
                            <>
                              <span className="text-[10px] text-muted-foreground">•</span>
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1 py-0 h-3.5 border-amber-500/40 text-amber-400 bg-amber-500/10"
                              >
                                fps {episodeFps.toFixed(1)}
                              </Badge>
                            </>
                          )}
                          {isVelocityMismatch && (
                            <>
                              <span className="text-[10px] text-muted-foreground">•</span>
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1 py-0 h-3.5 border-amber-500/40 text-amber-400 bg-amber-500/10"
                                title={`Velocity limit exceeded on ${velocityStatus.overCount} joint(s)`}
                              >
                                vel x{Math.max(1, velocityStatus.maxRatio).toFixed(2)}
                              </Badge>
                            </>
                          )}
                          <span className="text-[10px] text-muted-foreground">•</span>
                          <span
                            className={`text-[10px] font-mono tabular-nums ${
                              currentPlayingEpisodeIndex === index && isPlayingAll
                                ? "text-primary font-semibold"
                                : "text-muted-foreground"
                            }`}
                          >
                            {displayFrame}/{lastFrameIndex}
                          </span>
                        </div>

                        {/* Second Row: Source Info */}
                        {sourceType && (
                          <div className="flex items-center gap-1">
                            <Badge
                              variant={
                                sourceType === "hf"
                                  ? "default"
                                  : sourceType === "local"
                                  ? "secondary"
                                  : "outline"
                              }
                              className="text-[9px] px-1.5 py-0 h-3.5 font-medium"
                            >
                              {sourceType === "hf"
                                ? "HF"
                                : sourceType === "local"
                                ? "Local"
                                : sourceType === "recorded"
                                ? "REC"
                                : sourceType}
                            </Badge>
                            {sourceName && (
                              <span
                                className="text-[10px] text-muted-foreground truncate"
                                title={sourceName}
                              >
                                {sourceName}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Compact Controls - All Actions Together */}
                    <div className="flex items-center gap-0.5 mt-1 pt-0.5 border-t border-border/30 opacity-40 group-hover:opacity-100 transition-opacity">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1 text-[10px] text-muted-foreground/60 hover:text-foreground"
                        onClick={() => moveEpisode(episode.id, "up")}
                        disabled={index === 0}
                        title="Move up"
                      >
                        <ArrowUp className="w-2.5 h-2.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1 text-[10px] text-muted-foreground/60 hover:text-foreground"
                        onClick={() => moveEpisode(episode.id, "down")}
                        disabled={index === episodes.length - 1}
                        title="Move down"
                      >
                        <ArrowDown className="w-2.5 h-2.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1 text-[10px] text-muted-foreground/60 hover:text-foreground"
                        onClick={() => retakeEpisode(episode.id)}
                        disabled={isRecording}
                        title="Retake"
                      >
                        <RotateCcw className="w-2.5 h-2.5 mr-0.5" />
                        Retake
                      </Button>
                      <div className="flex-1" />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 w-5 p-0 text-muted-foreground/60 hover:text-foreground"
                        onClick={() => exportEpisodeToDataFile(episode)}
                        title="Export"
                      >
                        <Download className="w-2.5 h-2.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 w-5 p-0 text-muted-foreground/60 hover:text-foreground"
                        onClick={() => deleteEpisode(episode.id)}
                        disabled={isRecording}
                        title="Delete"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </BlenderPanel>
    </div>

    {/* Collapse Button at Bottom of Top Section */}
    {onToggleCollapse && (
      <div className="flex-shrink-0 border-t border-border/30 flex items-center justify-center p-1.5">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={onToggleCollapse}
          aria-label={isCollapsed ? "Expand panel" : "Collapse panel"}
          title={isCollapsed ? "Show sidebar" : "Hide sidebar"}
        >
          {isCollapsed ? (
            <ChevronsRight className="w-4 h-4" />
          ) : (
            <ChevronsLeft className="w-4 h-4" />
          )}
        </Button>
      </div>
    )}
  </div>
  );
};
