import type React from "react";
import { useJointStore } from "@/shared/store/useJointStore";
import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import {
  renameLink,
} from "@/features/urdf/editor/urdfEditorActions";
import type { JointAxisMap, JointLimits } from "@/shared/lib/urdfBrowser";
import {
  updateJointLinksInUrdf,
  validateJointLinkReassignment,
} from "@/shared/lib/urdfCore";
import { type CollisionVisibility } from "@/features/urdf/editor/LinkEditor";
import {
  getSortedJointList,
  parseRobotName,
  sanitizeFilename,
  serializeEpisodeCollectionJson,
  type Episode,
  type EmbodimentRef,
  type EpisodeMetadata,
  type RecordedFrame,
} from "@/features/dataset";
import {
  EPISODE_FPS_MISMATCH_TOLERANCE,
  EPISODE_VELOCITY_LIMIT_TOLERANCE,
} from "@/features/dataset/episodeReviewParams";
import type {
  DatasetActions,
  DatasetReviewDeleteTarget,
} from "@/features/dataset/datasetActions";
import { createDefaultDatasetConstraintSettings } from "@/features/dataset/episode-viewer/constraintSettings";
import { useEpisodePipelineStore } from "@/features/dataset/episode-pipeline/useEpisodePipelineStore";
import { useCameraStore } from "@/shared/store/useCameraStore";
import type { JointLimitMode, JointMapping } from "@/shared/types/feature";
import { isMetricsEnabled } from "@/shared/lib/metrics";
import { API_BASE_URL } from "@/shared/config/runtime";
import { EpisodesPanel } from "@/features/layout/panels/EpisodesPanel";
import { EpisodePreviewPanel } from "@/features/layout/panels/EpisodePreviewPanel";
import { HfDatasetImportDialogs } from "@/features/layout/sidebar/HfDatasetImportDialogs";
import { useViewerPlaybackStore } from "@/shared/store/useViewerPlaybackStore";
import { type PlaybackMode } from "@/features/viewer/playback/episodeCoordinator";
import type { PackageRootMap } from "@/shared/lib/urdfBrowser";
import {
  TOP_NAV_HEIGHT,
  VIEWPORT_HEIGHT_WITH_TOP_NAV,
} from "@/features/layout/page/constants";
import { toHfDatasetNumericRows } from "@/features/layout/sidebar/hfDatasetImportHelpers";
import {
  type DatasetSourceRecord,
} from "@/features/layout/sidebar/datasetSourceHelpers";
import { useHfLazyEpisodeLoader } from "@/features/layout/sidebar/useHfLazyEpisodeLoader";
import { useDatasetExportController } from "@/features/layout/sidebar/useDatasetExportController";
import { useDatasetActionBridge } from "@/features/layout/sidebar/useDatasetActionBridge";
import { useHfDatasetImportController } from "@/features/layout/sidebar/useHfDatasetImportController";
import { useLocalDatasetImportController } from "@/features/layout/sidebar/useLocalDatasetImportController";
import { useDatasetRecordingController } from "@/features/layout/sidebar/useDatasetRecordingController";
import { useEpisodeMutationController } from "@/features/layout/sidebar/useEpisodeMutationController";
import { useEpisodePreviewState } from "@/features/layout/sidebar/useEpisodePreviewState";
import { useEpisodeReviewController } from "@/features/layout/sidebar/useEpisodeReviewController";
import { useEpisodeViewerBridge } from "@/features/layout/sidebar/useEpisodeViewerBridge";
import { useReplaySessionController } from "@/features/layout/sidebar/useReplaySessionController";
import { useDatasetSessionController } from "@/features/layout/sidebar/useDatasetSessionController";
import { resolveLiveEpisodeIdsForReviewDelete } from "@/features/layout/sidebar/datasetReviewDeleteTargets";
import { buildTeleopMjlabRobotModel } from "@/features/teleop/recording/operatorTeleopReplayApi";
import { RECORDING_DEFAULT_FPS } from "@/features/layout/sidebar/recordingParams";
type JSZipConstructor = typeof import("jszip");

const loadJSZip = (() => {
  let cached: Promise<JSZipConstructor> | null = null;
  return () => {
    if (!cached) {
      cached = import("jszip").then((module) => module.default as JSZipConstructor);
    }
    return cached;
  };
})();

