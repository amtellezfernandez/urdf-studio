import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
} from "react";
import { toast } from "sonner";
import {
  applyJointLimitCorrectionsToFrames,
  computeJointLimitViolations,
  summarizeJointLimitCorrections,
  toAnimationFrames,
  type Episode,
  type RecordedFrame,
} from "@/features/dataset";
import { applyJointValues } from "@/shared/lib/urdf-joints";
import type { URDFRobot } from "urdf-loader";
import { Box3 } from "three";
import type * as THREE from "three";
import { getJointColor } from "@/features/urdf/utils/jointColors";
import { getJointLimits, type JointLimits } from "@/shared/lib/urdfBrowser";
import type { JointLimitMode } from "@/shared/types/feature";
import { viewerPlayback } from "@/features/viewer/playback/viewerPlayback";
import {
  DATASET_CONSTRAINT_AXIS_OPTIONS,
  DATASET_CONSTRAINT_MODES,
  DATASET_CONSTRAINT_WALL_SIDES,
  createDefaultDatasetConstraintSettings,
  type DatasetConstraintSettings,
  type DatasetConstraintAxis,
  type DatasetConstraintMode,
  type DatasetConstraintWallSide,
} from "@/features/dataset/episode-viewer/constraintSettings";
import { EPISODE_VELOCITY_LIMIT_TOLERANCE } from "@/features/dataset/episodeReviewParams";
import { EPISODE_EDITOR_INITIAL_FRAME_INDEX } from "@/features/dataset/episode-editor/episodeEditorParams";
import { EPISODE_VIEWER_MODAL_HELPER_PARAMS } from "@/features/dataset/episode-viewer/modalHelperParams";

export const CANVAS_PADDING = EPISODE_VIEWER_MODAL_HELPER_PARAMS.canvasPadding;
export const MIN_WINDOW_WIDTH =
  EPISODE_VIEWER_MODAL_HELPER_PARAMS.minWindowWidth;
export const MIN_WINDOW_HEIGHT =
  EPISODE_VIEWER_MODAL_HELPER_PARAMS.minWindowHeight;
export const DRAG_THRESHOLD = EPISODE_VIEWER_MODAL_HELPER_PARAMS.dragThreshold;
export const TIMELINE_HEADER_HEIGHT =
  EPISODE_VIEWER_MODAL_HELPER_PARAMS.timelineHeaderHeight;
export const CONSTRAINT_EPS =
  EPISODE_VIEWER_MODAL_HELPER_PARAMS.constraintEpsilon;
export const CONSTRAINT_SCAN_BATCH =
  EPISODE_VIEWER_MODAL_HELPER_PARAMS.constraintScanBatch;
export const CONSTRAINT_SCAN_PROGRESS_UPDATES_TARGET =
  EPISODE_VIEWER_MODAL_HELPER_PARAMS.constraintScanProgressUpdatesTarget;
export const VELOCITY_LIMIT_TOLERANCE = EPISODE_VELOCITY_LIMIT_TOLERANCE;
const CURVE_POINT_SELECTION_RADIUS_PX =
  EPISODE_VIEWER_MODAL_HELPER_PARAMS.curvePointSelectionRadiusPx;
const AXIS_OPTIONS = DATASET_CONSTRAINT_AXIS_OPTIONS;
const CONSTRAINT_MODES = DATASET_CONSTRAINT_MODES;
const WALL_SIDES = DATASET_CONSTRAINT_WALL_SIDES;
const RETIME_MODES = EPISODE_VIEWER_MODAL_HELPER_PARAMS.retimeModes;
const MIN_TIME_LABEL_SPACING_PX =
  EPISODE_VIEWER_MODAL_HELPER_PARAMS.minTimeLabelSpacingPx;
const MAX_TIME_TICKS = EPISODE_VIEWER_MODAL_HELPER_PARAMS.maxTimeTicks;
const CHART_VALUE_RANGE_PADDING_RATIO =
  EPISODE_VIEWER_MODAL_HELPER_PARAMS.chartValueRangePaddingRatio;
const CHART_VALUE_RANGE_FALLBACK_PADDING =
  EPISODE_VIEWER_MODAL_HELPER_PARAMS.chartValueRangeFallbackPadding;
export const Y_AXIS_FALLBACK_GRID_LINE_COUNT =
  EPISODE_VIEWER_MODAL_HELPER_PARAMS.yAxisFallbackGridLineCount;
export const Y_AXIS_TICK_LABEL_GAP_PX =
  EPISODE_VIEWER_MODAL_HELPER_PARAMS.yAxisTickLabelGapPx;
export const Y_AXIS_TICK_MARK_LENGTH_PX =
  EPISODE_VIEWER_MODAL_HELPER_PARAMS.yAxisTickMarkLengthPx;
export const TIME_TICK_LABEL_GAP_PX =
  EPISODE_VIEWER_MODAL_HELPER_PARAMS.timeTickLabelGapPx;
export const TIME_TICK_LABEL_Y_OFFSET_PX =
  EPISODE_VIEWER_MODAL_HELPER_PARAMS.timeTickLabelYOffsetPx;
export const X_AXIS_TITLE_BOTTOM_OFFSET_PX =
  EPISODE_VIEWER_MODAL_HELPER_PARAMS.xAxisTitleBottomOffsetPx;
export const Y_AXIS_TITLE_X_OFFSET_PX =
  EPISODE_VIEWER_MODAL_HELPER_PARAMS.yAxisTitleXOffsetPx;
const Y_AXIS_MAX_NUMERIC_TICK_COUNT =
  EPISODE_VIEWER_MODAL_HELPER_PARAMS.yAxisMaxNumericTickCount;
