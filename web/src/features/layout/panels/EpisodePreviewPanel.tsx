import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { EpisodeCameraPreview } from "@/features/camera/EpisodeCameraPreview";
import { useOperatorPerceptionStore } from "@/features/teleop/perception/operatorPerceptionStore";
import { useCameraStore } from "@/shared/store/useCameraStore";
import {
  resolveEpisodeRecordedVideoSyncMessage,
  type EpisodeRecordedVideoSyncInfo,
} from "@/features/dataset/episodeVideoSync";
import type { RecordedVideoStream } from "@/features/layout/sidebar/episodePreviewHelpers";
import type { MeshFiles } from "@/shared/types/feature";
import type { Camera } from "@/shared/types/camera";
import type { PackageRootMap } from "@/shared/lib/urdfBrowser";
import { MIN_CAMERAS_PANEL_HEIGHT } from "@/features/layout/page/constants";
import { Film } from "lucide-react";
import {
  EPISODE_PREVIEW_PANEL_PARAMS,
  shouldShowOperatorLiveCameraInEpisodePreviewMode,
  type ExtendedEpisodePreviewMode,
  type EpisodePreviewMode,
} from "@/features/layout/panels/episodePreviewPanelParams";

type EpisodePreviewPanelProps = {
  episodesViewHeight?: number;
  cameras: Camera[];
  recordedVideoCameras?: string[];
  recordedVideoStreams?: RecordedVideoStream[];
  recordedVideoSyncInfo?: EpisodeRecordedVideoSyncInfo | null;
  recordedSyncTimeSec?: number | null;
  recordedSyncPlaying?: boolean;
  recordedSyncEpisodeId?: string | null;
  episodePreviewCameraId: string | null;
  setEpisodePreviewCameraId: (value: string) => void;
  vizUrdf?: string;
  originalUrdf?: string;
  meshFiles: MeshFiles;
  urdfBasePath?: string;
  packageRoots?: PackageRootMap;
  cameraPreviewEmptyStateMessage?: string;
};

const RECORDED_VIDEO_PARAMS = EPISODE_PREVIEW_PANEL_PARAMS.recordedVideo;
const ALL_CAMERA_GRID_PARAMS = EPISODE_PREVIEW_PANEL_PARAMS.allCameraGrid;
const PANEL_LAYOUT_PARAMS = EPISODE_PREVIEW_PANEL_PARAMS.layout;

const formatRecordedCameraLabel = (cameraName: string) => {
  const trimmed = cameraName.trim();
  if (trimmed.startsWith(RECORDED_VIDEO_PARAMS.cameraKey.observationImagesPrefix)) {
    return trimmed.slice(RECORDED_VIDEO_PARAMS.cameraKey.observationImagesPrefix.length);
  }
  return trimmed;
};

const getCameraAspect = (camera: Camera) => {
  const width = camera.intrinsics?.width ?? 0;
  const height = camera.intrinsics?.height ?? 0;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return (
      ALL_CAMERA_GRID_PARAMS.fallbackAspect.width /
      ALL_CAMERA_GRID_PARAMS.fallbackAspect.height
    );
  }
  return width / height;
};

