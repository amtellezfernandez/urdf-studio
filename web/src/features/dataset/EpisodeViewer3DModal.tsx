import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import {
  GripHorizontal,
  ChevronDown,
  Save,
  Sparkles,
  Undo2,
  Redo2,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Scissors,
} from "lucide-react";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { cn } from "@/shared/lib/utils";
import { NumberInput } from "@/shared/ui/number-input";
import { useJointStore } from "@/shared/store/useJointStore";
import {
  applyJointDataZeroOffset,
  removeJointDataZeroOffset,
} from "@/shared/lib/jointDataZero";
import { useViewerPlaybackStore } from "@/shared/store/useViewerPlaybackStore";
import { viewerPlayback } from "@/features/viewer/playback/viewerPlayback";
import {
  applyJointLimitCorrectionsToFrames,
  computeJointLimitViolations,
  resolveEpisodeJointNames,
  resolveEpisodeSignalCatalogNames,
  summarizeJointLimitCorrections,
  toAnimationFrames,
  type Episode,
  type RecordedFrame,
} from "@/features/dataset";
import { applyJointValues } from "@/shared/lib/urdf-joints";
import {
  cloneRobotBasePose,
  hasMeaningfulRobotBasePoseDelta,
  interpolateRobotBasePose,
} from "@/shared/lib/robotBasePose";
import type { URDFRobot } from "urdf-loader";
import { Box3 } from "three";
import type * as THREE from "three";
import type { JointLimitMode } from "@/shared/types/feature";
import { resolveEpisodeSignalDisplayRows } from "@/features/dataset/episodeSignalDisplay";
import { applyRobotBasePose } from "@/features/viewer/viewer-helpers";
import {
  CANVAS_PADDING,
  CONSTRAINT_EPS,
  CONSTRAINT_SCAN_BATCH,
  CONSTRAINT_SCAN_PROGRESS_UPDATES_TARGET,
  DEFAULT_EPISODE_VIEWER_CONSTRAINT_SETTINGS,
  DRAG_THRESHOLD,
  EMPTY_FRAME_SET,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  TIMELINE_HEADER_HEIGHT,
  TIME_TICK_LABEL_GAP_PX,
  TIME_TICK_LABEL_Y_OFFSET_PX,
  VELOCITY_LIMIT_TOLERANCE,
  X_AXIS_TITLE_BOTTOM_OFFSET_PX,
  Y_AXIS_FALLBACK_GRID_LINE_COUNT,
  Y_AXIS_TICK_LABEL_GAP_PX,
  Y_AXIS_TICK_MARK_LENGTH_PX,
  Y_AXIS_TITLE_X_OFFSET_PX,
  analyzeTimestampSeries,
  applyEpisodeViewerFrameSelection,
  applyBezierCurve,
  applyConstraintsToFrames,
  applyConstraintsToFrameRange,
  applyEpisodeVideoClipBounds,
  buildJointPositionYAxisTicks,
  calculateFrameFromMouse,
  computeEffectiveFps,
  computeRecordedFps,
  computeVelocityViolations,
  enforceJointConstraints,
  findClosestPointOnCurve,
  getCurrentFrameValue,
  getTimeBounds,
  getEpisodeVideoClipBounds,
  resolveFrameIndexFromTimeOffset,
  resolveFrameTimeOffsetSec,
  resolveFrameX,
  resolveTimeX,
  resolveMsPerPx,
  normalizeChartValue,
  resolveCombinedChartValueRange,
  resolvePaddedChartValueRange,
  updateViewerFrame,
  smoothSeriesTemporal,
  buildTimelineTimeTicksSeconds,
  formatTimelineTickLabel,
  resolvePlaybackCursorTimeMs,
  type AxisKey,
  type EpisodeViewer3DModalProps,
  type RetimeMode,
  type ViolationZone,
} from "@/features/dataset/episode-viewer/modalHelpers";
import { WHEEL_JOINT_NAME_PATTERN } from "@/features/layout/jointRangeParams";
import {
  EPISODE_BASE_SIGNAL_SUGGESTION_ORDER,
  hasDifferentEpisodeSignalMapping,
  isEpisodeBaseSignalName,
  normalizeEpisodeSignalName,
} from "@/features/dataset/episodeJointDisplayParams";
import {
  buildRuntimeJointSeries,
  recordRuntimeJointSeriesFrame,
  resolveRuntimeJointSeriesValue,
} from "@/features/dataset/episode-viewer/runtimeJointSeries";
import {
  DERIVED_BASE_POSE_SIGNAL_NAMES,
  resolveEpisodeFrameSignalValue,
  writeEpisodeFrameSignalValue,
} from "@/features/dataset/episode-viewer/basePoseSignals";
import {
  EPISODE_RECORDED_VIDEO_SYNC_REASON_DELETE_INSIDE,
  EPISODE_RECORDED_VIDEO_SYNC_REASON_DELETE_OUTSIDE,
  EPISODE_RECORDED_VIDEO_SYNC_REASON_LIMIT_FIX,
  EPISODE_RECORDED_VIDEO_SYNC_REASON_RESAMPLE_FPS,
  EPISODE_RECORDED_VIDEO_SYNC_REASON_RETIME,
  EPISODE_RECORDED_VIDEO_SYNC_REASON_SMOOTH,
  EPISODE_RECORDED_VIDEO_SYNC_REASON_TRAJECTORY_EDIT,
  EPISODE_RECORDED_VIDEO_SYNC_STATUS_CLIP_ALIGNED,
  markEpisodeRecordedVideoReferenceOnly,
  markEpisodeRecordedVideoSyncAligned,
  resolveEpisodeRecordedVideoSyncInfo,
  type EpisodeRecordedVideoSyncReason,
} from "@/features/dataset/episodeVideoSync";
import { resolveAutoTrimRange } from "@/features/dataset/episode-viewer/autoTrimRange";
import { resolveEpisodeViewerEditSessionLifecycleAction } from "@/features/dataset/episode-editor/editSessionLifecycle";
import {
  cloneEpisodeForEditing,
  createEmptyEpisodeEditorDraftState,
  createEpisodeEditorDraftState,
} from "@/features/dataset/episode-editor/episodeEditorDraft";
import { EPISODE_EDITOR_INITIAL_FRAME_INDEX } from "@/features/dataset/episode-editor/episodeEditorParams";
import { useEpisodeEditorHistoryState } from "@/features/dataset/episode-editor/useEpisodeEditorHistoryState";
import { EPISODE_VIEWER_MODAL_PARAMS } from "@/features/dataset/episode-viewer/episodeViewerModalParams";
import {
  resolveDatasetEpisodeMjlabValidation,
  resolveDatasetMjlabValidationIssues,
} from "@/features/layout/sidebar/datasetMjlabValidation";
import type { OperatorTeleopMjlabMotionIssue } from "@/features/teleop/recording/operatorTeleopReplayApi";

const RUNTIME_JOINT_ACTIVITY_EPSILON =
  EPISODE_VIEWER_MODAL_PARAMS.runtimeJointActivityEpsilon;
const RUNTIME_RECORDED_MOTION_EPSILON =
  EPISODE_VIEWER_MODAL_PARAMS.runtimeRecordedMotionEpsilon;
const ENABLE_RUNTIME_EPISODE_CURVES =
  EPISODE_VIEWER_MODAL_PARAMS.enableRuntimeEpisodeCurves;
const HIDDEN_EPISODE_SIGNAL_COLOR =
  EPISODE_VIEWER_MODAL_PARAMS.hiddenEpisodeSignalColor;
const CURVE_DOUBLE_CLICK_SELECTION_RADIUS_PX =
  EPISODE_VIEWER_MODAL_PARAMS.curveDoubleClickSelectionRadiusPx;
const CURVE_HANDLE_SELECTION_RADIUS_PX =
  EPISODE_VIEWER_MODAL_PARAMS.curveHandleSelectionRadiusPx;
const EDIT_TOOLBAR_GROUP_CLASS =
  EPISODE_VIEWER_MODAL_PARAMS.editToolbarGroupClass;
const EDIT_TOOLBAR_TEXT_BUTTON_CLASS =
  EPISODE_VIEWER_MODAL_PARAMS.editToolbarTextButtonClass;
const EDIT_TOOLBAR_ICON_BUTTON_CLASS =
  EPISODE_VIEWER_MODAL_PARAMS.editToolbarIconButtonClass;
const EDIT_TOOLBAR_LABEL_CLASS =
  EPISODE_VIEWER_MODAL_PARAMS.editToolbarLabelClass;
const EDIT_TOOLBAR_SECTION_LABEL_CLASS =
  EPISODE_VIEWER_MODAL_PARAMS.editToolbarSectionLabelClass;
const EPISODE_CHANGE_TIMESTAMP_EPSILON_MS =
  EPISODE_VIEWER_MODAL_PARAMS.episodeChangeTimestampEpsilonMs;
const EPISODE_CHANGE_SIGNAL_EPSILON =
  EPISODE_VIEWER_MODAL_PARAMS.episodeChangeSignalEpsilon;
const EPISODE_CHANGE_BASE_TRANSLATION_EPSILON_METERS =
  EPISODE_VIEWER_MODAL_PARAMS.episodeChangeBaseTranslationEpsilonMeters;
const EPISODE_CHANGE_BASE_ROTATION_EPSILON_RAD =
  EPISODE_VIEWER_MODAL_PARAMS.episodeChangeBaseRotationEpsilonRad;
const RETIME_SPEED_IDENTITY_EPSILON =
  EPISODE_VIEWER_MODAL_PARAMS.retimeSpeedIdentityEpsilon;
const DEFAULT_RETIME_BASE_FPS =
  EPISODE_VIEWER_MODAL_PARAMS.defaultRetimeBaseFps;
const MJLAB_ISSUE_MARKER_RADIUS_PX =
  EPISODE_VIEWER_MODAL_PARAMS.mjlabIssueMarkerRadiusPx;
const MJLAB_ISSUE_MARKER_LABEL_OFFSET_X_PX =
  EPISODE_VIEWER_MODAL_PARAMS.mjlabIssueMarkerLabelOffsetXPx;
const MJLAB_ISSUE_MARKER_LABEL_OFFSET_Y_PX =
  EPISODE_VIEWER_MODAL_PARAMS.mjlabIssueMarkerLabelOffsetYPx;
const MJLAB_ISSUE_MARKER_LABEL_MAX_WIDTH_PX =
  EPISODE_VIEWER_MODAL_PARAMS.mjlabIssueMarkerLabelMaxWidthPx;
const MJLAB_ISSUE_MARKER_LABEL_GAP_PX =
  EPISODE_VIEWER_MODAL_PARAMS.mjlabIssueMarkerLabelGapPx;
const MJLAB_ISSUE_MARKER_LABEL_FONT =
  EPISODE_VIEWER_MODAL_PARAMS.mjlabIssueMarkerLabelFont;
const MJLAB_ISSUE_MARKER_VALUE_PRECISION_DIGITS =
  EPISODE_VIEWER_MODAL_PARAMS.mjlabIssueMarkerValuePrecisionDigits;
const MJLAB_ISSUE_MARKER_LIMIT_PRECISION_DIGITS =
  EPISODE_VIEWER_MODAL_PARAMS.mjlabIssueMarkerLimitPrecisionDigits;

type MjlabIssueMarker = OperatorTeleopMjlabMotionIssue & {
  frameIndex: number;
  jointName: string;
  label: string;
};

const resolveJointPositionUnitLabel = (episode: Episode | null | undefined) => {
  const additional = episode?.metadata?.additional;
  const unitToken =
    typeof additional === "object" &&
    additional !== null &&
    !Array.isArray(additional) &&
    typeof additional.joint_value_unit === "string"
      ? additional.joint_value_unit.trim().toLowerCase()
      : "";
  if (unitToken === "deg" || unitToken === "degree" || unitToken === "degrees") {
    return "deg";
  }
  if (unitToken === "rad" || unitToken === "radian" || unitToken === "radians") {
    return "rad";
  }
  if (unitToken.length > 0) {
    return unitToken;
  }
  return "rad";
};

const resolveMjlabIssueLabel = (issue: OperatorTeleopMjlabMotionIssue) => {
  const kind = issue.code.includes("acceleration")
    ? "accel limit"
    : issue.code.includes("velocity")
      ? "vel limit"
      : issue.code === "self_collision"
        ? "self-collision"
        : issue.code === "rejected"
          ? "physics rejected"
          : issue.code.replace(/^joint_/, "").replace(/_/g, " ");
  const measurement =
    issue.code !== "self_collision" &&
    typeof issue.value === "number" &&
    typeof issue.limit === "number"
      ? ` ${issue.value.toFixed(
          MJLAB_ISSUE_MARKER_VALUE_PRECISION_DIGITS
        )}>${issue.limit.toFixed(MJLAB_ISSUE_MARKER_LIMIT_PRECISION_DIGITS)}`
      : "";
  return `${kind}${measurement}`;
};

const buildMjlabIssueMarker = (
  issue: OperatorTeleopMjlabMotionIssue,
  frameCount: number,
  jointName: string
): MjlabIssueMarker | null => {
  if (frameCount <= 0) {
    return null;
  }
  if (!Number.isFinite(issue.sampleIndex) || typeof issue.sampleIndex !== "number") {
    return null;
  }
  const normalizedJointName = jointName.trim();
  if (!normalizedJointName) {
    return null;
  }
  return {
    ...issue,
    frameIndex: Math.max(0, Math.min(Math.trunc(issue.sampleIndex), frameCount - 1)),
    jointName: normalizedJointName,
    label: resolveMjlabIssueLabel(issue),
  };
};

const interpolateFrameJointPositions = (
  frameA: RecordedFrame,
  frameB: RecordedFrame,
  alpha: number
) => {
  const jointNames = new Set([
    ...Object.keys(frameA.jointPositions ?? {}),
    ...Object.keys(frameB.jointPositions ?? {}),
  ]);
  const jointPositions: Record<string, number> = {};
  jointNames.forEach((jointName) => {
    const valueA = frameA.jointPositions[jointName];
    const valueB = frameB.jointPositions[jointName] ?? valueA;
    if (!Number.isFinite(valueA) || !Number.isFinite(valueB)) {
      const fallbackValue = Number.isFinite(valueA)
        ? valueA
        : Number.isFinite(valueB)
          ? valueB
          : null;
      if (fallbackValue !== null) {
        jointPositions[jointName] = fallbackValue;
      }
      return;
    }
    jointPositions[jointName] = valueA + (valueB - valueA) * alpha;
  });
  return jointPositions;
};

const markEpisodeVideoReferenceOnly = (
  episode: Episode,
  reason: EpisodeRecordedVideoSyncReason
): Episode => ({
  ...episode,
  metadata: markEpisodeRecordedVideoReferenceOnly(episode.metadata, { reason }),
});

const markEpisodeVideoClipAligned = (
  episode: Episode,
  reason: EpisodeRecordedVideoSyncReason
): Episode => ({
  ...episode,
  metadata: markEpisodeRecordedVideoSyncAligned(episode.metadata, {
    status: EPISODE_RECORDED_VIDEO_SYNC_STATUS_CLIP_ALIGNED,
    reason,
  }),
});

const resolveEditableEpisode = (
  episode: Episode | null,
  modifiedEpisode: Episode | null,
  isEditMode: boolean
) => (isEditMode && modifiedEpisode ? modifiedEpisode : episode);