const Y_AXIS_PI_TICK_MULTIPLE_LIMIT =
  EPISODE_VIEWER_MODAL_HELPER_PARAMS.yAxisPiTickMultipleLimit;
const Y_AXIS_PI_SNAP_EPSILON =
  EPISODE_VIEWER_MODAL_HELPER_PARAMS.yAxisPiSnapEpsilon;
const Y_AXIS_NUMERIC_PRECISION_DIGITS =
  EPISODE_VIEWER_MODAL_HELPER_PARAMS.yAxisNumericPrecisionDigits;
export const EMPTY_FRAME_SET = new Set<number>();

export type ConstraintMode = DatasetConstraintMode;
export type AxisKey = DatasetConstraintAxis;
export type WallSide = DatasetConstraintWallSide;
export type RetimeMode = (typeof RETIME_MODES)[number];
export type ChartValueRange = {
  min: number;
  max: number;
  span: number;
};

export interface EpisodeViewer3DModalProps {
  episode: Episode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  robotBoundingBox?: THREE.Box3 | null;
  robot?: URDFRobot | null;
  jointLimits?: JointLimits;
  currentEpisodeIndex?: number | null;
  allEpisodes?: Episode[];
  isPlayingAll?: boolean;
  onPlayAllEpisodes?: (overrideFrame?: number) => void;
  onSetCurrentEpisodeIndex?: (index: number | null) => void;
  globalCurrentFrame?: number;
  onSetGlobalFrame?: (frame: number) => void;
  inline?: boolean; // If true, render inline instead of as modal
  showOnlyHeader?: boolean; // If true, only show the header (for collapsed view)
  onSaveEpisode?: (episode: Episode, saveAsNew: boolean, newName?: string) => void; // Callback to save/update episode
  constraintSettings?: DatasetConstraintSettings;
}

export const DEFAULT_EPISODE_VIEWER_CONSTRAINT_SETTINGS =
  createDefaultDatasetConstraintSettings();