const chooseAllPreviewColumns = (
  cameras: Camera[],
  viewportSize: { width: number; height: number }
) => {
  const n = cameras.length;
  if (n <= ALL_CAMERA_GRID_PARAMS.singleCameraCount) {
    return ALL_CAMERA_GRID_PARAMS.singleCameraCount;
  }

  const aspects = cameras.map(getCameraAspect);
  const horizontalCount = aspects.filter(
    (aspect) => aspect >= ALL_CAMERA_GRID_PARAMS.horizontalAspectThreshold
  ).length;
  const verticalCount = n - horizontalCount;

  // Strong UX rule requested: two horizontal cameras stack vertically.
  if (
    n === ALL_CAMERA_GRID_PARAMS.dualCameraCount &&
    horizontalCount === ALL_CAMERA_GRID_PARAMS.dualCameraCount
  ) {
    return ALL_CAMERA_GRID_PARAMS.singleCameraCount;
  }
  if (
    n === ALL_CAMERA_GRID_PARAMS.dualCameraCount &&
    verticalCount === ALL_CAMERA_GRID_PARAMS.dualCameraCount
  ) {
    return ALL_CAMERA_GRID_PARAMS.dualCameraCount;
  }

  const width = Math.max(ALL_CAMERA_GRID_PARAMS.viewportMinPx, viewportSize.width);
  const height = Math.max(ALL_CAMERA_GRID_PARAMS.viewportMinPx, viewportSize.height);
  const viewportAspect = width / height;
  const maxCols =
    n <= ALL_CAMERA_GRID_PARAMS.mediumCameraCount
      ? ALL_CAMERA_GRID_PARAMS.compactMaxColumns
      : n <= ALL_CAMERA_GRID_PARAMS.denseCameraCount
        ? ALL_CAMERA_GRID_PARAMS.mediumMaxColumns
        : ALL_CAMERA_GRID_PARAMS.denseMaxColumns;
  const candidates: number[] = [];
  for (
    let cols = ALL_CAMERA_GRID_PARAMS.singleCameraCount;
    cols <= Math.min(maxCols, n);
    cols += ALL_CAMERA_GRID_PARAMS.singleCameraCount
  ) {
    candidates.push(cols);
  }

  let bestCols = candidates[0] ?? ALL_CAMERA_GRID_PARAMS.singleCameraCount;
  let bestScore = Number.POSITIVE_INFINITY;

  candidates.forEach((cols) => {
    const rows = Math.ceil(n / cols);
    const tileAspect = viewportAspect * (rows / cols);
    const aspectCost =
      aspects.reduce((acc, aspect) => acc + Math.abs(Math.log(tileAspect / aspect)), 0) /
      Math.max(ALL_CAMERA_GRID_PARAMS.singleCameraCount, n);
    const emptySlots = cols * rows - n;
    const emptyCost = emptySlots * ALL_CAMERA_GRID_PARAMS.score.emptySlotPenalty;
    const deepStackPenalty =
      rows > ALL_CAMERA_GRID_PARAMS.score.deepStackRowThreshold
        ? (rows - ALL_CAMERA_GRID_PARAMS.score.deepStackRowThreshold) *
          ALL_CAMERA_GRID_PARAMS.score.deepStackPenalty
        : 0;
    const crowdedPenalty =
      cols > ALL_CAMERA_GRID_PARAMS.score.crowdedColumnThreshold
        ? ALL_CAMERA_GRID_PARAMS.score.crowdedPenalty
        : 0;

    let score = aspectCost + emptyCost + deepStackPenalty + crowdedPenalty;

    if (
      horizontalCount === n &&
      n <= ALL_CAMERA_GRID_PARAMS.compactCameraCount &&
      cols === ALL_CAMERA_GRID_PARAMS.singleCameraCount
    ) {
      score -= ALL_CAMERA_GRID_PARAMS.score.horizontalStackBonus;
    }
    if (
      verticalCount === n &&
      n <= ALL_CAMERA_GRID_PARAMS.compactCameraCount &&
      cols === ALL_CAMERA_GRID_PARAMS.dualCameraCount
    ) {
      score -= ALL_CAMERA_GRID_PARAMS.score.verticalPairGridBonus;
    }

    if (score < bestScore) {
      bestScore = score;
      bestCols = cols;
    }
  });

  return bestCols;
};

