import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useDisplayStore } from "@/features/displays/useDisplayStore";
import { useRuntimeHealthStore } from "@/runtime_engine/rosviz/state/runtimeHealthStore";
import type { Viewer3DProps } from "@/features/viewer/Viewer3D";
import { getViewerProfile, subscribeViewerProfile, type ViewerProfile } from "@/features/workspace/viewerProfile";
import { renderRosViz2dScene } from "@/studio_core/scene/rosViz2dSceneRenderer";
import {
  createRosVizSession,
  fetchRosVizClockState,
  fetchRosVizSessionState,
  fetchRosVizTopics,
  issueRosVizStreamTicket,
  updateRosVizClockState,
  updateRosVizSessionMode,
  updateRosVizSubscriptions,
} from "@/runtime_engine/rosviz/api/rosVizApi";
import {
  RosVizStreamFrameType,
  decodeRosVizJsonPayload,
  type RosVizStreamFrame,
} from "@/runtime_engine/rosviz/protocol/rosVizProtocol";
import {
  applyMarkerDeltaBatch,
  pruneExpiredMarkers,
  type MarkerStoreMap,
} from "@/runtime_engine/rosviz/state/markerStore";
import { RosVizStreamClient } from "@/runtime_engine/rosviz/transport/rosStreamClient";
import type {
  RosVizClockControlRequest,
  RosVizClockMode,
  RosVizClockState,
  RosVizClockTickPayload,
  RosVizDataSource,
  RosVizDiagnosticPayload,
  RosVizMarkerDeltaBatchPayload,
  RosVizResolvedFramePoseBatchPayload,
  RosVizResolvedFramePosePayload,
  RosVizSessionMode,
  RosVizSessionState,
} from "@/runtime_engine/rosviz/types";
import {
  resolveDefaultSessionMode,
} from "@/runtime_engine/rosviz/session/modeSpecs";
import { resolveRosVizSessionSource } from "@/runtime_engine/rosviz/session/sessionSource";
import { API_BASE_URL } from "@/shared/config/api";
import { cn } from "@/shared/lib/utils";
import { RosVizDiagnosticsPanel } from "@/studio_ui/rosviz/components/RosVizDiagnosticsPanel";
import { RosVizModeBar } from "@/studio_ui/rosviz/components/RosVizModeBar";
import { RosVizStatusBadges } from "@/studio_ui/rosviz/components/RosVizStatusBadges";
import { useRosVizCanvasNavigation } from "@/studio_ui/rosviz/viewer/useRosVizCanvasNavigation";

type RosVizV2ViewerProps = Partial<Viewer3DProps> & Record<string, unknown>;

const DEFAULT_FIXED_FRAME = "world";
const DEFAULT_DETERMINISTIC_MODE = "strict";
const DEFAULT_CLOCK_MODE: RosVizClockMode = "live";
const DEFAULT_DATA_SOURCE: RosVizDataSource = "live_ros";
const PLAYBACK_RATES = [0.5, 1, 2, 4] as const;
const VISUALIZATION_TOPIC_NAMES = new Set([
  "/rosviz/resolved_tf",
  "/rosviz/diagnostic",
  "/visualization_marker_array",
]);

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
};

const parseClockMode = (value: string | undefined): RosVizClockMode | null => {
  if (value === "live" || value === "replay" || value === "scrub") {
    return value;
  }
  return null;
};

const parseDataSource = (value: string | undefined): RosVizDataSource | null => {
  if (value === "live_ros" || value === "replay" || value === "episode") {
    return value;
  }
  return null;
};

const parseSessionMode = (value: string | undefined): RosVizSessionMode | null => {
  if (
    value === "live_debug" ||
    value === "live_record" ||
    value === "replay_rosbag" ||
    value === "replay_episode" ||
    value === "replay_motion_only" ||
    value === "hybrid_compare"
  ) {
    return value;
  }
  return null;
};

const hasTimelineControls = (state: RosVizSessionState | null): boolean => {
  if (!state) return false;
  const capabilities = state.capabilities;
  return Boolean(
    capabilities.can_toggle_play ||
      capabilities.can_step ||
      capabilities.can_seek ||
      capabilities.can_set_playback_rate
  );
};