export interface ViolationZone {
  start: number;
  end: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toFiniteSecondsOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

export const getEpisodeVideoClipBounds = (
  episode: Episode
): { startSec: number; endSec: number | null } => {
  const additional = isRecord(episode.metadata?.additional)
    ? episode.metadata.additional
    : {};
  const startRaw = toFiniteSecondsOrNull(additional.video_clip_start_sec);
  const startSec = startRaw !== null ? Math.max(0, startRaw) : 0;
  const endRaw = toFiniteSecondsOrNull(additional.video_clip_end_sec);
  const endSec =
    endRaw !== null && endRaw > startSec ? endRaw : null;
  return { startSec, endSec };
};

export const applyEpisodeVideoClipBounds = (
  metadata: Episode["metadata"] | undefined,
  clipStartSec: number,
  clipEndSec: number
): Episode["metadata"] => {
  const normalizedClipStart = Math.max(0, clipStartSec);
  const normalizedClipEnd = Math.max(normalizedClipStart, clipEndSec);
  const baseMetadata = { ...(metadata ?? {}) };
  const additional = isRecord(baseMetadata.additional)
    ? baseMetadata.additional
    : {};
  baseMetadata.additional = {
    ...additional,
    video_clip_start_sec: normalizedClipStart,
    video_clip_end_sec: normalizedClipEnd,
  };

  if (isRecord(baseMetadata.videos)) {
    const nextVideos: Record<string, unknown> = {};
    Object.entries(baseMetadata.videos).forEach(([cameraName, descriptor]) => {
      if (typeof descriptor === "string") {
        nextVideos[cameraName] = {
          path: descriptor,
          clip_start_sec: normalizedClipStart,
          clip_end_sec: normalizedClipEnd,
        };
        return;
      }
      if (isRecord(descriptor)) {
        nextVideos[cameraName] = {
          ...descriptor,
          clip_start_sec: normalizedClipStart,
          clip_end_sec: normalizedClipEnd,
        };
        return;
      }
      nextVideos[cameraName] = descriptor;
    });
    baseMetadata.videos = nextVideos;
  }

  return baseMetadata;
};

// Helper to get current frame value
export const getCurrentFrameValue = (
  preservedFrame: number | null,
  globalFrame?: number,
  localFrame?: number
): number => {
  if (preservedFrame !== null && preservedFrame !== undefined) {
    return preservedFrame;
  }
  return globalFrame ?? localFrame ?? 0;
};

export const getTimeBounds = (frames: RecordedFrame[]) => {
  if (!frames || frames.length === 0) {
    return { start: 0, end: 0, span: 0 };
  }
  const start = frames[0].timestamp ?? 0;
  const end = frames[frames.length - 1].timestamp ?? start;
  const span = Math.max(0, end - start);
  return { start, end, span };
};

const resolveNiceTimeStepSeconds = (roughStepSeconds: number) => {
  if (!Number.isFinite(roughStepSeconds) || roughStepSeconds <= 0) return 0.1;
  const exponent = Math.floor(Math.log10(roughStepSeconds));
  const magnitude = 10 ** exponent;
  const normalized = roughStepSeconds / magnitude;
  if (normalized <= 1) return 1 * magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
};

export const buildTimelineTimeTicksSeconds = (
  durationSeconds: number,
  graphWidth: number
) => {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [0];

  const maxTicksFromWidth = Math.max(
    2,
    Math.floor(graphWidth / MIN_TIME_LABEL_SPACING_PX) + 1
  );
  const targetTickCount = Math.min(MAX_TIME_TICKS, maxTicksFromWidth);
  const roughStep = durationSeconds / Math.max(1, targetTickCount - 1);
  const step = resolveNiceTimeStepSeconds(roughStep);

  const ticks: number[] = [];
  for (let tick = 0; tick <= durationSeconds + 1e-9; tick += step) {
    ticks.push(Number(tick.toFixed(6)));
    if (ticks.length > 512) break;
  }

  const lastTick = ticks[ticks.length - 1] ?? 0;
  if (durationSeconds - lastTick > step * 0.25) {
    ticks.push(durationSeconds);
  } else {
    ticks[ticks.length - 1] = durationSeconds;
  }

  if (ticks[0] !== 0) {
    ticks.unshift(0);
  }
  return ticks;
};

export const formatTimelineTickLabel = (seconds: number, durationSeconds: number) => {
  if (durationSeconds >= 120) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  }
  if (durationSeconds >= 10) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${seconds.toFixed(2)}s`;
};

export const resolvePaddedChartValueRange = (
  range: { min: number; max: number } | null | undefined
): ChartValueRange | null => {
  if (
    !range ||
    !Number.isFinite(range.min) ||
    !Number.isFinite(range.max)
  ) {
    return null;
  }

  const rawMin = Math.min(range.min, range.max);
  const rawMax = Math.max(range.min, range.max);
  const rawSpan = rawMax - rawMin;
  const padding =
    rawSpan > 0
      ? rawSpan * CHART_VALUE_RANGE_PADDING_RATIO
      : CHART_VALUE_RANGE_FALLBACK_PADDING;
  const min = rawMin - padding;
  const max = rawMax + padding;
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) {
    return null;
  }
  return { min, max, span };
};

export const resolveCombinedChartValueRange = ({
  signalNames,
  ranges,
}: {
  signalNames: string[];
  ranges: Record<string, { min: number; max: number }>;
}): ChartValueRange | null => {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  signalNames.forEach((signalName) => {
    const range = ranges[signalName];
    if (
      !range ||
      !Number.isFinite(range.min) ||
      !Number.isFinite(range.max)
    ) {
      return;
    }
    min = Math.min(min, range.min, range.max);
    max = Math.max(max, range.min, range.max);
  });

  if (min === Number.POSITIVE_INFINITY || max === Number.NEGATIVE_INFINITY) {
    return null;
  }
  return resolvePaddedChartValueRange({ min, max });
};

export const normalizeChartValue = (
  value: number,
  range: ChartValueRange
) => (value - range.min) / range.span;

const formatNumericAxisTick = (value: number) => {
  if (Math.abs(value) <= Y_AXIS_PI_SNAP_EPSILON) {
    return "0";
  }
  const fixed = value.toFixed(Y_AXIS_NUMERIC_PRECISION_DIGITS);
  return fixed.replace(/\.?0+$/, "");
};

export const formatJointPositionYAxisTick = ({
  value,
  unitLabel,
}: {
  value: number;
  unitLabel: string;
}) => {
  if (unitLabel === "rad") {
    const piRatio = value / Math.PI;
    const nearestInteger = Math.round(piRatio);
    if (Math.abs(piRatio - nearestInteger) <= Y_AXIS_PI_SNAP_EPSILON) {
      if (nearestInteger === 0) return "0";
      if (nearestInteger === 1) return "pi";
      if (nearestInteger === -1) return "-pi";
      return `${nearestInteger}pi`;
    }

    const nearestHalf = Math.round(piRatio * 2) / 2;
    if (Math.abs(piRatio - nearestHalf) <= Y_AXIS_PI_SNAP_EPSILON) {
      if (nearestHalf === 0) return "0";
      const numerator = Math.round(nearestHalf * 2);
      if (numerator === 1) return "pi/2";
      if (numerator === -1) return "-pi/2";
      return `${numerator}pi/2`;
    }
  }

  if (unitLabel === "deg") {
    return `${formatNumericAxisTick(value)}deg`;
  }

  return formatNumericAxisTick(value);
};

export const buildJointPositionYAxisTicks = ({
  range,
  unitLabel,
}: {
  range: ChartValueRange;
  unitLabel: string;
}) => {
  if (unitLabel === "rad") {
    const firstMultiple = Math.ceil(range.min / Math.PI);
    const lastMultiple = Math.floor(range.max / Math.PI);
    const multipleCount = lastMultiple - firstMultiple + 1;
    if (
      multipleCount >= 2 &&
      multipleCount <= Y_AXIS_PI_TICK_MULTIPLE_LIMIT * 2 + 1
    ) {
      return Array.from({ length: multipleCount }, (_, index) => {
        const value = (firstMultiple + index) * Math.PI;
        return {
          value,
          label: formatJointPositionYAxisTick({ value, unitLabel }),
        };
      });
    }
  }

  const step = range.span / Math.max(1, Y_AXIS_MAX_NUMERIC_TICK_COUNT - 1);
  return Array.from({ length: Y_AXIS_MAX_NUMERIC_TICK_COUNT }, (_, index) => {
    const value =
      index === Y_AXIS_MAX_NUMERIC_TICK_COUNT - 1
        ? range.max
        : range.min + step * index;
    return {
      value,
      label: formatJointPositionYAxisTick({ value, unitLabel }),
    };
  });
};

export const analyzeTimestampSeries = (frames: RecordedFrame[]) => {
  if (!frames || frames.length < 2) {
    return {
      nonMonotonic: false,
      zeroOrNegativeCount: 0,
      minDtMs: 0,
      maxDtMs: 0,
    };
  }

  let prev = frames[0].timestamp ?? 0;
  let zeroOrNegativeCount = 0;
  let minDtMs = Number.POSITIVE_INFINITY;
  let maxDtMs = 0;

  for (let i = 1; i < frames.length; i += 1) {
    const current = frames[i].timestamp ?? prev;
    const dt = current - prev;
    if (!Number.isFinite(dt)) {
      zeroOrNegativeCount += 1;
    } else {
      if (dt <= 0) {
        zeroOrNegativeCount += 1;
      }
      minDtMs = Math.min(minDtMs, dt);
      maxDtMs = Math.max(maxDtMs, dt);
    }
    prev = current;
  }

  return {
    nonMonotonic: zeroOrNegativeCount > 0,
    zeroOrNegativeCount,
    minDtMs: minDtMs === Number.POSITIVE_INFINITY ? 0 : minDtMs,
    maxDtMs,
  };
};

export type VelocityViolation = {
  frameIndex: number;
  jointName: string;
  ratio: number;
  velocity: number;
};

export const computeVelocityViolations = (
  frames: RecordedFrame[],
  jointLimits?: JointLimits
): VelocityViolation[] => {
  if (!frames || frames.length < 2 || !jointLimits) return [];
  const velocityLimits = new Map<string, number>();
  Object.entries(jointLimits).forEach(([jointName, info]) => {
    if (!info) return;
    const limit = info.velocity;
    if (Number.isFinite(limit) && (limit as number) > 0) {
      velocityLimits.set(jointName, limit as number);
    }
  });
  if (velocityLimits.size === 0) return [];

  const violations: VelocityViolation[] = [];
  for (let i = 1; i < frames.length; i += 1) {
    const prev = frames[i - 1];
    const current = frames[i];
    const dtMs = current.timestamp - prev.timestamp;
    if (!Number.isFinite(dtMs) || dtMs <= 0) continue;
    const dt = dtMs / 1000;
    let bestJoint = "";
    let bestRatio = 0;
    let bestVelocity = 0;

    velocityLimits.forEach((limit, jointName) => {
      const prevValue = prev.jointPositions[jointName];
      const currValue = current.jointPositions[jointName];
      if (!Number.isFinite(prevValue) || !Number.isFinite(currValue)) return;
      const velocity = Math.abs(currValue - prevValue) / dt;
      const ratio = velocity / limit;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestJoint = jointName;
        bestVelocity = velocity;
      }
    });

    if (bestRatio > 1 + VELOCITY_LIMIT_TOLERANCE && bestJoint) {
      violations.push({
        frameIndex: i,
        jointName: bestJoint,
        ratio: bestRatio,
        velocity: bestVelocity,
      });
    }
  }

  return violations;
};

const resolveClosestFrameIndexByTime = (frames: RecordedFrame[], targetTime: number) => {
  if (!frames || frames.length === 0) return 0;
  const { start, end } = getTimeBounds(frames);
  if (targetTime <= start) return 0;
  if (targetTime >= end) return frames.length - 1;

  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (frames[mid].timestamp < targetTime) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const upper = low;
  const lower = Math.max(0, upper - 1);
  const lowerTime = frames[lower].timestamp;
  const upperTime = frames[upper].timestamp;
  return Math.abs(targetTime - lowerTime) <= Math.abs(upperTime - targetTime)
    ? lower
    : upper;
};

// Like resolveFrameX but accepts a continuous time value (ms) instead of an
// integer frame index. Used to draw the playback cursor at sub-frame precision.
export const resolveTimeX = (frames: RecordedFrame[], timeMs: number, graphWidth: number) => {
  if (!frames || frames.length <= 1 || graphWidth <= 0) {
    return CANVAS_PADDING;
  }
  const { start, span } = getTimeBounds(frames);
  if (span <= 0) return CANVAS_PADDING;
  const normalized = Math.max(0, Math.min(1, (timeMs - start) / span));
  return CANVAS_PADDING + graphWidth * normalized;
};

export const resolvePlaybackCursorTimeMs = ({
  frames,
  playbackTimeMs,
  lastPlaybackEventAtMs,
  nowMs,
  playbackSpeed,
  isPlaying,
  fallbackFrameIndex = 0,
  previousCursorTimeMs,
}: {
  frames: RecordedFrame[];
  playbackTimeMs: number;
  lastPlaybackEventAtMs: number;
  nowMs: number;
  playbackSpeed: number;
  isPlaying: boolean;
  fallbackFrameIndex?: number;
  previousCursorTimeMs?: number;
}) => {
  if (!frames || frames.length === 0) return 0;

  const { start, end } = getTimeBounds(frames);
  const normalizedFallbackFrame = Number.isFinite(fallbackFrameIndex)
    ? Math.max(0, Math.min(Math.floor(fallbackFrameIndex), frames.length - 1))
    : 0;
  const fallbackTime = frames[normalizedFallbackFrame]?.timestamp ?? start;
  const baseTime = Number.isFinite(playbackTimeMs) ? playbackTimeMs : fallbackTime;
  const clampedBaseTime = Math.max(start, Math.min(baseTime, end));

  let resolvedTime = clampedBaseTime;

  if (
    !isPlaying ||
    !Number.isFinite(lastPlaybackEventAtMs) ||
    !Number.isFinite(nowMs)
  ) {
    return resolvedTime;
  }

  const safePlaybackSpeed =
    Number.isFinite(playbackSpeed) && playbackSpeed > 0 ? playbackSpeed : 0;
  const elapsedMs = Math.max(0, nowMs - lastPlaybackEventAtMs);
  resolvedTime = Math.max(
    start,
    Math.min(clampedBaseTime + elapsedMs * safePlaybackSpeed, end)
  );

  if (Number.isFinite(previousCursorTimeMs)) {
    return Math.max(
      resolvedTime,
      Math.max(start, Math.min(previousCursorTimeMs, end))
    );
  }
  return resolvedTime;
};

export const resolveFrameX = (frames: RecordedFrame[], frameIndex: number, graphWidth: number) => {
  if (!frames || frames.length <= 1 || graphWidth <= 0) {
    return CANVAS_PADDING;
  }
  const safeIndex = Math.max(0, Math.min(frameIndex, frames.length - 1));
  const { start, span } = getTimeBounds(frames);
  if (span <= 0) {
    return CANVAS_PADDING + (graphWidth * safeIndex) / (frames.length - 1);
  }
  const frameTime = frames[safeIndex]?.timestamp ?? start;
  const normalized = Math.max(0, Math.min(1, (frameTime - start) / span));
  return CANVAS_PADDING + graphWidth * normalized;
};

export const resolveFrameTimeOffsetSec = (frames: RecordedFrame[], frameIndex: number) => {
  if (!frames || frames.length === 0) return 0;
  const clampedIndex = Math.max(0, Math.min(frameIndex, frames.length - 1));
  const start = frames[0]?.timestamp ?? 0;
  const current = frames[clampedIndex]?.timestamp ?? start;
  const delta = current - start;
  return Number.isFinite(delta) ? Math.max(0, delta / 1000) : 0;
};

export const resolveFrameIndexFromTimeOffset = (
  frames: RecordedFrame[],
  offsetSeconds: number
) => {
  if (!frames || frames.length === 0) return 0;
  const start = frames[0]?.timestamp ?? 0;
  const end = frames[frames.length - 1]?.timestamp ?? start;
  const duration = Math.max(0, end - start);
  const clampedOffsetMs = Math.max(0, Math.min(offsetSeconds * 1000, duration));
  const targetTime = start + clampedOffsetMs;
  return resolveClosestFrameIndexByTime(frames, targetTime);
};

const resolveFrameIndexFromX = (
  frames: RecordedFrame[],
  mouseX: number,
  graphWidth: number
) => {
  if (!frames || frames.length === 0 || graphWidth <= 0) return 0;
  const clampedX = Math.max(CANVAS_PADDING, Math.min(CANVAS_PADDING + graphWidth, mouseX));
  const { start, span } = getTimeBounds(frames);
  if (span <= 0) {
    const normalizedX = (clampedX - CANVAS_PADDING) / graphWidth;
    const index = Math.round(normalizedX * (frames.length - 1));
    return Math.max(0, Math.min(index, frames.length - 1));
  }
  const normalizedX = (clampedX - CANVAS_PADDING) / graphWidth;
  const targetTime = start + normalizedX * span;
  return resolveClosestFrameIndexByTime(frames, targetTime);
};

export const resolveMsPerPx = (frames: RecordedFrame[], graphWidth: number) => {
  if (!frames || frames.length <= 1 || graphWidth <= 0) return 1;
  const { span } = getTimeBounds(frames);
  if (span > 0) return span / graphWidth;
  return (frames.length - 1) / graphWidth;
};

// Helper to calculate frame from mouse position
export const calculateFrameFromMouse = (
  mouseX: number,
  canvasWidth: number,
  frames: RecordedFrame[]
): number => {
  const graphWidth = canvasWidth - CANVAS_PADDING * 2;
  return resolveFrameIndexFromX(frames, mouseX, graphWidth);
};

// Helper to update frame in 3D viewer (for timeline scrubbing)
// This does NOT reload the episode, just sets the frame and ensures playback is stopped
// NOTE: We only call viewer3dStopAnimation, NOT viewer3dPlayAnimation(false)
// because the parent's onSetGlobalFrame will call stopAllPlayback() which clears frames,
// and calling viewer3dPlayAnimation with cleared frames would trigger "upload data first" error
export const updateViewerFrame = (frame: number) => {
  viewerPlayback.setFrame(frame);
  viewerPlayback.stopAnimation();
};

type EpisodeViewerFrameSelectionHandlers = {
  setCurrentFrame: (frame: number) => void;
  setGlobalFrame?: (frame: number) => void;
  setPreservedFrame: (frame: number) => void;
  updateFrame: (frame: number) => void;
};

export const applyEpisodeViewerFrameSelection = (
  frame: number,
  handlers: EpisodeViewerFrameSelectionHandlers
) => {
  const candidateFrame = Number.isFinite(frame)
    ? Math.floor(frame)
    : EPISODE_EDITOR_INITIAL_FRAME_INDEX;
  const selectedFrame = Math.max(
    EPISODE_EDITOR_INITIAL_FRAME_INDEX,
    candidateFrame
  );
  handlers.updateFrame(selectedFrame);
  handlers.setCurrentFrame(selectedFrame);
  handlers.setPreservedFrame(selectedFrame);
  handlers.setGlobalFrame?.(selectedFrame);
  return selectedFrame;
};

export const computeEffectiveFps = (candidate?: Episode | null) => {
  if (!candidate || candidate.frames.length < 2) return 0;
  const durationMs =
    candidate.frames[candidate.frames.length - 1].timestamp -
    candidate.frames[0].timestamp;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return (candidate.frames.length - 1) / (durationMs / 1000);
};

export const computeRecordedFps = (candidate?: Episode | null) => {
  if (!candidate) return 0;
  const metaFps = candidate.metadata?.fps;
  if (Number.isFinite(metaFps) && metaFps > 0) {
    return metaFps;
  }
  return computeEffectiveFps(candidate);
};

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const medianFilter = (values: number[], radius = 1) => {
  if (values.length === 0 || radius <= 0) return values.slice();
  const output = new Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - radius);
    const end = Math.min(values.length - 1, i + radius);
    const window: number[] = [];
    for (let j = start; j <= end; j += 1) {
      window.push(values[j]);
    }
    window.sort((a, b) => a - b);
    output[i] = window[Math.floor(window.length / 2)];
  }
  return output;
};

const resolveSmoothingTau = (fps: number, strength = 6) => {
  if (!Number.isFinite(fps) || fps <= 0) return 0.2;
  const frameDt = 1 / fps;
  return clampNumber(frameDt * strength, 0.06, 0.6);
};

const lowPassFilter = (
  values: number[],
  timestamps: number[],
  tau: number,
  defaultDt: number
) => {
  if (values.length < 2 || tau <= 0) return values.slice();
  const output = new Array(values.length);
  output[0] = values[0];
  for (let i = 1; i < values.length; i += 1) {
    const rawDt = Math.abs((timestamps[i] - timestamps[i - 1]) / 1000);
    const dt = Number.isFinite(rawDt) && rawDt > 0 ? rawDt : defaultDt;
    const alpha = clampNumber(1 - Math.exp(-dt / tau), 0.02, 0.9);
    output[i] = output[i - 1] + alpha * (values[i] - output[i - 1]);
  }
  return output;
};

const forwardBackwardLowPass = (
  values: number[],
  timestamps: number[],
  tau: number,
  defaultDt: number
) => {
  const forward = lowPassFilter(values, timestamps, tau, defaultDt);
  const reversedValues = forward.slice().reverse();
  const reversedTimes = timestamps.slice().reverse();
  const backward = lowPassFilter(reversedValues, reversedTimes, tau, defaultDt);
  return backward.reverse();
};

export const smoothSeriesTemporal = (
  values: number[],
  timestamps: number[],
  fps: number,
  rangeMin: number,
  rangeMax: number,
  strength = 6
) => {
  if (values.length < 3) return values.slice();
  const defaultDt = Number.isFinite(fps) && fps > 0 ? 1 / fps : 1 / 30;
  const tau = resolveSmoothingTau(fps, strength);
  const cleaned = medianFilter(values, 1);
  let smoothed = forwardBackwardLowPass(cleaned, timestamps, tau, defaultDt);

  if (Number.isFinite(rangeMin) && Number.isFinite(rangeMax) && rangeMax > rangeMin) {
    smoothed = smoothed.map((value) => clampNumber(value, rangeMin, rangeMax));
  }

  smoothed[0] = values[0];
  smoothed[smoothed.length - 1] = values[values.length - 1];
  return smoothed;
};

const clampSeriesToVelocity = (
  values: number[],
  timestamps: number[],
  velocityLimit: number
) => {
  if (!Number.isFinite(velocityLimit) || velocityLimit <= 0 || values.length < 2) {
    return values.slice();
  }
  const output = values.slice();
  for (let i = 1; i < output.length; i += 1) {
    const dt = (timestamps[i] - timestamps[i - 1]) / 1000;
    if (!Number.isFinite(dt) || dt <= 0) continue;
    const maxStep = velocityLimit * dt;
    const delta = output[i] - output[i - 1];
    if (Math.abs(delta) > maxStep) {
      output[i] = output[i - 1] + Math.sign(delta) * maxStep;
    }
  }
  for (let i = output.length - 2; i >= 0; i -= 1) {
    const dt = (timestamps[i + 1] - timestamps[i]) / 1000;
    if (!Number.isFinite(dt) || dt <= 0) continue;
    const maxStep = velocityLimit * dt;
    const delta = output[i] - output[i + 1];
    if (Math.abs(delta) > maxStep) {
      output[i] = output[i + 1] + Math.sign(delta) * maxStep;
    }
  }
  return output;
};

export const enforceJointConstraints = (
  values: number[],
  frames: RecordedFrame[],
  jointName: string,
  jointLimits?: JointLimits
) => {
  if (!jointLimits) return values;
  const limitInfo = jointLimits[jointName];
  if (!limitInfo) return values;

  const { lower, upper } = getJointLimits(jointLimits, jointName);
  const timestamps = frames.map((frame) => frame.timestamp);
  let next = values.map((value) => clampNumber(value, lower, upper));

  const velocityLimit = limitInfo.velocity ?? null;
  if (Number.isFinite(velocityLimit) && (velocityLimit as number) > 0) {
    next = clampSeriesToVelocity(next, timestamps, velocityLimit as number);
    next = next.map((value) => clampNumber(value, lower, upper));
  }

  return next;
};

const clampJointSeriesRangeToVelocity = ({
  values,
  frames,
  startIndex,
  endIndex,
  velocityLimit,
}: {
  values: number[];
  frames: RecordedFrame[];
  startIndex: number;
  endIndex: number;
  velocityLimit: number;
}) => {
  const next = [...values];
  for (let index = startIndex; index <= endIndex; index += 1) {
    const previousIndex = index - 1;
    if (previousIndex < 0) continue;
    const dtSeconds = (frames[index].timestamp - frames[previousIndex].timestamp) / 1000;
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) continue;
    const maxStep = velocityLimit * dtSeconds;
    const delta = next[index] - next[previousIndex];
    if (Math.abs(delta) > maxStep) {
      next[index] = next[previousIndex] + Math.sign(delta) * maxStep;
    }
  }
  for (let index = endIndex; index >= startIndex; index -= 1) {
    const followingIndex = index + 1;
    if (followingIndex >= next.length) continue;
    const dtSeconds = (frames[followingIndex].timestamp - frames[index].timestamp) / 1000;
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) continue;
    const maxStep = velocityLimit * dtSeconds;
    const delta = next[index] - next[followingIndex];
    if (Math.abs(delta) > maxStep) {
      next[index] = next[followingIndex] + Math.sign(delta) * maxStep;
    }
  }
  return next;
};

export const applyConstraintsToFrameRange = ({
  frames,
  jointNames,
  jointLimits,
  startIndex,
  endIndex,
}: {
  frames: RecordedFrame[];
  jointNames: string[];
  jointLimits?: JointLimits;
  startIndex: number;
  endIndex: number;
}) => {
  if (!jointLimits || jointNames.length === 0 || frames.length === 0) {
    return frames;
  }

  const clampedStartIndex = Math.max(0, Math.min(startIndex, frames.length - 1));
  const clampedEndIndex = Math.max(clampedStartIndex, Math.min(endIndex, frames.length - 1));
  const constrainedByJoint = new Map<string, number[]>();

  jointNames.forEach((jointName) => {
    const limitInfo = jointLimits[jointName];
    if (!limitInfo) return;

    const { lower, upper } = getJointLimits(jointLimits, jointName);
    let nextValues = frames.map((frame) =>
      clampNumber(frame.jointPositions[jointName] ?? 0, lower, upper)
    );
    const velocityLimit = limitInfo.velocity ?? null;
    if (Number.isFinite(velocityLimit) && (velocityLimit as number) > 0) {
      nextValues = clampJointSeriesRangeToVelocity({
        values: nextValues,
        frames,
        startIndex: clampedStartIndex,
        endIndex: clampedEndIndex,
        velocityLimit: velocityLimit as number,
      }).map((value) => clampNumber(value, lower, upper));
    }
    constrainedByJoint.set(jointName, nextValues);
  });

  if (constrainedByJoint.size === 0) {
    return frames;
  }

  return frames.map((frame, index) => {
    if (index < clampedStartIndex || index > clampedEndIndex) {
      return frame;
    }
    const nextPositions = { ...frame.jointPositions };
    constrainedByJoint.forEach((values, jointName) => {
      nextPositions[jointName] = values[index];
    });
    return {
      ...frame,
      jointPositions: nextPositions,
    };
  });
};

export const applyConstraintsToFrames = (
  frames: RecordedFrame[],
  jointNames: string[],
  jointLimits?: JointLimits
) => {
  if (!jointLimits || jointNames.length === 0 || frames.length === 0) {
    return frames;
  }

  const constrainedByJoint = new Map<string, number[]>();
  jointNames.forEach((jointName) => {
    if (!jointLimits[jointName]) {
      return;
    }
    const values = frames.map((frame) => frame.jointPositions[jointName] ?? 0);
    const constrained = enforceJointConstraints(values, frames, jointName, jointLimits);
    constrainedByJoint.set(jointName, constrained);
  });

  if (constrainedByJoint.size === 0) {
    return frames;
  }

  return frames.map((frame, index) => {
    const nextPositions = { ...frame.jointPositions };
    constrainedByJoint.forEach((values, jointName) => {
      nextPositions[jointName] = values[index];
    });
    return {
      ...frame,
      jointPositions: nextPositions,
    };
  });
};

// Helper to smooth curve around a point using Catmull-Rom spline
const smoothCurveAroundPoint = (
  values: number[],
  pointIndex: number,
  newValue: number,
  influenceRadius: number = 3
): number[] => {
  const result = [...values];
  result[pointIndex] = newValue;
  
  // Apply smoothing to nearby points
  const start = Math.max(0, pointIndex - influenceRadius);
  const end = Math.min(values.length - 1, pointIndex + influenceRadius);
  
  for (let i = start; i <= end; i++) {
    if (i === pointIndex) continue;
    
    const distance = Math.abs(i - pointIndex);
    const influence = 1 - (distance / influenceRadius);
    
    if (influence > 0) {
      // Interpolate between original and new value based on distance
      const original = values[i];
      const target = newValue;
      result[i] = original + (target - original) * influence * 0.3; // 0.3 is smoothing factor
    }
  }
  
  return result;
};

// Bezier curve interpolation helper
const bezierInterpolate = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  
  return uuu * p0 + 3 * uu * t * p1 + 3 * u * tt * p2 + ttt * p3;
};

// Apply Bezier curve interpolation using tangent handles
// Handles control the curve shape through their time offset and value
export const applyBezierCurve = (
  values: number[],
  pointIndex: number,
  leftHandle: { timeOffset: number; value: number } | null,
  rightHandle: { timeOffset: number; value: number } | null,
  frames: RecordedFrame[],
  minVal: number,
  maxVal: number
): number[] => {
  const result = [...values];
  
  if (leftHandle === null && rightHandle === null) {
    return result; // No handles, return unchanged
  }
  
  const currentValue = values[pointIndex];
  const pointTime = frames[pointIndex]?.timestamp ?? 0;
  const timeSpan =
    frames.length > 1
      ? (frames[frames.length - 1].timestamp ?? 0) - (frames[0].timestamp ?? 0)
      : 0;
  const avgDt = frames.length > 1 ? timeSpan / (frames.length - 1) : 0;
  const baseSpanMs = avgDt > 0 ? avgDt * 3 : 1;
  
  const leftSpan = leftHandle ? Math.max(baseSpanMs, Math.abs(leftHandle.timeOffset)) : baseSpanMs;
  const rightSpan = rightHandle ? Math.max(baseSpanMs, Math.abs(rightHandle.timeOffset)) : baseSpanMs;

  let prevAnchorIndex = pointIndex;
  let nextAnchorIndex = pointIndex;
  if (timeSpan > 0) {
    while (
      prevAnchorIndex > 0 &&
      pointTime - (frames[prevAnchorIndex - 1]?.timestamp ?? pointTime) <= leftSpan
    ) {
      prevAnchorIndex -= 1;
    }
    while (
      nextAnchorIndex < values.length - 1 &&
      (frames[nextAnchorIndex + 1]?.timestamp ?? pointTime) - pointTime <= rightSpan
    ) {
      nextAnchorIndex += 1;
    }
  } else {
    prevAnchorIndex = Math.max(0, pointIndex - 3);
    nextAnchorIndex = Math.min(values.length - 1, pointIndex + 3);
  }

  const start = prevAnchorIndex;
  const end = nextAnchorIndex;
  
  // Get neighboring anchor points
  const prevAnchorValue = values[prevAnchorIndex];
  const nextAnchorValue = values[nextAnchorIndex];
  
  // Calculate handle strength based on time span (longer = stronger influence)
  const leftStrength = leftHandle
    ? Math.min(1.0, Math.abs(leftHandle.timeOffset) / (baseSpanMs * 3))
    : 0;
  const rightStrength = rightHandle
    ? Math.min(1.0, Math.abs(rightHandle.timeOffset) / (baseSpanMs * 3))
    : 0;
  
  // Apply Bezier interpolation
  for (let i = start; i <= end; i++) {
    if (i === pointIndex) {
      result[i] = currentValue; // Keep the main point value unchanged
      continue;
    }
    
    // Calculate normalized position (0 to 1) relative to the selected point
    let t: number;
    if (i < pointIndex) {
      // Before the point - use left handle
      if (leftHandle && leftStrength > 0) {
        const startTime = frames[prevAnchorIndex]?.timestamp ?? pointTime;
        const denom = pointTime - startTime;
        if (denom > 0) {
          t = ((frames[i]?.timestamp ?? pointTime) - startTime) / denom;
        } else {
          const segmentLength = pointIndex - prevAnchorIndex;
          t = segmentLength > 0 ? (i - prevAnchorIndex) / segmentLength : 0;
        }
        t = Math.max(0, Math.min(1, t));
        
        // Calculate the control point value based on handle
        // The handle's value represents the tangent direction
        const handleInfluence = leftStrength;
        const controlValue = currentValue + (leftHandle.value - currentValue) * handleInfluence;
        
        // Bezier curve: prevAnchor -> controlValue -> currentPoint
        result[i] = clampNumber(bezierInterpolate(
          prevAnchorValue,
          controlValue,
          currentValue,
          currentValue,
          t
        ), minVal, maxVal);
      }
    } else {
      // After the point - use right handle
      if (rightHandle && rightStrength > 0) {
        const endTime = frames[nextAnchorIndex]?.timestamp ?? pointTime;
        const denom = endTime - pointTime;
        if (denom > 0) {
          t = ((frames[i]?.timestamp ?? pointTime) - pointTime) / denom;
        } else {
          const segmentLength = nextAnchorIndex - pointIndex;
          t = segmentLength > 0 ? (i - pointIndex) / segmentLength : 0;
        }
        t = Math.max(0, Math.min(1, t));
        
        // Calculate the control point value based on handle
        const handleInfluence = rightStrength;
        const controlValue = currentValue + (rightHandle.value - currentValue) * handleInfluence;
        
        // Bezier curve: currentPoint -> controlValue -> nextAnchor
        result[i] = clampNumber(bezierInterpolate(
          currentValue,
          controlValue,
          nextAnchorValue,
          nextAnchorValue,
          t
        ), minVal, maxVal);
      }
    }
  }
  
  return result;
};

// Helper to find closest point on a curve
export const findClosestPointOnCurve = (
  mouseX: number,
  mouseY: number,
  frames: RecordedFrame[],
  jointName: string,
  jointRange: { min: number; max: number },
  canvasWidth: number,
  canvasHeight: number,
  resolveValue?: (frame: RecordedFrame, frameIndex: number) => number | null,
  chartValueRange?: ChartValueRange | null
): number | null => {
  const graphWidth = canvasWidth - CANVAS_PADDING * 2;
  const graphHeight = canvasHeight - CANVAS_PADDING * 2;
  const valueRange = chartValueRange ?? resolvePaddedChartValueRange(jointRange);
  if (!valueRange) return null;
  
  let closestIndex: number | null = null;
  let minDistance = Infinity;
  const pointSelectionRadius = CURVE_POINT_SELECTION_RADIUS_PX;
  
  frames.forEach((frame, frameIndex) => {
    const value = resolveValue
      ? resolveValue(frame, frameIndex)
      : frame.jointPositions[jointName];
    if (!Number.isFinite(value)) return;
    const x = resolveFrameX(frames, frameIndex, graphWidth);
    const normalizedValue = normalizeChartValue(value, valueRange);
    const y = canvasHeight - CANVAS_PADDING - graphHeight * normalizedValue;
    
    const distance = Math.sqrt(
      Math.pow(mouseX - x, 2) + Math.pow(mouseY - y, 2)
    );
    
    if (distance < pointSelectionRadius && distance < minDistance) {
      minDistance = distance;
      closestIndex = frameIndex;
    }
  });
  
  return closestIndex;
};