export const DEFAULT_SIDEBAR_WIDTH = 220;
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 320;
const metricsEnabled =
  typeof window !== "undefined" && isMetricsEnabled(window, import.meta.env);
const UNKNOWN_EMBODIMENT_PREFIX = "unknown:";
const FALLBACK_EMBODIMENT_BASE_FRAME = "base_link";
const FALLBACK_EMBODIMENT_EE_FRAME = "tool0";

const logMetric = (name: string, payload: Record<string, unknown>) => {
  if (!metricsEnabled || typeof performance === "undefined") return;
  console.debug(`[metrics] ${name}`, { t_ms: performance.now(), ...payload });
};

const toEmbodimentSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

interface SidebarProps {
  isLoading?: boolean;
  availableJoints?: string[];
  jointLimits?: JointLimits;
  jointAxes?: JointAxisMap;
  originalJointAxes?: JointAxisMap;
  originalUrdf?: string;
  vizUrdf?: string;
  onJointChange?: (jointName: string, value: number) => void;
  onJointSelect?: (jointName: string | null) => void;
  selectedJoint?: string | null;
  onVizUrdfChange?: (newContent: string) => void;
  onJointAxisChange?: (jointName: string, axis: [number, number, number]) => void;
  onResetAxis?: (jointName: string) => void;
  onJointTypeChange?: (jointName: string, jointType: string, lowerLimit?: number, upperLimit?: number) => void;
  onJointNameChange?: (oldName: string, newName: string) => boolean | void;
  onDeleteJoint?: (jointName: string) => void;
  onJointLinkChange?: (jointName: string, parentLink: string, childLink: string) => void;
  deletedJoints?: Set<string>;
  getExportUrdf?: () => string;
  onMotionDataUpload?: (file: File) => void;
  onPlayAnimation?: () => void;
  isPlaying?: boolean;
  motionDataFileName?: string;
  hasAnimationFrames?: boolean;
  currentFrame?: number;
  totalFrames?: number;
  width?: number;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  meshFiles?: Record<string, Blob>;
  onCollisionVisibilityChange?: (visibility: CollisionVisibility) => void;
  rotationPlaneVisible?: boolean;
  onRotationPlaneVisibilityChange?: (visible: boolean) => void;
  onFrameChange?: (frame: number) => void;
  onUrdfEditorToggle?: (show: boolean) => void;
  showUrdfEditor?: boolean;
  viewerSplitView?: boolean;
  onViewerSplitViewChange?: (splitView: boolean) => void;
  onViewerEpisodeChange?: (episode: Episode | null) => void;
  onViewerOpenChange?: (open: boolean) => void;
  onEpisodeSaveHandlerChange?: (
    handler: ((episode: Episode, saveAsNew: boolean, newName?: string) => void) | undefined
  ) => void;
  onRotateRobot?: (axis: [number, number, number], angleRad: number) => void;
  onResetRotation?: () => void;
  hasRotationChanges?: boolean;
  onDatasetActionsReady?: (actions: DatasetActions) => void;
  episodesViewHeight?: number;
  onEpisodesResizeStart?: (event: React.PointerEvent<HTMLDivElement>) => void;
  activeWorldSnapshotRef?: EpisodeMetadata["world_snapshot_ref"] | null;
  urdfBasePath?: string;
  packageRoots?: PackageRootMap;
  cameraPreviewEmptyStateMessage?: string;
}