export const EpisodePreviewPanel = ({
  episodesViewHeight = PANEL_LAYOUT_PARAMS.defaultEpisodeViewHeightRatio,
  cameras,
  recordedVideoCameras = [],
  recordedVideoStreams = [],
  recordedVideoSyncInfo = null,
  recordedSyncTimeSec = null,
  recordedSyncPlaying = false,
  recordedSyncEpisodeId = null,
  episodePreviewCameraId,
  setEpisodePreviewCameraId,
  vizUrdf,
  originalUrdf,
  meshFiles,
  urdfBasePath,
  packageRoots,
  cameraPreviewEmptyStateMessage,
}: EpisodePreviewPanelProps) => {
  const [previewMode, setPreviewMode] = useState<ExtendedEpisodePreviewMode>("all");
  const activeCameraVideoFrame = useOperatorPerceptionStore((state) => state.activeCameraVideoFrame);
  const selectCamera = useCameraStore((state) => state.selectCamera);
  const urdfContent = vizUrdf || originalUrdf || null;
  const allPreviewRef = useRef<HTMLDivElement | null>(null);
  const recordedVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const [videoLoadErrorByKey, setVideoLoadErrorByKey] = useState<
    Record<string, string>
  >({});
  const [videoUrlAttemptByKey, setVideoUrlAttemptByKey] = useState<
    Record<string, number>
  >({});
  const [preferredVideoUrlByCamera, setPreferredVideoUrlByCamera] = useState<
    Record<string, string>
  >({});
  const [allPreviewSize, setAllPreviewSize] = useState({ width: 0, height: 0 });
  const visibleCameras = useMemo(
    () => cameras.slice(0, RECORDED_VIDEO_PARAMS.visibleLimits.liveCameraCount),
    [cameras]
  );
  const visibleRecordedCameras = useMemo(
    () =>
      recordedVideoCameras.slice(
        0,
        RECORDED_VIDEO_PARAMS.visibleLimits.recordedCameraCount
      ),
    [recordedVideoCameras]
  );
  const visibleRecordedStreams = useMemo(
    () =>
      recordedVideoStreams.slice(
        0,
        RECORDED_VIDEO_PARAMS.visibleLimits.playableStreamCount
      ),
    [recordedVideoStreams]
  );
  const showOperatorLiveCamera = Boolean(
    activeCameraVideoFrame &&
      shouldShowOperatorLiveCameraInEpisodePreviewMode(previewMode)
  );
  const visibleRecordedStreamKeys = useMemo(
    () =>
      visibleRecordedStreams.map(
        (stream) =>
          `${stream.episodeId ?? "episode"}:${stream.cameraName}`
      ),
    [visibleRecordedStreams]
  );
  const visibleRecordedStreamByKey = useMemo(() => {
    const map = new Map<string, (typeof visibleRecordedStreams)[number]>();
    visibleRecordedStreams.forEach((stream) => {
      const key = `${stream.episodeId ?? "episode"}:${stream.cameraName}`;
      map.set(key, stream);
    });
    return map;
  }, [visibleRecordedStreams]);
  const recordedVideoAutoSyncEnabled =
    recordedVideoSyncInfo?.hasRecordedVideo === true
      ? recordedVideoSyncInfo.autoSyncEnabled
      : true;
  const recordedVideoSyncMessage = useMemo(
    () =>
      recordedVideoSyncInfo?.hasRecordedVideo
        ? resolveEpisodeRecordedVideoSyncMessage(recordedVideoSyncInfo)
        : null,
    [recordedVideoSyncInfo]
  );
  const showRecordedVideoSyncBanner =
    recordedVideoSyncInfo?.hasRecordedVideo === true &&
    recordedVideoSyncInfo.status !== null &&
    recordedVideoSyncInfo.status !== "aligned" &&
    typeof recordedVideoSyncMessage === "string" &&
    recordedVideoSyncMessage.length > 0;

  const syncRecordedVideoElement = useCallback(
    (
      video: HTMLVideoElement,
      stream?: {
        clipStartSec?: number;
        clipEndSec?: number;
      }
    ) => {
      if (!recordedVideoAutoSyncEnabled) {
        if (recordedSyncPlaying && !video.paused) {
          video.pause();
        }
        return;
      }
      if (recordedSyncTimeSec === null || !Number.isFinite(recordedSyncTimeSec)) {
        if (!video.paused) {
          video.pause();
        }
        return;
      }

      const clipStartCandidate = stream?.clipStartSec;
      const clipStartSec =
        typeof clipStartCandidate === "number" && Number.isFinite(clipStartCandidate)
          ? Math.max(0, clipStartCandidate)
          : 0;
      const clipEndCandidate = stream?.clipEndSec;
      const rawClipEndSec =
        typeof clipEndCandidate === "number" && Number.isFinite(clipEndCandidate)
          ? Math.max(0, clipEndCandidate)
          : null;
      const clipEndSec =
        rawClipEndSec !== null && rawClipEndSec > clipStartSec
          ? rawClipEndSec
          : null;

      const duration = video.duration;
      let maxTime =
        Number.isFinite(duration) && duration > 0
          ? Math.max(
              0,
              duration - RECORDED_VIDEO_PARAMS.sync.durationEndMarginSec
            )
          : Number.POSITIVE_INFINITY;
      if (clipEndSec !== null) {
        maxTime = Math.min(maxTime, clipEndSec);
      }
      const targetTimeSec = Math.max(
        clipStartSec,
        Math.min(clipStartSec + recordedSyncTimeSec, maxTime)
      );
      const seekToleranceSec = recordedSyncPlaying
        ? RECORDED_VIDEO_PARAMS.sync.seekToleranceSec.playing
        : RECORDED_VIDEO_PARAMS.sync.seekToleranceSec.idle;
      if (
        video.readyState >= HTMLMediaElement.HAVE_METADATA &&
        Math.abs(video.currentTime - targetTimeSec) > seekToleranceSec
      ) {
        video.currentTime = targetTimeSec;
      }

      if (recordedSyncPlaying) {
        if (
          targetTimeSec >=
          maxTime - RECORDED_VIDEO_PARAMS.sync.endPauseMarginSec
        ) {
          if (!video.paused) {
            video.pause();
          }
          return;
        }
        if (video.paused) {
          const playPromise = video.play();
          if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch(() => {});
          }
        }
      } else if (!video.paused) {
        video.pause();
      }
    },
    [recordedSyncPlaying, recordedSyncTimeSec, recordedVideoAutoSyncEnabled]
  );

  const setRecordedVideoRef = useCallback(
    (streamKey: string) => (node: HTMLVideoElement | null) => {
      if (node) {
        recordedVideoRefs.current.set(streamKey, node);
      } else {
        recordedVideoRefs.current.delete(streamKey);
      }
    },
    []
  );

  useEffect(() => {
    if (cameras.length === 0) return;
    if (!episodePreviewCameraId || !cameras.some((cam) => cam.id === episodePreviewCameraId)) {
      setEpisodePreviewCameraId(cameras[0].id);
    }
  }, [cameras, episodePreviewCameraId, setEpisodePreviewCameraId]);

  useEffect(() => {
    if (recordedSyncEpisodeId && visibleRecordedStreams.length > 0) {
      setPreviewMode("recorded");
    }
  }, [recordedSyncEpisodeId, visibleRecordedStreams.length]);

  useEffect(() => {
    const node = allPreviewRef.current;
    if (!node) return;

    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      const width = Math.max(0, rect.width);
      const height = Math.max(0, rect.height);
      setAllPreviewSize((prev) =>
        Math.abs(prev.width - width) < PANEL_LAYOUT_PARAMS.resizeEpsilonPx &&
        Math.abs(prev.height - height) < PANEL_LAYOUT_PARAMS.resizeEpsilonPx
          ? prev
          : { width, height }
      );
    };

    updateSize();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => updateSize());
    observer.observe(node);
    return () => observer.disconnect();
  }, [previewMode, cameras.length]);

  useEffect(() => {
    const activeKeys = new Set(visibleRecordedStreamKeys);
    recordedVideoRefs.current.forEach((video, key) => {
      if (!activeKeys.has(key)) {
        video.pause();
        recordedVideoRefs.current.delete(key);
      }
    });
  }, [visibleRecordedStreamKeys]);

  useEffect(() => {
    const activeKeys = new Set(visibleRecordedStreamKeys);
    setVideoLoadErrorByKey((prev) => {
      const next: Record<string, string> = {};
      Object.entries(prev).forEach(([key, value]) => {
        if (activeKeys.has(key)) {
          next[key] = value;
        }
      });
      return next;
    });
  }, [visibleRecordedStreamKeys]);
  useEffect(() => {
    const activeKeys = new Set(visibleRecordedStreamKeys);
    setVideoUrlAttemptByKey((prev) => {
      const next: Record<string, number> = {};
      Object.entries(prev).forEach(([key, value]) => {
        if (activeKeys.has(key)) {
          next[key] = value;
        }
      });
      return next;
    });
  }, [visibleRecordedStreamKeys]);

  useEffect(() => {
    recordedVideoRefs.current.forEach((video, streamKey) => {
      syncRecordedVideoElement(
        video,
        visibleRecordedStreamByKey.get(streamKey)
      );
    });
  }, [
    syncRecordedVideoElement,
    recordedSyncTimeSec,
    recordedSyncPlaying,
    recordedSyncEpisodeId,
    visibleRecordedStreamByKey,
    visibleRecordedStreamKeys,
  ]);

  const allPreviewColumns = useMemo(
    () => chooseAllPreviewColumns(visibleCameras, allPreviewSize),
    [allPreviewSize, visibleCameras]
  );
  const allPreviewRows = useMemo(
    () =>
      Math.max(
        ALL_CAMERA_GRID_PARAMS.singleCameraCount,
        Math.ceil(visibleCameras.length / allPreviewColumns)
      ),
    [allPreviewColumns, visibleCameras.length]
  );
  const focusCameraId = useMemo(
    () => episodePreviewCameraId ?? visibleCameras[0]?.id ?? null,
    [episodePreviewCameraId, visibleCameras]
  );
  const focusCamera = useMemo(
    () => visibleCameras.find((camera) => camera.id === focusCameraId) ?? visibleCameras[0] ?? null,
    [focusCameraId, visibleCameras]
  );
  const handleCameraSelect = (cameraId: string, nextMode?: EpisodePreviewMode) => {
    setEpisodePreviewCameraId(cameraId);
    selectCamera(cameraId);
    if (nextMode) {
      setPreviewMode(nextMode);
    }
  };

  return (
    <div
      className="overflow-hidden flex flex-col bg-background"
      style={{
        flex: `0 0 ${episodesViewHeight * PANEL_LAYOUT_PARAMS.panelPercentMultiplier}%`,
        minHeight: `${MIN_CAMERAS_PANEL_HEIGHT}px`,
      }}
    >
      <div className="flex-1 min-h-0 flex flex-col gap-1.5 p-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-foreground/90">
            <Film className="h-3 w-3" />
            <span>({cameras.length})</span>
          </span>
          <div className="inline-flex items-center rounded-md border border-border/60 bg-muted/20 p-0.5">
            <button
              type="button"
              onClick={() => setPreviewMode("focus")}
              className={`h-5 rounded px-1.5 text-[9px] transition-colors ${
                previewMode === "focus"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Focus
            </button>
            <button
              type="button"
              onClick={() => setPreviewMode("all")}
              className={`h-5 rounded px-1.5 text-[9px] transition-colors ${
                previewMode === "all"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setPreviewMode("list")}
              className={`h-5 rounded px-1.5 text-[9px] transition-colors ${
                previewMode === "list"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              List
            </button>
            <button
              type="button"
              onClick={() => setPreviewMode("recorded")}
              className={`h-5 rounded px-1.5 text-[9px] transition-colors ${
                previewMode === "recorded"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Recorded
            </button>
          </div>
        </div>

        {previewMode === "focus" && (
          <div className="flex min-w-0 items-center gap-1">
            <span className="shrink-0 text-[9px] text-muted-foreground">Camera</span>
            <Select
              value={episodePreviewCameraId ?? undefined}
              onValueChange={(value) => handleCameraSelect(value)}
              disabled={cameras.length === 0}
            >
              <SelectTrigger className="h-6 min-w-0 flex-1 text-[9px]">
                <SelectValue placeholder="Choose camera" />
              </SelectTrigger>
              <SelectContent>
                {cameras.map((cam) => (
                  <SelectItem key={cam.id} value={cam.id}>
                    {cam.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex-1 min-h-[160px] min-w-0 overflow-hidden">
          {showOperatorLiveCamera ? (
            <div className="h-full min-h-[160px] min-w-0 overflow-hidden">
              <EpisodeCameraPreview
                urdfContent={urdfContent}
                meshFiles={meshFiles}
                cameraId={null}
                urdfBasePath={urdfBasePath}
                packageRoots={packageRoots}
                gpuMode="low"
                emptyStateMessage={cameraPreviewEmptyStateMessage}
                allowOperatorLiveCamera
              />
            </div>
          ) : previewMode === "recorded" ? (
            <div className="h-full min-h-0 min-w-0 overflow-y-auto rounded-md border border-border/60 bg-background/40 p-2">
              {showRecordedVideoSyncBanner && (
                <div
                  className={`mb-2 rounded border px-2 py-1 text-[8px] ${
                    recordedVideoAutoSyncEnabled
                      ? "border-sky-500/40 bg-sky-500/10 text-sky-200"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-200"
                  }`}
                >
                  {recordedVideoSyncMessage}
                </div>
              )}
              {visibleRecordedStreams.length > 0 ? (
                <div className="space-y-2">
                  {visibleRecordedStreams.map((stream) => {
                    const streamKey = `${stream.episodeId ?? "episode"}:${stream.cameraName}`;
                    const baseUrlCandidates = [
                      stream.url,
                      ...(Array.isArray(stream.fallbackUrls)
                        ? stream.fallbackUrls
                        : []),
                    ].filter(
                      (candidate, index, arr): candidate is string =>
                        typeof candidate === "string" &&
                        candidate.length > 0 &&
                        arr.indexOf(candidate) === index
                    );
                    const preferredCameraUrl =
                      preferredVideoUrlByCamera[stream.cameraName];
                    const urlCandidates = preferredCameraUrl
                      ? [preferredCameraUrl, ...baseUrlCandidates].filter(
                          (candidate, index, arr) => arr.indexOf(candidate) === index
                        )
                      : baseUrlCandidates;
                    const currentAttempt = Math.max(
                      0,
                      Math.min(
                        videoUrlAttemptByKey[streamKey] ?? 0,
                        Math.max(urlCandidates.length - 1, 0)
                      )
                    );
                    const activeUrl =
                      urlCandidates[currentAttempt] ?? stream.url;
                    return (
                      <div
                        key={streamKey}
                        className="overflow-hidden rounded-md border border-border/60 bg-background/40 p-0.5"
                      >
                        <div className="flex items-center justify-between gap-2 px-1 pb-0.5">
                          <div className="truncate text-[9px] text-foreground/90">
                            {formatRecordedCameraLabel(stream.cameraName)}
                          </div>
                          <div className="text-[8px] text-muted-foreground">
                            {typeof stream.episodeNumber === "number"
                              ? `ep ${stream.episodeNumber}`
                              : "recorded"}
                          </div>
                        </div>
                        <video
                          ref={setRecordedVideoRef(streamKey)}
                          className="block h-auto w-full bg-black"
                          style={{
                            maxHeight: RECORDED_VIDEO_PARAMS.layout.previewMaxHeightPx,
                          }}
                          src={activeUrl}
                          preload="metadata"
                          playsInline
                          muted
                          controls={!recordedVideoAutoSyncEnabled}
                          onLoadedMetadata={(event) => {
                            syncRecordedVideoElement(event.currentTarget, stream);
                          }}
                          onLoadedData={() => {
                            setVideoUrlAttemptByKey((prev) => {
                              if (!(streamKey in prev) || prev[streamKey] === 0) {
                                return prev;
                              }
                              const next = { ...prev };
                              next[streamKey] = 0;
                              return next;
                            });
                            if (activeUrl && activeUrl !== preferredCameraUrl) {
                              setPreferredVideoUrlByCamera((prev) => ({
                                ...prev,
                                [stream.cameraName]: activeUrl,
                              }));
                            }
                            setVideoLoadErrorByKey((prev) => {
                              if (!(streamKey in prev)) return prev;
                              const next = { ...prev };
                              delete next[streamKey];
                              return next;
                            });
                          }}
                          onError={() => {
                            if (currentAttempt < urlCandidates.length - 1) {
                              setVideoUrlAttemptByKey((prev) => ({
                                ...prev,
                                [streamKey]: currentAttempt + 1,
                              }));
                              setVideoLoadErrorByKey((prev) => {
                                if (!(streamKey in prev)) return prev;
                                const next = { ...prev };
                                delete next[streamKey];
                                return next;
                              });
                              return;
                            }
                            setVideoLoadErrorByKey((prev) => ({
                              ...prev,
                              [streamKey]: "Video failed to load",
                            }));
                          }}
                        />
                        {videoLoadErrorByKey[streamKey] && (
                          <div className="px-1 pt-1 text-[8px] text-red-400">
                            {videoLoadErrorByKey[streamKey]}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {visibleRecordedStreams.length < visibleRecordedCameras.length && (
                    <div className="text-[8px] text-muted-foreground">
                      Some recorded camera keys do not expose a direct playable URL.
                    </div>
                  )}
                </div>
              ) : visibleRecordedCameras.length === 0 ? (
                <div className="text-[9px] text-muted-foreground">
                  {recordedSyncEpisodeId
                    ? "No recorded video cameras detected for this episode."
                    : "Play an episode to show recorded video."}
                </div>
              ) : (
                <div className="space-y-1">
                  {visibleRecordedCameras.map((cameraName) => (
                    <div
                      key={cameraName}
                      className="rounded border border-border/40 bg-muted/20 px-2 py-1"
                    >
                      <div className="truncate text-[9px] text-foreground/90">
                        {formatRecordedCameraLabel(cameraName)}
                      </div>
                      <div className="text-[8px] text-muted-foreground">
                        Recorded key found, but no direct playable URL metadata.
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : cameras.length === 0 ? (
            <EpisodeCameraPreview
              urdfContent={urdfContent}
              meshFiles={meshFiles}
              cameraId={null}
              urdfBasePath={urdfBasePath}
              packageRoots={packageRoots}
              gpuMode="low"
              emptyStateMessage={cameraPreviewEmptyStateMessage}
            />
          ) : previewMode === "focus" ? (
            <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
              <div className="flex-1 min-h-0 min-w-0 overflow-hidden rounded-md border border-border/60">
                <EpisodeCameraPreview
                  urdfContent={urdfContent}
                  meshFiles={meshFiles}
                  cameraId={focusCamera?.id ?? null}
                  urdfBasePath={urdfBasePath}
                  packageRoots={packageRoots}
                  gpuMode="low"
                  emptyStateMessage={cameraPreviewEmptyStateMessage}
                  renderWorldLayoutSplat
                />
              </div>
            </div>
          ) : previewMode === "list" ? (
            <div className="h-full min-h-0 min-w-0 overflow-y-auto rounded-md border border-border/60 bg-background/40">
              <div className="divide-y divide-border/30">
                {visibleCameras.map((camera) => {
                  const intrinsics = camera.intrinsics;
                  const width = intrinsics?.width ?? 0;
                  const height = intrinsics?.height ?? 0;
                  const fov = intrinsics?.fov_deg ?? 0;
                  const isSelected = episodePreviewCameraId === camera.id;
                  return (
                    <div
                      key={camera.id}
                      className={`flex items-center justify-between gap-2 px-2 py-1.5 ${
                        isSelected ? "bg-primary/5" : "hover:bg-muted/20"
                      }`}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => handleCameraSelect(camera.id)}
                      >
                        <div className="truncate text-[9px] text-foreground/90">{camera.name}</div>
                        <div className="truncate text-[8px] text-muted-foreground">
                          {width}x{height} · {fov.toFixed(1)}deg · {camera.parent_joint}
                        </div>
                      </button>
                      <button
                        type="button"
                        className="shrink-0 text-[8px] text-muted-foreground transition-colors hover:text-foreground"
                        onClick={() => {
                          handleCameraSelect(camera.id, "focus");
                        }}
                      >
                        Focus
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div
              ref={allPreviewRef}
              className="h-full min-h-0 min-w-0 overflow-hidden"
            >
              <div
                className="grid h-full min-h-0 min-w-0 gap-1.5"
                style={{
                  gridTemplateColumns: `repeat(${allPreviewColumns}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${allPreviewRows}, minmax(0, 1fr))`,
                }}
              >
                {visibleCameras.map((camera) => (
                  <div
                    key={camera.id}
                    className={`h-full min-h-0 min-w-0 overflow-hidden rounded-md border p-0.5 ${
                      episodePreviewCameraId === camera.id
                        ? "border-primary/70 bg-primary/5"
                        : "border-border/60 bg-background/40"
                    }`}
                  >
                    <div className="flex items-center justify-between px-1 pb-0.5">
                      <span className="truncate text-[9px] text-foreground/90">{camera.name}</span>
                      <button
                        type="button"
                        className="text-[9px] text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          handleCameraSelect(camera.id, "focus");
                        }}
                      >
                        Focus
                      </button>
                    </div>
                    <div className="h-[calc(100%-1.2rem)] min-h-0">
                      <EpisodeCameraPreview
                        urdfContent={urdfContent}
                        meshFiles={meshFiles}
                        cameraId={camera.id}
                        urdfBasePath={urdfBasePath}
                        packageRoots={packageRoots}
                        gpuMode="low"
                        emptyStateMessage={cameraPreviewEmptyStateMessage}
                        renderWorldLayoutSplat
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
