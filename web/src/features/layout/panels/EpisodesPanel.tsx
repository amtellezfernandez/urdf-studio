import type React from "react";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { BlenderPanel } from "@/shared/ui/blender-panel";
import { NumberInput } from "@/shared/ui/number-input";
import { Badge } from "@/shared/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { cn } from "@/shared/lib/utils";
import {
  resolveEpisodeSourceDescriptor,
  resolveEpisodeSignalMode,
  resolveEpisodeSignalModeLabel,
  resolveSourceTypeDisplayLabel,
  type Episode,
} from "@/features/dataset";
import type { DatasetSessionSummary } from "@/features/dataset/datasetSessionTypes";
import type { EpisodeMaterializationState } from "@/features/dataset/episode-pipeline/types";
import { isEpisodeThrottleWindowActive } from "@/features/dataset/episode-pipeline/episodePipelineController";
import { MIN_EPISODES_PANEL_HEIGHT } from "@/features/layout/page/constants";
import type { JointLimitMode } from "@/shared/types/feature";
import { useJointStore, type DataZeroJointSource } from "@/shared/store/useJointStore";
import {
  DATASET_CONSTRAINT_AXIS_OPTIONS,
  DATASET_CONSTRAINT_MODES,
  DATASET_CONSTRAINT_NUMBER_STEP,
  type DatasetConstraintAxis,
  type DatasetConstraintMode,
  type DatasetConstraintSettings,
  type DatasetConstraintWallSide,
} from "@/features/dataset/episode-viewer/constraintSettings";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  Circle,
} from "lucide-react";
import {
  LOCAL_DATASET_FILE_INPUT_ACCEPT,
  LOCAL_DATASET_FILE_INPUT_ID,
} from "@/features/layout/sidebar/localDatasetImportParams";
import {
  resolveDatasetEpisodeMjlabValidation,
  type DatasetMjlabValidationStatus,
} from "@/features/layout/sidebar/datasetMjlabValidation";

const THROTTLE_REFRESH_INTERVAL_MS = 500;
const ZERO_POSE_STATUS_LABELS = {
  empty: "none",
  target: "Target",
  raw: "Raw",
};
const LIMIT_CORRECTION_MODES: Array<{
  value: JointLimitMode;
  label: string;
  description: string;
}> = [
  { value: "report", label: "Report", description: "Flag violations but preserve raw values." },
  { value: "clamp", label: "Clamp", description: "Clamp each value to the nearest valid bound." },
  { value: "shift", label: "Shift", description: "Shift each series so it stays inside bounds." },
];

type ZeroPoseStatus = {
  label: string;
  title: string;
  available: boolean;
};

const LEROBOT_WEB3D_ZERO_POSE_STATUS: ZeroPoseStatus = {
  label: "HF/Web3D",
  title:
    "Matches the Hugging Face LeRobot Dataset Visualizer: dataset joint values are applied directly after unit conversion, without the loaded target robot zero pose.",
  available: true,
};

const countFiniteJointValues = (jointValues: Readonly<Record<string, number>>): number =>
  Object.values(jointValues).filter((value) => Number.isFinite(value)).length;

const formatJointCount = (count: number): string =>
  `${count} joint${count === 1 ? "" : "s"}`;

const resolveAutoZeroPoseStatus = (
  dataZeroJointValues: Readonly<Record<string, number>>,
): ZeroPoseStatus => {
  const jointCount = countFiniteJointValues(dataZeroJointValues);
  if (jointCount === 0) {
    return {
      label: ZERO_POSE_STATUS_LABELS.empty,
      title: "No target robot zero pose has been inferred for dataset joints.",
      available: false,
    };
  }
  return {
    label: formatJointCount(jointCount),
    title: `Uses the loaded target robot zero pose for ${formatJointCount(jointCount)}.`,
    available: true,
  };
};

const analyzeTimestampSeries = (frames: Episode["frames"]) => {
  if (!frames || frames.length < 2) {
    return { nonMonotonic: false, zeroOrNegativeCount: 0 };
  }
  let prev = frames[0]?.timestamp ?? 0;
  let zeroOrNegativeCount = 0;
  for (let i = 1; i < frames.length; i += 1) {
    const current = frames[i]?.timestamp ?? prev;
    const dt = current - prev;
    if (!Number.isFinite(dt) || dt <= 0) {
      zeroOrNegativeCount += 1;
    }
    prev = current;
  }
  return {
    nonMonotonic: zeroOrNegativeCount > 0,
    zeroOrNegativeCount,
  };
};