export const Sidebar = ({
  isLoading = false,
  availableJoints = [],
  jointLimits = {},
  jointAxes = {},
  originalJointAxes = {},
  originalUrdf = "",
  vizUrdf = "",
  onJointChange,
  onJointSelect,
  selectedJoint,
  onVizUrdfChange,
  onJointAxisChange,
  onResetAxis,
  onJointTypeChange,
  onJointNameChange,
  onDeleteJoint,
  deletedJoints = new Set(),
  getExportUrdf,
  onRotateRobot,
  onResetRotation,
  hasRotationChanges = false,
  onMotionDataUpload: _onMotionDataUpload,
  onPlayAnimation,
  isPlaying = false,
  motionDataFileName,
  hasAnimationFrames = false,
  currentFrame = 0,
  totalFrames = 0,
  width = DEFAULT_SIDEBAR_WIDTH,
  isCollapsed = false,
  onToggleCollapse,
  meshFiles = {},
  onCollisionVisibilityChange,
  onFrameChange,
  onUrdfEditorToggle,
  showUrdfEditor = false,
  viewerSplitView = false,
  onViewerSplitViewChange,
  onViewerEpisodeChange,
  onViewerOpenChange,
  onEpisodeSaveHandlerChange,
  onDatasetActionsReady,
  episodesViewHeight = 0.4,
  onEpisodesResizeStart,
  activeWorldSnapshotRef = null,
  urdfBasePath,
  packageRoots,
  cameraPreviewEmptyStateMessage,
}: SidebarProps) => {
  const [collisionVisibility, setCollisionVisibility] = useState<CollisionVisibility>({});

  // Notify parent when collision visibility changes
  useEffect(() => {
    onCollisionVisibilityChange?.(collisionVisibility);
  }, [collisionVisibility, onCollisionVisibilityChange]);

  const storeJointValues = useJointStore((s) => s.jointValues);
  const setStoreJointValue = useJointStore((s) => s.setJointValue);
  const availableJointsStore = useJointStore((s) => s.availableJoints);
  const cameras = useCameraStore((s) => s.cameras);
  const [episodePreviewCameraId, setEpisodePreviewCameraId] = useState<string | null>(null);

  // Keep a stable selection for episode playback camera previews
  useEffect(() => {
    if (episodePreviewCameraId && cameras.some((c) => c.id === episodePreviewCameraId)) return;
    if (cameras.length > 0) {
      setEpisodePreviewCameraId(cameras[0].id);
    } else {
      setEpisodePreviewCameraId(null);
    }
  }, [cameras, episodePreviewCameraId]);
  const previewJointValue = useJointStore((s) => s.previewJointValue);
  const setIsAnimating = useJointStore((s) => s.setIsAnimating);

  const robotName = useMemo(() => parseRobotName(originalUrdf), [originalUrdf]);
  const robotBaseName = useMemo(() => sanitizeFilename(robotName), [robotName]);
  const activeEmbodimentId = useMemo(() => {
    const robotIdentity = robotName || robotBaseName || "active";
    return `urdfstudio:${toEmbodimentSlug(robotIdentity)}:v1`;
  }, [robotBaseName, robotName]);

  const effectiveHfToken = null;
  const hfTokenGate = useMemo(
    () => ({
      kind: "credential" as const,
      enabled: false,
      unavailableSuffix: "backend auth required",
      unavailableReason: "Hugging Face export requires backend-managed auth. Browser tokens are disabled.",
      disabledBadge: "backend auth required",
      requiredCredentials: [] as const,
    }),
    []
  );
  const [exportLimitMode, setExportLimitMode] = useState<JointLimitMode>("report");
  const [constraintSettings, setConstraintSettings] = useState(() =>
    createDefaultDatasetConstraintSettings()
  );

  const episodePipelineStates = useEpisodePipelineStore((state) => state.episodeStates);
  const setPipelineStage = useEpisodePipelineStore((state) => state.setStage);
  const setPipelineProgress = useEpisodePipelineStore((state) => state.setProgress);
  const resetPipelineProgress = useEpisodePipelineStore((state) => state.resetProgress);
  const setEpisodePipelineState = useEpisodePipelineStore((state) => state.setEpisodeState);
  const beginPipelineEpisodeLoad = useEpisodePipelineStore((state) => state.beginEpisodeLoad);
  const finishPipelineEpisodeLoad = useEpisodePipelineStore((state) => state.finishEpisodeLoad);
  const syncEpisodePipelineReadiness = useEpisodePipelineStore((state) => state.syncEpisodeReadiness);
  const clearMissingPipelineEpisodes = useEpisodePipelineStore((state) => state.clearMissingEpisodes);

  const buildFallbackEmbodimentRef = useCallback(
    (
      datasetPath: string,
      partitionLabel: string,
      datasetJointNames: string[]
    ): EmbodimentRef => {
      const suffixSeed = `${datasetPath}:${partitionLabel}:${datasetJointNames.join(",")}`;
      const suffix = toEmbodimentSlug(suffixSeed) || "unfingerprinted";
      return {
        embodiment_id: `${UNKNOWN_EMBODIMENT_PREFIX}${suffix}`,
        robot_type: datasetPath,
        base_frame: FALLBACK_EMBODIMENT_BASE_FRAME,
        ee_frame: FALLBACK_EMBODIMENT_EE_FRAME,
      };
    },
    []
  );

  const resolveHfEmbodimentRef = useCallback(
    async (
      datasetPath: string,
      partitionLabel: string,
      datasetJointNames: string[]
    ): Promise<EmbodimentRef> => {
      const fallback = buildFallbackEmbodimentRef(
        datasetPath,
        partitionLabel,
        datasetJointNames
      );
      try {
        const response = await fetch(`${API_BASE_URL}/datasets/embodiments/resolve`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            urdf_xml: originalUrdf || undefined,
            robot_type: datasetPath,
            base_frame: FALLBACK_EMBODIMENT_BASE_FRAME,
            ee_frame: FALLBACK_EMBODIMENT_EE_FRAME,
          }),
        });
        if (!response.ok) {
          return fallback;
        }
        const payload = (await response.json()) as {
          embodiment?: EmbodimentRef;
        };
        const embodiment = payload.embodiment;
        if (!embodiment?.embodiment_id) {
          return fallback;
        }
        return embodiment;
      } catch {
        return fallback;
      }
    },
    [buildFallbackEmbodimentRef, originalUrdf]
  );

  const getJointOrderForFrames = useCallback(
    (frames: RecordedFrame[]) => {
      if (availableJointsStore.length > 0) {
        // Use URDF order directly, filtering to only joints present in frames
        const jointsInFrames = new Set(
          frames.flatMap((frame) => Object.keys(frame.jointPositions))
        );
        // Preserve URDF order, don't sort
        return availableJointsStore.filter((joint) => jointsInFrames.has(joint));
      }

      // Fallback: if no URDF joints available, extract from frames and sort alphabetically
      const jointsFromFrames = Array.from(
        new Set(
          frames.flatMap((frame) => Object.keys(frame.jointPositions))
        )
      );
      jointsFromFrames.sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
      );
      return jointsFromFrames;
    },
    [availableJointsStore]
  );
  const buildRecordingMjlabRobotModel = useCallback(
    () =>
      buildTeleopMjlabRobotModel({
        name: robotName,
        urdfXml: vizUrdf || originalUrdf || "",
        urdfBasePath,
        packageRoots,
        meshFiles,
      }),
    [meshFiles, originalUrdf, packageRoots, robotName, urdfBasePath, vizUrdf]
  );

  // Recording state - multiple episodes
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(null);
  const [currentPlayingEpisodeIndex, setCurrentPlayingEpisodeIndex] = useState<number | null>(null);
  const episodesRef = useRef<Episode[]>([]);
  const [targetFps, setTargetFps] = useState<number>(RECORDING_DEFAULT_FPS);
  const isPlayingAllRef = useRef<boolean>(false);
  const playbackSpeed = useViewerPlaybackStore((state) => state.playbackSpeed);
  const playbackEpisode = useViewerPlaybackStore((state) => state.playbackEpisode);
  const setPlaybackSpeed = useViewerPlaybackStore((state) => state.setPlaybackSpeed);
  // Track dataset sources for future mixing
  const [datasetSources, setDatasetSources] = useState<DatasetSourceRecord[]>([]);
  const {
    activeReplayEpisode,
    activeReplayWorldSnapshotWarning,
    activeReplayTimeSec,
    recordedVideoCameras,
    recordedVideoStreams,
    activeReplayRecordedVideoSyncInfo,
  } = useEpisodePreviewState({
    episodes,
    currentPlayingEpisodeIndex,
    playbackEpisode,
    currentFrame,
    activeWorldSnapshotRef,
  });
  function applyHfLazyEpisodeLimitCorrections(
    frames: RecordedFrame[],
    modeByJoint?: Record<string, JointLimitMode | undefined>,
    limitsOverride?: JointLimits
  ) {
    return applyLimitCorrections(frames, modeByJoint, limitsOverride);
  }
  const {
    getLazyEpisodeRef: getHfLazyEpisodeRef,
    registerLazyLoadContext,
    materializeEpisode: materializeHfLazyEpisode,
  } = useHfLazyEpisodeLoader({
    episodes,
    episodesRef,
    setEpisodes,
    effectiveHfToken,
    toNumericRows: toHfDatasetNumericRows,
    setEpisodePipelineState,
    beginPipelineEpisodeLoad,
    finishPipelineEpisodeLoad,
    syncEpisodePipelineReadiness,
    clearMissingPipelineEpisodes,
  });
  const {
    isImportingFromHFDataset,
    pendingHfRemainderEpisodeId,
    pendingHfRemainderLabel,
    isLoadingPendingHfRemainder,
    clearPendingHfRemainderUi,
    loadPendingHfRemainder,
    abortPendingHfRemainderLoad,
    openPendingHfRemapDialog,
    loadEpisodesFromHuggingFaceDataset,
    mappingDialog: hfDatasetMappingDialog,
    partitionDialog: hfDatasetPartitionDialog,
  } = useHfDatasetImportController({
    activeEmbodimentId,
    availableJoints: availableJointsStore,
    effectiveHfToken,
    hfTokenUnavailableReason: hfTokenGate.unavailableReason,
    jointLimits,
    setEpisodes,
    setDatasetSources,
    setPipelineStage,
    setPipelineProgress,
    resetPipelineProgress,
    registerLazyLoadContext,
    applyLimitCorrections: applyHfLazyEpisodeLimitCorrections,
    resolveHfEmbodimentRef,
  });
  const {
    isExportingDataset,
    isUploadingToHF,
    exportDatasetToLeRobotFormat,
    uploadEpisodesToHuggingFace,
  } = useDatasetExportController({
    episodes,
    datasetSources,
    getHfLazyEpisodeRef: getHfLazyEpisodeRef,
    robotBaseName,
    robotName,
    availableJoints: availableJointsStore,
    exportLimitMode,
    jointLimits,
    metricsEnabled,
    loadJSZip,
    effectiveHfToken,
    hfTokenUnavailableReason: hfTokenGate.unavailableReason,
    logMetric,
  });
  const {
    currentLoadedEpisodeRef,
    applyEpisodeMutationSelection,
    stopReplayPlaybackState,
    resetReplayFrameToStart,
    stopAllPlayback,
    setEpisodeAndFrame,
    playEpisode,
    playAllEpisodes,
  } = useReplaySessionController({
    episodesRef,
    isPlayingAllRef,
    currentPlayingEpisodeIndex,
    currentFrame,
    totalFrames,
    isPlaying,
    isPlayingAll,
    playbackMode,
    episodePipelineStates,
    getLazyEpisodeRef: getHfLazyEpisodeRef,
    materializeEpisode: materializeHfLazyEpisode,
    setEpisodes,
    setCurrentPlayingEpisodeIndex,
    setIsPlayingAll,
    setPlaybackMode,
    onFrameChange,
    onViewerOpenChange,
    onViewerEpisodeChange,
    onViewerSplitViewChange,
  });
  const {
    beginRecording,
    isRecording,
    recordingFps,
    recordingStats,
    setRecordingFps,
    startRecording,
    stopRecording,
  } = useDatasetRecordingController({
    getCurrentEpisodes: () => episodesRef.current,
    jointLimits,
    buildMjlabRobotModel: buildRecordingMjlabRobotModel,
    robotBaseName,
    setEpisodes,
    setDatasetSources,
    getJointOrderForFrames,
    stopReplayPlaybackState,
    resetReplayFrameToStart,
    setCurrentPlayingEpisodeIndex,
    setIsAnimating,
  });
  useEffect(() => {
    episodesRef.current = episodes;
  }, [episodes]);
  const {
    computeEpisodeFps,
    getEpisodeVelocityStatus,
    applyTargetFps,
    applyLimitCorrections,
    exportEpisodeToDataFile,
  } = useEpisodeReviewController({
    jointLimits,
    robotBaseName,
    targetFps,
    currentFrame,
    episodesRef,
    setEpisodes,
    setCurrentPlayingEpisodeIndex,
    currentLoadedEpisodeRef,
    isPlayingAllRef,
    getJointOrderForFrames,
    onEpisodeSaveHandlerChange,
    onViewerEpisodeChange,
    onViewerOpenChange,
    onViewerSplitViewChange,
  });
  useEpisodeViewerBridge({
    episodes,
    currentPlayingEpisodeIndex,
    currentFrame,
    totalFrames,
    onViewerEpisodeChange,
    onViewerOpenChange,
    onViewerSplitViewChange,
    stopReplayPlaybackState,
    resetReplayFrameToStart,
    setCurrentPlayingEpisodeIndex,
  });

  const handleJointChange = (jointName: string, value: number) => {
    const limited = previewJointValue(jointName, value);
    if (!onJointChange) {
      setStoreJointValue(jointName, limited);
      return;
    }
    onJointChange(jointName, limited);
  };


  const handleLinkNameChange = useCallback((oldName: string, newName: string): void => {
    if (newName === oldName || !vizUrdf) return;

    try {
      const result = renameLink(vizUrdf, oldName, newName);
      if (!result.success) {
        toast.error(result.error ?? "Failed to update link name");
        return;
      }

      onVizUrdfChange?.(result.content);
      toast.success(result.message ?? `Link renamed from "${oldName}" to "${newName}"`);
    } catch (error) {
      console.error("Error updating link name:", error);
      toast.error("Failed to update link name");
    }
  }, [vizUrdf, onVizUrdfChange]);

  const handleJointLinkChange = useCallback((jointName: string, parentLink: string, childLink: string): void => {
    if (!vizUrdf) return;

    try {
      const validation = validateJointLinkReassignment(
        vizUrdf,
        jointName,
        parentLink,
        childLink
      );
      if (!validation.valid) {
        toast.error(
          "error" in validation ? validation.error : "Invalid joint link update"
        );
        return;
      }
      const result = updateJointLinksInUrdf(vizUrdf, jointName, parentLink, childLink);
      if (!result.success) {
        toast.error(result.error ?? "Failed to update joint links");
        return;
      }

      onVizUrdfChange?.(result.content);
      toast.success(`Updated links for joint "${jointName}"`);
    } catch (error) {
      console.error("Error updating joint links:", error);
      toast.error("Failed to update joint links");
    }
  }, [vizUrdf, onVizUrdfChange]);

  const { handleFileUpload } = useLocalDatasetImportController({
    availableJoints: availableJointsStore,
    robotBaseName,
    setEpisodes,
    setDatasetSources,
    applyLimitCorrections,
    loadJSZip,
  });

  const { deleteEpisode, deleteEpisodes, retakeEpisode, moveEpisode } =
    useEpisodeMutationController({
      episodesRef,
      currentPlayingEpisodeIndex,
      currentLoadedEpisodeRef,
      isPlayingAllRef,
      applyEpisodeMutationSelection,
      stopReplayPlaybackState,
      resetReplayFrameToStart,
      beginRecording,
      setIsAnimating,
    });
  const {
    datasetSessionSummary,
    datasetSessionStatus,
    datasetSessionError,
    fetchReviewEpisode,
    listReviewEpisodes,
    getReviewState,
    updateReviewFlags,
    deleteReviewEpisodes,
  } = useDatasetSessionController({
    episodes,
    datasetSources,
  });
  const selectEpisodeById = useCallback(
    (episodeId: string) => {
      const episodeIndex = episodesRef.current.findIndex(
        (episode) => episode.id === episodeId
      );
      if (episodeIndex >= 0) {
        setCurrentPlayingEpisodeIndex(episodeIndex);
      }
    },
    [episodesRef, setCurrentPlayingEpisodeIndex]
  );
  const playEpisodeById = useCallback(
    async (episodeId: string) => {
      const episode = episodesRef.current.find((candidate) => candidate.id === episodeId);
      if (!episode) {
        return;
      }
      selectEpisodeById(episodeId);
      playEpisode(episode);
    },
    [episodesRef, playEpisode, selectEpisodeById]
  );
  const upsertReviewEpisode = useCallback(
    (episode: Episode) => {
      const currentEpisodes = episodesRef.current;
      const existingIndex = currentEpisodes.findIndex(
        (candidate) => candidate.id === episode.id
      );
      const nextEpisodes =
        existingIndex >= 0
          ? currentEpisodes.map((candidate, index) =>
              index === existingIndex ? episode : candidate
            )
          : [...currentEpisodes, episode];
      episodesRef.current = nextEpisodes;
      setEpisodes(nextEpisodes);
    },
    [episodesRef, setEpisodes]
  );
  const playReviewEpisode = useCallback(
    async (episodeId: string) => {
      const episode = await fetchReviewEpisode(episodeId);
      if (!episode) {
        throw new Error("Replay blocked: dataset session episode is not available");
      }
      if (episode.frames.length === 0) {
        throw new Error("Replay blocked: dataset session episode has no frames");
      }
      upsertReviewEpisode(episode);
      await playEpisode(episode);
    },
    [fetchReviewEpisode, playEpisode, upsertReviewEpisode]
  );
  const deleteEpisodesFromReview = useCallback(
    async (reviewEpisodes: readonly DatasetReviewDeleteTarget[]) => {
      const normalizedReviewEpisodes = Array.from(
        new Map(
          reviewEpisodes
            .map((episode) => ({
              ...episode,
              episode_id: episode.episode_id.trim(),
            }))
            .filter((episode) => episode.episode_id.length > 0)
            .map((episode) => [episode.episode_id, episode])
        ).values()
      );
      if (normalizedReviewEpisodes.length === 0) {
        return;
      }
      const reviewEpisodeIds = normalizedReviewEpisodes.map(
        (episode) => episode.episode_id
      );
      const liveEpisodeIds = resolveLiveEpisodeIdsForReviewDelete({
        episodes: episodesRef.current,
        reviewEpisodes: normalizedReviewEpisodes,
      });

      await deleteReviewEpisodes(reviewEpisodeIds);
      const deletedLiveEpisodes = deleteEpisodes(liveEpisodeIds);
      if (deletedLiveEpisodes) {
        toast.success(
          reviewEpisodeIds.length === 1
            ? "Episode deleted"
            : `Deleted ${reviewEpisodeIds.length} episodes`
        );
      }
    },
    [deleteEpisodes, deleteReviewEpisodes, episodesRef]
  );
  useDatasetActionBridge({
    onDatasetActionsReady,
    episodes,
    episodesRef,
    setEpisodes,
    currentPlayingEpisodeIndex,
    setCurrentPlayingEpisodeIndex,
    loadEpisodesFromHuggingFaceDataset,
    loadPendingHfRemainder,
    abortPendingHfRemainderLoad,
    materializeHfLazyEpisode,
    exportDatasetToLeRobotFormat,
    uploadEpisodesToHuggingFace,
    clearPendingHfRemainderUi,
    resetPipelineProgress,
    setPipelineStage,
    stopReplayPlaybackState,
    resetReplayFrameToStart,
    isImportingFromHFDataset,
    pendingHfRemainderLabel,
    isLoadingPendingHfRemainder,
    isExportingDataset,
    isUploadingToHF,
    exportLimitMode,
    setExportLimitMode,
    constraintSettings,
    setConstraintSettings,
    hfTokenGate,
    playEpisodeById,
    playReviewEpisode,
    selectEpisodeById,
    deleteEpisodesFromReview,
    datasetSessionSummary,
    datasetSessionStatus,
    datasetSessionError,
    listReviewEpisodes,
    getReviewState,
    updateReviewFlags,
  });

  return (
    <div
      className="sidebar-panel flex flex-col fixed left-0 bg-[hsl(var(--sidebar-bg))] border-r border-border/35 backdrop-blur-sm transition-transform duration-200 ease-out shadow-xl z-30"
      style={{
        width,
        minWidth: SIDEBAR_MIN_WIDTH,
        top: TOP_NAV_HEIGHT,
        height: VIEWPORT_HEIGHT_WITH_TOP_NAV,
        transform: isCollapsed ? "translateX(-100%)" : undefined,
        pointerEvents: isCollapsed ? "none" : "auto",
      }}
      aria-hidden={isCollapsed}
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        {isLoading && (
          <div className="flex-shrink-0 border-b border-border/30">
            <div className="px-2 py-1.5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span>Loading robot model...</span>
              </div>
            </div>
          </div>
        )}

        {/* Top Section - Recording Controls (shrinks when episode viewer grows) */}
        <EpisodesPanel
          episodes={episodes}
          episodePipelineStates={episodePipelineStates}
          episodesViewHeight={episodesViewHeight}
          isRecording={isRecording}
          recordingStats={recordingStats}
          recordingFps={recordingFps}
          setRecordingFps={setRecordingFps}
          fpsTarget={targetFps}
          setFpsTarget={setTargetFps}
          applyFpsTarget={applyTargetFps}
          limitCorrectionMode={exportLimitMode}
          setLimitCorrectionMode={setExportLimitMode}
          constraintSettings={constraintSettings}
          setConstraintSettings={setConstraintSettings}
          getEpisodeFps={computeEpisodeFps}
          getEpisodeVelocityStatus={getEpisodeVelocityStatus}
          velocityTolerance={EPISODE_VELOCITY_LIMIT_TOLERANCE}
          fpsTolerance={EPISODE_FPS_MISMATCH_TOLERANCE}
          startRecording={startRecording}
          stopRecording={stopRecording}
          handleFileUpload={handleFileUpload}
          playAllEpisodes={playAllEpisodes}
          stopAllPlayback={stopAllPlayback}
          setEpisodeAndFrame={setEpisodeAndFrame}
          setCurrentPlayingEpisodeIndex={setCurrentPlayingEpisodeIndex}
          playEpisode={playEpisode}
          moveEpisode={moveEpisode}
          retakeEpisode={retakeEpisode}
          exportEpisodeToDataFile={exportEpisodeToDataFile}
          deleteEpisode={deleteEpisode}
          onFrameChange={onFrameChange}
          isPlayingAll={isPlayingAll}
          currentFrame={currentFrame}
          currentPlayingEpisodeIndex={currentPlayingEpisodeIndex}
          activeReplayWorldSnapshotWarning={activeReplayWorldSnapshotWarning}
          playbackSpeed={playbackSpeed}
          setPlaybackSpeed={setPlaybackSpeed}
          datasetSessionSummary={datasetSessionSummary}
          datasetSessionStatus={datasetSessionStatus}
          datasetSessionError={datasetSessionError}
          pendingHfRemainderEpisodeId={pendingHfRemainderEpisodeId}
          pendingHfRemainderLabel={pendingHfRemainderLabel ?? undefined}
          isLoadingPendingHfRemainder={isLoadingPendingHfRemainder}
          onLoadPendingHfRemainder={loadPendingHfRemainder}
          onAbortPendingHfRemainder={abortPendingHfRemainderLoad}
          onRemapPendingHfRemainder={openPendingHfRemapDialog}
        />

        {/* Horizontal Resizer */}
        {onEpisodesResizeStart && (
          <div
            onPointerDown={onEpisodesResizeStart}
            className="cursor-row-resize select-none bg-border/30 hover:bg-border/60 transition-colors relative group flex-shrink-0 z-10"
            style={{ height: 4 }}
            aria-label="Resize episodes view"
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-12 h-0.5 bg-border/40 group-hover:bg-border/80 transition-colors rounded-full" />
            </div>
          </div>
        )}

        {/* Bottom Section - Camera monitor (independent sidebar split) */}
        <EpisodePreviewPanel
          episodesViewHeight={episodesViewHeight}
          cameras={cameras}
          recordedVideoCameras={recordedVideoCameras}
          recordedVideoStreams={recordedVideoStreams}
          recordedVideoSyncInfo={activeReplayRecordedVideoSyncInfo}
          recordedSyncTimeSec={activeReplayTimeSec}
          recordedSyncPlaying={isPlayingAll && isPlaying}
          recordedSyncEpisodeId={activeReplayEpisode?.id ?? null}
          episodePreviewCameraId={episodePreviewCameraId}
          setEpisodePreviewCameraId={setEpisodePreviewCameraId}
          vizUrdf={vizUrdf}
          originalUrdf={originalUrdf}
          meshFiles={meshFiles}
          urdfBasePath={urdfBasePath}
          packageRoots={packageRoots}
          cameraPreviewEmptyStateMessage={cameraPreviewEmptyStateMessage}
        />
      </div>

      <HfDatasetImportDialogs
        availableJoints={availableJointsStore}
        jointLimits={jointLimits}
        mappingDialog={hfDatasetMappingDialog}
        partitionDialog={hfDatasetPartitionDialog}
      />

    </div>
  );
};