const EpisodeViewerDialog = ({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  children?: React.ReactNode;
  footer: React.ReactNode;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {children}
      <DialogFooter>{footer}</DialogFooter>
    </DialogContent>
  </Dialog>
);

export const EpisodeViewer3DModal: React.FC<EpisodeViewer3DModalProps> = ({
  episode,
  open,
  onOpenChange,
  robotBoundingBox,
  robot,
  jointLimits,
  currentEpisodeIndex,
  allEpisodes = [],
  isPlayingAll = false,
  onPlayAllEpisodes,
  onSetCurrentEpisodeIndex,
  globalCurrentFrame,
  onSetGlobalFrame,
  inline = false,
  showOnlyHeader = false,
  onSaveEpisode,
  constraintSettings,
}) => {
  const [currentFrame, setCurrentFrame] = useState(0);
  const [selectedJoints, setSelectedJoints] = useState<Set<string>>(new Set());
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string>("");
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  
  // Edit mode states
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingJoint, setEditingJoint] = useState<string | null>(null);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [isDraggingPoint, setIsDraggingPoint] = useState(false);
  const [modifiedEpisode, setModifiedEpisode] = useState<Episode | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveAsNew, setSaveAsNew] = useState(false);
  const [newEpisodeName, setNewEpisodeName] = useState("");
  const [showExitConfirmDialog, setShowExitConfirmDialog] = useState(false);
  const [trimRange, setTrimRange] = useState<{ start: number | null; end: number | null }>({
    start: null,
    end: null,
  });
  const [retimeScale, setRetimeScale] = useState(1);
  const [retimeFps, setRetimeFps] = useState(0);
  const [retimeMode, setRetimeMode] = useState<RetimeMode>("scale");
  const [smoothingStrength, setSmoothingStrength] = useState(12);
  const [limitFixMode, setLimitFixMode] = useState<JointLimitMode>("report");
  const [violationFrames, setViolationFrames] = useState<number[]>([]);
  const [isConstraintScanRunning, setIsConstraintScanRunning] = useState(false);
  const constraintScanTokenRef = useRef(0);
  const constraintBboxRef = useRef<THREE.Box3 | null | undefined>(robotBoundingBox);
  const constraintRobotCloneRef = useRef<URDFRobot | null>(null);
  const setGlobalFrameRef = useRef(onSetGlobalFrame);
  const currentFrameRef = useRef(currentFrame);
  const globalCurrentFrameRef = useRef(globalCurrentFrame);
  const previousEpisodeIdRef = useRef<string | null>(episode?.id ?? null);
  const selectedPointIndexRef = useRef<number | null>(null);
  const isDraggingPointRef = useRef(false);

  const {
    canUndo,
    canRedo,
    replaceHistoryState,
    initializeHistory,
    appendHistory,
    undoHistory,
    redoHistory,
  } = useEpisodeEditorHistoryState();
  const [lastSaveChoice, setLastSaveChoice] = useState<'overwrite' | 'new' | null>(null);
  const [showSmoothPreviewDialog, setShowSmoothPreviewDialog] = useState(false);
  const [smoothPreviewEpisode, setSmoothPreviewEpisode] = useState<Episode | null>(null);
  const [smoothPreviewSummary, setSmoothPreviewSummary] = useState<{
    violationCount: number;
    maxRatio: number;
    worstJoint: string | null;
    worstTimeSec: number | null;
  } | null>(null);
  
  // Tangent handles state: Map<pointIndex, {left: {timeOffset, value}, right: {timeOffset, value}}>
  // timeOffset is milliseconds relative to the point timestamp, value is the joint value at that handle
  const [tangentHandles, setTangentHandles] = useState<Map<number, {
    left: { timeOffset: number; value: number };
    right: { timeOffset: number; value: number };
  }>>(new Map());
  const [draggingHandle, setDraggingHandle] = useState<{pointIndex: number, side: 'left' | 'right'} | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null);
  const playbackTimeMsRef = useRef<number>(0);
  const lastPlaybackTimeEventAtRef = useRef<number>(Number.NEGATIVE_INFINITY);
  const lastDrawnPlaybackCursorTimeMsRef = useRef<number>(0);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingTimelineRef = useRef<boolean>(false);
  const dragStartPositionRef = useRef<{ x: number; y: number } | null>(null);
  const preservedFrameRef = useRef<number | null>(null);
  const pendingSyncEpisodeRef = useRef<Episode | null>(null);
  const syncRafRef = useRef<number | null>(null);
  const latestModifiedEpisodeRef = useRef<Episode | null>(null);
  const editSessionBaselineRef = useRef<Episode | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const warnedTimestampEpisodeIdRef = useRef<string | null>(null);
  const runtimeJointSeriesRef = useRef<Map<string, number[]>>(new Map());
  const playbackSpeed = useViewerPlaybackStore((state) => state.playbackSpeed);
  const [runtimeJointSeriesVersion, setRuntimeJointSeriesVersion] = useState(0);
  const autoSelectedRuntimeJointNamesRef = useRef<Set<string>>(new Set());
  const setModifiedEpisodeTracked = useCallback((nextEpisode: Episode | null) => {
    latestModifiedEpisodeRef.current = nextEpisode;
    setModifiedEpisode(nextEpisode);
  }, []);
  const effectiveEpisode = resolveEditableEpisode(episode, modifiedEpisode, isEditMode);
  const defaultEditedEpisodeName = `Episode ${
    episode?.number ? episode.number - 1 : allEpisodes.length
  } (edited)`;
  const resetSaveDialogState = useCallback(() => {
    setShowSaveDialog(false);
    setSaveAsNew(false);
    setNewEpisodeName("");
  }, []);
  const resetSaveAsNewDraft = useCallback(() => {
    setSaveAsNew(false);
    setNewEpisodeName("");
  }, []);
  const closeExitConfirmDialog = useCallback(() => {
    setShowExitConfirmDialog(false);
  }, []);
  const resetCurveSelection = useCallback(() => {
    selectedPointIndexRef.current = null;
    isDraggingPointRef.current = false;
    setSelectedPointIndex(null);
    setDraggingHandle(null);
    setTangentHandles(new Map());
  }, []);
  const clearEditingJointSelection = useCallback(() => {
    setEditingJoint(null);
    resetCurveSelection();
  }, [resetCurveSelection]);
  const resetEpisodeEditorChrome = useCallback(() => {
    editSessionBaselineRef.current = null;
    setIsEditMode(false);
    clearEditingJointSelection();
    resetSaveDialogState();
    closeExitConfirmDialog();
    setLastSaveChoice(null);
    autoSelectedRuntimeJointNamesRef.current = new Set();
  }, [clearEditingJointSelection, closeExitConfirmDialog, resetSaveDialogState]);
  const clearEpisodeEditorDraftState = useCallback(() => {
    const draftState = createEmptyEpisodeEditorDraftState();
    setSelectedJoints(draftState.selectedJoints);
    setModifiedEpisodeTracked(draftState.modifiedEpisode);
    replaceHistoryState(draftState);
    resetEpisodeEditorChrome();
  }, [replaceHistoryState, resetEpisodeEditorChrome, setModifiedEpisodeTracked]);
  const refreshEpisodeEditorDraftState = useCallback(
    (nextEpisode: Episode) => {
      const draftState = createEpisodeEditorDraftState(nextEpisode);
      setSelectedJoints(draftState.selectedJoints);
      setModifiedEpisodeTracked(draftState.modifiedEpisode);
      replaceHistoryState(draftState);
    },
    [replaceHistoryState, setModifiedEpisodeTracked]
  );
  const selectEditingJoint = useCallback((jointName: string) => {
    setEditingJoint(jointName);
    resetCurveSelection();
  }, [resetCurveSelection]);
  const openSaveDialog = useCallback(
    (nextSaveAsNew: boolean) => {
      setShowSaveDialog(true);
      setSaveAsNew(nextSaveAsNew);
      setNewEpisodeName(defaultEditedEpisodeName);
    },
    [defaultEditedEpisodeName]
  );
  const setSaveMode = useCallback((nextSaveAsNew: boolean) => {
    setSaveAsNew(nextSaveAsNew);
  }, []);
  const applyFrameSelection = useCallback((frameIndex: number) => {
    applyEpisodeViewerFrameSelection(frameIndex, {
      setCurrentFrame,
      setGlobalFrame: setGlobalFrameRef.current,
      setPreservedFrame: (selectedFrame) => {
        preservedFrameRef.current = selectedFrame;
      },
      updateFrame: updateViewerFrame,
    });
  }, []);
  const resetTrimAndFrame = useCallback((
    nextFrame = EPISODE_EDITOR_INITIAL_FRAME_INDEX
  ) => {
    setTrimRange({ start: null, end: null });
    applyFrameSelection(nextFrame);
  }, [applyFrameSelection]);
  const activeConstraintSettings =
    constraintSettings ?? DEFAULT_EPISODE_VIEWER_CONSTRAINT_SETTINGS;
  const constraintMode = activeConstraintSettings.mode;
  const heightAxis = activeConstraintSettings.heightAxis;
  const heightLimit = activeConstraintSettings.heightLimit;
  const boxMin = activeConstraintSettings.boxMin;
  const boxMax = activeConstraintSettings.boxMax;
  const wallAxis = activeConstraintSettings.wallAxis;
  const wallSide = activeConstraintSettings.wallSide;
  const wallPosition = activeConstraintSettings.wallPosition;

  const getAxisValue = useCallback((vec: THREE.Vector3, axis: AxisKey) => {
    if (axis === "x") return vec.x;
    if (axis === "y") return vec.y;
    return vec.z;
  }, []);

  const constraintSignature = useMemo(() => {
    return JSON.stringify({
      constraintMode,
      heightAxis,
      heightLimit,
      boxMin,
      boxMax,
      wallAxis,
      wallSide,
      wallPosition,
    });
  }, [constraintMode, heightAxis, heightLimit, boxMin, boxMax, wallAxis, wallSide, wallPosition]);

  const checkConstraintViolation = useCallback(
    (bbox?: THREE.Box3 | null) => {
      if (!bbox || bbox.isEmpty() || constraintMode === "none") return false;
      if (constraintMode === "height") {
        const maxValue = getAxisValue(bbox.max, heightAxis);
        return maxValue > heightLimit + CONSTRAINT_EPS;
      }
      if (constraintMode === "box") {
        const outsideMin =
          bbox.min.x < boxMin.x - CONSTRAINT_EPS ||
          bbox.min.y < boxMin.y - CONSTRAINT_EPS ||
          bbox.min.z < boxMin.z - CONSTRAINT_EPS;
        const outsideMax =
          bbox.max.x > boxMax.x + CONSTRAINT_EPS ||
          bbox.max.y > boxMax.y + CONSTRAINT_EPS ||
          bbox.max.z > boxMax.z + CONSTRAINT_EPS;
        return outsideMin || outsideMax;
      }
      if (constraintMode === "wall") {
        const minValue = getAxisValue(bbox.min, wallAxis);
        const maxValue = getAxisValue(bbox.max, wallAxis);
        if (wallSide === "negative") {
          return maxValue > wallPosition + CONSTRAINT_EPS;
        }
        return minValue < wallPosition - CONSTRAINT_EPS;
      }
      return false;
    },
    [
      boxMax.x,
      boxMax.y,
      boxMax.z,
      boxMin.x,
      boxMin.y,
      boxMin.z,
      constraintMode,
      getAxisValue,
      heightAxis,
      heightLimit,
      wallAxis,
      wallPosition,
      wallSide,
    ]
  );

  const waitForNextPaint = useCallback(
    () =>
      new Promise<void>((resolve) => {
        if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
          setTimeout(resolve, 0);
          return;
        }
        window.requestAnimationFrame(() => resolve());
      }),
    []
  );

  useEffect(() => {
    setGlobalFrameRef.current = onSetGlobalFrame;
  }, [onSetGlobalFrame]);

  useEffect(() => {
    currentFrameRef.current = currentFrame;
  }, [currentFrame]);

  useEffect(() => {
    selectedPointIndexRef.current = selectedPointIndex;
  }, [selectedPointIndex]);

  useEffect(() => {
    isDraggingPointRef.current = isDraggingPoint;
  }, [isDraggingPoint]);

  useEffect(() => {
    globalCurrentFrameRef.current = globalCurrentFrame;
  }, [globalCurrentFrame]);

  useEffect(() => {
    constraintBboxRef.current = robotBoundingBox;
  }, [robotBoundingBox]);

  useEffect(() => {
    if (!robot) {
      constraintRobotCloneRef.current = null;
      return;
    }
    try {
      constraintRobotCloneRef.current = robot.clone(true) as URDFRobot;
    } catch {
      constraintRobotCloneRef.current = null;
    }
  }, [robot]);

  useEffect(() => {
    setViolationFrames([]);
  }, [constraintSignature, constraintMode, effectiveEpisode]);

  useEffect(() => {
    if (!open || !effectiveEpisode || constraintMode === "none" || effectiveEpisode.frames.length === 0) {
      constraintScanTokenRef.current += 1;
      setIsConstraintScanRunning(false);
      return;
    }

    const scanToken = constraintScanTokenRef.current + 1;
    constraintScanTokenRef.current = scanToken;
    setIsConstraintScanRunning(true);

    const frameCount = effectiveEpisode.frames.length;
    const robotClone = constraintRobotCloneRef.current;
    const restoreFrame = Math.max(
      0,
      Math.min(
        getCurrentFrameValue(
          preservedFrameRef.current,
          globalCurrentFrameRef.current,
          currentFrameRef.current
        ),
        frameCount - 1
      )
    );
    const matchedFrames: number[] = [];
    let lastPublishedViolationCount = -1;
    const progressBatch = Math.max(
      CONSTRAINT_SCAN_BATCH,
      Math.floor(frameCount / CONSTRAINT_SCAN_PROGRESS_UPDATES_TARGET)
    );
    const scanBox = new Box3();
    const publishMatchedFrames = (force: boolean) => {
      if (!force && matchedFrames.length === lastPublishedViolationCount) return;
      const snapshot = matchedFrames.slice();
      setViolationFrames(snapshot);
      lastPublishedViolationCount = snapshot.length;
    };

    const runScan = async () => {
      if (robotClone) {
        for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
          if (constraintScanTokenRef.current !== scanToken) return;

          const frame = effectiveEpisode.frames[frameIndex];
          if (frame) {
            applyJointValues(
              robotClone,
              applyJointDataZeroOffset({
                jointValues: frame.jointPositions,
                dataZeroJointValues:
                  useJointStore.getState().getActiveDataZeroJointValues(),
              }),
            );
            applyRobotBasePose(robotClone, frame.basePose);
            robotClone.updateMatrixWorld(true);
            scanBox.makeEmpty();
            scanBox.setFromObject(robotClone);
            if (!scanBox.isEmpty() && checkConstraintViolation(scanBox)) {
              matchedFrames.push(frameIndex);
            }
          }

          if ((frameIndex + 1) % progressBatch === 0 || frameIndex === frameCount - 1) {
            publishMatchedFrames(frameIndex === frameCount - 1);
            await waitForNextPaint();
          }
        }
      } else {
        for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
          if (constraintScanTokenRef.current !== scanToken) return;

          applyFrameSelection(frameIndex);
          await waitForNextPaint();
          await waitForNextPaint();

          if (constraintScanTokenRef.current !== scanToken) return;
          const bbox = constraintBboxRef.current;
          if (bbox && !bbox.isEmpty() && checkConstraintViolation(bbox)) {
            matchedFrames.push(frameIndex);
          }

          if ((frameIndex + 1) % progressBatch === 0 || frameIndex === frameCount - 1) {
            publishMatchedFrames(frameIndex === frameCount - 1);
          }
        }

        if (constraintScanTokenRef.current !== scanToken) return;
        applyFrameSelection(restoreFrame);
      }
      setIsConstraintScanRunning(false);
    };

    void runScan().catch(() => {
      if (constraintScanTokenRef.current === scanToken) {
        setIsConstraintScanRunning(false);
      }
    });

    return () => {
      if (constraintScanTokenRef.current === scanToken) {
        constraintScanTokenRef.current += 1;
        setIsConstraintScanRunning(false);
      }
    };
  }, [
    open,
    effectiveEpisode,
    constraintMode,
    constraintSignature,
    applyFrameSelection,
    checkConstraintViolation,
    waitForNextPaint,
  ]);

  // Handle canvas hover to change cursor
  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const x = e.clientX - rect.left;
    
    // Change cursor to pointer only when hovering over the top header area
    if (y <= TIMELINE_HEADER_HEIGHT && x >= CANVAS_PADDING && x <= rect.width - CANVAS_PADDING) {
      canvasRef.current.style.cursor = 'pointer';
    } else {
      canvasRef.current.style.cursor = 'default';
    }
  }, []);

  const rangeEpisode = effectiveEpisode;
  const timingEpisode = rangeEpisode;
  const timestampHealth = useMemo(
    () => analyzeTimestampSeries(timingEpisode?.frames ?? []),
    [timingEpisode]
  );

  // Get all joint names from the active episode
  const jointNames = useMemo(() => {
    return resolveEpisodeJointNames(rangeEpisode);
  }, [rangeEpisode]);
  const signalCatalogNames = useMemo(
    () =>
      resolveEpisodeSignalCatalogNames({
        activeEpisode: rangeEpisode,
        allEpisodes,
      }),
    [allEpisodes, rangeEpisode]
  );
  const robotJointNames = useMemo(
    () => Object.keys(robot?.joints ?? {}),
    [robot]
  );
  const recordedEpisodeSignalRows = useMemo(
    () =>
      resolveEpisodeSignalDisplayRows({
        signalNames: signalCatalogNames,
        robot,
        signalColorReferenceNames: signalCatalogNames,
        colorStrategy: "by-signal",
      }),
    [robot, signalCatalogNames]
  );
  const activeEpisodeSignalRows = useMemo(
    () =>
      resolveEpisodeSignalDisplayRows({
        signalNames: jointNames,
        robot,
        mappedColorReferenceJointNames: robotJointNames,
      }),
    [jointNames, robot, robotJointNames]
  );
  const recordedMappedRobotJointNameWithMotion = useMemo(() => {
    const jointNameSet = new Set<string>();
    if (!rangeEpisode || rangeEpisode.frames.length === 0) {
      return jointNameSet;
    }
    recordedEpisodeSignalRows.forEach((row) => {
      const mappedJointName = row.mappedJointName;
      if (!mappedJointName) return;
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      let finiteCount = 0;
      rangeEpisode.frames.forEach((frame) => {
        const value = resolveEpisodeFrameSignalValue(frame, row.signalName);
        if (!Number.isFinite(value)) return;
        finiteCount += 1;
        min = Math.min(min, value);
        max = Math.max(max, value);
      });
      if (
        finiteCount >= 2 &&
        Number.isFinite(min) &&
        Number.isFinite(max) &&
        Math.abs(max - min) > RUNTIME_RECORDED_MOTION_EPSILON
      ) {
        jointNameSet.add(mappedJointName);
      }
    });
    return jointNameSet;
  }, [rangeEpisode, recordedEpisodeSignalRows]);
  const runtimeSynthesisCandidateJointNames = useMemo(() => {
    if (!ENABLE_RUNTIME_EPISODE_CURVES) {
      return [];
    }
    return robotJointNames.filter(
      (jointName) =>
        !recordedMappedRobotJointNameWithMotion.has(jointName)
    );
  }, [recordedMappedRobotJointNameWithMotion, robotJointNames]);
  const [runtimeActiveJointNames, setRuntimeActiveJointNames] = useState<string[]>(
    []
  );
  const runtimeLastJointValueRef = useRef<Record<string, number>>({});
  const runtimeActiveJointNameSet = useMemo(
    () => new Set(runtimeActiveJointNames),
    [runtimeActiveJointNames]
  );
  const runtimeActiveSignalRows = useMemo(
    () => {
      if (!ENABLE_RUNTIME_EPISODE_CURVES) {
        return [];
      }
      return resolveEpisodeSignalDisplayRows({
        signalNames: runtimeActiveJointNames,
        robot,
        mappedColorReferenceJointNames: robotJointNames,
      });
    },
    [robot, robotJointNames, runtimeActiveJointNames]
  );
  const episodeSignalRows = useMemo(
    () => [...recordedEpisodeSignalRows, ...runtimeActiveSignalRows],
    [recordedEpisodeSignalRows, runtimeActiveSignalRows]
  );
  const episodeSignalsWithDifferentMapping = useMemo(
    () =>
      recordedEpisodeSignalRows
        .filter((row) =>
          hasDifferentEpisodeSignalMapping({
            signalName: row.signalName,
            mappedJointName: row.mappedJointName,
          })
        )
        .map((row) => row.signalName),
    [recordedEpisodeSignalRows]
  );
  const episodeSignalRowByName = useMemo(() => {
    const map = new Map<string, (typeof episodeSignalRows)[number]>();
    episodeSignalRows.forEach((row) => {
      map.set(row.signalName, row);
    });
    return map;
  }, [episodeSignalRows]);
  const mappedEpisodeJointNames = useMemo(() => {
    return activeEpisodeSignalRows
      .filter((row) => row.mappedJointName !== null)
      .map((row) => row.signalName);
  }, [activeEpisodeSignalRows]);
  const displayJointNames = useMemo(
    () =>
      Array.from(
        new Set([...mappedEpisodeJointNames, ...episodeSignalsWithDifferentMapping])
      ).sort((left, right) =>
        left.localeCompare(right, undefined, {
          numeric: true,
          sensitivity: "base",
        })
      ),
    [episodeSignalsWithDifferentMapping, mappedEpisodeJointNames]
  );
  const displayDifferentMappingSignalNameSet = useMemo(
    () => new Set(episodeSignalsWithDifferentMapping),
    [episodeSignalsWithDifferentMapping]
  );
  const editableDisplayJointNames = useMemo(
    () =>
      displayJointNames.filter(
        (jointName) => !runtimeActiveJointNameSet.has(jointName)
      ),
    [displayJointNames, runtimeActiveJointNameSet]
  );
  const hiddenEpisodeSignalCount = useMemo(
    () =>
      Math.max(
        0,
        jointNames.length -
          activeEpisodeSignalRows.filter((row) => row.mappedJointName !== null).length
      ),
    [activeEpisodeSignalRows, jointNames.length]
  );
  const suggestedBaseSignalNames = useMemo(() => {
    const activeSignalNameSet = new Set(
      jointNames.map((name) => normalizeEpisodeSignalName(name))
    );
    const catalogSignalNameSet = new Set(
      signalCatalogNames.map((name) => normalizeEpisodeSignalName(name))
    );
    return EPISODE_BASE_SIGNAL_SUGGESTION_ORDER.filter((signalName) => {
      const normalizedName = normalizeEpisodeSignalName(signalName);
      return (
        catalogSignalNameSet.has(normalizedName) &&
        !activeSignalNameSet.has(normalizedName)
      );
    });
  }, [jointNames, signalCatalogNames]);
  const activeEpisodeSignalNamesWithData = useMemo(() => {
    const namesWithData = new Set<string>();
    if (!rangeEpisode) return namesWithData;
    rangeEpisode.frames.forEach((frame) => {
      Object.entries(frame.jointPositions ?? {}).forEach(([signalName, value]) => {
        if (!Number.isFinite(value)) return;
        namesWithData.add(normalizeEpisodeSignalName(signalName));
      });
      DERIVED_BASE_POSE_SIGNAL_NAMES.forEach((signalName) => {
        const value = resolveEpisodeFrameSignalValue(frame, signalName);
        if (!Number.isFinite(value)) return;
        namesWithData.add(normalizeEpisodeSignalName(signalName));
      });
    });
    return namesWithData;
  }, [rangeEpisode]);
  const displayJointNameToRobotJoint = useMemo(() => {
    const map = new Map<string, string | null>();
    displayJointNames.forEach((jointName) => {
      const mappedJointName = episodeSignalRowByName.get(jointName)?.mappedJointName;
      if (mappedJointName !== undefined) {
        map.set(jointName, mappedJointName);
        return;
      }
      if (!ENABLE_RUNTIME_EPISODE_CURVES) {
        map.set(jointName, null);
        return;
      }
      map.set(
        jointName,
        runtimeActiveJointNameSet.has(jointName) ? jointName : null
      );
    });
    return map;
  }, [displayJointNames, episodeSignalRowByName, runtimeActiveJointNameSet]);
  const displayJointNameToLabel = useMemo(() => {
    const map = new Map<string, string>();
    displayJointNames.forEach((jointName) => {
      map.set(jointName, jointName);
    });
    return map;
  }, [displayJointNames]);
  const robotJointToEpisodeSignals = useMemo(() => {
    const map = new Map<string, string[]>();
    activeEpisodeSignalRows.forEach((row) => {
      const mappedJointName = row.mappedJointName;
      if (!mappedJointName) return;
      const existing = map.get(mappedJointName);
      if (existing) {
        existing.push(row.signalName);
        return;
      }
      map.set(mappedJointName, [row.signalName]);
    });
    return map;
  }, [activeEpisodeSignalRows]);
  const mjlabValidation = useMemo(
    () =>
      effectiveEpisode
        ? resolveDatasetEpisodeMjlabValidation(effectiveEpisode)
        : null,
    [effectiveEpisode]
  );
  const mjlabIssueMarkers = useMemo(() => {
    if (!effectiveEpisode || effectiveEpisode.frames.length === 0) {
      return [];
    }
    const markers: MjlabIssueMarker[] = [];
    resolveDatasetMjlabValidationIssues(mjlabValidation).forEach((issue) => {
      const candidateNames = new Set<string>();
      if (issue.jointName) {
        candidateNames.add(issue.jointName);
        robotJointToEpisodeSignals.get(issue.jointName)?.forEach((signalName) => {
          candidateNames.add(signalName);
        });
      } else if (issue.sampleIndex !== undefined && issue.sampleIndex !== null) {
        displayJointNames.forEach((jointName) => {
          candidateNames.add(jointName);
        });
      }
      if (candidateNames.size === 0) {
        return;
      }
      candidateNames.forEach((candidateName) => {
        const marker = buildMjlabIssueMarker(
          issue,
          effectiveEpisode.frames.length,
          candidateName
        );
        if (marker) {
          markers.push(marker);
        }
      });
    });
    return markers;
  }, [displayJointNames, effectiveEpisode, mjlabValidation, robotJointToEpisodeSignals]);
  const jointPositionUnitLabel = useMemo(
    () => resolveJointPositionUnitLabel(rangeEpisode),
    [rangeEpisode]
  );
  const resolveDisplayJointFrameValue = useCallback(
    (
      targetEpisode: Episode | null | undefined,
      frameIndex: number,
      jointName: string
    ) => {
      const frame = targetEpisode?.frames[frameIndex];
      if (!frame) return null;
      const signalValue = resolveEpisodeFrameSignalValue(frame, jointName);
      if (!ENABLE_RUNTIME_EPISODE_CURVES) {
        return Number.isFinite(signalValue) ? signalValue : null;
      }
      const runtimeValue = resolveRuntimeJointSeriesValue({
        series: runtimeJointSeriesRef.current,
        jointName,
        frameIndex,
      });
      if (runtimeActiveJointNameSet.has(jointName) && Number.isFinite(runtimeValue)) {
        return runtimeValue;
      }
      if (Number.isFinite(signalValue)) {
        return signalValue;
      }
      return runtimeValue;
    },
    [runtimeActiveJointNameSet]
  );
  const resolveEditableSignalValue = useCallback(
    (
      targetEpisode: Episode | null | undefined,
      frameIndex: number,
      signalName: string
    ) => {
      const value = resolveDisplayJointFrameValue(targetEpisode, frameIndex, signalName);
      return Number.isFinite(value) ? value : 0;
    },
    [resolveDisplayJointFrameValue]
  );
  const captureRuntimeJointFrame = useCallback(
    (frameIndex: number, sourceJointValues: Record<string, number>) => {
      if (!ENABLE_RUNTIME_EPISODE_CURVES) {
        return;
      }
      if (runtimeSynthesisCandidateJointNames.length === 0) {
        return;
      }
      const didRecord = recordRuntimeJointSeriesFrame({
        series: runtimeJointSeriesRef.current,
        frameIndex,
        jointNames: runtimeSynthesisCandidateJointNames,
        jointValues: removeJointDataZeroOffset({
          jointValues: sourceJointValues,
          dataZeroJointValues:
            useJointStore.getState().getActiveDataZeroJointValues(),
        }),
      });
      setRuntimeActiveJointNames((previous) => {
        const next = new Set(previous);
        let changed = false;
        runtimeSynthesisCandidateJointNames.forEach((jointName) => {
          const currentValue = sourceJointValues[jointName];
          if (!Number.isFinite(currentValue)) return;
          const previousValue = runtimeLastJointValueRef.current[jointName];
          runtimeLastJointValueRef.current[jointName] = currentValue;
          if (!Number.isFinite(previousValue)) return;
          if (
            Math.abs(currentValue - previousValue) <=
            RUNTIME_JOINT_ACTIVITY_EPSILON
          ) {
            return;
          }
          if (!next.has(jointName)) {
            next.add(jointName);
            changed = true;
          }
        });
        if (!changed) return previous;
        return Array.from(next).sort((left, right) =>
          left.localeCompare(right, undefined, {
            numeric: true,
            sensitivity: "base",
          })
        );
      });
      if (didRecord) {
        setRuntimeJointSeriesVersion((previous) => previous + 1);
      }
    },
    [runtimeSynthesisCandidateJointNames]
  );

  // Calculate min/max values for each joint
  const jointRanges = useMemo(() => {
    void runtimeJointSeriesVersion;
    if (!rangeEpisode || rangeEpisode.frames.length === 0) return {};
    const ranges: Record<string, { min: number; max: number }> = {};

    displayJointNames.forEach((jointName) => {
      const values = rangeEpisode.frames
        .map((_, frameIndex) =>
          resolveDisplayJointFrameValue(rangeEpisode, frameIndex, jointName)
        )
        .filter((value): value is number => Number.isFinite(value));
      if (values.length === 0) {
        ranges[jointName] = {
          min: 0,
          max: 0,
        };
        return;
      }
      ranges[jointName] = {
        min: Math.min(...values),
        max: Math.max(...values),
      };
    });

    return ranges;
  }, [displayJointNames, rangeEpisode, resolveDisplayJointFrameValue, runtimeJointSeriesVersion]);
  const selectedDisplayJointNames = useMemo(
    () => displayJointNames.filter((name) => selectedJoints.has(name)),
    [displayJointNames, selectedJoints]
  );
  const selectedChartValueRange = useMemo(
    () =>
      resolveCombinedChartValueRange({
        signalNames: selectedDisplayJointNames,
        ranges: jointRanges,
      }),
    [jointRanges, selectedDisplayJointNames]
  );
  useEffect(() => {
    runtimeJointSeriesRef.current = buildRuntimeJointSeries({
      jointNames: runtimeSynthesisCandidateJointNames,
      frameCount: rangeEpisode?.frames.length ?? 0,
      previousSeries: runtimeJointSeriesRef.current,
    });
    setRuntimeJointSeriesVersion((previous) => previous + 1);
  }, [rangeEpisode?.frames.length, runtimeSynthesisCandidateJointNames]);
  useEffect(() => {
    if (runtimeActiveJointNames.length === 0) return;
    setSelectedJoints((previous) => {
      const next = new Set(previous);
      let changed = false;
      runtimeActiveJointNames.forEach((jointName) => {
        if (autoSelectedRuntimeJointNamesRef.current.has(jointName)) return;
        autoSelectedRuntimeJointNamesRef.current.add(jointName);
        if (!next.has(jointName)) {
          next.add(jointName);
          changed = true;
        }
      });
      return changed ? next : previous;
    });
  }, [runtimeActiveJointNames]);
  useEffect(() => {
    if (mjlabIssueMarkers.length === 0) return;
    const issueJointNames = new Set(mjlabIssueMarkers.map((marker) => marker.jointName));
    setSelectedJoints((previous) => {
      const next = new Set(previous);
      let changed = false;
      issueJointNames.forEach((jointName) => {
        if (!displayJointNames.includes(jointName) || next.has(jointName)) {
          return;
        }
        next.add(jointName);
        changed = true;
      });
      return changed ? next : previous;
    });
  }, [displayJointNames, mjlabIssueMarkers]);
  useEffect(() => {
    const candidateJointSet = new Set(runtimeSynthesisCandidateJointNames);
    setRuntimeActiveJointNames((previous) => {
      const next = previous.filter((jointName) => candidateJointSet.has(jointName));
      return next.length === previous.length ? previous : next;
    });
  }, [runtimeSynthesisCandidateJointNames]);

  const velocityViolations = useMemo(() => {
    if (!effectiveEpisode) return [];
    return computeVelocityViolations(effectiveEpisode.frames, jointLimits);
  }, [effectiveEpisode, jointLimits]);

  const velocityViolationMap = useMemo(() => {
    const map = new Map<number, { frameIndex: number; jointName: string; ratio: number; velocity: number }>();
    velocityViolations.forEach((violation) => {
      map.set(violation.frameIndex, violation);
    });
    return map;
  }, [velocityViolations]);

  const limitViolations = useMemo(() => {
    if (!effectiveEpisode || effectiveEpisode.frames.length === 0 || !jointLimits) {
      return [];
    }
    return computeJointLimitViolations(effectiveEpisode.frames, jointLimits);
  }, [effectiveEpisode, jointLimits]);

  const limitViolationMap = useMemo(() => {
    const map = new Map<number, { frameIndex: number; joints: string[] }>();
    limitViolations.forEach((violation) => {
      const existing = map.get(violation.frameIndex);
      if (existing) {
        if (!existing.joints.includes(violation.jointName)) {
          existing.joints.push(violation.jointName);
        }
      } else {
        map.set(violation.frameIndex, {
          frameIndex: violation.frameIndex,
          joints: [violation.jointName],
        });
      }
    });
    return map;
  }, [limitViolations]);

  const constraintViolationZones = useMemo<ViolationZone[]>(() => {
    if (violationFrames.length === 0) return [];
    const sorted = Array.from(new Set(violationFrames)).sort((a, b) => a - b);
    const zones: ViolationZone[] = [];
    let currentStart = sorted[0];
    let previous = sorted[0];
    for (let index = 1; index < sorted.length; index += 1) {
      const frameIndex = sorted[index];
      if (frameIndex === previous + 1) {
        previous = frameIndex;
        continue;
      }
      zones.push({ start: currentStart, end: previous });
      currentStart = frameIndex;
      previous = frameIndex;
    }
    zones.push({ start: currentStart, end: previous });
    return zones;
  }, [violationFrames]);
  const [sidebarSignalColorByName, setSidebarSignalColorByName] = useState<
    Record<string, string>
  >({});

  // Create stable color mapping for joints
  const jointColorMap = useMemo(() => {
    const map = new Map<string, string>();
    episodeSignalRows.forEach((row) => {
      map.set(row.signalName, row.color);
    });
    return map;
  }, [episodeSignalRows]);
  const resolveEpisodeSignalColor = useCallback(
    (signalName: string) => {
      const baseColor =
        sidebarSignalColorByName[signalName] ??
        jointColorMap.get(signalName) ??
        "#9ca3af";
      if (!activeEpisodeSignalNamesWithData.has(normalizeEpisodeSignalName(signalName))) {
        return HIDDEN_EPISODE_SIGNAL_COLOR;
      }
      return baseColor;
    },
    [activeEpisodeSignalNamesWithData, jointColorMap, sidebarSignalColorByName]
  );
  useEffect(() => {
    const handleSidebarSignalColorMap = (event: Event) => {
      const customEvent = event as CustomEvent<{
        colorBySignalName?: Record<string, string>;
      }>;
      const colorBySignalName = customEvent.detail?.colorBySignalName;
      if (!colorBySignalName || typeof colorBySignalName !== "object") {
        return;
      }
      setSidebarSignalColorByName(colorBySignalName);
    };

    window.addEventListener(
      "sidebar:episodeSignalColorMap",
      handleSidebarSignalColorMap
    );
    window.dispatchEvent(new CustomEvent("sidebar:requestEpisodeSignalColorMap"));
    return () => {
      window.removeEventListener(
        "sidebar:episodeSignalColorMap",
        handleSidebarSignalColorMap
      );
    };
  }, []);
  const editingJointDisplayLabel = useMemo(() => {
    if (!editingJoint) return null;
    return displayJointNameToLabel.get(editingJoint) ?? editingJoint;
  }, [displayJointNameToLabel, editingJoint]);

  const effectiveFps = useMemo(
    () => computeEffectiveFps(effectiveEpisode),
    [effectiveEpisode]
  );

  const recordedFps = useMemo(
    () => computeRecordedFps(effectiveEpisode),
    [effectiveEpisode]
  );

  useEffect(() => {
    if (effectiveFps <= 0) return;
    setRetimeFps((prev) => {
      const next = Number(effectiveFps.toFixed(2));
      return Math.abs(prev - next) < 1e-3 ? prev : next;
    });
  }, [effectiveFps]);

  // Listen to global frame updates from 3D viewer.
  useEffect(() => {
    if (!open) return;

    const handleFrameUpdate = (event: CustomEvent) => {
      const { frame, episodeIndex } = event.detail;
      if (episodeIndex !== currentEpisodeIndex) return;
      if (typeof frame !== "number" || !Number.isFinite(frame)) return;
      const frameIndex = Math.max(0, Math.floor(frame));
      setCurrentFrame(frameIndex);
      preservedFrameRef.current = frameIndex;
      captureRuntimeJointFrame(frameIndex, useJointStore.getState().jointValues);
    };

    window.addEventListener('viewer3d:frameUpdate', handleFrameUpdate);
    return () => {
      window.removeEventListener('viewer3d:frameUpdate', handleFrameUpdate);
    };
  }, [open, currentEpisodeIndex, captureRuntimeJointFrame]);

  const resolveFrameFromLiveRefs = useCallback(() => {
    if (isPlayingAll) {
      return (
        globalCurrentFrameRef.current ??
        currentFrameRef.current ??
        preservedFrameRef.current ??
        0
      );
    }
    return getCurrentFrameValue(
      preservedFrameRef.current,
      globalCurrentFrameRef.current,
      currentFrameRef.current
    );
  }, [isPlayingAll]);

  const syncPlaybackCursorTimeToFrame = useCallback(
    (frames: RecordedFrame[]) => {
      if (!frames || frames.length === 0) {
        playbackTimeMsRef.current = 0;
        lastDrawnPlaybackCursorTimeMsRef.current = 0;
        lastPlaybackTimeEventAtRef.current = Number.NEGATIVE_INFINITY;
        return;
      }
      const frame = resolveFrameFromLiveRefs();
      const clampedFrame = Math.max(0, Math.min(Math.floor(frame), frames.length - 1));
      playbackTimeMsRef.current = frames[clampedFrame]?.timestamp ?? frames[0]?.timestamp ?? 0;
      lastDrawnPlaybackCursorTimeMsRef.current = playbackTimeMsRef.current;
      lastPlaybackTimeEventAtRef.current = Number.NEGATIVE_INFINITY;
    },
    [resolveFrameFromLiveRefs]
  );

  useEffect(() => {
    if (!open) return;
    syncPlaybackCursorTimeToFrame(effectiveEpisode?.frames ?? []);
  }, [
    open,
    effectiveEpisode?.id,
    effectiveEpisode?.frames,
    syncPlaybackCursorTimeToFrame,
  ]);

  useEffect(() => {
    if (isPlayingAll) return;
    syncPlaybackCursorTimeToFrame(effectiveEpisode?.frames ?? []);
  }, [
    isPlayingAll,
    effectiveEpisode,
    globalCurrentFrame,
    currentFrame,
    syncPlaybackCursorTimeToFrame,
  ]);

  // Track continuous playback time (sub-frame precision) via a ref so we can
  // draw the graph cursor smoothly without triggering React re-renders.
  useEffect(() => {
    const handlePlaybackTime = (e: Event) => {
      const timeMs = (e as CustomEvent<{ timeMs?: number }>).detail?.timeMs;
      if (typeof timeMs !== "number" || !Number.isFinite(timeMs)) return;
      playbackTimeMsRef.current = timeMs;
      lastPlaybackTimeEventAtRef.current = performance.now();
    };
    window.addEventListener('viewer3d:playbackTime', handlePlaybackTime);
    return () => window.removeEventListener('viewer3d:playbackTime', handlePlaybackTime);
  }, []);

  // Smooth cursor overlay — draws only the time-position cursor on a separate
  // canvas via rAF so the main data canvas is not redrawn every frame.
  useEffect(() => {
    const cursorCanvas = cursorCanvasRef.current;
    if (!cursorCanvas) return;
    let rafId = 0;

    const drawCursor = () => {
      const frames = effectiveEpisode?.frames;
      if (!frames || frames.length === 0) {
        rafId = requestAnimationFrame(drawCursor);
        return;
      }
      const ctx = cursorCanvas.getContext('2d');
      if (!ctx) { rafId = requestAnimationFrame(drawCursor); return; }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssWidth = cursorCanvas.width / dpr;
      const cssHeight = cursorCanvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      const graphWidth = cssWidth - CANVAS_PADDING * 2;
      const cursorTimeMs = resolvePlaybackCursorTimeMs({
        frames,
        playbackTimeMs: playbackTimeMsRef.current,
        lastPlaybackEventAtMs: lastPlaybackTimeEventAtRef.current,
        nowMs: performance.now(),
        playbackSpeed,
        isPlaying: isPlayingAll,
        fallbackFrameIndex: resolveFrameFromLiveRefs(),
        previousCursorTimeMs: isPlayingAll
          ? lastDrawnPlaybackCursorTimeMsRef.current
          : undefined,
      });
      lastDrawnPlaybackCursorTimeMsRef.current = cursorTimeMs;
      const x = resolveTimeX(frames, cursorTimeMs, graphWidth);

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(x, CANVAS_PADDING);
      ctx.lineTo(x, cssHeight - CANVAS_PADDING);
      ctx.stroke();
      ctx.setLineDash([]);

      rafId = requestAnimationFrame(drawCursor);
    };

    rafId = requestAnimationFrame(drawCursor);
    return () => cancelAnimationFrame(rafId);
  }, [effectiveEpisode, isPlayingAll, playbackSpeed, resolveFrameFromLiveRefs]);

  // Update preserved frame when not playing
  useEffect(() => {
    if (isPlayingAll) return;
    const currentFrameValue = globalCurrentFrame ?? currentFrame;
    if (currentFrameValue != null) {
      preservedFrameRef.current = currentFrameValue;
    }
  }, [isPlayingAll, globalCurrentFrame, currentFrame]);

  // Sync local frame with global when manually set (paused)
  useEffect(() => {
    if (!isPlayingAll && globalCurrentFrame !== undefined) {
      setCurrentFrame(globalCurrentFrame);
      preservedFrameRef.current = globalCurrentFrame;
    }
  }, [isPlayingAll, globalCurrentFrame]);
  useEffect(() => {
    const frameCount = rangeEpisode?.frames.length ?? 0;
    if (frameCount <= 0) return;
    const clampedFrameIndex = Math.max(0, Math.min(currentFrame, frameCount - 1));
    captureRuntimeJointFrame(clampedFrameIndex, useJointStore.getState().jointValues);
  }, [currentFrame, rangeEpisode, captureRuntimeJointFrame]);

  // Helper to check if episode has been modified
  const hasChanges = useMemo(() => {
    if (!episode || !modifiedEpisode) return false;
    if (episode.frames.length !== modifiedEpisode.frames.length) return true;

    for (let i = 0; i < episode.frames.length; i++) {
      const original = episode.frames[i];
      const modified = modifiedEpisode.frames[i];
      if (
        Math.abs(original.timestamp - modified.timestamp) >
        EPISODE_CHANGE_TIMESTAMP_EPSILON_MS
      ) {
        return true;
      }

      const originalHasBasePose = Boolean(original.basePose);
      const modifiedHasBasePose = Boolean(modified.basePose);
      if (originalHasBasePose !== modifiedHasBasePose) {
        return true;
      }
      if (
        originalHasBasePose &&
        modifiedHasBasePose &&
        hasMeaningfulRobotBasePoseDelta(
          original.basePose,
          modified.basePose,
          EPISODE_CHANGE_BASE_TRANSLATION_EPSILON_METERS,
          EPISODE_CHANGE_BASE_ROTATION_EPSILON_RAD
        )
      ) {
        return true;
      }

      const jointNames = new Set([
        ...Object.keys(original.jointPositions),
        ...Object.keys(modified.jointPositions),
      ]);
      for (const jointName of jointNames) {
        const originalValue = original.jointPositions[jointName];
        const modifiedValue = modified.jointPositions[jointName];
        if (
          Number.isFinite(originalValue) !== Number.isFinite(modifiedValue)
        ) {
          return true;
        }
        if (
          Number.isFinite(originalValue) &&
          Number.isFinite(modifiedValue) &&
          Math.abs(originalValue - modifiedValue) >
            EPISODE_CHANGE_SIGNAL_EPSILON
        ) {
          return true;
        }
      }
    }

    return false;
  }, [episode, modifiedEpisode]);

  useEffect(() => {
    if (!editingJoint) return;
    if (editableDisplayJointNames.includes(editingJoint)) return;
    clearEditingJointSelection();
  }, [clearEditingJointSelection, editableDisplayJointNames, editingJoint]);

  // Reset edit state only for a real episode switch. Parent playback/frame
  // callbacks can change on every frame and must not tear down an edit session.
  useEffect(() => {
    const previousEpisodeId = previousEpisodeIdRef.current;
    const nextEpisodeId = episode?.id ?? null;
    const lifecycleAction = resolveEpisodeViewerEditSessionLifecycleAction({
      previousEpisodeId,
      nextEpisodeId,
      isEditMode,
    });
    previousEpisodeIdRef.current = nextEpisodeId;

    if (lifecycleAction === "clear") {
      clearEpisodeEditorDraftState();
      return;
    }

    if (!episode || lifecycleAction === "preserve") {
      return;
    }

    if (lifecycleAction === "reset") {
      resetTrimAndFrame(EPISODE_EDITOR_INITIAL_FRAME_INDEX);
      resetEpisodeEditorChrome();
    } else {
      setTrimRange({ start: null, end: null });
    }

    refreshEpisodeEditorDraftState(episode);
  }, [
    clearEpisodeEditorDraftState,
    episode,
    isEditMode,
    refreshEpisodeEditorDraftState,
    resetEpisodeEditorChrome,
    resetTrimAndFrame,
  ]);

  // Listen for joint visibility toggles from joint list sidebar
  useEffect(() => {
    const handleJointVisibilityToggle = (event: Event) => {
      const customEvent = event as CustomEvent<{
        jointName: string;
        signalName?: string;
        mappedJointName?: string | null;
        isVisible: boolean;
      }>;
      const { jointName, signalName, mappedJointName, isVisible } = customEvent.detail;
      const targetJointNames = new Set<string>();
      const addJointName = (value: unknown) => {
        if (typeof value !== "string") return;
        const normalized = value.trim();
        if (normalized.length === 0) return;
        targetJointNames.add(normalized);
      };
      addJointName(jointName);
      addJointName(signalName);
      addJointName(mappedJointName);
      [jointName, signalName, mappedJointName].forEach((name) => {
        if (typeof name !== "string" || name.trim().length === 0) return;
        const mappedSignalNames = robotJointToEpisodeSignals.get(name);
        mappedSignalNames?.forEach((mappedSignalName) => {
          targetJointNames.add(mappedSignalName);
        });
      });
      if (targetJointNames.size === 0) {
        return;
      }
      setSelectedJoints(prev => {
        const newSelected = new Set(prev);
        targetJointNames.forEach((targetJointName) => {
          if (isVisible) {
            newSelected.add(targetJointName);
          } else {
            newSelected.delete(targetJointName);
          }
        });
        return newSelected;
      });
    };

    window.addEventListener('jointVisibilityToggle', handleJointVisibilityToggle);
    return () => {
      window.removeEventListener('jointVisibilityToggle', handleJointVisibilityToggle);
    };
  }, [robotJointToEpisodeSignals]);

  // Dispatch visibility changes when selectedJoints changes
  // Use a ref to track previous state and only dispatch for changed joints
  const prevSelectedJointsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (displayJointNames.length === 0) return;
    const prev = prevSelectedJointsRef.current;
    
    displayJointNames.forEach(jointName => {
      const wasVisible = prev.has(jointName);
      const isVisible = selectedJoints.has(jointName);
      // Only dispatch if visibility actually changed
      if (wasVisible !== isVisible) {
        const syncEvent = new CustomEvent('episodeViewer:jointVisibilityChange', {
          detail: {
            jointName,
            signalName: jointName,
            mappedJointName: displayJointNameToRobotJoint.get(jointName) ?? null,
            isVisible,
          },
        });
        window.dispatchEvent(syncEvent);
      }
    });
    
    // Update ref for next comparison
    prevSelectedJointsRef.current = new Set(selectedJoints);
  }, [displayJointNameToRobotJoint, displayJointNames, selectedJoints]);

  useEffect(() => {
    if (!open || !timingEpisode || !timestampHealth.nonMonotonic) return;
    if (warnedTimestampEpisodeIdRef.current === timingEpisode.id) return;
    warnedTimestampEpisodeIdRef.current = timingEpisode.id;
    toast.warning(
      `Non-monotonic timestamps detected (${timestampHealth.zeroOrNegativeCount} gap(s)). Playback and edits may be unsafe.`
    );
  }, [open, timingEpisode, timestampHealth]);

  // Initialize preserved frame on mount
  useEffect(() => {
    if (preservedFrameRef.current === null) {
      preservedFrameRef.current = globalCurrentFrame ?? currentFrame ?? 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncViewerEpisode = useCallback(
    (updatedEpisode: Episode, frameOverride?: number) => {
      if (!open || !updatedEpisode || updatedEpisode.frames.length === 0) return;
      if (episode && updatedEpisode.id !== episode.id) return;
      if (isPlayingAll) return;

      const rawFrame =
        frameOverride ??
        getCurrentFrameValue(
          preservedFrameRef.current,
          globalCurrentFrame,
          currentFrame
        );
      const clampedFrame = Math.max(
        0,
        Math.min(rawFrame, updatedEpisode.frames.length - 1)
      );

      viewerPlayback.playEpisode(toAnimationFrames(updatedEpisode), {
        autoplay: false,
        startFrame: clampedFrame,
        playbackEpisode: updatedEpisode,
      });
    },
    [open, episode, isPlayingAll, globalCurrentFrame, currentFrame]
  );
  const initializeDraftState = useCallback(
    (nextEpisode: Episode, options: { syncViewer?: boolean } = {}) => {
      setModifiedEpisodeTracked(nextEpisode);
      initializeHistory(nextEpisode);
      if (options.syncViewer) {
        syncViewerEpisode(nextEpisode);
      }
    },
    [initializeHistory, setModifiedEpisodeTracked, syncViewerEpisode]
  );

  const requestViewerSync = useCallback(
    (updatedEpisode: Episode) => {
      pendingSyncEpisodeRef.current = updatedEpisode;
      if (syncRafRef.current !== null) return;
      syncRafRef.current = requestAnimationFrame(() => {
        syncRafRef.current = null;
        const nextEpisode = pendingSyncEpisodeRef.current;
        if (nextEpisode) {
          syncViewerEpisode(nextEpisode);
        }
        pendingSyncEpisodeRef.current = null;
      });
    },
    [syncViewerEpisode]
  );

  const pushToHistory = useCallback((newEpisode: Episode) => {
    appendHistory(newEpisode);
    syncViewerEpisode(newEpisode);
  }, [appendHistory, syncViewerEpisode]);

  const handleUndo = useCallback(() => {
    const nextState = undoHistory();
    if (!nextState) return;
    setModifiedEpisodeTracked(nextState.activeEpisode);
    syncViewerEpisode(nextState.activeEpisode);
    toast.info("Undo");
  }, [setModifiedEpisodeTracked, syncViewerEpisode, undoHistory]);

  const handleRedo = useCallback(() => {
    const nextState = redoHistory();
    if (!nextState) return;
    setModifiedEpisodeTracked(nextState.activeEpisode);
    syncViewerEpisode(nextState.activeEpisode);
    toast.info("Redo");
  }, [redoHistory, setModifiedEpisodeTracked, syncViewerEpisode]);

  const buildSmoothedEpisode = useCallback(
    (strength: number) => {
      if (!isEditMode || !editingJoint || !modifiedEpisode) return null;

      const values = modifiedEpisode.frames.map((_, frameIndex) =>
        resolveEditableSignalValue(modifiedEpisode, frameIndex, editingJoint)
      );
      const timestamps = modifiedEpisode.frames.map((frame) => frame.timestamp);
      const fps = computeEffectiveFps(modifiedEpisode);
      const range = jointRanges[editingJoint];
      const rangeMin = range?.min ?? Math.min(...values);
      const rangeMax = range?.max ?? Math.max(...values);
      const smoothedRaw = smoothSeriesTemporal(
        values,
        timestamps,
        fps,
        rangeMin,
        rangeMax,
        strength
      );
      const smoothed = enforceJointConstraints(
        smoothedRaw,
        modifiedEpisode.frames,
        editingJoint,
        jointLimits
      );

      const newFrames = modifiedEpisode.frames.map((frame, idx) =>
        writeEpisodeFrameSignalValue(frame, editingJoint, smoothed[idx])
      );

      return markEpisodeVideoReferenceOnly(
        { ...modifiedEpisode, frames: newFrames },
        EPISODE_RECORDED_VIDEO_SYNC_REASON_SMOOTH
      );
    },
    [
      isEditMode,
      editingJoint,
      modifiedEpisode,
      jointRanges,
      jointLimits,
      resolveEditableSignalValue,
    ]
  );

  const handleSmoothPreview = useCallback(() => {
    if (!isEditMode || !editingJoint || !modifiedEpisode) {
      toast.error("Enter edit mode and pick a joint to smooth");
      return;
    }

    const nextEpisode = buildSmoothedEpisode(smoothingStrength);
    if (!nextEpisode) return;
    const violations = computeVelocityViolations(nextEpisode.frames, jointLimits);
    let maxRatio = 0;
    let worstJoint: string | null = null;
    let worstTimeSec: number | null = null;
    const startTime = nextEpisode.frames[0]?.timestamp ?? 0;

    violations.forEach((violation) => {
      if (violation.ratio > maxRatio) {
        maxRatio = violation.ratio;
        worstJoint = violation.jointName;
        const timestamp = nextEpisode.frames[violation.frameIndex]?.timestamp ?? startTime;
        const delta = (timestamp - startTime) / 1000;
        worstTimeSec = Number.isFinite(delta) ? Math.max(0, delta) : null;
      }
    });

    setSmoothPreviewEpisode(nextEpisode);
    setSmoothPreviewSummary({
      violationCount: violations.length,
      maxRatio,
      worstJoint,
      worstTimeSec,
    });
    setShowSmoothPreviewDialog(true);
  }, [
    isEditMode,
    editingJoint,
    modifiedEpisode,
    buildSmoothedEpisode,
    smoothingStrength,
    jointLimits,
  ]);

  const clearSmoothPreview = useCallback(() => {
    setShowSmoothPreviewDialog(false);
    setSmoothPreviewEpisode(null);
    setSmoothPreviewSummary(null);
  }, []);

  const applySmoothPreview = useCallback(() => {
    if (!smoothPreviewEpisode) return;
    setModifiedEpisodeTracked(smoothPreviewEpisode);
    pushToHistory(smoothPreviewEpisode);
    resetCurveSelection();
    clearSmoothPreview();
    if (editingJoint) {
      toast.success(`Smoothed ${editingJoint} trajectory`);
    } else {
      toast.success("Smoothed trajectory");
    }
  }, [
    clearSmoothPreview,
    smoothPreviewEpisode,
    pushToHistory,
    editingJoint,
    resetCurveSelection,
    setModifiedEpisodeTracked,
  ]);

  const getResolvedTrimRange = useCallback(
    (frameCount: number) => {
      if (trimRange.start === null || trimRange.end === null || frameCount <= 0) return null;
      const maxIndex = Math.max(0, frameCount - 1);
      const rawStart = Math.max(0, Math.min(trimRange.start, maxIndex));
      const rawEnd = Math.max(0, Math.min(trimRange.end, maxIndex));
      return {
        start: Math.min(rawStart, rawEnd),
        end: Math.max(rawStart, rawEnd),
      };
    },
    [trimRange]
  );

  const resolveCurrentFrame = useCallback(
    () => {
      if (isPlayingAll) {
        return globalCurrentFrame ?? currentFrame ?? preservedFrameRef.current ?? 0;
      }
      return getCurrentFrameValue(preservedFrameRef.current, globalCurrentFrame, currentFrame);
    },
    [globalCurrentFrame, currentFrame, isPlayingAll]
  );

  const ensureTimelineEditingSession = useCallback(() => {
    if (editingJoint) {
      toast.info("Clear joint selection to use timeline tools");
      return null;
    }
    if (!modifiedEpisode) {
      if (!episode) return null;
      const draft = cloneEpisodeForEditing(episode);
      initializeDraftState(draft);
      if (!isEditMode) {
        editSessionBaselineRef.current = cloneEpisodeForEditing(episode);
        setIsEditMode(true);
      }
      clearEditingJointSelection();
      return draft;
    }

    if (!isEditMode) {
      if (!editSessionBaselineRef.current) {
        editSessionBaselineRef.current = cloneEpisodeForEditing(episode ?? modifiedEpisode);
      }
      setIsEditMode(true);
      clearEditingJointSelection();
    }
    return modifiedEpisode;
  }, [
    clearEditingJointSelection,
    editingJoint,
    episode,
    initializeDraftState,
    isEditMode,
    modifiedEpisode,
  ]);

  const handleSetTrimPoint = useCallback(
    (edge: "start" | "end") => {
      const targetEpisode = ensureTimelineEditingSession();
      if (!targetEpisode) return;
      const frame = resolveCurrentFrame();
      setTrimRange((prev) => ({ ...prev, [edge]: frame }));
      const timeOffset = resolveFrameTimeOffsetSec(targetEpisode.frames, frame);
      toast.info(
        edge === "start"
          ? `Set In at F${frame} (${timeOffset.toFixed(2)}s)`
          : `Set Out at F${frame} (${timeOffset.toFixed(2)}s)`
      );
    },
    [ensureTimelineEditingSession, resolveCurrentFrame]
  );

  const handleSetTrimPointWithScissors = useCallback(() => {
    const targetEpisode = ensureTimelineEditingSession();
    if (!targetEpisode) return;

    const frame = resolveCurrentFrame();
    const startFrame = trimRange.start;
    const endFrame = trimRange.end;
    let edge: "start" | "end" = "start";

    if (startFrame === null) {
      edge = "start";
    } else if (endFrame === null) {
      edge = "end";
    } else {
      const distanceToStart = Math.abs(frame - startFrame);
      const distanceToEnd = Math.abs(frame - endFrame);
      edge = distanceToStart <= distanceToEnd ? "start" : "end";
    }

    setTrimRange((previous) => ({ ...previous, [edge]: frame }));
    const timeOffset = resolveFrameTimeOffsetSec(targetEpisode.frames, frame);
    toast.info(
      edge === "start"
        ? `Set In at F${frame} (${timeOffset.toFixed(2)}s)`
        : `Set Out at F${frame} (${timeOffset.toFixed(2)}s)`
    );
  }, [ensureTimelineEditingSession, resolveCurrentFrame, trimRange.start, trimRange.end]);

  const handleSetTrimTime = useCallback(
    (edge: "start" | "end", seconds: number) => {
      const targetEpisode = ensureTimelineEditingSession();
      if (!targetEpisode) return;
      if (!Number.isFinite(seconds)) return;
      const frame = resolveFrameIndexFromTimeOffset(targetEpisode.frames, seconds);
      setTrimRange((prev) => ({ ...prev, [edge]: frame }));
    },
    [ensureTimelineEditingSession]
  );

  const handleClearTrimRange = useCallback(() => {
    setTrimRange({ start: null, end: null });
    toast.info("Cleared range");
  }, []);

  const applyTrimOperation = useCallback((operation: "delete_outside" | "delete_inside") => {
    const targetEpisode = ensureTimelineEditingSession();
    if (!targetEpisode) return;
    const resolved = getResolvedTrimRange(targetEpisode.frames.length);
    if (!resolved) {
      toast.error("Set In and Out before trimming");
      return;
    }

    const { start, end } = resolved;
    const originalFrames = targetEpisode.frames;
    const startFrame = originalFrames[start];
    const endFrame = originalFrames[end];
    if (!startFrame || !endFrame) {
      toast.error("Invalid trim range");
      return;
    }

    const cloneFrame = (frame: RecordedFrame): RecordedFrame => ({
      timestamp: frame.timestamp,
      jointPositions: { ...frame.jointPositions },
      basePose: cloneRobotBasePose(frame.basePose),
    });

    let nextFrames: RecordedFrame[] = [];
    const isDeleteOutside = operation === "delete_outside";
    if (isDeleteOutside) {
      const baseTimestamp = startFrame.timestamp;
      nextFrames = originalFrames.slice(start, end + 1).map((frame) => ({
        ...cloneFrame(frame),
        timestamp: frame.timestamp - baseTimestamp,
      }));
    } else {
      const beforeFrames = originalFrames.slice(0, start).map(cloneFrame);
      const afterSourceFrames = originalFrames.slice(end + 1);
      const seamReferenceTimestamp =
        beforeFrames.length > 0
          ? beforeFrames[beforeFrames.length - 1].timestamp
          : startFrame.timestamp;
      const afterShiftMs = endFrame.timestamp - seamReferenceTimestamp;
      const afterFrames = afterSourceFrames.map((frame) => ({
        ...cloneFrame(frame),
        timestamp: frame.timestamp - afterShiftMs,
      }));
      nextFrames = [...beforeFrames, ...afterFrames];
      const firstTimestamp = nextFrames[0]?.timestamp ?? 0;
      nextFrames = nextFrames.map((frame) => ({
        ...frame,
        timestamp: frame.timestamp - firstTimestamp,
      }));
    }

    if (nextFrames.length === 0) {
      toast.error(
        isDeleteOutside
          ? "Trim range produced no frames"
          : "Delete inside would remove all frames"
      );
      return;
    }

    const nextDurationSec = (nextFrames[nextFrames.length - 1]?.timestamp ?? 0) / 1000;
    const nextMetadata = (() => {
      if (!isDeleteOutside) {
        return markEpisodeRecordedVideoReferenceOnly(targetEpisode.metadata, {
          reason: EPISODE_RECORDED_VIDEO_SYNC_REASON_DELETE_INSIDE,
        });
      }
      const existingClip = getEpisodeVideoClipBounds(targetEpisode);
      const trimmedStartSec = startFrame.timestamp / 1000;
      const nextClipStartSec = existingClip.startSec + trimmedStartSec;
      const nextClipEndSec = nextClipStartSec + Math.max(0, nextDurationSec);
      return markEpisodeRecordedVideoSyncAligned(
        applyEpisodeVideoClipBounds(
          targetEpisode.metadata,
          nextClipStartSec,
          nextClipEndSec
        ),
        {
          status: EPISODE_RECORDED_VIDEO_SYNC_STATUS_CLIP_ALIGNED,
          reason: EPISODE_RECORDED_VIDEO_SYNC_REASON_DELETE_OUTSIDE,
        }
      );
    })();

    const nextEpisode: Episode = {
      ...targetEpisode,
      frames: nextFrames,
      metadata: nextMetadata
        ? {
            ...nextMetadata,
            num_frames: nextFrames.length,
            episode_length_sec:
              nextFrames[nextFrames.length - 1]?.timestamp !== undefined
                ? nextFrames[nextFrames.length - 1].timestamp / 1000
                : targetEpisode.metadata?.episode_length_sec,
          }
        : undefined,
    };

    setModifiedEpisodeTracked(nextEpisode);
    pushToHistory(nextEpisode);
    resetCurveSelection();
    resetTrimAndFrame(EPISODE_EDITOR_INITIAL_FRAME_INDEX);
    if (!isDeleteOutside && start > 0 && end < originalFrames.length - 1) {
      toast.success("Deleted inside range (timeline stitched)");
      if (resolveEpisodeRecordedVideoSyncInfo(nextEpisode).hasRecordedVideo) {
        toast.info("Recorded video is now reference only for this edited episode.");
      }
      return;
    }
    toast.success(
      isDeleteOutside ? "Deleted outside range" : "Deleted inside range"
    );
  }, [
    ensureTimelineEditingSession,
    getResolvedTrimRange,
    pushToHistory,
    resetCurveSelection,
    resetTrimAndFrame,
    setModifiedEpisodeTracked,
  ]);

  const handleTrimToRange = useCallback(() => {
    applyTrimOperation("delete_outside");
  }, [applyTrimOperation]);

  const handleDeleteInsideRange = useCallback(() => {
    applyTrimOperation("delete_inside");
  }, [applyTrimOperation]);

  const handleTimeScale = useCallback(
    (
      speed: number,
      rangeOverride?: { start: number; end: number } | null,
      label?: string,
      modeOverride?: RetimeMode
    ) => {
      const targetEpisode = ensureTimelineEditingSession();
      if (!targetEpisode) return;
      if (!Number.isFinite(speed) || speed <= 0) {
        toast.error("Enter a valid speed");
        return;
      }
      if (Math.abs(speed - 1) < RETIME_SPEED_IDENTITY_EPSILON) {
        toast.info("Speed is already 1x");
        return;
      }
      if (targetEpisode.frames.length < 2) {
        toast.error("Not enough frames to retime");
        return;
      }

      let resolved = rangeOverride ?? getResolvedTrimRange(targetEpisode.frames.length);
      let startIndex = resolved?.start ?? 0;
      let endIndex = resolved?.end ?? targetEpisode.frames.length - 1;
      if (startIndex >= endIndex) {
        const lastIndex = targetEpisode.frames.length - 1;
        if (rangeOverride) {
          toast.error("Not enough frames to retime");
          return;
        }
        const expandedStart = Math.max(0, Math.min(startIndex, endIndex) - 1);
        const expandedEnd = Math.min(lastIndex, Math.max(startIndex, endIndex) + 1);
        if (expandedStart < expandedEnd) {
          startIndex = expandedStart;
          endIndex = expandedEnd;
          resolved = { start: startIndex, end: endIndex };
          setTrimRange({ start: startIndex, end: endIndex });
        } else {
          startIndex = 0;
          endIndex = lastIndex;
          resolved = null;
          setTrimRange({ start: null, end: null });
          if (startIndex >= endIndex) {
            toast.error("Not enough frames to retime");
            return;
          }
        }
      }

      const segmentFrames = targetEpisode.frames.slice(startIndex, endIndex + 1);
      const timingCheck = analyzeTimestampSeries(segmentFrames);
      if (timingCheck.nonMonotonic) {
        toast.error("Non-monotonic timestamps in selection. Fix timing before retiming.");
        return;
      }

      const mode = modeOverride ?? retimeMode;
      const segmentStartTime = segmentFrames[0].timestamp;
      const segmentEndTime = segmentFrames[segmentFrames.length - 1].timestamp;
      const segmentDuration = segmentEndTime - segmentStartTime;
      if (!Number.isFinite(segmentDuration) || segmentDuration <= 0) {
        toast.error("Invalid timing data");
        return;
      }

      let nextSegment: RecordedFrame[] = [];
      let newDuration = segmentDuration;
      const baseFps =
        recordedFps > 0
          ? recordedFps
          : effectiveFps > 0
            ? effectiveFps
            : DEFAULT_RETIME_BASE_FPS;

      if (mode === "resample") {
        const targetDuration = segmentDuration / speed;
        const targetCount = Math.max(2, Math.round((targetDuration / 1000) * baseFps) + 1);
        const segmentTimes = segmentFrames.map((frame) => frame.timestamp - segmentStartTime);
        const lastSegmentIndex = segmentFrames.length - 1;
        let sourceIndex = 0;

        nextSegment = Array.from({ length: targetCount }, (_, idx) => {
          const tNew =
            targetCount === 1 ? 0 : (targetDuration * idx) / (targetCount - 1);
          const tSrc = Math.min(segmentDuration, tNew * speed);

          while (
            sourceIndex < lastSegmentIndex - 1 &&
            segmentTimes[sourceIndex + 1] < tSrc
          ) {
            sourceIndex += 1;
          }

          const t0 = segmentTimes[sourceIndex] ?? 0;
          const t1 = segmentTimes[sourceIndex + 1] ?? t0;
          const alpha = t1 > t0 ? (tSrc - t0) / (t1 - t0) : 0;
          const frameA = segmentFrames[sourceIndex];
          const frameB = segmentFrames[sourceIndex + 1] ?? frameA;

          return {
            timestamp: segmentStartTime + tNew,
            jointPositions: interpolateFrameJointPositions(frameA, frameB, alpha),
            basePose: interpolateRobotBasePose(
              frameA.basePose,
              frameB.basePose,
              alpha
            ),
          };
        });

        newDuration = targetDuration;
      } else {
        const scale = 1 / speed;
        nextSegment = segmentFrames.map((frame) => ({
          ...frame,
          timestamp: segmentStartTime + (frame.timestamp - segmentStartTime) * scale,
        }));
        newDuration = segmentDuration * scale;
      }

      const deltaAfter = newDuration - segmentDuration;
      const before = targetEpisode.frames.slice(0, startIndex);
      const after = targetEpisode.frames.slice(endIndex + 1).map((frame) => ({
        ...frame,
        timestamp: frame.timestamp + deltaAfter,
      }));
      const combinedFrames = [...before, ...nextSegment, ...after];
      const nextFrames =
        startIndex === 0 && endIndex === targetEpisode.frames.length - 1
          ? applyConstraintsToFrames(combinedFrames, jointNames, jointLimits)
          : applyConstraintsToFrameRange({
              frames: combinedFrames,
              jointNames,
              jointLimits,
              startIndex,
              endIndex: startIndex + nextSegment.length - 1,
            });

      const lastTimestamp =
        nextFrames[nextFrames.length - 1]?.timestamp ?? targetEpisode.frames.at(-1)?.timestamp ?? 0;
      const nextFps =
        mode === "resample"
          ? baseFps
          : computeEffectiveFps({ ...targetEpisode, frames: nextFrames });
      const nextEpisode = markEpisodeVideoReferenceOnly({
        ...targetEpisode,
        frames: nextFrames,
        metadata: targetEpisode.metadata
          ? {
              ...targetEpisode.metadata,
              fps: nextFps > 0 ? nextFps : targetEpisode.metadata.fps,
              num_frames: nextFrames.length,
              episode_length_sec: lastTimestamp / 1000,
            }
          : undefined,
      }, EPISODE_RECORDED_VIDEO_SYNC_REASON_RETIME);

      setModifiedEpisodeTracked(nextEpisode);
      pushToHistory(nextEpisode);
      resetTrimAndFrame(startIndex);
      if (label) {
        toast.success(label);
      } else {
        toast.success(
          resolved
            ? `Speed ${speed.toFixed(2)}x (${mode})`
            : `Speed ${speed.toFixed(2)}x (${mode})`
        );
      }
    },
    [
      ensureTimelineEditingSession,
      getResolvedTrimRange,
      retimeMode,
      recordedFps,
      effectiveFps,
      jointNames,
      jointLimits,
      pushToHistory,
      resetTrimAndFrame,
      setModifiedEpisodeTracked,
    ]
  );

  const handleAutoSlowToLimits = useCallback(() => {
    const targetEpisode = ensureTimelineEditingSession();
    if (!targetEpisode) return;
    if (velocityViolations.length === 0) {
      toast.info("No velocity violations detected");
      return;
    }

    const frames = targetEpisode.frames;
    if (frames.length < 2) {
      toast.error("Not enough frames to retime");
      return;
    }

    let minFrame = Number.POSITIVE_INFINITY;
    let maxFrame = Number.NEGATIVE_INFINITY;
    let maxRatio = 0;
    velocityViolations.forEach((violation) => {
      minFrame = Math.min(minFrame, violation.frameIndex);
      maxFrame = Math.max(maxFrame, violation.frameIndex);
      maxRatio = Math.max(maxRatio, violation.ratio);
    });

    if (!Number.isFinite(minFrame) || !Number.isFinite(maxFrame) || maxRatio <= 1) {
      toast.info("No velocity violations detected");
      return;
    }

    const startIndex = Math.max(0, Math.min(frames.length - 2, minFrame - 1));
    const endIndex = Math.min(frames.length - 1, maxFrame);
    if (startIndex >= endIndex) {
      toast.error("Not enough frames to retime");
      return;
    }

    const effectiveRatio = Math.max(maxRatio, 1 + VELOCITY_LIMIT_TOLERANCE);
    const targetSpeed = Math.min(1, 1 / effectiveRatio);
    handleTimeScale(
      targetSpeed,
      { start: startIndex, end: endIndex },
      "Auto slow to limits",
      "scale"
    );
  }, [ensureTimelineEditingSession, handleTimeScale, velocityViolations]);

  const handleFixLimitViolations = useCallback(() => {
    if (!isEditMode || !modifiedEpisode) return;
    if (!jointLimits || Object.keys(jointLimits).length === 0) {
      toast.info("No joint limits available");
      return;
    }
    if (limitFixMode === "report") {
      if (limitViolations.length === 0) {
        toast.info("No joint limit violations detected");
      } else {
        toast.info(
          `${limitViolations.length} joint limit violation${
            limitViolations.length === 1 ? "" : "s"
          } detected`
        );
      }
      return;
    }

    const modeByJoint: Record<string, JointLimitMode> = {};
    Object.keys(jointLimits).forEach((jointName) => {
      modeByJoint[jointName] = limitFixMode;
    });

    const { frames: correctedFrames, summaries, violations } =
      applyJointLimitCorrectionsToFrames(
        modifiedEpisode.frames,
        jointLimits,
        modeByJoint
      );
    const report = summarizeJointLimitCorrections(summaries, violations);
    const shiftedJoints = summaries.filter(
      (summary) =>
        summary.mode === "shift" &&
        summary.shiftOffset !== null &&
        Math.abs(summary.shiftOffset) > 0
    ).length;

    if (report.totalViolations === 0 && report.totalClamped === 0 && shiftedJoints === 0) {
      toast.info("No joint limit fixes applied");
      return;
    }

    const nextEpisode = markEpisodeVideoReferenceOnly({
      ...modifiedEpisode,
      frames: correctedFrames,
    }, EPISODE_RECORDED_VIDEO_SYNC_REASON_LIMIT_FIX);
    setModifiedEpisodeTracked(nextEpisode);
    pushToHistory(nextEpisode);
    const actionLabel =
      limitFixMode === "clamp"
        ? `Clamped ${report.totalClamped} values`
        : `Shifted ${shiftedJoints} joint${shiftedJoints === 1 ? "" : "s"}`;
    toast.success(actionLabel);
  }, [
    isEditMode,
    jointLimits,
    limitFixMode,
    limitViolations.length,
    modifiedEpisode,
    pushToHistory,
    setModifiedEpisodeTracked,
  ]);

  const handleRescaleFps = useCallback(() => {
    const targetEpisode = ensureTimelineEditingSession();
    if (!targetEpisode) return;
    if (!Number.isFinite(retimeFps) || retimeFps <= 0) {
      toast.error("Enter a valid FPS");
      return;
    }
    if (targetEpisode.frames.length < 2) {
      toast.error("Not enough frames to rescale");
      return;
    }
    const sourceFrames = targetEpisode.frames;
    const timingCheck = analyzeTimestampSeries(sourceFrames);
    if (timingCheck.nonMonotonic) {
      toast.error("Non-monotonic timestamps detected. Fix timing before resampling FPS.");
      return;
    }
    const baseTime = sourceFrames[0].timestamp;
    const sourceTimes = sourceFrames.map((frame) => frame.timestamp - baseTime);
    const sourceDuration = sourceTimes[sourceTimes.length - 1];
    if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
      toast.error("Invalid timing data");
      return;
    }

    const targetCount = Math.max(2, Math.round((sourceDuration / 1000) * retimeFps) + 1);
    if (targetCount === sourceFrames.length) {
      toast.info("FPS already matches");
      return;
    }

    const lastSourceIndex = sourceFrames.length - 1;
    let sourceIndex = 0;

    const nextFrames = Array.from({ length: targetCount }, (_, idx) => {
      const tNew =
        targetCount === 1 ? 0 : (sourceDuration * idx) / (targetCount - 1);

      while (
        sourceIndex < lastSourceIndex - 1 &&
        sourceTimes[sourceIndex + 1] < tNew
      ) {
        sourceIndex += 1;
      }

      const t0 = sourceTimes[sourceIndex] ?? 0;
      const t1 = sourceTimes[sourceIndex + 1] ?? t0;
      const alpha = t1 > t0 ? (tNew - t0) / (t1 - t0) : 0;
      const frameA = sourceFrames[sourceIndex];
      const frameB = sourceFrames[sourceIndex + 1] ?? frameA;

      return {
        timestamp: tNew,
        jointPositions: interpolateFrameJointPositions(frameA, frameB, alpha),
        basePose: interpolateRobotBasePose(
          frameA.basePose,
          frameB.basePose,
          alpha
        ),
      };
    });
    const constrainedFrames = applyConstraintsToFrames(
      nextFrames,
      jointNames,
      jointLimits
    );

    const nextEpisode = markEpisodeVideoReferenceOnly({
      ...targetEpisode,
      frames: constrainedFrames,
      metadata: targetEpisode.metadata
        ? {
          ...targetEpisode.metadata,
          fps: retimeFps,
          num_frames: constrainedFrames.length,
          episode_length_sec: sourceDuration / 1000,
        }
        : undefined,
    }, EPISODE_RECORDED_VIDEO_SYNC_REASON_RESAMPLE_FPS);

    setModifiedEpisodeTracked(nextEpisode);
    pushToHistory(nextEpisode);
    resetTrimAndFrame(EPISODE_EDITOR_INITIAL_FRAME_INDEX);
    toast.success(`Resampled to ${retimeFps.toFixed(2)} FPS`);
  }, [
    ensureTimelineEditingSession,
    retimeFps,
    jointNames,
    jointLimits,
    pushToHistory,
    resetTrimAndFrame,
    setModifiedEpisodeTracked,
  ]);

  const handleAutoTrimRange = useCallback(() => {
    const targetEpisode = ensureTimelineEditingSession();
    if (!targetEpisode) return;
    if (jointNames.length === 0) {
      toast.error("No signals available for auto trim");
      return;
    }

    const trimRangeResult = resolveAutoTrimRange({
      frames: targetEpisode.frames,
      signalNames: jointNames,
      resolveSignalValue: (frame, signalName) =>
        resolveEpisodeFrameSignalValue(frame, signalName),
    });

    if (trimRangeResult.status !== "ok") {
      if (trimRangeResult.status === "not_enough_frames") {
        toast.error("Not enough frames to auto trim");
      } else if (trimRangeResult.status === "movement_too_small") {
        toast.info("Movement too small to auto trim");
      } else if (trimRangeResult.status === "no_movement") {
        toast.error("No movement detected for auto trim");
      } else if (trimRangeResult.status === "already_trimmed") {
        toast.info("Already trimmed");
      }
      return;
    }

    const { start, end } = trimRangeResult;
    setTrimRange({ start, end });
    applyFrameSelection(start);
    toast.success("Auto range set");
  }, [applyFrameSelection, ensureTimelineEditingSession, jointNames]);


  // Keyboard shortcuts (Blender-like)
  const exitEditMode = useCallback(() => {
    setIsEditMode(false);
    clearEditingJointSelection();
    closeExitConfirmDialog();
  }, [clearEditingJointSelection, closeExitConfirmDialog]);

  useEffect(() => {
    if (!open || !isEditMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S or Cmd+S - Save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (hasChanges && modifiedEpisode && onSaveEpisode) {
          // Quick save: use last choice if available, otherwise show dialog
          if (lastSaveChoice === 'overwrite') {
            onSaveEpisode(modifiedEpisode, false);
            toast.success(`Episode ${episode?.number ? episode.number - 1 : 0} updated`);
          } else if (lastSaveChoice === 'new') {
            openSaveDialog(true);
          } else {
            openSaveDialog(false);
          }
        }
      }
      // Shift+Ctrl+S or Shift+Cmd+S - Save As (always show dialog)
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        if (hasChanges && modifiedEpisode && onSaveEpisode) {
          openSaveDialog(true);
        }
      }
      // Ctrl+Z or Cmd+Z - Undo
      else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
      // Ctrl+Shift+Z, Cmd+Shift+Z, or Ctrl+Y - Redo
      else if (((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Z') ||
               ((e.ctrlKey || e.metaKey) && e.key === 'y')) {
        e.preventDefault();
        handleRedo();
      }
      // Escape - Exit edit mode (with confirmation if unsaved)
      else if (e.key === 'Escape') {
        e.preventDefault();
        if (hasChanges && modifiedEpisode && onSaveEpisode) {
          setShowExitConfirmDialog(true);
        } else {
          editSessionBaselineRef.current = null;
          exitEditMode();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    open,
    isEditMode,
    hasChanges,
    modifiedEpisode,
    onSaveEpisode,
    lastSaveChoice,
    episode,
    exitEditMode,
    openSaveDialog,
    handleUndo,
    handleRedo,
  ]);

  // Watch for container size changes to redraw canvas
  useEffect(() => {
    if (!canvasContainerRef.current) return;

    // Initialize size on mount
    const rect = canvasContainerRef.current.getBoundingClientRect();
    setContainerSize((prev) =>
      Math.abs(prev.width - rect.width) < 0.5 && Math.abs(prev.height - rect.height) < 0.5
        ? prev
        : { width: rect.width, height: rect.height }
    );

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerSize((prev) =>
          Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5
            ? prev
            : { width, height }
        );
      }
    });

    resizeObserver.observe(canvasContainerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);


  // Handle timeline mouse down
  const handleTimelineMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!effectiveEpisode || !canvasRef.current || effectiveEpisode.frames.length === 0) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Only allow dragging in the top header area (FRAME/SECS area)
    if (y > TIMELINE_HEADER_HEIGHT) return;
    
    if (x < CANVAS_PADDING || x > rect.width - CANVAS_PADDING) return;

    dragStartPositionRef.current = { x: e.clientX, y: e.clientY };
    isDraggingTimelineRef.current = false;

    const frameIndex = calculateFrameFromMouse(x, rect.width, effectiveEpisode.frames);

    applyFrameSelection(frameIndex);

    if (currentEpisodeIndex !== null && onSetCurrentEpisodeIndex) {
      onSetCurrentEpisodeIndex(currentEpisodeIndex);
    } else if (currentEpisodeIndex === null && allEpisodes.length > 0 && episode) {
      const episodeIndex = allEpisodes.findIndex(ep => ep.id === episode.id);
      if (episodeIndex !== -1 && onSetCurrentEpisodeIndex) {
        onSetCurrentEpisodeIndex(episodeIndex);
      }
    }

  }, [allEpisodes, applyFrameSelection, currentEpisodeIndex, effectiveEpisode, episode, onSetCurrentEpisodeIndex]);

  // Handle timeline mouse move
  const handleTimelineMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!effectiveEpisode || !canvasRef.current || !dragStartPositionRef.current) return;

    const moveDistance = Math.sqrt(
      Math.pow(e.clientX - dragStartPositionRef.current.x, 2) +
      Math.pow(e.clientY - dragStartPositionRef.current.y, 2)
    );

    if (moveDistance > DRAG_THRESHOLD) {
      isDraggingTimelineRef.current = true;
    }

    if (!isDraggingTimelineRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Only allow dragging if we're in the header area or if we started dragging from the header
    // This allows dragging to continue even if mouse moves slightly below the header
    const initialY = dragStartPositionRef.current.y - rect.top;
    if (initialY > TIMELINE_HEADER_HEIGHT) return;

    if (x >= CANVAS_PADDING && x <= rect.width - CANVAS_PADDING && effectiveEpisode.frames.length > 0) {
      const frameIndex = calculateFrameFromMouse(x, rect.width, effectiveEpisode.frames);

      applyFrameSelection(frameIndex);
    }
  }, [applyFrameSelection, effectiveEpisode]);

  const handleTimelineMouseUp = useCallback(() => {
    isDraggingTimelineRef.current = false;
    dragStartPositionRef.current = null;
  }, []);

  const handleTimelineMouseLeave = useCallback(() => {
    isDraggingTimelineRef.current = false;
    dragStartPositionRef.current = null;
  }, []);

  // Helper to create tangent handles for a point (Photoshop-style)
  const createHandlesForPoint = useCallback((
    pointIndex: number,
    rect: DOMRect,
    graphWidth: number,
    graphHeight: number,
    minVal: number,
    maxVal: number,
    valueRange: number
  ) => {
    const currentValue = resolveEditableSignalValue(
      modifiedEpisode,
      pointIndex,
      editingJoint!
    );
    const normalizedValue = (currentValue - minVal) / valueRange;
    const pointY = rect.height - CANVAS_PADDING - graphHeight * normalizedValue;
    const pointX = resolveFrameX(modifiedEpisode!.frames, pointIndex, graphWidth);
    const msPerPx = resolveMsPerPx(modifiedEpisode!.frames, graphWidth);
    
    // Calculate default handle positions based on curve tangent
    const prevIndex = Math.max(0, pointIndex - 1);
    const nextIndex = Math.min(modifiedEpisode!.frames.length - 1, pointIndex + 1);
    
    const prevValue = resolveEditableSignalValue(
      modifiedEpisode,
      prevIndex,
      editingJoint!
    );
    const nextValue = resolveEditableSignalValue(
      modifiedEpisode,
      nextIndex,
      editingJoint!
    );
    
    const prevNormalized = (prevValue - minVal) / valueRange;
    const nextNormalized = (nextValue - minVal) / valueRange;
    
    const prevY = rect.height - CANVAS_PADDING - graphHeight * prevNormalized;
    const nextY = rect.height - CANVAS_PADDING - graphHeight * nextNormalized;
    const prevX = resolveFrameX(modifiedEpisode!.frames, prevIndex, graphWidth);
    const nextX = resolveFrameX(modifiedEpisode!.frames, nextIndex, graphWidth);
    
    // Calculate tangent direction
    const dxLeft = pointX - prevX;
    const dyLeft = pointY - prevY;
    const dxRight = nextX - pointX;
    const dyRight = nextY - pointY;
    
    // Default handle distance
    const defaultHandleDistance = 40;
    
    // Calculate tangent angles
    const leftAngle = Math.atan2(dyLeft, dxLeft);
    const rightAngle = Math.atan2(dyRight, dxRight);
    
    // Position handles along tangent direction
    const leftHandleX = pointX - Math.cos(leftAngle) * defaultHandleDistance;
    const leftHandleY = pointY - Math.sin(leftAngle) * defaultHandleDistance;
    const rightHandleX = pointX + Math.cos(rightAngle) * defaultHandleDistance;
    const rightHandleY = pointY + Math.sin(rightAngle) * defaultHandleDistance;
    
    // Convert handle positions to values
    const leftNormalizedY = 1 - ((leftHandleY - CANVAS_PADDING) / graphHeight);
    const rightNormalizedY = 1 - ((rightHandleY - CANVAS_PADDING) / graphHeight);
    const leftHandleValue = minVal + leftNormalizedY * valueRange;
    const rightHandleValue = minVal + rightNormalizedY * valueRange;
    const leftOffset = (leftHandleX - pointX) * msPerPx;
    const rightOffset = (rightHandleX - pointX) * msPerPx;
    
    return {
      left: { timeOffset: Math.min(0, leftOffset), value: leftHandleValue },
      right: { timeOffset: Math.max(0, rightOffset), value: rightHandleValue }
    };
  }, [editingJoint, modifiedEpisode, resolveEditableSignalValue]);

  // Handle curve editing - click to select point (Photoshop-style: dragging creates handles)
  const handleCurveClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isEditMode || !editingJoint || !canvasRef.current || !modifiedEpisode) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Don't handle clicks in the header area
    if (y <= TIMELINE_HEADER_HEIGHT) return;

    const range = jointRanges[editingJoint];
    if (!range) return;

    const closestIndex = findClosestPointOnCurve(
      x, y,
      modifiedEpisode.frames,
      editingJoint,
      range,
      rect.width,
      rect.height,
      (_, frameIndex) =>
        resolveDisplayJointFrameValue(modifiedEpisode, frameIndex, editingJoint),
      selectedChartValueRange
    );

    if (closestIndex !== null) {
      selectedPointIndexRef.current = closestIndex;
      isDraggingPointRef.current = true;
      setSelectedPointIndex(closestIndex);
      setIsDraggingPoint(true);
      applyFrameSelection(closestIndex);
      
      // Photoshop-style: automatically create handles if they don't exist when dragging
      if (!tangentHandles.has(closestIndex)) {
        const graphWidth = rect.width - CANVAS_PADDING * 2;
        const graphHeight = rect.height - CANVAS_PADDING * 2;
        const valueRange = selectedChartValueRange ?? resolvePaddedChartValueRange(range);
        if (!valueRange) return;
        
        const handles = createHandlesForPoint(
          closestIndex,
          rect,
          graphWidth,
          graphHeight,
          valueRange.min,
          valueRange.max,
          valueRange.span
        );
        
        const newHandles = new Map(tangentHandles);
        newHandles.set(closestIndex, handles);
        setTangentHandles(newHandles);
      }
    }
  }, [
    isEditMode,
    editingJoint,
    modifiedEpisode,
    jointRanges,
    tangentHandles,
    applyFrameSelection,
    createHandlesForPoint,
    resolveDisplayJointFrameValue,
    selectedChartValueRange,
  ]);

  // Handle curve editing - drag to modify point (Photoshop-style: uses handles for smooth curves)
  const handleCurveDrag = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const activePointIndex = selectedPointIndexRef.current ?? selectedPointIndex;
    const isPointDragActive = isDraggingPointRef.current || isDraggingPoint;
    if (
      !isEditMode ||
      !editingJoint ||
      !canvasRef.current ||
      !modifiedEpisode ||
      activePointIndex === null ||
      !isPointDragActive
    ) {
      return;
    }

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Don't handle drags in the header area
    if (y <= TIMELINE_HEADER_HEIGHT) return;

    const range = jointRanges[editingJoint];
    if (!range) return;

    const graphWidth = rect.width - CANVAS_PADDING * 2;
    const graphHeight = rect.height - CANVAS_PADDING * 2;
    const valueRange = selectedChartValueRange ?? resolvePaddedChartValueRange(range);
    if (!valueRange) return;
    const minVal = valueRange.min;
    const maxVal = valueRange.max;

    // Convert mouse Y position to joint value
    const normalizedY = 1 - ((y - CANVAS_PADDING) / graphHeight);
    const newValue = minVal + normalizedY * valueRange.span;
    const clampedValue = Math.max(minVal, Math.min(maxVal, newValue));

    // Update the point value
    const currentValues = modifiedEpisode.frames.map((_, frameIndex) =>
      resolveEditableSignalValue(modifiedEpisode, frameIndex, editingJoint)
    );
    currentValues[activePointIndex] = clampedValue;

    // Get or create handles (Photoshop-style: handles are always used when dragging)
    let handles = tangentHandles.get(activePointIndex);

    // If handles don't exist, create them automatically
    if (!handles) {
      handles = createHandlesForPoint(
        activePointIndex,
        rect,
        graphWidth,
        graphHeight,
        minVal,
        maxVal,
        valueRange.span
      );
      const newHandles = new Map(tangentHandles);
      newHandles.set(activePointIndex, handles);
      setTangentHandles(newHandles);
    } else {
      // Update handle positions relative to the new point position (Photoshop-style)
      const oldPointValue = resolveEditableSignalValue(
        modifiedEpisode,
        activePointIndex,
        editingJoint
      );
      const deltaValue = clampedValue - oldPointValue;

      handles = {
        left: { timeOffset: handles.left.timeOffset, value: handles.left.value + deltaValue },
        right: { timeOffset: handles.right.timeOffset, value: handles.right.value + deltaValue },
      };

      const newHandles = new Map(tangentHandles);
      newHandles.set(activePointIndex, handles);
      setTangentHandles(newHandles);
    }

    // Always use Bezier interpolation with handles (Photoshop-style)
    const updatedValues = applyBezierCurve(
      currentValues,
      activePointIndex,
      handles.left,
      handles.right,
      modifiedEpisode.frames,
      minVal,
      maxVal
    );
    const constrainedValues = enforceJointConstraints(
      updatedValues,
      modifiedEpisode.frames,
      editingJoint,
      jointLimits
    );

    // Update modified episode
    const updatedFrames = modifiedEpisode.frames.map((frame, index) =>
      writeEpisodeFrameSignalValue(frame, editingJoint, constrainedValues[index])
    );

    const newEpisode = markEpisodeVideoReferenceOnly({
      ...modifiedEpisode,
      frames: updatedFrames
    }, EPISODE_RECORDED_VIDEO_SYNC_REASON_TRAJECTORY_EDIT);
    setModifiedEpisodeTracked(newEpisode);
    requestViewerSync(newEpisode);
    // Don't push to history while dragging - we'll push on mouse up to avoid too many history states
  }, [isEditMode, editingJoint, modifiedEpisode, selectedPointIndex, isDraggingPoint, jointRanges, jointLimits, tangentHandles, createHandlesForPoint, requestViewerSync, setModifiedEpisodeTracked, resolveEditableSignalValue, selectedChartValueRange]);

  // Handle curve editing - mouse up
  const handleCurveMouseUp = useCallback(() => {
    // Push to history when done dragging (not on every mouse move)
    const latestDraft = latestModifiedEpisodeRef.current;
    if ((isDraggingPoint || draggingHandle) && latestDraft) {
      pushToHistory(latestDraft);
    }
    isDraggingPointRef.current = false;
    setIsDraggingPoint(false);
    setDraggingHandle(null);
  }, [isDraggingPoint, draggingHandle, pushToHistory]);


  // Handle dragging tangent handles - allows free 2D movement
  const handleHandleDrag = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isEditMode || !editingJoint || !canvasRef.current || !modifiedEpisode || !draggingHandle) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Don't handle drags in the header area
    if (mouseY <= TIMELINE_HEADER_HEIGHT) return;

    const range = jointRanges[editingJoint];
    if (!range) return;

    const graphWidth = rect.width - CANVAS_PADDING * 2;
    const graphHeight = rect.height - CANVAS_PADDING * 2;
    const valueRange = selectedChartValueRange ?? resolvePaddedChartValueRange(range);
    if (!valueRange) return;
    const minVal = valueRange.min;
    const maxVal = valueRange.max;

    // Get the main point position
    const pointX = resolveFrameX(modifiedEpisode.frames, draggingHandle.pointIndex, graphWidth);
    const msPerPx = resolveMsPerPx(modifiedEpisode.frames, graphWidth);

    // Allow free 2D movement - calculate new handle position
    const newHandleX = Math.max(CANVAS_PADDING, Math.min(rect.width - CANVAS_PADDING, mouseX));
    const newHandleY = Math.max(CANVAS_PADDING, Math.min(rect.height - CANVAS_PADDING, mouseY));

    // Convert handle Y position to joint value
    const normalizedY = 1 - ((newHandleY - CANVAS_PADDING) / graphHeight);
    const newValue = minVal + normalizedY * valueRange.span;
    const clampedValue = Math.max(minVal, Math.min(maxVal, newValue));
    const rawOffset = (newHandleX - pointX) * msPerPx;
    const timeOffset =
      draggingHandle.side === "left" ? Math.min(0, rawOffset) : Math.max(0, rawOffset);

    // Update the handle offset and value
    const handles = tangentHandles.get(draggingHandle.pointIndex);
    if (!handles) return;

    const newHandles = new Map(tangentHandles);
    const updatedHandle = draggingHandle.side === 'left' 
      ? { 
          ...handles, 
          left: { timeOffset, value: clampedValue },
          right: handles.right
        }
      : { 
          ...handles, 
          left: handles.left,
          right: { timeOffset, value: clampedValue }
        };
    newHandles.set(draggingHandle.pointIndex, updatedHandle);
    setTangentHandles(newHandles);

    // Apply Bezier curve interpolation with updated handle positions
    const currentValues = modifiedEpisode.frames.map((_, frameIndex) =>
      resolveEditableSignalValue(modifiedEpisode, frameIndex, editingJoint)
    );
    const updatedValues = applyBezierCurve(
      currentValues,
      draggingHandle.pointIndex,
      updatedHandle.left,
      updatedHandle.right,
      modifiedEpisode.frames,
      minVal,
      maxVal
    );
    const constrainedValues = enforceJointConstraints(
      updatedValues,
      modifiedEpisode.frames,
      editingJoint,
      jointLimits
    );

    // Update modified episode
    const updatedFrames = modifiedEpisode.frames.map((frame, index) =>
      writeEpisodeFrameSignalValue(frame, editingJoint, constrainedValues[index])
    );

    const newEpisode = markEpisodeVideoReferenceOnly({
      ...modifiedEpisode,
      frames: updatedFrames
    }, EPISODE_RECORDED_VIDEO_SYNC_REASON_TRAJECTORY_EDIT);
    setModifiedEpisodeTracked(newEpisode);
    requestViewerSync(newEpisode);
    // Don't push to history while dragging - we'll push on mouse up to avoid too many history states
  }, [isEditMode, editingJoint, modifiedEpisode, draggingHandle, jointRanges, jointLimits, tangentHandles, requestViewerSync, setModifiedEpisodeTracked, resolveEditableSignalValue, selectedChartValueRange]);

  // Handle clicking on tangent handles
  const handleHandleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isEditMode || !editingJoint || !canvasRef.current || !modifiedEpisode) return false;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Don't handle clicks in the header area
    if (mouseY <= TIMELINE_HEADER_HEIGHT) return false;

    const range = jointRanges[editingJoint];
    if (!range) return false;
    const graphWidth = rect.width - CANVAS_PADDING * 2;
    const graphHeight = rect.height - CANVAS_PADDING * 2;
    const valueRange = selectedChartValueRange ?? resolvePaddedChartValueRange(range);
    if (!valueRange) return false;
    const msPerPx = resolveMsPerPx(modifiedEpisode.frames, graphWidth);

    // Check if clicking on any handle (use stored screen coordinates)
    for (const [pointIndex, handles] of tangentHandles.entries()) {
      const pointX = resolveFrameX(modifiedEpisode.frames, pointIndex, graphWidth);
      const leftHandleX = pointX + handles.left.timeOffset / msPerPx;
      const rightHandleX = pointX + handles.right.timeOffset / msPerPx;
      const leftNormalizedY = normalizeChartValue(handles.left.value, valueRange);
      const rightNormalizedY = normalizeChartValue(handles.right.value, valueRange);
      const leftHandleY = rect.height - CANVAS_PADDING - graphHeight * leftNormalizedY;
      const rightHandleY = rect.height - CANVAS_PADDING - graphHeight * rightNormalizedY;

      // Use stored screen coordinates, clamped to canvas bounds
      const clampedLeftX = Math.max(CANVAS_PADDING, Math.min(rect.width - CANVAS_PADDING, leftHandleX));
      const clampedLeftY = Math.max(CANVAS_PADDING, Math.min(rect.height - CANVAS_PADDING, leftHandleY));
      const clampedRightX = Math.max(CANVAS_PADDING, Math.min(rect.width - CANVAS_PADDING, rightHandleX));
      const clampedRightY = Math.max(CANVAS_PADDING, Math.min(rect.height - CANVAS_PADDING, rightHandleY));
      
      const leftDist = Math.sqrt(
        Math.pow(mouseX - clampedLeftX, 2) + Math.pow(mouseY - clampedLeftY, 2)
      );
      const rightDist = Math.sqrt(
        Math.pow(mouseX - clampedRightX, 2) + Math.pow(mouseY - clampedRightY, 2)
      );

      if (leftDist < CURVE_HANDLE_SELECTION_RADIUS_PX) {
        setDraggingHandle({ pointIndex, side: 'left' });
        selectedPointIndexRef.current = pointIndex;
        setSelectedPointIndex(pointIndex);
        applyFrameSelection(pointIndex);
        return true; // Indicate we handled this click
      }
      if (rightDist < CURVE_HANDLE_SELECTION_RADIUS_PX) {
        setDraggingHandle({ pointIndex, side: 'right' });
        selectedPointIndexRef.current = pointIndex;
        setSelectedPointIndex(pointIndex);
        applyFrameSelection(pointIndex);
        return true; // Indicate we handled this click
      }
    }
    return false; // No handle was clicked
  }, [applyFrameSelection, isEditMode, editingJoint, modifiedEpisode, tangentHandles, jointRanges, selectedChartValueRange]);

  // Calculate time display
  const calculateTime = useCallback((frame: number): string => {
    if (!effectiveEpisode || effectiveEpisode.frames.length === 0) return "0.00s";
    const clampedFrame = Math.max(0, Math.min(frame, effectiveEpisode.frames.length - 1));
    const start = effectiveEpisode.frames[0].timestamp ?? 0;
    const current = effectiveEpisode.frames[clampedFrame].timestamp ?? start;
    const calculatedTime = current - start;
    return `${(calculatedTime / 1000).toFixed(2)}s`;
  }, [effectiveEpisode]);

  const totalFrames = effectiveEpisode?.frames.length ?? 0;
  const resolvedTrimRange = useMemo(
    () => getResolvedTrimRange(totalFrames),
    [getResolvedTrimRange, totalFrames]
  );
  const trimMaxSec = useMemo(() => {
    if (!effectiveEpisode || effectiveEpisode.frames.length === 0) return 0;
    return resolveFrameTimeOffsetSec(
      effectiveEpisode.frames,
      effectiveEpisode.frames.length - 1
    );
  }, [effectiveEpisode]);
  const resolvedTrimTimes = useMemo(() => {
    if (!effectiveEpisode || !resolvedTrimRange) return null;
    return {
      start: resolveFrameTimeOffsetSec(effectiveEpisode.frames, resolvedTrimRange.start),
      end: resolveFrameTimeOffsetSec(effectiveEpisode.frames, resolvedTrimRange.end),
    };
  }, [effectiveEpisode, resolvedTrimRange]);

  // Draw canvas
  useLayoutEffect(() => {
    if (!effectiveEpisode || !canvasRef.current || showOnlyHeader) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    // Use containerSize if available, otherwise fall back to getBoundingClientRect
    const width = Math.max(
      1,
      Math.floor(containerSize.width > 0 ? containerSize.width : rect.width)
    );
    const height = Math.max(
      1,
      Math.floor(containerSize.height > 0 ? containerSize.height : rect.height)
    );
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    // Keep cursor overlay canvas in sync with main canvas dimensions.
    const cursorCanvas = cursorCanvasRef.current;
    if (cursorCanvas && (cursorCanvas.width !== pixelWidth || cursorCanvas.height !== pixelHeight)) {
      cursorCanvas.width = pixelWidth;
      cursorCanvas.height = pixelHeight;
      cursorCanvas.style.width = `${width}px`;
      cursorCanvas.style.height = `${height}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const graphHeight = height - CANVAS_PADDING * 2;
    const graphWidth = width - CANVAS_PADDING * 2;

    // Clear canvas
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, width, height);

    if (graphWidth <= 1 || graphHeight <= 1) {
      ctx.fillStyle = "#71717a";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText("Expand episode panel to view timeline", width / 2, Math.max(14, height / 2));
      return;
    }

    // Draw grid
    ctx.strokeStyle = "#27272a";
    ctx.lineWidth = 1;

    const activeEpisode = effectiveEpisode;
    const totalFrames = activeEpisode.frames.length;
    if (totalFrames === 0) return;
    const frameXs = activeEpisode.frames.map((_, frameIndex) =>
      resolveFrameX(activeEpisode.frames, frameIndex, graphWidth)
    );
    const { span } = getTimeBounds(activeEpisode.frames);
    const durationSeconds = span / 1000;
    const tickSeconds = buildTimelineTimeTicksSeconds(durationSeconds, graphWidth);
    const yAxisTicks = selectedChartValueRange
      ? buildJointPositionYAxisTicks({
          range: selectedChartValueRange,
          unitLabel: jointPositionUnitLabel,
        })
      : [];

    // Draw uniformly spaced time ticks independent of frame distribution.
    tickSeconds.forEach((tickSecondsValue) => {
      const normalizedTime =
        span > 0 ? Math.max(0, Math.min(1, (tickSecondsValue * 1000) / span)) : 0;
      const x = CANVAS_PADDING + graphWidth * normalizedTime;
      ctx.beginPath();
      ctx.moveTo(x, CANVAS_PADDING);
      ctx.lineTo(x, height - CANVAS_PADDING);
      ctx.stroke();
    });

    // Draw tick labels while preventing text overlap.
    ctx.fillStyle = "#71717a";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    let lastLabelRight = Number.NEGATIVE_INFINITY;
    const lastTickIndex = tickSeconds.length - 1;
    tickSeconds.forEach((tickSecondsValue, tickIndex) => {
      const normalizedTime =
        span > 0 ? Math.max(0, Math.min(1, (tickSecondsValue * 1000) / span)) : 0;
      const x = CANVAS_PADDING + graphWidth * normalizedTime;
      const label = formatTimelineTickLabel(tickSecondsValue, durationSeconds);
      const textWidth = ctx.measureText(label).width;
      const drawX = Math.max(
        CANVAS_PADDING + textWidth / 2,
        Math.min(width - CANVAS_PADDING - textWidth / 2, x)
      );
      const labelLeft = drawX - textWidth / 2;
      const labelRight = drawX + textWidth / 2;
      const canDraw = labelLeft >= lastLabelRight + TIME_TICK_LABEL_GAP_PX;
      const isLastTick = tickIndex === lastTickIndex;
      if (!canDraw && !isLastTick) return;
      if (!canDraw && isLastTick && tickSeconds.length > 1) return;
      ctx.fillText(
        label,
        drawX,
        height - CANVAS_PADDING + TIME_TICK_LABEL_Y_OFFSET_PX
      );
      lastLabelRight = labelRight;
    });

    if (yAxisTicks.length > 0) {
      yAxisTicks.forEach((tick) => {
        const normalizedValue = normalizeChartValue(tick.value, selectedChartValueRange!);
        const y = height - CANVAS_PADDING - graphHeight * normalizedValue;
        ctx.beginPath();
        ctx.moveTo(CANVAS_PADDING, y);
        ctx.lineTo(width - CANVAS_PADDING, y);
        ctx.stroke();
      });
    } else {
      for (let i = 0; i <= Y_AXIS_FALLBACK_GRID_LINE_COUNT; i += 1) {
        const y =
          CANVAS_PADDING +
          (graphHeight * i) / Y_AXIS_FALLBACK_GRID_LINE_COUNT;
        ctx.beginPath();
        ctx.moveTo(CANVAS_PADDING, y);
        ctx.lineTo(width - CANVAS_PADDING, y);
        ctx.stroke();
      }
    }

    if (resolvedTrimRange && totalFrames > 1) {
      const startX = frameXs[resolvedTrimRange.start] ?? CANVAS_PADDING;
      const endX = frameXs[resolvedTrimRange.end] ?? CANVAS_PADDING;
      const leftX = Math.min(startX, endX);
      const rightX = Math.max(startX, endX);

      ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
      ctx.fillRect(CANVAS_PADDING, CANVAS_PADDING, leftX - CANVAS_PADDING, graphHeight);
      ctx.fillRect(rightX, CANVAS_PADDING, width - CANVAS_PADDING - rightX, graphHeight);

      ctx.strokeStyle = "#52525b";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(leftX, CANVAS_PADDING);
      ctx.lineTo(leftX, height - CANVAS_PADDING);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(rightX, CANVAS_PADDING);
      ctx.lineTo(rightX, height - CANVAS_PADDING);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "#a1a1aa";
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("IN", leftX, CANVAS_PADDING - 4);
      ctx.fillText("OUT", rightX, CANVAS_PADDING - 4);
    }

    if (constraintMode !== "none" && constraintViolationZones.length > 0) {
      ctx.fillStyle = "rgba(239, 68, 68, 0.14)";
      ctx.strokeStyle = "rgba(239, 68, 68, 0.24)";
      ctx.lineWidth = 1;
      constraintViolationZones.forEach((zone) => {
        const startFrame = Math.max(0, Math.min(zone.start, totalFrames - 1));
        const endFrame = Math.max(0, Math.min(zone.end, totalFrames - 1));
        const startX = frameXs[startFrame] ?? CANVAS_PADDING;
        const endX = frameXs[endFrame] ?? CANVAS_PADDING;
        const leftX = Math.max(CANVAS_PADDING, Math.min(startX, endX));
        const rightX = Math.min(width - CANVAS_PADDING, Math.max(startX, endX));
        const zoneWidth = Math.max(1 / dpr, rightX - leftX);
        ctx.fillRect(leftX, CANVAS_PADDING, zoneWidth, graphHeight);
        ctx.beginPath();
        ctx.moveTo(leftX, CANVAS_PADDING);
        ctx.lineTo(leftX, height - CANVAS_PADDING);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(rightX, CANVAS_PADDING);
        ctx.lineTo(rightX, height - CANVAS_PADDING);
        ctx.stroke();
      });
    }

    // Draw axes
    ctx.strokeStyle = "#52525b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(CANVAS_PADDING, CANVAS_PADDING);
    ctx.lineTo(CANVAS_PADDING, height - CANVAS_PADDING);
    ctx.lineTo(width - CANVAS_PADDING, height - CANVAS_PADDING);
    ctx.stroke();

    if (yAxisTicks.length > 0) {
      ctx.fillStyle = "#a1a1aa";
      ctx.font = "9px monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      yAxisTicks.forEach((tick) => {
        const normalizedValue = normalizeChartValue(tick.value, selectedChartValueRange!);
        const y = height - CANVAS_PADDING - graphHeight * normalizedValue;
        ctx.beginPath();
        ctx.moveTo(CANVAS_PADDING - Y_AXIS_TICK_MARK_LENGTH_PX, y);
        ctx.lineTo(CANVAS_PADDING, y);
        ctx.stroke();
        ctx.fillText(
          tick.label,
          CANVAS_PADDING - Y_AXIS_TICK_LABEL_GAP_PX,
          y
        );
      });
      ctx.textBaseline = "alphabetic";
    }

    // Draw labels
    ctx.fillStyle = "#a1a1aa";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("Time", width / 2, height - X_AXIS_TITLE_BOTTOM_OFFSET_PX);

    ctx.save();
    ctx.translate(Y_AXIS_TITLE_X_OFFSET_PX, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`Joint Position (${jointPositionUnitLabel})`, 0, 0);
    ctx.restore();

    // Draw joint curves
    const velocityViolationSetByName = new Map<string, Set<number>>();
    velocityViolations.forEach((violation) => {
      const clampedFrame = Math.max(0, Math.min(violation.frameIndex, totalFrames - 1));
      const set = velocityViolationSetByName.get(violation.jointName) ?? new Set<number>();
      set.add(clampedFrame);
      velocityViolationSetByName.set(violation.jointName, set);
    });
    const limitViolationSetByName = new Map<string, Set<number>>();
    limitViolations.forEach((violation) => {
      const clampedFrame = Math.max(0, Math.min(violation.frameIndex, totalFrames - 1));
      const set = limitViolationSetByName.get(violation.jointName) ?? new Set<number>();
      set.add(clampedFrame);
      limitViolationSetByName.set(violation.jointName, set);
    });
    const mjlabIssueMapByName = new Map<string, Map<number, MjlabIssueMarker[]>>();
    mjlabIssueMarkers.forEach((marker) => {
      const clampedFrame = Math.max(0, Math.min(marker.frameIndex, totalFrames - 1));
      const frameMap =
        mjlabIssueMapByName.get(marker.jointName) ??
        new Map<number, MjlabIssueMarker[]>();
      const issues = frameMap.get(clampedFrame) ?? [];
      issues.push({ ...marker, frameIndex: clampedFrame });
      frameMap.set(clampedFrame, issues);
      mjlabIssueMapByName.set(marker.jointName, frameMap);
    });

    selectedDisplayJointNames.forEach((jointName) => {
      const color = resolveEpisodeSignalColor(jointName);
      const range = jointRanges[jointName];
      if (!range) return;
      const valueRange = selectedChartValueRange ?? resolvePaddedChartValueRange(range);
      if (!valueRange) return;

      // In edit mode, show non-edited lines in dark grey
      const isEditingThisJoint = isEditMode && editingJoint === jointName;
      const shouldDim = isEditMode && !!editingJoint && editingJoint !== jointName;
      const displayColor = shouldDim ? "#404040" : color;
      const shouldUseFullPrecision = constraintMode !== "none";
      const shouldUseFullPrecisionForSignal =
        WHEEL_JOINT_NAME_PATTERN.test(jointName) ||
        isEpisodeBaseSignalName(jointName);
      const curveStride = isEditingThisJoint || shouldUseFullPrecision
        || shouldUseFullPrecisionForSignal
        ? 1
        : Math.max(1, Math.floor(totalFrames / 1400));
      const sampledIndices: number[] = [];
      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += curveStride) {
        sampledIndices.push(frameIndex);
      }
      if (sampledIndices[sampledIndices.length - 1] !== totalFrames - 1) {
        sampledIndices.push(totalFrames - 1);
      }

      const velocityViolationSet = velocityViolationSetByName.get(jointName) ?? EMPTY_FRAME_SET;
      const limitViolationSet = limitViolationSetByName.get(jointName) ?? EMPTY_FRAME_SET;
      const mjlabIssueFrameMap = mjlabIssueMapByName.get(jointName) ?? null;
      const mjlabIssueFrameSet =
        mjlabIssueFrameMap !== null
          ? new Set(mjlabIssueFrameMap.keys())
          : EMPTY_FRAME_SET;

      const drawCurveSegments = (
        shouldDrawFrame: (frameIndex: number) => boolean,
        strokeColor: string,
        lineWidth: number,
        options?: {
          shadowColor?: string;
          shadowBlur?: number;
        }
      ) => {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = "round";
        ctx.shadowColor = options?.shadowColor ?? "transparent";
        ctx.shadowBlur = options?.shadowBlur ?? 0;
        let segmentOpen = false;

        for (const frameIndex of sampledIndices) {
          if (!shouldDrawFrame(frameIndex)) {
            if (segmentOpen) {
              ctx.stroke();
              segmentOpen = false;
            }
            continue;
          }

          const value = resolveDisplayJointFrameValue(
            activeEpisode,
            frameIndex,
            jointName
          );
          if (!Number.isFinite(value)) {
            if (segmentOpen) {
              ctx.stroke();
              segmentOpen = false;
            }
            continue;
          }
          const x = frameXs[frameIndex] ?? CANVAS_PADDING;
          const normalizedValue = normalizeChartValue(value, valueRange);
          const y = height - CANVAS_PADDING - graphHeight * normalizedValue;
          if (!segmentOpen) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            segmentOpen = true;
          } else {
            ctx.lineTo(x, y);
          }
        }

        if (segmentOpen) {
          ctx.stroke();
        }
        ctx.lineCap = "butt";
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
      };

      const baseCurveColor = displayColor;
      const defaultLineWidth = isEditingThisJoint ? 3 : 2;

      // Speed violations: keep the same thickness, but add a yellow glow beneath violating parts.
      if (velocityViolationSet.size > 0) {
        drawCurveSegments(
          (frameIndex) => velocityViolationSet.has(frameIndex),
          "rgba(255, 241, 118, 1)",
          defaultLineWidth,
          {
            shadowColor: "rgba(255, 235, 59, 1)",
            shadowBlur: 18,
          }
        );
        drawCurveSegments(
          (frameIndex) => velocityViolationSet.has(frameIndex),
          "rgba(250, 204, 21, 1)",
          defaultLineWidth,
          {
            shadowColor: "rgba(250, 204, 21, 1)",
            shadowBlur: 10,
          }
        );
      }

      if (mjlabIssueFrameSet.size > 0) {
        drawCurveSegments(
          (frameIndex) => mjlabIssueFrameSet.has(frameIndex),
          "rgba(248, 113, 113, 1)",
          defaultLineWidth + 1,
          {
            shadowColor: "rgba(239, 68, 68, 1)",
            shadowBlur: 18,
          }
        );
      }

      drawCurveSegments(() => true, baseCurveColor, defaultLineWidth);

      if (mjlabIssueFrameMap !== null) {
        Array.from(mjlabIssueFrameMap.entries()).forEach(([frameIndex, issues]) => {
          const clampedFrame = Math.max(0, Math.min(frameIndex, totalFrames - 1));
          const value = resolveDisplayJointFrameValue(
            activeEpisode,
            clampedFrame,
            jointName
          );
          if (!Number.isFinite(value)) return;
          const x = frameXs[clampedFrame] ?? CANVAS_PADDING;
          const normalizedValue = normalizeChartValue(value, valueRange);
          if (!Number.isFinite(normalizedValue)) return;
          const y = height - CANVAS_PADDING - graphHeight * normalizedValue;

          ctx.save();
          ctx.shadowColor = "rgba(239, 68, 68, 1)";
          ctx.shadowBlur = 10;
          ctx.fillStyle = "#ef4444";
          ctx.strokeStyle = "#111111";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, MJLAB_ISSUE_MARKER_RADIUS_PX, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.font = MJLAB_ISSUE_MARKER_LABEL_FONT;
          ctx.textAlign = "left";
          ctx.textBaseline = "bottom";
          ctx.fillStyle = "#fecaca";
          issues.forEach((issue, issueIndex) => {
            const label = issue.label || "MJLab";
            const labelWidth = Math.min(
              MJLAB_ISSUE_MARKER_LABEL_MAX_WIDTH_PX,
              ctx.measureText(label).width +
                MJLAB_ISSUE_MARKER_LABEL_OFFSET_X_PX
            );
            const preferredLabelX = x + MJLAB_ISSUE_MARKER_LABEL_OFFSET_X_PX;
            const labelX =
              preferredLabelX + labelWidth > width - CANVAS_PADDING
                ? x - labelWidth - MJLAB_ISSUE_MARKER_LABEL_OFFSET_X_PX
                : preferredLabelX;
            const labelY =
              y -
              MJLAB_ISSUE_MARKER_LABEL_OFFSET_Y_PX -
              issueIndex * MJLAB_ISSUE_MARKER_LABEL_GAP_PX;
            ctx.fillText(label, labelX, Math.max(CANVAS_PADDING, labelY));
          });
          ctx.restore();
        });
      }

      // Joint-limit violations: draw small amber pointer markers.
      if (limitViolationSet.size > 0) {
        const limitMarkerSize = 3;
        const limitMarkerFill = color;
        const limitMarkerStroke = "#000000";
        ctx.fillStyle = limitMarkerFill;
        ctx.strokeStyle = limitMarkerStroke;
        ctx.lineWidth = 1;
        Array.from(limitViolationSet).forEach((frameIndex) => {
          const clampedFrame = Math.max(0, Math.min(frameIndex, totalFrames - 1));
          const value = resolveDisplayJointFrameValue(
            activeEpisode,
            clampedFrame,
            jointName
          );
          if (!Number.isFinite(value)) return;
          const x = frameXs[clampedFrame] ?? CANVAS_PADDING;
          const normalizedValue = normalizeChartValue(value, valueRange);
          if (!Number.isFinite(normalizedValue)) return;
          const y = height - CANVAS_PADDING - graphHeight * normalizedValue;

          ctx.beginPath();
          ctx.moveTo(x, y - limitMarkerSize);
          ctx.lineTo(x + limitMarkerSize, y);
          ctx.lineTo(x, y + limitMarkerSize);
          ctx.lineTo(x - limitMarkerSize, y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        });
      }

      // Draw points on the editable line
      if (isEditingThisJoint) {
        activeEpisode.frames.forEach((_, frameIndex) => {
          const value = resolveDisplayJointFrameValue(
            activeEpisode,
            frameIndex,
            jointName
          );
          if (!Number.isFinite(value)) return;
          const x = frameXs[frameIndex] ?? CANVAS_PADDING;
          const normalizedValue = normalizeChartValue(value, valueRange);
          const y = height - CANVAS_PADDING - graphHeight * normalizedValue;

          const isSelected = selectedPointIndex === frameIndex;
          const hasHandles = tangentHandles.has(frameIndex);
          
          // Draw tangent handles and lines if they exist
          if (hasHandles && isSelected) {
            const handles = tangentHandles.get(frameIndex);
            if (handles) {
              const msPerPx = resolveMsPerPx(activeEpisode.frames, graphWidth);
              const leftHandleX = x + handles.left.timeOffset / msPerPx;
              const rightHandleX = x + handles.right.timeOffset / msPerPx;
              const leftNormalizedY = normalizeChartValue(handles.left.value, valueRange);
              const rightNormalizedY = normalizeChartValue(handles.right.value, valueRange);
              const leftHandleY = height - CANVAS_PADDING - graphHeight * leftNormalizedY;
              const rightHandleY = height - CANVAS_PADDING - graphHeight * rightNormalizedY;

              const clampedLeftX = Math.max(CANVAS_PADDING, Math.min(width - CANVAS_PADDING, leftHandleX));
              const clampedLeftY = Math.max(CANVAS_PADDING, Math.min(height - CANVAS_PADDING, leftHandleY));
              const clampedRightX = Math.max(CANVAS_PADDING, Math.min(width - CANVAS_PADDING, rightHandleX));
              const clampedRightY = Math.max(CANVAS_PADDING, Math.min(height - CANVAS_PADDING, rightHandleY));
              
              // Draw lines from point to handles (thicker, more visible)
              ctx.strokeStyle = "#3b82f6"; // Blue color for handles
              ctx.lineWidth = 2;
              ctx.setLineDash([4, 4]);
              
              // Left handle line
              ctx.beginPath();
              ctx.moveTo(x, y);
              ctx.lineTo(clampedLeftX, clampedLeftY);
              ctx.stroke();
              
              // Right handle line
              ctx.beginPath();
              ctx.moveTo(x, y);
              ctx.lineTo(clampedRightX, clampedRightY);
              ctx.stroke();
              
              ctx.setLineDash([]);
              
              // Draw larger, more visible handle circles
              const isDraggingLeft = draggingHandle?.pointIndex === frameIndex && draggingHandle.side === 'left';
              const isDraggingRight = draggingHandle?.pointIndex === frameIndex && draggingHandle.side === 'right';
              
              // Left handle - larger when dragging
              ctx.fillStyle = isDraggingLeft ? "#60a5fa" : "#ffffff";
              ctx.strokeStyle = "#3b82f6";
              ctx.lineWidth = isDraggingLeft ? 3 : 2;
              ctx.beginPath();
              ctx.arc(clampedLeftX, clampedLeftY, isDraggingLeft ? 6 : 5, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
              
              // Right handle - larger when dragging
              ctx.fillStyle = isDraggingRight ? "#60a5fa" : "#ffffff";
              ctx.strokeStyle = "#3b82f6";
              ctx.lineWidth = isDraggingRight ? 3 : 2;
              ctx.beginPath();
              ctx.arc(clampedRightX, clampedRightY, isDraggingRight ? 6 : 5, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }
          }
          
          // Draw point
          ctx.fillStyle = isSelected ? "#3b82f6" : color; // Blue when selected, original color otherwise
          ctx.beginPath();
          ctx.arc(x, y, isSelected ? 5 : 3, 0, Math.PI * 2);
          ctx.fill();
          
          // Draw a ring around selected point
          if (isSelected) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, 7, 0, Math.PI * 2);
            ctx.stroke();
          }
        });
      }
    });

    // Current frame cursor is drawn by the overlay canvas (cursorCanvasRef) via
    // requestAnimationFrame. When paused or scrubbing, sync the time ref to the
    // exact frame timestamp so the cursor sits precisely on the frame.
    // During playback the window event viewer3d:playbackTime keeps the ref up to
    // date at sub-frame precision; do not overwrite it here in that case.
    if (activeEpisode.frames.length > 0) {
      const displayFrame = getCurrentFrameValue(
        preservedFrameRef.current,
        globalCurrentFrame,
        currentFrame
      );
      const clampedFrame = Math.max(0, Math.min(displayFrame, activeEpisode.frames.length - 1));
      const frameTimestamp = activeEpisode.frames[clampedFrame]?.timestamp;
      // Only update from integer-frame data when paused/scrubbing.
      // During playback the viewer3d:playbackTime event provides sub-frame time.
      if (frameTimestamp !== undefined && !isPlayingAll) {
        playbackTimeMsRef.current = frameTimestamp;
      }
    }
  }, [effectiveEpisode, currentFrame, globalCurrentFrame, selectedDisplayJointNames, selectedChartValueRange, jointRanges, resolveEpisodeSignalColor, size, containerSize, calculateTime, isEditMode, editingJoint, selectedPointIndex, tangentHandles, draggingHandle, getResolvedTrimRange, resolvedTrimRange, violationFrames, velocityViolations, limitViolations, mjlabIssueMarkers, constraintMode, constraintViolationZones, showOnlyHeader, jointPositionUnitLabel, resolveDisplayJointFrameValue, isPlayingAll]);

  // Mouse handlers for dragging
  const handleMouseDownHeader = useCallback((e: React.MouseEvent) => {
    // Don't start dragging if clicking on buttons or interactive elements
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'BUTTON' ||
      target.closest('button') ||
      target.closest('[role="button"]') ||
      target.closest('[data-interactive]') ||
      target.closest('[data-radix-tooltip-trigger]') ||
      target.closest('[data-radix-popper-content-wrapper]') ||
      (target !== e.currentTarget && !target.classList.contains('drag-handle'))
    ) {
      return;
    }
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  }, [position]);

  const handleMouseDownResize = useCallback((e: React.MouseEvent, direction: string) => {
    e.stopPropagation();
    setIsResizing(true);
    setResizeDirection(direction);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
    });
  }, [size]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragOffset.x,
          y: e.clientY - dragOffset.y,
        });
      } else if (isResizing) {
        const deltaX = e.clientX - resizeStart.x;
        const deltaY = e.clientY - resizeStart.y;

        let newWidth = resizeStart.width;
        let newHeight = resizeStart.height;
        let newX = position.x;
        let newY = position.y;

        if (resizeDirection.includes('e')) {
          newWidth = Math.max(MIN_WINDOW_WIDTH, resizeStart.width + deltaX);
        }
        if (resizeDirection.includes('s')) {
          newHeight = Math.max(MIN_WINDOW_HEIGHT, resizeStart.height + deltaY);
        }
        if (resizeDirection.includes('w')) {
          const width = Math.max(MIN_WINDOW_WIDTH, resizeStart.width - deltaX);
          if (width > MIN_WINDOW_WIDTH) {
            newWidth = width;
            newX = position.x + deltaX;
          }
        }
        if (resizeDirection.includes('n')) {
          const height = Math.max(MIN_WINDOW_HEIGHT, resizeStart.height - deltaY);
          if (height > MIN_WINDOW_HEIGHT) {
            newHeight = height;
            newY = position.y + deltaY;
          }
        }

        setSize({ width: newWidth, height: newHeight });
        setPosition({ x: newX, y: newY });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, dragOffset, resizeStart, resizeDirection, position]);

  const startEditSessionIfNeeded = useCallback(() => {
    const currentDraft = latestModifiedEpisodeRef.current;
    const source = currentDraft ?? episode;
    if (!source) return;

    if (!isEditMode) {
      editSessionBaselineRef.current = cloneEpisodeForEditing(source);
      const draft = cloneEpisodeForEditing(source);
      initializeDraftState(draft, { syncViewer: true });
      setIsEditMode(true);
    }
  }, [episode, initializeDraftState, isEditMode]);

  const abortEditSession = useCallback(() => {
    const baseline = editSessionBaselineRef.current ?? (episode ? cloneEpisodeForEditing(episode) : null);
    if (baseline) {
      const restored = cloneEpisodeForEditing(baseline);
      initializeDraftState(restored, { syncViewer: true });
    }
    editSessionBaselineRef.current = null;
    exitEditMode();
    resetSaveAsNewDraft();
  }, [
    episode,
    exitEditMode,
    initializeDraftState,
    resetSaveAsNewDraft,
  ]);

  const handleSave = useCallback(() => {
    if (!modifiedEpisode || !onSaveEpisode) return;

    if (saveAsNew && newEpisodeName.trim()) {
      // Save as new episode
      onSaveEpisode(modifiedEpisode, true, newEpisodeName.trim());
      // Remember choice for quick save (Ctrl+S)
      setLastSaveChoice('new');
    } else if (!saveAsNew) {
      // Overwrite existing episode
      onSaveEpisode(modifiedEpisode, false);
      // Remember choice for quick save (Ctrl+S)
      setLastSaveChoice('overwrite');
    }

    // Close dialog and exit edit mode
    resetSaveDialogState();
    editSessionBaselineRef.current = null;
    exitEditMode();
  }, [modifiedEpisode, onSaveEpisode, saveAsNew, newEpisodeName, exitEditMode, resetSaveDialogState]);

  const handleCancelSave = useCallback(() => {
    resetSaveDialogState();
  }, [resetSaveDialogState]);
  const handleExitConfirmSave = useCallback(() => {
    closeExitConfirmDialog();
    openSaveDialog(lastSaveChoice === "new");
  }, [closeExitConfirmDialog, lastSaveChoice, openSaveDialog]);

  const handleRequestExitEditMode = useCallback(() => {
    if (hasChanges && modifiedEpisode && onSaveEpisode) {
      setShowExitConfirmDialog(true);
      return;
    }
    editSessionBaselineRef.current = null;
    exitEditMode();
  }, [hasChanges, modifiedEpisode, onSaveEpisode, exitEditMode]);

  const handleJointSelect = useCallback((jointName: string) => {
    // Make sure the joint is visible first
    if (!selectedJoints.has(jointName)) {
      const newSelected = new Set(selectedJoints);
      newSelected.add(jointName);
      setSelectedJoints(newSelected);
    }
    startEditSessionIfNeeded();
    selectEditingJoint(jointName);
  }, [selectEditingJoint, selectedJoints, startEditSessionIfNeeded]);

  const handleCurveDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !modifiedEpisode) return;
    if (displayJointNames.length === 0 || modifiedEpisode.frames.length === 0) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    if (mouseY <= TIMELINE_HEADER_HEIGHT) return;

    const graphWidth = rect.width - CANVAS_PADDING * 2;
    const graphHeight = rect.height - CANVAS_PADDING * 2;
    if (graphWidth <= 0 || graphHeight <= 0) return;

    let closestJointName: string | null = null;
    let closestFrameIndex: number | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    displayJointNames.forEach((jointName) => {
      if (!selectedJoints.has(jointName)) return;
      const range = jointRanges[jointName];
      if (!range) return;
      const valueRange = selectedChartValueRange ?? resolvePaddedChartValueRange(range);
      if (!valueRange) return;

      modifiedEpisode.frames.forEach((_frame, frameIndex) => {
        const value = resolveDisplayJointFrameValue(modifiedEpisode, frameIndex, jointName);
        if (!Number.isFinite(value)) return;
        const pointX = resolveFrameX(modifiedEpisode.frames, frameIndex, graphWidth);
        const normalizedValue = normalizeChartValue(value, valueRange);
        const pointY = rect.height - CANVAS_PADDING - graphHeight * normalizedValue;
        const distance = Math.hypot(mouseX - pointX, mouseY - pointY);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestJointName = jointName;
          closestFrameIndex = frameIndex;
        }
      });
    });

    if (
      !closestJointName ||
      closestFrameIndex === null ||
      closestDistance > CURVE_DOUBLE_CLICK_SELECTION_RADIUS_PX
    ) {
      return;
    }

    handleJointSelect(closestJointName);
    selectedPointIndexRef.current = closestFrameIndex;
    isDraggingPointRef.current = false;
    setSelectedPointIndex(closestFrameIndex);
    setIsDraggingPoint(false);
    setDraggingHandle(null);
  }, [displayJointNames, handleJointSelect, jointRanges, modifiedEpisode, resolveDisplayJointFrameValue, selectedChartValueRange, selectedJoints]);

  const handleClearJointSelection = useCallback(() => {
    clearEditingJointSelection();
  }, [clearEditingJointSelection]);

  if (!open) return null;

  if (!episode) return null;

  const duration =
    totalFrames > 0 && effectiveEpisode
      ? effectiveEpisode.frames[effectiveEpisode.frames.length - 1].timestamp
      : 0;
  const durationSeconds = (duration / 1000).toFixed(1);
  const displayFrame = isPlayingAll
    ? globalCurrentFrame ?? currentFrame ?? preservedFrameRef.current ?? 0
    : getCurrentFrameValue(preservedFrameRef.current, globalCurrentFrame, currentFrame);
  const clampedDisplayFrame = Math.max(0, Math.min(displayFrame, totalFrames - 1));
  const currentVelocityViolation = velocityViolationMap.get(clampedDisplayFrame);
  const currentLimitViolation = limitViolationMap.get(clampedDisplayFrame);

  const content = (
    <div
      ref={containerRef}
      className={cn(
        "bg-background flex flex-col overflow-hidden h-full",
        inline ? "border-t border-border" : "fixed border-2 border-border rounded-lg shadow-2xl",
        isEditMode && hasChanges && "bg-orange-500/10 border-orange-500/30"
      )}
      style={inline ? {} : {
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${size.width}px`,
        height: `${size.height}px`,
        zIndex: 99999,
        userSelect: isDragging ? 'none' : 'auto',
      }}
    >
      {/* Header */}
      <div className="flex flex-col gap-2 px-3 py-2 bg-muted border-b border-border">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0 pointer-events-none">
            <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">
              Episode {episode ? episode.number - 1 : 0}{isEditMode && hasChanges && <span className="text-orange-500 ml-1 text-lg font-bold">*</span>}
            </h3>
            {/* Timeline Controls */}
            {onPlayAllEpisodes && (
              <div className="flex items-center gap-1 pointer-events-auto" onMouseDown={(e) => e.stopPropagation()}>
                {onSetCurrentEpisodeIndex && allEpisodes.length > 1 && (
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (allEpisodes.length === 0) return;
                          const currentIndex = currentEpisodeIndex ?? 0;
                          const prevIndex = currentIndex > 0 ? currentIndex - 1 : allEpisodes.length - 1;
                          onSetCurrentEpisodeIndex(prevIndex);
                          onSetGlobalFrame?.(0);
                        }}
                        disabled={allEpisodes.length <= 1}
                      >
                        <SkipBack className="w-3 h-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Previous Episode</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlayAllEpisodes();
                      }}
                      disabled={!episode || episode.frames.length === 0}
                    >
                      {isPlayingAll ? (
                        <Pause className="w-3 h-3" />
                      ) : (
                        <Play className="w-3 h-3 fill-current" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{isPlayingAll ? "Pause" : "Play"}</p>
                  </TooltipContent>
                </Tooltip>
                {onSetCurrentEpisodeIndex && allEpisodes.length > 1 && (
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (allEpisodes.length === 0) return;
                          const currentIndex = currentEpisodeIndex ?? 0;
                          const nextIndex = (currentIndex + 1) % allEpisodes.length;
                          onSetCurrentEpisodeIndex(nextIndex);
                          onSetGlobalFrame?.(0);
                        }}
                        disabled={allEpisodes.length <= 1}
                      >
                        <SkipForward className="w-3 h-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Next Episode</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}
            {isEditMode && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] px-1.5 py-0 h-4",
                  hasChanges && "border-orange-500/50 text-orange-500 bg-orange-500/10"
                )}
              >
                EDIT
              </Badge>
            )}
            <div className="flex items-center gap-2 px-1.5 py-0.5 text-[10px] font-mono flex-wrap min-w-0">
              <span className="tabular-nums">{displayFrame}/{totalFrames - 1}</span>
              <span className="text-muted-foreground/60">•</span>
              <span className="tabular-nums text-muted-foreground">
                {episode ? `${calculateTime(displayFrame).replace('s', '')}/${durationSeconds}s` : "0.00/0.00s"}
              </span>
              {effectiveFps > 0 && (
                <>
                  <span className="text-muted-foreground/60">•</span>
                  <span className="tabular-nums text-muted-foreground">
                    eff {effectiveFps.toFixed(2)} fps
                  </span>
                </>
              )}
              {hiddenEpisodeSignalCount > 0 && (
                <>
                  <span className="text-muted-foreground/60">•</span>
                  <span className="tabular-nums text-amber-400">
                    hidden {hiddenEpisodeSignalCount}
                  </span>
                </>
              )}
              {suggestedBaseSignalNames.length > 0 && (
                <>
                  <span className="text-muted-foreground/60">•</span>
                  <span
                    className="tabular-nums text-amber-400"
                    title="Signals available in other episodes and suggested for consistent dataset-wide comparison."
                  >
                    suggest {suggestedBaseSignalNames.join("/")}
                  </span>
                </>
              )}
              {timestampHealth.nonMonotonic && (
                <>
                  <span className="text-muted-foreground/60">•</span>
                  <span className="tabular-nums text-red-400">
                    time {timestampHealth.zeroOrNegativeCount} gap
                    {timestampHealth.zeroOrNegativeCount === 1 ? "" : "s"}
                  </span>
                </>
              )}
              {isEditMode && resolvedTrimRange && (
                <>
                  <span className="text-muted-foreground/60">•</span>
                  <span className="tabular-nums text-muted-foreground">
                    In F{resolvedTrimRange.start}
                    {resolvedTrimTimes && ` (${resolvedTrimTimes.start.toFixed(2)}s)`}
                    {" "}Out F{resolvedTrimRange.end}
                    {resolvedTrimTimes && ` (${resolvedTrimTimes.end.toFixed(2)}s)`}
                  </span>
                </>
              )}
              {currentVelocityViolation && (
                <>
                  <span className="text-muted-foreground/60">•</span>
                  <span className="tabular-nums text-red-400">
                    vel x{currentVelocityViolation.ratio.toFixed(2)} {currentVelocityViolation.jointName}
                  </span>
                </>
              )}
              {currentLimitViolation && (
                <>
                  <span className="text-muted-foreground/60">•</span>
                  <span className="tabular-nums text-amber-400">
                    limit {currentLimitViolation.joints.length}{" "}
                    {currentLimitViolation.joints[0]}
                  </span>
                </>
              )}
            </div>
            </div>
          </div>
          <div
            className="flex items-center gap-2 shrink-0 pointer-events-auto"
            onMouseDown={(e) => e.stopPropagation()}
          >
          {!isEditMode && (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    startEditSessionIfNeeded();
                  }}
                  disabled={!episode || totalFrames === 0}
                >
                  Edit
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Open timeline edit tools</p>
              </TooltipContent>
            </Tooltip>
          )}
          {/* Save Button (only in edit mode) */}
          {isEditMode && (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="default"
                  className="h-6 px-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (modifiedEpisode && onSaveEpisode) {
                      openSaveDialog(false);
                    }
                  }}
                  disabled={!hasChanges || !modifiedEpisode || !onSaveEpisode}
                >
                  <Save className="w-3.5 h-3.5 mr-1" />
                  <span className="text-xs">Save</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Save Changes (Ctrl+S)</p>
              </TooltipContent>
            </Tooltip>
          )}
          {isEditMode && (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRequestExitEditMode();
                  }}
                >
                  <span className="text-xs">Done</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Exit Edit Mode (Esc)</p>
              </TooltipContent>
            </Tooltip>
          )}
          {/* Joint Switcher */}
          <DropdownMenu>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 flex items-center gap-1 text-xs"
                    disabled={editableDisplayJointNames.length === 0}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{
                        backgroundColor: editingJoint
                          ? resolveEpisodeSignalColor(editingJoint)
                          : "#71717a",
                      }}
                    />
                    <span className="truncate max-w-[128px]">
                      {editingJointDisplayLabel || "No joint selected"}
                    </span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p>Select joint</p>
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              className="w-44 max-h-[220px] overflow-y-auto bg-[#282828] border-[#3d3d3d] p-0.5"
              align="end"
            >
              <DropdownMenuItem
                onClick={handleClearJointSelection}
                className={cn(
                  "text-[10px] font-mono cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                  "flex items-center gap-1 px-1.5 py-0.5",
                  editingJoint === null && "bg-[#3d3d3d]/60 text-white"
                )}
              >
                <div className="w-2 h-2 rounded-full flex-shrink-0 bg-[#71717a]" />
                <span className="flex-1 truncate">No joint selected</span>
              </DropdownMenuItem>
              <div className="h-px bg-[#3d3d3d] my-0.5" />
              {editableDisplayJointNames.map((jointName) => {
                const color = resolveEpisodeSignalColor(jointName);
                const isCurrent = jointName === editingJoint;
                const mappedJointName = displayJointNameToRobotJoint.get(jointName);
                const displayLabel = displayJointNameToLabel.get(jointName) ?? jointName;
                return (
                  <DropdownMenuItem
                    key={jointName}
                    onClick={() => handleJointSelect(jointName)}
                    className={cn(
                      "text-[10px] font-mono cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                      "flex items-center gap-1 px-1.5 py-0.5",
                      isCurrent && "bg-[#3d3d3d]/60 text-white"
                    )}
                  >
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="flex-1 truncate" title={displayLabel}>{displayLabel}</span>
                    {displayDifferentMappingSignalNameSet.has(jointName) && (
                      <span
                        className={cn(
                          "max-w-[54px] truncate text-[8px]",
                          mappedJointName ? "text-[#9d9d9d]" : "text-amber-400"
                        )}
                      >
                        {mappedJointName ?? "unmapped"}
                      </span>
                    )}
                    {isCurrent && (
                      <span className="text-[8px] uppercase text-orange-400">editing</span>
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </div>
        {isEditMode && (
          <div
            className="w-full overflow-x-auto pb-1"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex min-w-max items-center gap-2 pr-1">
              <div
                className={cn(
                  "flex items-center gap-2",
                  editingJoint && "opacity-50 pointer-events-none"
                )}
              >
              <span className={EDIT_TOOLBAR_SECTION_LABEL_CLASS}>Timeline</span>
              <div className={EDIT_TOOLBAR_GROUP_CLASS}>
                <span className={EDIT_TOOLBAR_LABEL_CLASS}>History</span>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className={EDIT_TOOLBAR_ICON_BUTTON_CLASS}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUndo();
                      }}
                      disabled={!canUndo}
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Undo (Ctrl+Z)</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className={EDIT_TOOLBAR_ICON_BUTTON_CLASS}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRedo();
                      }}
                      disabled={!canRedo}
                    >
                      <Redo2 className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Redo (Ctrl+Shift+Z)</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className={EDIT_TOOLBAR_GROUP_CLASS}>
                <span className={EDIT_TOOLBAR_LABEL_CLASS}>Trim</span>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className={EDIT_TOOLBAR_ICON_BUTTON_CLASS}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSetTrimPointWithScissors();
                      }}
                      disabled={totalFrames === 0}
                    >
                      <Scissors className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {trimRange.start === null
                        ? "Set In (current frame)"
                        : trimRange.end === null
                        ? "Set Out (current frame)"
                        : "Update nearest trim marker (current frame)"}
                    </p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className={EDIT_TOOLBAR_TEXT_BUTTON_CLASS}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAutoTrimRange();
                      }}
                      disabled={totalFrames < 2}
                    >
                      Auto
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Auto detect In/Out</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className={EDIT_TOOLBAR_TEXT_BUTTON_CLASS}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSetTrimPoint("start");
                      }}
                      disabled={totalFrames === 0}
                    >
                      In
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Set In (current frame)</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className={EDIT_TOOLBAR_TEXT_BUTTON_CLASS}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSetTrimPoint("end");
                      }}
                      disabled={totalFrames === 0}
                    >
                      Out
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Set Out (current frame)</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="secondary"
                      className={EDIT_TOOLBAR_TEXT_BUTTON_CLASS}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTrimToRange();
                      }}
                      disabled={!resolvedTrimRange}
                    >
                      Del Out
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Delete outside In/Out range</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="secondary"
                      className={EDIT_TOOLBAR_TEXT_BUTTON_CLASS}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteInsideRange();
                      }}
                      disabled={!resolvedTrimRange}
                    >
                      Del In
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Delete inside In/Out range</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className={EDIT_TOOLBAR_TEXT_BUTTON_CLASS}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleClearTrimRange();
                      }}
                      disabled={trimRange.start === null && trimRange.end === null}
                    >
                      Clear
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Clear range</p>
                  </TooltipContent>
                </Tooltip>
                <div className="flex items-center gap-1 pl-1 ml-1 border-l border-border/50">
                  <span className="text-[10px] text-muted-foreground">In</span>
                  <NumberInput
                    value={resolvedTrimTimes?.start}
                    onValueChange={(value) => handleSetTrimTime("start", value)}
                    min={0}
                    max={trimMaxSec}
                    step={0.01}
                    compact={true}
                    allowEmpty={true}
                    className="w-16"
                    disabled={totalFrames === 0}
                  />
                  <span className="text-[10px] text-muted-foreground">Out</span>
                  <NumberInput
                    value={resolvedTrimTimes?.end}
                    onValueChange={(value) => handleSetTrimTime("end", value)}
                    min={0}
                    max={trimMaxSec}
                    step={0.01}
                    compact={true}
                    allowEmpty={true}
                    className="w-16"
                    disabled={totalFrames === 0}
                  />
                </div>
              </div>
              <div className={EDIT_TOOLBAR_GROUP_CLASS}>
                <span className={EDIT_TOOLBAR_LABEL_CLASS}>Timing</span>
                <span className="text-[10px] text-muted-foreground">x</span>
                <NumberInput
                  value={retimeScale}
                  onValueChange={setRetimeScale}
                  min={0.1}
                  max={10}
                  step={0.05}
                  compact={true}
                  className="w-14"
                />
                <Select
                  value={retimeMode}
                  onValueChange={(value) => setRetimeMode(value as RetimeMode)}
                >
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <SelectTrigger className="h-7 w-28 px-2 text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        Scale: keeps poses, changes timing. Resample: changes poses to
                        keep FPS (riskier).
                      </p>
                    </TooltipContent>
                  </Tooltip>
                  <SelectContent>
                    <SelectItem value="scale">Scale time</SelectItem>
                    <SelectItem value="resample">Resample</SelectItem>
                  </SelectContent>
                </Select>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="secondary"
                      className={EDIT_TOOLBAR_TEXT_BUTTON_CLASS}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTimeScale(retimeScale, undefined, undefined, retimeMode);
                      }}
                      disabled={totalFrames < 2}
                    >
                      Apply
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Apply speed using selected mode</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className={EDIT_TOOLBAR_TEXT_BUTTON_CLASS}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAutoSlowToLimits();
                      }}
                      disabled={totalFrames < 2 || velocityViolations.length === 0}
                    >
                      Auto
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Auto slow between velocity violations</p>
                  </TooltipContent>
                </Tooltip>
                <span className="text-[10px] text-muted-foreground pl-1 ml-1 border-l border-border/50">
                  FPS
                </span>
                <NumberInput
                  value={retimeFps}
                  onValueChange={setRetimeFps}
                  min={1}
                  max={240}
                  step={1}
                  compact={true}
                  className="w-14"
                />
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="secondary"
                      className={EDIT_TOOLBAR_TEXT_BUTTON_CLASS}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRescaleFps();
                      }}
                      disabled={totalFrames < 2}
                    >
                      Set
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Resample frames to target FPS</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              </div>
              <div
                className={cn(
                  "flex items-center gap-2",
                  !editingJoint && "opacity-50 pointer-events-none"
                )}
              >
              <span className={EDIT_TOOLBAR_SECTION_LABEL_CLASS}>Joint</span>
              <div className={EDIT_TOOLBAR_GROUP_CLASS}>
                <span className={EDIT_TOOLBAR_LABEL_CLASS}>Smooth</span>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="secondary"
                      className={EDIT_TOOLBAR_TEXT_BUTTON_CLASS}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSmoothPreview();
                      }}
                      disabled={!editingJoint || !modifiedEpisode}
                    >
                      <Sparkles className="w-3.5 h-3.5 mr-1" />
                      <span>Preview</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Preview smoothing and velocity impact</p>
                  </TooltipContent>
                </Tooltip>
                <NumberInput
                  value={smoothingStrength}
                  onValueChange={setSmoothingStrength}
                  min={1}
                  max={20}
                  step={1}
                  compact={true}
                  className="w-16"
                />
              </div>
              <div className={EDIT_TOOLBAR_GROUP_CLASS}>
                <span className={EDIT_TOOLBAR_LABEL_CLASS}>Limits</span>
                <Select
                  value={limitFixMode}
                  onValueChange={(value) => setLimitFixMode(value as JointLimitMode)}
                >
                  <SelectTrigger className="h-7 w-24 px-2 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="report">Report</SelectItem>
                    <SelectItem value="clamp">Clamp</SelectItem>
                    <SelectItem value="shift">Shift</SelectItem>
                  </SelectContent>
                </Select>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="secondary"
                      className={EDIT_TOOLBAR_TEXT_BUTTON_CLASS}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFixLimitViolations();
                      }}
                      disabled={limitFixMode === "report" || limitViolations.length === 0}
                    >
                      Fix
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Apply joint limit fixes to this episode</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Content - hidden when showOnlyHeader is true */}
      {!showOnlyHeader && (
      <>
          <div className="flex items-center gap-2 px-3 py-1 border-b border-border/30 bg-muted/10">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
              Constraints
            </span>
            {constraintMode !== "none" && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[9px] px-1.5 py-0 h-4 border-transparent",
                  violationFrames.length > 0
                    ? "border-slate-500/40 text-slate-300 bg-slate-500/10"
                    : "text-muted-foreground/70"
                )}
              >
                {isConstraintScanRunning
                  ? "indexing..."
                  : `violations ${violationFrames.length} zones ${constraintViolationZones.length}`}
              </Badge>
            )}
            <span className="text-[9px] text-muted-foreground">
              Configure in left panel
            </span>
            <div className="flex items-center gap-2 text-[9px] text-muted-foreground flex-wrap">
              <span className="inline-flex items-center gap-1">
                <span
                  className="h-2.5 w-4 rounded-sm border"
                  style={{
                    backgroundColor: "rgba(239, 68, 68, 0.24)",
                    borderColor: "rgba(239, 68, 68, 0.45)",
                  }}
                />
                constraint zone
              </span>
              <span className="inline-flex items-center gap-1">
                <span
                  className="h-2.5 w-4 rounded-sm"
                  style={{
                    backgroundColor: "rgba(250, 204, 21, 0.95)",
                    boxShadow: "0 0 8px rgba(250, 204, 21, 1)",
                  }}
                />
                velocity glow
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rotate-45 border border-black bg-muted-foreground/80" />
                limit pointer
              </span>
            </div>
          </div>
          {/* Graph Canvas */}
          <div className="flex-1 flex overflow-hidden">
            <div ref={canvasContainerRef} className="flex-1 relative bg-background overflow-hidden">
              {/* Cursor overlay — drawn separately at rAF rate for sub-frame smoothness */}
              <canvas
                ref={cursorCanvasRef}
                className="absolute inset-0 w-full h-full pointer-events-none"
                style={{ background: 'transparent', zIndex: 2 }}
              />
              <canvas
                ref={canvasRef}
                className="relative z-0 w-full h-full"
                style={{ background: "#09090b", cursor: isEditMode && editingJoint ? 'crosshair' : 'default' }}
                onMouseDown={(e) => {
                  if (isEditMode && editingJoint) {
                    // First check if clicking on a handle
                    const handleClicked = handleHandleClick(e);
                    // If not a handle, check for curve point
                    if (!handleClicked) {
                      handleCurveClick(e);
                    }
                  } else {
                    handleTimelineMouseDown(e);
                  }
                }}
                onDoubleClick={(e) => {
                  handleCurveDoubleClick(e);
                }}
                onMouseMove={(e) => {
                  handleCanvasMouseMove(e);
                  if (isEditMode && editingJoint) {
                    if (draggingHandle) {
                      handleHandleDrag(e);
                    } else if (isDraggingPoint || isDraggingPointRef.current) {
                      handleCurveDrag(e);
                    }
                  } else {
                    handleTimelineMouseMove(e);
                  }
                }}
                onMouseUp={(e) => {
                  if (isEditMode && editingJoint) {
                    handleCurveMouseUp();
                  } else {
                    handleTimelineMouseUp();
                  }
                }}
                onMouseLeave={(e) => {
                  if (canvasRef.current) {
                    canvasRef.current.style.cursor = isEditMode && editingJoint ? 'crosshair' : 'default';
                  }
                  if (isEditMode && editingJoint) {
                    handleCurveMouseUp();
                  } else {
                    handleTimelineMouseLeave();
                  }
                }}
              />
              {/* Edit mode indicator overlay */}
              {isEditMode && editingJoint && (
                <div className="absolute top-2 left-2 pointer-events-none">
                  <div className="text-[8px] font-mono text-[#9d9d9d] bg-[#09090b]/80 px-1.5 py-0.5 rounded">
                    editing trajectory of joint <span style={{ color: resolveEpisodeSignalColor(editingJoint) }}>{editingJointDisplayLabel ?? editingJoint}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );

  const smoothPreviewDialog = (
    <EpisodeViewerDialog
      open={showSmoothPreviewDialog}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          clearSmoothPreview();
        }
      }}
      title="Confirm Smoothing"
      description="Review velocity-limit impact before applying smoothing."
      footer={
        <>
          <Button variant="ghost" onClick={clearSmoothPreview}>
            Cancel
          </Button>
          <Button variant="default" onClick={applySmoothPreview} disabled={!smoothPreviewEpisode}>
            Apply
          </Button>
        </>
      }
    >
      <div className="space-y-2 text-xs text-muted-foreground">
        {!jointLimits && <p>No velocity limits configured. Preview is informational only.</p>}
        {smoothPreviewSummary && (
          <>
            <p>
              Violations:{" "}
              <span className="text-foreground">
                {smoothPreviewSummary.violationCount}
              </span>
            </p>
            {smoothPreviewSummary.maxRatio > 0 && smoothPreviewSummary.worstJoint && (
              <p>
                Worst:{" "}
                <span className="text-foreground">
                  x{smoothPreviewSummary.maxRatio.toFixed(2)}{" "}
                  {smoothPreviewSummary.worstJoint}
                  {smoothPreviewSummary.worstTimeSec !== null &&
                    ` @ ${smoothPreviewSummary.worstTimeSec.toFixed(2)}s`}
                </span>
              </p>
            )}
            {smoothPreviewSummary.violationCount === 0 && (
              <p className="text-foreground">No velocity violations predicted.</p>
            )}
          </>
        )}
        {timestampHealth.nonMonotonic && (
          <p className="text-red-400">
            Non-monotonic timestamps detected. Velocity preview may be unreliable.
          </p>
        )}
      </div>
    </EpisodeViewerDialog>
  );

  // Save Dialog
  const saveDialog = (
    <EpisodeViewerDialog
      open={showSaveDialog}
      onOpenChange={setShowSaveDialog}
      title="Save Trajectory Changes"
      description="You have unsaved changes to the trajectory. How would you like to save them?"
      footer={
        <>
          <Button variant="outline" onClick={handleCancelSave}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saveAsNew && !newEpisodeName.trim()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4 py-4">
        <div className="flex items-center space-x-2">
          <input
            type="radio"
            id="overwrite"
            name="saveOption"
            checked={!saveAsNew}
            onChange={() => setSaveMode(false)}
            className="h-4 w-4"
          />
          <label htmlFor="overwrite" className="text-sm font-medium cursor-pointer">
            Overwrite existing episode
          </label>
        </div>
        <div className="flex items-center space-x-2">
          <input
            type="radio"
            id="saveAsNew"
            name="saveOption"
            checked={saveAsNew}
            onChange={() => setSaveMode(true)}
            className="h-4 w-4"
          />
          <label htmlFor="saveAsNew" className="text-sm font-medium cursor-pointer">
            Save as new episode
          </label>
        </div>
        {saveAsNew && (
          <div className="pl-6 space-y-2">
            <label htmlFor="newEpisodeName" className="text-sm text-muted-foreground">
              New episode name:
            </label>
            <Input
              id="newEpisodeName"
              value={newEpisodeName}
              onChange={(e) => setNewEpisodeName(e.target.value)}
              placeholder="Enter episode name"
              className="w-full"
            />
          </div>
        )}
      </div>
    </EpisodeViewerDialog>
  );


  // Exit Confirmation Dialog (Blender-like)
  const exitConfirmDialog = (
    <EpisodeViewerDialog
      open={showExitConfirmDialog}
      onOpenChange={setShowExitConfirmDialog}
      title="Unsaved Changes"
      description="You have unsaved changes to the trajectory. Do you want to save before exiting?"
      footer={
        <>
          <Button variant="outline" onClick={abortEditSession}>
            Don't Save
          </Button>
          <Button variant="outline" onClick={closeExitConfirmDialog}>
            Cancel
          </Button>
          <Button onClick={handleExitConfirmSave}>
            Save
          </Button>
        </>
      }
    />
  );

  const contentWithDialog = (
    <>
      {content}
      {smoothPreviewDialog}
      {saveDialog}
      {exitConfirmDialog}
    </>
  );

  if (inline) {
    return contentWithDialog;
  }

  return typeof window !== 'undefined' ? createPortal(contentWithDialog, document.body) : null;
};