export const RosVizV2Viewer = ({
  thumbnailMode = false,
  onRobotLoaded,
  onRobotBoundingBoxChange,
  onRobotJointsLoaded,
  onPlayingChange,
  onAnimationFramesChange,
  onFrameChange,
}: RosVizV2ViewerProps) => {
  const activeSessionIdRef = useRef<string | null>(null);
  const {
    canvasRef,
    viewTransform,
    isPanning,
    zoomPercent,
    resetView,
    stopPanning,
    handleCanvasWheel,
    handleCanvasPointerDown,
    handleCanvasPointerMove,
    handleCanvasPointerUp,
  } = useRosVizCanvasNavigation();

  const [fixedFrame, setFixedFrame] = useState(DEFAULT_FIXED_FRAME);
  const [resolvedPoses, setResolvedPoses] = useState<RosVizResolvedFramePosePayload[]>([]);
  const [markers, setMarkers] = useState<MarkerStoreMap>(new Map());
  const [clockMode, setClockMode] = useState<RosVizClockMode>(DEFAULT_CLOCK_MODE);
  const [clockIsPlaying, setClockIsPlaying] = useState(true);
  const [clockPlaybackRate, setClockPlaybackRate] = useState(1);
  const [clockTickIndex, setClockTickIndex] = useState(0);
  const [clockCanControl, setClockCanControl] = useState(false);
  const [dataSource, setDataSource] = useState<RosVizDataSource>(DEFAULT_DATA_SOURCE);
  const [sessionState, setSessionState] = useState<RosVizSessionState | null>(null);
  const [clockRequestPending, setClockRequestPending] = useState(false);
  const [diagnostic, setDiagnostic] = useState("Initializing ROS viz stream...");
  const status = useRuntimeHealthStore((state) => state.status);
  const viewerProfile: ViewerProfile = useSyncExternalStore(
    subscribeViewerProfile,
    () => getViewerProfile(),
    () => "studio" as ViewerProfile
  );
  const deterministicMode = useRuntimeHealthStore((state) => state.deterministicMode);
  const framesReceived = useRuntimeHealthStore((state) => state.framesReceived);
  const sequenceGapCount = useRuntimeHealthStore((state) => state.sequenceGapCount);
  const lastError = useRuntimeHealthStore((state) => state.lastError);
  const setSession = useRuntimeHealthStore((state) => state.setSession);
  const setConnectionStatus = useRuntimeHealthStore((state) => state.setConnectionStatus);
  const setFixedFrameHealth = useRuntimeHealthStore((state) => state.setFixedFrame);
  const setDeterministicMode = useRuntimeHealthStore((state) => state.setDeterministicMode);
  const setPoseHash = useRuntimeHealthStore((state) => state.setPoseHash);
  const setSessionHash = useRuntimeHealthStore((state) => state.setSessionHash);
  const recordDeterminismSample = useRuntimeHealthStore((state) => state.recordDeterminismSample);
  const recordFrame = useRuntimeHealthStore((state) => state.recordFrame);
  const recordSequenceGap = useRuntimeHealthStore((state) => state.recordSequenceGap);
  const setError = useRuntimeHealthStore((state) => state.setError);
  const setDiagnosticHealth = useRuntimeHealthStore((state) => state.setDiagnostic);
  const resetStore = useRuntimeHealthStore((state) => state.reset);

  const showRobotModel = useDisplayStore((state) => state.displays.robot_model.enabled);
  const showTfFrames = useDisplayStore((state) => state.displays.tf_frames.enabled);
  const showMarkers = useDisplayStore((state) => state.displays.markers.enabled);
  const showTrajectory = useDisplayStore((state) => state.displays.trajectory.enabled);
  const showDiagnosticsOverlay = useDisplayStore(
    (state) => state.displays.diagnostics_overlay.enabled
  );
  const setDisplayStatus = useDisplayStore((state) => state.setDisplayStatus);
  const setDisplayMetrics = useDisplayStore((state) => state.setDisplayMetrics);

  const poseSummary = useMemo(() => {
    const basePose =
      resolvedPoses.find((pose) => pose.frame_id.includes("base")) ??
      resolvedPoses[0] ??
      null;
    if (!basePose) {
      return "No resolved frames";
    }
    const [x, y, z] = basePose.translation_xyz;
    return `${basePose.frame_id} (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`;
  }, [resolvedPoses]);

  const markerCount = markers.size;

  const applyClockState = useCallback((state: RosVizClockState) => {
    setClockMode(state.mode);
    setClockIsPlaying(state.is_playing);
    setClockPlaybackRate(state.playback_rate);
    setClockTickIndex(state.tick_index);
    setDataSource(state.data_source);
    setClockCanControl(state.can_control);
  }, []);

  const refreshSessionState = useCallback(async (sessionId: string) => {
    const state = await fetchRosVizSessionState(sessionId);
    setSessionState(state);
    setClockCanControl(hasTimelineControls(state));
    return state;
  }, []);

  const issueClockControl = useCallback(
    async (request: RosVizClockControlRequest) => {
      const sessionId = activeSessionIdRef.current;
      if (!sessionId || clockRequestPending) {
        return;
      }
      setClockRequestPending(true);
      try {
        const nextState = await updateRosVizClockState(sessionId, request);
        applyClockState(nextState);
      } catch (error) {
        setError(toErrorMessage(error, "Failed to update ROS viz clock control."));
      } finally {
        setClockRequestPending(false);
      }
    },
    [applyClockState, clockRequestPending, setError]
  );

  const handleModeChange = useCallback(
    async (mode: RosVizSessionMode) => {
      const sessionId = activeSessionIdRef.current;
      if (!sessionId || clockRequestPending) {
        return;
      }
      setClockRequestPending(true);
      try {
        const nextState = await updateRosVizSessionMode(sessionId, { mode });
        setSessionState(nextState);
        setClockMode(nextState.clock_mode);
        setClockIsPlaying(nextState.is_playing);
        setClockPlaybackRate(nextState.playback_rate);
        setClockTickIndex(nextState.tick_index);
        setDataSource(nextState.data_source);
        setClockCanControl(hasTimelineControls(nextState));
      } catch (error) {
        setError(toErrorMessage(error, "Failed to update ROS viz session mode."));
      } finally {
        setClockRequestPending(false);
      }
    },
    [clockRequestPending, setError]
  );

  const handleTogglePlay = useCallback(() => {
    void issueClockControl({ is_playing: !clockIsPlaying });
  }, [clockIsPlaying, issueClockControl]);

  const handleStep = useCallback(() => {
    void issueClockControl({ is_playing: false, step_ticks: 1 });
  }, [issueClockControl]);

  const handleCyclePlaybackRate = useCallback(() => {
    const currentIndex = PLAYBACK_RATES.findIndex(
      (value) => Math.abs(value - clockPlaybackRate) < 1e-6
    );
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % PLAYBACK_RATES.length : 1;
    const nextRate = PLAYBACK_RATES[nextIndex];
    void issueClockControl({ playback_rate: nextRate });
  }, [clockPlaybackRate, issueClockControl]);

  useEffect(() => {
    onRobotLoaded?.(null);
    onRobotBoundingBoxChange?.(null);
    onRobotJointsLoaded?.([], {});
    onPlayingChange?.(false);
    onAnimationFramesChange?.(false);
    onFrameChange?.(0, 0);
  }, [
    onAnimationFramesChange,
    onFrameChange,
    onPlayingChange,
    onRobotBoundingBoxChange,
    onRobotJointsLoaded,
    onRobotLoaded,
  ]);

  useEffect(() => {
    let disposed = false;
    let streamClient: RosVizStreamClient | null = null;

    const handleFrame = (frame: RosVizStreamFrame) => {
      recordFrame(frame);

      if (frame.type === RosVizStreamFrameType.CLOCK_TICK) {
        const payload = decodeRosVizJsonPayload<RosVizClockTickPayload>(frame);
        setClockMode(payload.mode);
        setClockTickIndex(payload.tick_index);
        setMarkers((current) => pruneExpiredMarkers(current, frame.timestampNs));
        return;
      }

      if (frame.type === RosVizStreamFrameType.RESOLVED_FRAME_POSE_BATCH) {
        const payload = decodeRosVizJsonPayload<RosVizResolvedFramePoseBatchPayload>(frame);
        const nextFrame = payload.fixed_frame || DEFAULT_FIXED_FRAME;
        setFixedFrame(nextFrame);
        setFixedFrameHealth(nextFrame);
        setPoseHash(payload.pose_hash || null);
        recordDeterminismSample(frame.timestampNs, payload.pose_hash || null);
        const poses = Array.isArray(payload.poses) ? payload.poses : [];
        setResolvedPoses(poses);
        setDisplayStatus("robot_model", "ok");
        setDisplayStatus("tf_frames", "ok");
        setDisplayMetrics("robot_model", { poses: poses.length });
        setDisplayMetrics("tf_frames", { poses: poses.length });
        return;
      }

      if (frame.type === RosVizStreamFrameType.MARKER_DELTA_BATCH) {
        const payload = decodeRosVizJsonPayload<RosVizMarkerDeltaBatchPayload>(frame);
        setMarkers((current) => {
          const nextMarkers = applyMarkerDeltaBatch(current, payload, frame.timestampNs);
          setDisplayStatus("markers", "ok");
          setDisplayStatus("trajectory", "ok");
          setDisplayMetrics("markers", { count: nextMarkers.size });
          const trajectoryPoints = Array.from(nextMarkers.values()).reduce((total, entry) => {
            if (entry.marker.marker_type !== "line_strip") return total;
            return total + entry.marker.points_xyz.length;
          }, 0);
          setDisplayMetrics("trajectory", { points: trajectoryPoints });
          return nextMarkers;
        });
        return;
      }

      if (frame.type === RosVizStreamFrameType.DIAGNOSTIC_EVENT) {
        const payload = decodeRosVizJsonPayload<RosVizDiagnosticPayload>(frame);
        const details = payload.details ?? {};
        if (typeof details.session_hash === "string") {
          setSessionHash(details.session_hash || null);
        }
        if (typeof details.deterministic_mode === "string") {
          setDeterministicMode(details.deterministic_mode === "smooth" ? "smooth" : "strict");
        }
        const detailClockMode = parseClockMode(details.clock_mode);
        if (detailClockMode) {
          setClockMode(detailClockMode);
        }
        const detailDataSource = parseDataSource(details.data_source);
        if (detailDataSource) {
          setDataSource(detailDataSource);
        }
        if (typeof details.playback_rate === "string") {
          const parsedRate = Number(details.playback_rate);
          if (Number.isFinite(parsedRate) && parsedRate > 0) {
            setClockPlaybackRate(parsedRate);
          }
        }
        if (typeof details.is_playing === "string") {
          setClockIsPlaying(details.is_playing === "true");
        }
        if (typeof details.tick_index === "string") {
          const parsedTick = Number(details.tick_index);
          if (Number.isFinite(parsedTick) && parsedTick >= 0) {
            setClockTickIndex(parsedTick);
          }
        }

        const mode = parseSessionMode(details.mode);
        if (mode) {
          setSessionState((current) => (current ? { ...current, mode } : current));
        }

        const diagnosticLine = `${payload.severity.toUpperCase()}: ${payload.message}`;
        setDiagnostic(diagnosticLine);
        setDiagnosticHealth(diagnosticLine);
        setDisplayStatus("diagnostics_overlay", payload.severity === "error" ? "error" : "ok");
      }
    };

    const initialize = async () => {
      setConnectionStatus("connecting");
      try {
        const sourceConfig = resolveRosVizSessionSource();
        const initialMode = resolveDefaultSessionMode(sourceConfig.dataSource);

        const session = await createRosVizSession({
          fixed_frame: DEFAULT_FIXED_FRAME,
          deterministic_mode: DEFAULT_DETERMINISTIC_MODE,
          mode_profile: viewerProfile,
          data_source: sourceConfig.dataSource,
          replay_source: sourceConfig.replaySource ?? undefined,
          session_mode: initialMode,
        });
        if (disposed) return;

        activeSessionIdRef.current = session.session_id;
        setSession(session.session_id);
        setDeterministicMode(session.deterministic_mode ?? DEFAULT_DETERMINISTIC_MODE);
        setSessionHash(session.deterministic_session_hash || null);
        setDataSource(session.data_source ?? DEFAULT_DATA_SOURCE);

        const state = await refreshSessionState(session.session_id);
        if (disposed) return;
        setSessionState(state);

        const clockState = await fetchRosVizClockState(session.session_id);
        if (disposed) return;
        applyClockState(clockState);

        const topicCatalog = await fetchRosVizTopics(session.session_id);
        if (disposed) return;

        const selectedTopicIds = topicCatalog.topics
          .filter((topic) => VISUALIZATION_TOPIC_NAMES.has(topic.name))
          .map((topic) => topic.topic_id);

        await updateRosVizSubscriptions(session.session_id, {
          topic_ids: selectedTopicIds,
          include_clock: true,
        });
        if (disposed) return;

        streamClient = new RosVizStreamClient({
          apiBaseUrl: API_BASE_URL,
          sessionId: session.session_id,
          resolveTicket: async () => {
            const ticketResponse = await issueRosVizStreamTicket(session.session_id);
            return ticketResponse.ticket;
          },
          onOpen: () => {
            setConnectionStatus("connected");
            setDiagnostic("INFO: ROS viz stream connected.");
          },
          onClose: () => {
            if (!disposed) {
              setConnectionStatus("idle");
            }
          },
          onError: () => {
            if (!disposed) {
              setError("ROS viz websocket connection error.");
            }
          },
          onFrame: handleFrame,
          onSequenceGap: () => {
            recordSequenceGap();
          },
          onFrameParseError: (error) => {
            if (!disposed) {
              setError(`ROS viz frame parse error: ${error.message}`);
            }
          },
        });
        await streamClient.connect();
      } catch (error) {
        if (!disposed) {
          setError(toErrorMessage(error, "Failed to initialize ROS viz runtime."));
        }
      }
    };

    void initialize();

    return () => {
      disposed = true;
      activeSessionIdRef.current = null;
      streamClient?.disconnect();
      resetStore();
      setFixedFrame(DEFAULT_FIXED_FRAME);
      setResolvedPoses([]);
      setMarkers(new Map());
      setClockMode(DEFAULT_CLOCK_MODE);
      setClockIsPlaying(true);
      setClockPlaybackRate(1);
      setClockTickIndex(0);
      setClockCanControl(false);
      setDataSource(DEFAULT_DATA_SOURCE);
      setSessionState(null);
      setClockRequestPending(false);
      resetView();
      stopPanning();
    };
  }, [
    applyClockState,
    recordFrame,
    recordSequenceGap,
    recordDeterminismSample,
    refreshSessionState,
    resetStore,
    setConnectionStatus,
    setDeterministicMode,
    setDiagnosticHealth,
    setDisplayMetrics,
    setDisplayStatus,
    setError,
    setFixedFrameHealth,
    setPoseHash,
    setSession,
    setSessionHash,
    resetView,
    stopPanning,
    viewerProfile,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const draw = () => {
      const width = Math.max(1, Math.floor(canvas.clientWidth));
      const height = Math.max(1, Math.floor(canvas.clientHeight));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      renderRosViz2dScene({
        context,
        width,
        height,
        viewTransform,
        resolvedPoses,
        markers,
        visibility: {
          showRobotModel,
          showTfFrames,
          showMarkers,
          showTrajectory,
        },
      });
    };

    draw();
    window.addEventListener("resize", draw);
    return () => {
      window.removeEventListener("resize", draw);
    };
  }, [canvasRef, markers, resolvedPoses, showMarkers, showRobotModel, showTfFrames, showTrajectory, viewTransform]);

  return (
    <div className={cn("relative h-full w-full", thumbnailMode ? "bg-transparent" : "bg-background")}>
      <canvas
        ref={canvasRef}
        className={cn("h-full w-full touch-none select-none", isPanning ? "cursor-grabbing" : "cursor-grab")}
        onWheel={handleCanvasWheel}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerUp}
        onPointerLeave={handleCanvasPointerUp}
      />

      {!thumbnailMode && (
        <>
          <RosVizStatusBadges
            status={status}
            dataSource={dataSource}
            fixedFrame={fixedFrame}
            deterministicMode={deterministicMode}
            zoomPercent={zoomPercent}
            resolvedPoseCount={resolvedPoses.length}
            markerCount={markerCount}
            framesReceived={framesReceived}
            sequenceGapCount={sequenceGapCount}
          />

          <div className="absolute right-3 top-3 z-10 flex items-center gap-2 text-[10px]">
            <div className="pointer-events-none rounded border border-border/40 bg-background/85 px-2 py-1 text-muted-foreground backdrop-blur-sm">
              Drag to pan | Wheel to zoom
            </div>
            <button
              type="button"
              onClick={resetView}
              className="pointer-events-auto rounded border border-border/50 bg-background/90 px-2 py-1 font-mono text-foreground hover:bg-background"
            >
              Reset view
            </button>
          </div>

          <RosVizModeBar
            sessionState={sessionState}
            clockIsPlaying={clockIsPlaying}
            clockPlaybackRate={clockPlaybackRate}
            clockRequestPending={clockRequestPending}
            status={status}
            onModeChange={(mode) => {
              void handleModeChange(mode);
            }}
            onTogglePlay={handleTogglePlay}
            onStep={handleStep}
            onCyclePlaybackRate={handleCyclePlaybackRate}
          />
        </>
      )}

      <RosVizDiagnosticsPanel
        show={!thumbnailMode && showDiagnosticsOverlay}
        poseSummary={poseSummary}
        diagnostic={diagnostic}
        lastError={lastError}
      />

      {!thumbnailMode && !clockCanControl && (
        <div className="pointer-events-none absolute bottom-3 right-3 z-10 rounded border border-border/40 bg-background/85 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-sm">
          Timeline controls unavailable for this mode
        </div>
      )}
    </div>
  );
};