type EpisodesPanelProps = {
  episodes: Episode[];
  episodePipelineStates?: Record<string, EpisodeMaterializationState>;
  episodesViewHeight?: number;
  isRecording: boolean;
  recordingStats: { frames: number; seconds: number };
  recordingFps: number;
  setRecordingFps: (fps: number) => void;
  fpsTarget: number;
  setFpsTarget: (fps: number) => void;
  applyFpsTarget: () => void;
  limitCorrectionMode: JointLimitMode;
  setLimitCorrectionMode: (mode: JointLimitMode) => void;
  constraintSettings: DatasetConstraintSettings;
  setConstraintSettings: Dispatch<SetStateAction<DatasetConstraintSettings>>;
  getEpisodeFps: (episode: Episode) => number;
  fpsTolerance?: number;
  getEpisodeVelocityStatus: (
    episode: Episode
  ) => { overCount: number; maxRatio: number; worstJoint: string | null; worstFrame: number | null; worstTimeSec: number | null };
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
  activeReplayWorldSnapshotWarning?: string | null;
  playbackSpeed: number;
  setPlaybackSpeed: (speed: number) => void;
  datasetSessionSummary?: DatasetSessionSummary | null;
  datasetSessionStatus?: "idle" | "syncing" | "ready" | "error";
  datasetSessionError?: string | null;
  pendingHfRemainderEpisodeId?: string | null;
  pendingHfRemainderLabel?: string;
  isLoadingPendingHfRemainder?: boolean;
  onLoadPendingHfRemainder?: () => void;
  onAbortPendingHfRemainder?: () => void;
  onRemapPendingHfRemainder?: () => void;
};

const resolveDatasetMjlabValidationTone = (
  phase: DatasetMjlabValidationStatus["phase"],
): string => {
  if (phase === "pending") return "text-sky-300";
  if (phase === "passed") return "text-emerald-300";
  if (phase === "rejected") return "text-red-300";
  if (phase === "unavailable") return "text-amber-300";
  return "text-muted-foreground";
};

const resolveDatasetMjlabValidationBadgeTone = (
  phase: DatasetMjlabValidationStatus["phase"],
): string => {
  if (phase === "pending") return "border-sky-500/40 text-sky-300 bg-sky-500/10";
  if (phase === "passed") {
    return "border-emerald-500/40 text-emerald-300 bg-emerald-500/10";
  }
  if (phase === "rejected") return "border-red-500/40 text-red-300 bg-red-500/10";
  if (phase === "unavailable") {
    return "border-amber-500/40 text-amber-300 bg-amber-500/10";
  }
  return "border-border/60 text-muted-foreground";
};

const resolveDatasetMjlabValidationBadgeLabel = (
  phase: DatasetMjlabValidationStatus["phase"],
): string => {
  if (phase === "pending") return "MJLab sending";
  if (phase === "passed") return "MJLab passed";
  if (phase === "rejected") return "MJLab rejected";
  if (phase === "unavailable") return "MJLab unavailable";
  return "MJLab idle";
};

const buildDatasetMjlabValidationTitle = (
  validation: DatasetMjlabValidationStatus,
): string =>
  [validation.message, ...(validation.issueSummaries ?? [])].join("\n");

export const EpisodesPanel = ({
  episodes,
  episodePipelineStates = {},
  episodesViewHeight = 0.4,
  isRecording,
  recordingStats,
  recordingFps,
  setRecordingFps,
  fpsTarget,
  setFpsTarget,
  applyFpsTarget,
  limitCorrectionMode,
  setLimitCorrectionMode,
  constraintSettings,
  setConstraintSettings,
  getEpisodeFps,
  fpsTolerance = 0.5,
  getEpisodeVelocityStatus,
  velocityTolerance = 0.05,
  startRecording,
  stopRecording,
  handleFileUpload,
  playAllEpisodes,
  playEpisode,
  moveEpisode,
  retakeEpisode,
  exportEpisodeToDataFile,
  deleteEpisode,
  isPlayingAll,
  currentFrame,
  currentPlayingEpisodeIndex,
  activeReplayWorldSnapshotWarning = null,
  playbackSpeed,
  setPlaybackSpeed,
  datasetSessionSummary = null,
  datasetSessionStatus = "idle",
  datasetSessionError = null,
  pendingHfRemainderEpisodeId = null,
  pendingHfRemainderLabel,
  isLoadingPendingHfRemainder = false,
  onLoadPendingHfRemainder,
  onAbortPendingHfRemainder,
  onRemapPendingHfRemainder,
}: EpisodesPanelProps) => {
  const dataZeroJointValues = useJointStore(
    (state) => state.dataZeroJointValues,
  );
  const dataZeroJointSource = useJointStore(
    (state) => state.dataZeroJointSource,
  );
  const setDataZeroJointSource = useJointStore(
    (state) => state.setDataZeroJointSource,
  );
  const setLeRobotDataZeroJointValues = useJointStore(
    (state) => state.setLeRobotDataZeroJointValues,
  );
  const [pipelineClockMs, setPipelineClockMs] = useState(() => Date.now());

  const hasActiveThrottleWindow = useMemo(
    () =>
      Object.values(episodePipelineStates).some((state) =>
        isEpisodeThrottleWindowActive(state, pipelineClockMs)
      ),
    [episodePipelineStates, pipelineClockMs]
  );

  useEffect(() => {
    if (!hasActiveThrottleWindow) return;
    const intervalId = window.setInterval(() => {
      setPipelineClockMs(Date.now());
    }, THROTTLE_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [hasActiveThrottleWindow]);

  const episodeStats = useMemo(
    () =>
      episodes.map((episode) => {
        const loadedFrameCount = episode.frames.length;
        const metadataFrameCount = Number(episode.metadata?.num_frames ?? 0);
        const frameCount =
          loadedFrameCount > 0
            ? loadedFrameCount
            : Number.isFinite(metadataFrameCount)
              ? Math.max(0, metadataFrameCount)
              : 0;
        let durationMs = 0;
        if (loadedFrameCount > 0) {
          const startTimestamp = episode.frames[0]?.timestamp ?? 0;
          const endTimestamp =
            episode.frames[loadedFrameCount - 1]?.timestamp ?? startTimestamp;
          durationMs = endTimestamp - startTimestamp;
          if (!Number.isFinite(durationMs) || durationMs < 0) {
            durationMs = Math.max(0, endTimestamp);
          }
        } else {
          const metadataDurationSec = Number(
            episode.metadata?.episode_length_sec ?? 0
          );
          if (Number.isFinite(metadataDurationSec) && metadataDurationSec > 0) {
            durationMs = metadataDurationSec * 1000;
          }
        }

        const timing =
          loadedFrameCount > 1
            ? analyzeTimestampSeries(episode.frames)
            : { nonMonotonic: false, zeroOrNegativeCount: 0 };
        const computedFps = loadedFrameCount > 1 ? getEpisodeFps(episode) : 0;
        const metadataFps = Number(episode.metadata?.fps ?? 0);
        const fps =
          computedFps > 0
            ? computedFps
            : Number.isFinite(metadataFps) && metadataFps > 0
              ? metadataFps
              : 0;
        const velocityStatus =
          loadedFrameCount > 1
            ? getEpisodeVelocityStatus(episode)
            : { overCount: 0, maxRatio: 0, worstJoint: null, worstFrame: null, worstTimeSec: null };
        const isFpsMismatch =
          fpsTarget > 0 &&
          fps > 0 &&
          Math.abs(fps - fpsTarget) > fpsTolerance;
        const isVelocityMismatch = velocityStatus.overCount > 0;

        return {
          fps,
          velocityStatus,
          frameCount,
          isFpsMismatch,
          isVelocityMismatch,
          durationSeconds: (durationMs / 1000).toFixed(1),
          hasTimingIssue: timing.nonMonotonic,
          timingIssueCount: timing.zeroOrNegativeCount,
        };
      }),
    [episodes, getEpisodeFps, getEpisodeVelocityStatus, fpsTarget, fpsTolerance]
  );

  const fpsMismatchCount = useMemo(
    () => episodeStats.reduce((count, stat) => (stat.isFpsMismatch ? count + 1 : count), 0),
    [episodeStats]
  );
  const velocityMismatchCount = useMemo(
    () =>
      episodeStats.reduce((count, stat) => (stat.isVelocityMismatch ? count + 1 : count), 0),
    [episodeStats]
  );
  const timingMismatchCount = useMemo(
    () =>
      episodeStats.reduce((count, stat) => (stat.hasTimingIssue ? count + 1 : count), 0),
    [episodeStats]
  );
  const datasetReviewIssueCount = useMemo(
    () =>
      datasetSessionSummary?.review_counts.reduce(
        (count, reviewCount) => count + reviewCount.episode_count,
        0
      ) ?? 0,
    [datasetSessionSummary]
  );
  const autoZeroPoseStatus = useMemo(
    () => resolveAutoZeroPoseStatus(dataZeroJointValues),
    [dataZeroJointValues],
  );
  const lerobotZeroPoseStatus = LEROBOT_WEB3D_ZERO_POSE_STATUS;

  useEffect(() => {
    setLeRobotDataZeroJointValues({});
  }, [setLeRobotDataZeroJointValues]);

  const setZeroPoseSource = (source: DataZeroJointSource) => {
    if (source === "lerobot" && !lerobotZeroPoseStatus.available) {
      return;
    }
    setDataZeroJointSource(source);
  };

  const updateConstraintSettings = (
    updater: (previous: DatasetConstraintSettings) => DatasetConstraintSettings
  ) => {
    setConstraintSettings((previous) => updater(previous));
  };

  return (
    <div
      className="overflow-hidden flex flex-col p-1.5 border-b border-border/20"
      style={{
        flex: `0 0 ${((1 - episodesViewHeight) * 100)}%`,
        minHeight: `${MIN_EPISODES_PANEL_HEIGHT}px`,
      }}
    >
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden micro-scrollbar pr-0">
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
          id={LOCAL_DATASET_FILE_INPUT_ID}
          accept={LOCAL_DATASET_FILE_INPUT_ACCEPT}
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
        {datasetSessionSummary ? (
          <>
            <Badge
              variant="outline"
              className="h-4 px-1 py-0 text-[9px] border-border/60 text-muted-foreground"
            >
              {resolveSourceTypeDisplayLabel(datasetSessionSummary.source_kind) ??
                datasetSessionSummary.source_kind}
            </Badge>
            <Badge
              variant="outline"
              className="h-4 px-1 py-0 text-[9px] border-border/60 text-muted-foreground"
            >
              {datasetSessionSummary.episode_count} eps
            </Badge>
            <Badge
              variant="outline"
              className="h-4 px-1 py-0 text-[9px] border-border/60 text-muted-foreground"
            >
              {datasetSessionSummary.flagged_episode_count} flagged
            </Badge>
            {datasetReviewIssueCount > 0 && (
              <Badge
                variant="outline"
                className="h-4 px-1 py-0 text-[9px] border-amber-500/40 text-amber-400 bg-amber-500/10"
              >
                {datasetReviewIssueCount} review
              </Badge>
            )}
          </>
        ) : null}
        {datasetSessionStatus === "syncing" && (
          <Badge
            variant="outline"
            className="h-4 px-1 py-0 text-[9px] border-primary/40 text-primary bg-primary/10"
          >
            syncing review
          </Badge>
        )}
        {datasetSessionStatus === "error" && datasetSessionError ? (
          <Badge
            variant="outline"
            className="h-4 px-1 py-0 text-[9px] border-red-500/40 text-red-400 bg-red-500/10"
            title={datasetSessionError}
          >
            review sync failed
          </Badge>
        ) : null}
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
        {timingMismatchCount > 0 && (
          <Badge
            variant="outline"
            className="text-[9px] px-1.5 py-0 h-4 border-red-500/40 text-red-400 bg-red-500/10"
          >
            {timingMismatchCount} time
          </Badge>
        )}
      </div>

      <BlenderPanel title="Dataset Policy" defaultOpen={true}>
        <div className="space-y-2">
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
              Limit correction
            </div>
            <div className="grid grid-cols-3 gap-1">
              {LIMIT_CORRECTION_MODES.map((option) => {
                const selected = limitCorrectionMode === option.value;
                return (
                  <Button
                    key={option.value}
                    type="button"
                    size="sm"
                    variant={selected ? "secondary" : "outline"}
                    className={cn(
                      "h-6 px-1 text-[10px]",
                      selected && "border-primary/50 bg-primary/10 text-primary"
                    )}
                    title={option.description}
                    onClick={() => setLimitCorrectionMode(option.value)}
                  >
                    {option.label}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1 rounded-sm border border-border/40 bg-muted/20 p-1.5">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                Constraints
              </span>
              <Badge
                variant="outline"
                className="h-4 px-1 py-0 text-[9px] border-border/60 text-muted-foreground"
              >
                global
              </Badge>
            </div>
            <div className="flex items-center gap-1">
              <Select
                value={constraintSettings.mode}
                onValueChange={(value) =>
                  updateConstraintSettings((previous) => ({
                    ...previous,
                    mode: value as DatasetConstraintMode,
                  }))
                }
              >
                <SelectTrigger className="h-6 w-[96px] text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATASET_CONSTRAINT_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode} className="text-[10px]">
                      {mode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-[10px] text-muted-foreground">
                Applies to all episodes
              </span>
            </div>

            {constraintSettings.mode === "height" && (
              <div className="flex items-center gap-1">
                <Select
                  value={constraintSettings.heightAxis}
                  onValueChange={(value) =>
                    updateConstraintSettings((previous) => ({
                      ...previous,
                      heightAxis: value as DatasetConstraintAxis,
                    }))
                  }
                >
                  <SelectTrigger className="h-6 w-[56px] text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DATASET_CONSTRAINT_AXIS_OPTIONS.map((axis) => (
                      <SelectItem key={axis} value={axis} className="text-[10px]">
                        {axis.toUpperCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <NumberInput
                  value={constraintSettings.heightLimit}
                  onValueChange={(value) =>
                    updateConstraintSettings((previous) => ({
                      ...previous,
                      heightLimit: value,
                    }))
                  }
                  step={DATASET_CONSTRAINT_NUMBER_STEP}
                  compact
                  className="w-16"
                />
                <span className="text-[9px] text-muted-foreground">max</span>
              </div>
            )}

            {constraintSettings.mode === "box" && (
              <div className="space-y-1">
                <div className="flex items-center gap-1">
                  <span className="w-6 text-[9px] text-muted-foreground">min</span>
                  <NumberInput
                    value={constraintSettings.boxMin.x}
                    onValueChange={(value) =>
                      updateConstraintSettings((previous) => ({
                        ...previous,
                        boxMin: { ...previous.boxMin, x: value },
                      }))
                    }
                    step={DATASET_CONSTRAINT_NUMBER_STEP}
                    compact
                    className="w-14"
                  />
                  <NumberInput
                    value={constraintSettings.boxMin.y}
                    onValueChange={(value) =>
                      updateConstraintSettings((previous) => ({
                        ...previous,
                        boxMin: { ...previous.boxMin, y: value },
                      }))
                    }
                    step={DATASET_CONSTRAINT_NUMBER_STEP}
                    compact
                    className="w-14"
                  />
                  <NumberInput
                    value={constraintSettings.boxMin.z}
                    onValueChange={(value) =>
                      updateConstraintSettings((previous) => ({
                        ...previous,
                        boxMin: { ...previous.boxMin, z: value },
                      }))
                    }
                    step={DATASET_CONSTRAINT_NUMBER_STEP}
                    compact
                    className="w-14"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-6 text-[9px] text-muted-foreground">max</span>
                  <NumberInput
                    value={constraintSettings.boxMax.x}
                    onValueChange={(value) =>
                      updateConstraintSettings((previous) => ({
                        ...previous,
                        boxMax: { ...previous.boxMax, x: value },
                      }))
                    }
                    step={DATASET_CONSTRAINT_NUMBER_STEP}
                    compact
                    className="w-14"
                  />
                  <NumberInput
                    value={constraintSettings.boxMax.y}
                    onValueChange={(value) =>
                      updateConstraintSettings((previous) => ({
                        ...previous,
                        boxMax: { ...previous.boxMax, y: value },
                      }))
                    }
                    step={DATASET_CONSTRAINT_NUMBER_STEP}
                    compact
                    className="w-14"
                  />
                  <NumberInput
                    value={constraintSettings.boxMax.z}
                    onValueChange={(value) =>
                      updateConstraintSettings((previous) => ({
                        ...previous,
                        boxMax: { ...previous.boxMax, z: value },
                      }))
                    }
                    step={DATASET_CONSTRAINT_NUMBER_STEP}
                    compact
                    className="w-14"
                  />
                </div>
              </div>
            )}

            {constraintSettings.mode === "wall" && (
              <div className="flex items-center gap-1">
                <Select
                  value={constraintSettings.wallAxis}
                  onValueChange={(value) =>
                    updateConstraintSettings((previous) => ({
                      ...previous,
                      wallAxis: value as DatasetConstraintAxis,
                    }))
                  }
                >
                  <SelectTrigger className="h-6 w-[56px] text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DATASET_CONSTRAINT_AXIS_OPTIONS.map((axis) => (
                      <SelectItem key={axis} value={axis} className="text-[10px]">
                        {axis.toUpperCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={constraintSettings.wallSide}
                  onValueChange={(value) =>
                    updateConstraintSettings((previous) => ({
                      ...previous,
                      wallSide: value as DatasetConstraintWallSide,
                    }))
                  }
                >
                  <SelectTrigger className="h-6 w-[64px] text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="negative" className="text-[10px]">
                      &lt;=
                    </SelectItem>
                    <SelectItem value="positive" className="text-[10px]">
                      &gt;=
                    </SelectItem>
                  </SelectContent>
                </Select>
                <NumberInput
                  value={constraintSettings.wallPosition}
                  onValueChange={(value) =>
                    updateConstraintSettings((previous) => ({
                      ...previous,
                      wallPosition: value,
                    }))
                  }
                  step={DATASET_CONSTRAINT_NUMBER_STEP}
                  compact
                  className="w-16"
                />
              </div>
            )}
          </div>
        </div>
      </BlenderPanel>

      {/* Playback Controls */}
      <BlenderPanel title="Playback" defaultOpen={true}>
        {/* Playback and Speed on same row */}
        <div className="flex items-center gap-1.5 mb-1">
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
        <div className="-mx-1.5 px-0">
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
                const stats = episodeStats[index];
                const durationSeconds = stats?.durationSeconds ?? "0.0";
                const episodeFps = stats?.fps ?? 0;
                const frameCountDisplay = stats?.frameCount ?? episode.frames.length;
                const isFpsMismatch = stats?.isFpsMismatch ?? false;
                const velocityStatus = stats?.velocityStatus ?? {
                  overCount: 0,
                  maxRatio: 0,
                  worstJoint: null,
                  worstFrame: null,
                  worstTimeSec: null,
                };
                const isVelocityMismatch = stats?.isVelocityMismatch ?? false;
                const hasTimingIssue = stats?.hasTimingIssue ?? false;
                const timingIssueCount = stats?.timingIssueCount ?? 0;
                const isPlaying =
                  currentPlayingEpisodeIndex === index && isPlayingAll;
                const additional = episode.metadata?.additional;
                const mjlabValidation =
                  resolveDatasetEpisodeMjlabValidation(episode);
                const isLazyPlaceholder =
                  episode.frames.length === 0 &&
                  !!additional &&
                  typeof additional === "object" &&
                  "hfLazy" in additional;
                const pipelineState = episodePipelineStates[episode.id];
                const isPipelineLoading = pipelineState?.status === "loading";
                const throttleWindowActive = isEpisodeThrottleWindowActive(
                  pipelineState,
                  pipelineClockMs
                );
                const canPlayEpisode = !isPipelineLoading && !throttleWindowActive;
                const episodeCurrentFrame =
                  currentPlayingEpisodeIndex === index && currentFrame !== undefined
                    ? currentFrame
                    : 0;
                const totalFrames = Math.max(episode.frames.length, frameCountDisplay);
                const lastFrameIndex = Math.max(0, totalFrames - 1);
                const displayFrame = Math.max(
                  0,
                  Math.min(episodeCurrentFrame, lastFrameIndex)
                );
                const sourceDescriptor = resolveEpisodeSourceDescriptor(episode);
                const sourceType = sourceDescriptor.sourceType;
                const sourceName = sourceDescriptor.sourceName;
                const sourceTypeLabel = resolveSourceTypeDisplayLabel(sourceType);
                const signalMode = resolveEpisodeSignalMode(episode);
                const signalModeLabel = resolveEpisodeSignalModeLabel(episode);
                const showPendingHfActions =
                  pendingHfRemainderEpisodeId !== null &&
                  episode.id === pendingHfRemainderEpisodeId;

                return (
                  <div
                    key={episode.id}
                    className={cn(
                      "group relative w-full rounded-sm border px-1 py-1 transition-colors",
                      isPlaying
                        ? "border-primary/60 bg-primary/5"
                        : isLazyPlaceholder
                        ? "border-border/60 border-dashed bg-muted/20 hover:bg-muted/30"
                        : "border-border bg-background hover:bg-muted/30",
                      isPipelineLoading && "opacity-70",
                      throttleWindowActive && "opacity-60"
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
                          if (!canPlayEpisode && !isPlaying) return;
                          playEpisode(episode);
                        }}
                        disabled={!isPlaying && !canPlayEpisode}
                        title={
                          isPlaying
                            ? "Pause"
                            : isPipelineLoading
                            ? "Loading episode..."
                            : throttleWindowActive
                            ? (pipelineState?.message ?? "Episode fetch was throttled. Retry in a few seconds.")
                            : isLazyPlaceholder
                            ? "Load and play indexed episode"
                            : "Play"
                        }
                      >
                        {isPlaying ? (
                          <Pause className="w-3 h-3" />
                        ) : (
                          <Play className="w-3 h-3 fill-current" />
                        )}
                      </Button>

                      {/* Episode Number */}
                      <div className="mt-0.5 h-5 w-5 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-primary">
                          {episode.number}
                        </span>
                      </div>

                      {/* Episode Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex min-w-0 items-center gap-1 text-[10px]">
                          <span className="font-medium text-foreground">
                            {frameCountDisplay} frames
                          </span>
                          <span className="text-[10px] text-muted-foreground">•</span>
                          <span className="text-[10px] text-muted-foreground">
                            {durationSeconds}s
                          </span>
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

                        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1">
                          {sourceType && (
                            <Badge
                              variant={
                                sourceType === "hf"
                                  ? "default"
                                  : sourceType === "local"
                                  ? "secondary"
                                  : "outline"
                              }
                              className="h-4 px-1.5 py-0 text-[9px] font-medium"
                            >
                              {sourceTypeLabel}
                            </Badge>
                          )}
                          {signalMode !== "joint-only" && (
                            <Badge
                              variant="outline"
                              className="h-4 px-1 py-0 text-[9px] border-border/60 text-muted-foreground"
                              title="Detected signal mode"
                            >
                              {signalModeLabel}
                            </Badge>
                          )}
                          {isLazyPlaceholder && (
                            <Badge
                              variant="outline"
                              className="h-4 px-1 py-0 text-[9px] border-border/60 text-muted-foreground"
                              title="Indexed only. Click play to stream-load this episode."
                            >
                              indexed
                            </Badge>
                          )}
                          {isPipelineLoading && (
                            <Badge
                              variant="outline"
                              className="h-4 px-1 py-0 text-[9px] border-blue-500/40 text-blue-400 bg-blue-500/10"
                            >
                              loading
                            </Badge>
                          )}
                          {pipelineState?.status === "throttled" && (
                            <Badge
                              variant="outline"
                              className="h-4 px-1 py-0 text-[9px] border-amber-500/40 text-amber-400 bg-amber-500/10"
                              title={pipelineState.message}
                            >
                              throttled
                            </Badge>
                          )}
                          {pipelineState?.status === "error" && (
                            <Badge
                              variant="outline"
                              className="h-4 px-1 py-0 text-[9px] border-red-500/40 text-red-400 bg-red-500/10"
                              title={pipelineState.message}
                            >
                              error
                            </Badge>
                          )}
                          {isFpsMismatch && signalMode !== "joint-only" && (
                            <Badge
                              variant="outline"
                              className="h-4 px-1 py-0 text-[9px] border-amber-500/40 text-amber-400 bg-amber-500/10"
                              title={`Episode FPS ${episodeFps.toFixed(1)} (target ${fpsTarget})`}
                            >
                              fps {episodeFps.toFixed(1)}
                            </Badge>
                          )}
                          {isVelocityMismatch && (
                            <Badge
                              variant="outline"
                              className="h-4 px-1 py-0 text-[9px] border-amber-500/40 text-amber-400 bg-amber-500/10"
                              title={
                                velocityStatus.worstJoint && velocityStatus.worstFrame !== null
                                  ? `Velocity exceeded (${velocityStatus.overCount} joints). Worst: ${velocityStatus.worstJoint}@F${velocityStatus.worstFrame}`
                                  : `Velocity exceeded on ${velocityStatus.overCount} joint(s)`
                              }
                            >
                              vel x{Math.max(1, velocityStatus.maxRatio).toFixed(2)}
                            </Badge>
                          )}
                          {hasTimingIssue && (
                            <Badge
                              variant="outline"
                              className="h-4 px-1 py-0 text-[9px] border-red-500/40 text-red-400 bg-red-500/10"
                              title={`${timingIssueCount} non-monotonic timestamp gap(s)`}
                            >
                              time {timingIssueCount}
                            </Badge>
                          )}
                          {mjlabValidation && (
                            <Badge
                              variant="outline"
                              className={cn(
                                "h-4 px-1 py-0 text-[9px]",
                                resolveDatasetMjlabValidationBadgeTone(
                                  mjlabValidation.phase,
                                ),
                              )}
                              title={buildDatasetMjlabValidationTitle(
                                mjlabValidation,
                              )}
                            >
                              {resolveDatasetMjlabValidationBadgeLabel(
                                mjlabValidation.phase,
                              )}
                            </Badge>
                          )}
                        </div>

                        {sourceName && (
                          <div className="mt-0.5 min-w-0">
                            <span className="block truncate text-[9px] text-muted-foreground" title={sourceName}>
                              {sourceName}
                            </span>
                          </div>
                        )}
                        {mjlabValidation && mjlabValidation.phase !== "rejected" && (
                          <div
                            className={cn(
                              "mt-0.5 min-w-0 text-[9px] font-mono",
                              resolveDatasetMjlabValidationTone(
                                mjlabValidation.phase,
                              ),
                            )}
                            title={buildDatasetMjlabValidationTitle(
                              mjlabValidation,
                            )}
                          >
                            <span className="block truncate">
                              MJLab: {mjlabValidation.message}
                            </span>
                          </div>
                        )}
                        {currentPlayingEpisodeIndex === index &&
                          activeReplayWorldSnapshotWarning && (
                            <div className="mt-0.5 min-w-0">
                              <span
                                className="block truncate text-[9px] text-amber-400/90"
                                title={activeReplayWorldSnapshotWarning}
                              >
                                {activeReplayWorldSnapshotWarning}
                              </span>
                            </div>
                          )}
                      </div>
                    </div>

                    {showPendingHfActions && (
                      <div className="mt-1 rounded-sm border border-primary/30 bg-primary/5 px-1.5 py-1">
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className="truncate text-[9px] text-primary/80"
                            title={pendingHfRemainderLabel}
                          >
                            Ready to load more episodes
                          </span>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-5 px-1.5 text-[9px]"
                              disabled={
                                !onLoadPendingHfRemainder || isLoadingPendingHfRemainder
                              }
                              onClick={() => onLoadPendingHfRemainder?.()}
                            >
                              {isLoadingPendingHfRemainder
                                ? "Loading..."
                                : "Load Next 10"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-5 px-1.5 text-[9px]"
                              disabled={
                                !onRemapPendingHfRemainder || isLoadingPendingHfRemainder
                              }
                              onClick={() => onRemapPendingHfRemainder?.()}
                            >
                              Remap
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 px-1.5 text-[9px] text-muted-foreground hover:text-foreground"
                              disabled={
                                !onAbortPendingHfRemainder || isLoadingPendingHfRemainder
                              }
                              onClick={() => onAbortPendingHfRemainder?.()}
                            >
                              Abort
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}

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

    <div className="flex-shrink-0 border-t border-border/30 flex items-center gap-1.5 px-1.5 py-1">
      <span className="shrink-0 text-[9px] text-muted-foreground">Replay zero</span>
      <Button
        type="button"
        variant={dataZeroJointSource === "auto" ? "secondary" : "ghost"}
        size="sm"
        className={cn(
          "h-5 rounded-sm px-1.5 text-[9px] font-medium",
          autoZeroPoseStatus.available
            ? "text-emerald-600"
            : "text-muted-foreground",
        )}
        title={autoZeroPoseStatus.title}
        onClick={() => setZeroPoseSource("auto")}
      >
        {ZERO_POSE_STATUS_LABELS.target}: {autoZeroPoseStatus.label}
      </Button>
      <Button
        type="button"
        variant={dataZeroJointSource === "lerobot" ? "secondary" : "ghost"}
        size="sm"
        className="h-5 rounded-sm px-1.5 text-[9px] font-medium text-sky-600"
        title={lerobotZeroPoseStatus.title}
        onClick={() => setZeroPoseSource("lerobot")}
      >
        {ZERO_POSE_STATUS_LABELS.raw}: {lerobotZeroPoseStatus.label}
      </Button>
    </div>
  </div>
  );
};
