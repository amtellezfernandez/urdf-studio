import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { toast } from "sonner";
import * as THREE from "three";
import { useCameraAutoGeneration } from "@/features/camera";
import { useCameraStore } from "@/shared/store/useCameraStore";
import { WORLD_SCENARIO_DEFAULT_SEED, WORLD_SCENARIO_SOURCES } from "@/features/world/worldScenarioParams";
import { buildWorldScenarioTimeline } from "@/features/world/worldScenarioEngine";
import { useObjectStore, type CreatedObject } from "@/features/objects";
import { useThumbnailBootstrap } from "@/app/pages/index/useThumbnailBootstrap";
import {
  readThumbnailRenderState,
  writeThumbnailRenderState,
} from "@/app/pages/index/thumbnailRenderState";
import { useDemoMotionFlow } from "@/app/pages/index/useDemoMotionFlow";
import {
  CAMERA_AUTO_RECONCILE_INTERVAL_MS,
  CAMERA_AUTO_RECONCILE_MAX_ATTEMPTS,
} from "@/features/camera/cameraAutoGenerationParams";
import type { ThumbnailParams } from "@/app/pages/index/useIndexPageParams";
import {
  computeRuntimeDemoDirectMovePose,
  computeRuntimeDemoDirectRotatePose,
  buildRuntimeDemoScanPose,
  computeRuntimeDemoNavigatePose,
  RUNTIME_DEMO_DIRECT_MOVE_MIN_DURATION_MS,
  RUNTIME_DEMO_DIRECT_ROTATE_MIN_DURATION_MS,
  RUNTIME_DEMO_MILLISECONDS_PER_SECOND,
  RUNTIME_DEMO_NAVIGATION_DURATION_BY_SPEED_MS,
  resolveRuntimePreviewTargetPosition,
} from "@/app/pages/index/runtimeDemo";
import {
  isDirectRuntimeDemoCommandMessage,
  isRunRuntimeDemoScanMessage,
  isSetRuntimeDemoSpeedMessage,
  isSetRuntimeDemoTrajectoryMessage,
  RUNTIME_POSE_SAMPLE_MESSAGE_TYPE,
} from "@/shared/contracts/previewBridge";
import { RUNTIME_DEMO_SCAN_DURATION_MS } from "@/studio_ui/runtimeviz/runtimeRobotPreviewParams";
import type { Camera } from "@/shared/types/camera";
import type { URDFRobot } from "urdf-loader";

type RuntimePose = {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
} | null;

type UseDemoMotionFlowParams = Parameters<typeof useDemoMotionFlow>[0];
type UseThumbnailBootstrapParams = Parameters<typeof useThumbnailBootstrap>[0];

type UseCameraRuntimeOrchestrationParams = {
  activeUrdfPath: string | null;
  addCamera: (camera: Omit<Camera, "id">) => void;
  addObject: (
    object: Omit<CreatedObject, "id">,
    options?: { trackHistory?: boolean; select?: boolean }
  ) => void;
  availableJoints: string[];
  availableLinks: string[];
  cameras: Camera[];
  endEffectorLink: string | null;
  hasLoadedFiles: boolean;
  hydrateDemoAssetsFromFiles: UseDemoMotionFlowParams["hydrateDemoAssetsFromFiles"];
  jointLimits: UseDemoMotionFlowParams["jointLimits"];
  loadDemoUrdfTextWithFreshCameras: UseDemoMotionFlowParams["loadDemoUrdfTextWithFreshCameras"];
  loadFilesFromFolderWithFreshCameras: UseDemoMotionFlowParams["loadFilesFromFolderWithFreshCameras"];
  playbackHandlers: UseDemoMotionFlowParams["playbackHandlers"];
  removeCamera: (cameraId: string) => void;
  removeObject: (id: string) => void;
  robot: URDFRobot | null;
  robotBoundingBox: THREE.Box3 | null;
  runtimePreviewMode: boolean;
  runtimeRobotBasePose: RuntimePose;
  setIsImportingWorldLayout: (value: boolean) => void;
  setWorldLayoutImportDialogOpen: (value: boolean) => void;
  setWorldLayoutImportUrlDraft: (value: string) => void;
  skipDefaultWorldLayoutAutoImportRef: MutableRefObject<boolean>;
  thumbnailMode: boolean;
  thumbnailParams: ThumbnailParams;
  updateCamera: (cameraId: string, updates: Partial<Camera>) => void;
  updateTrackedJoint: (id: string, trackedJointName: string | null) => void;
  urdfAnalysis: UseDemoMotionFlowParams["urdfAnalysis"];
  urdfFileName?: string;
  vizUrdfContent: string;
  originalUrdfContent: string;
};

export const useCameraRuntimeOrchestration = ({
  activeUrdfPath,
  addCamera,
  addObject,
  availableJoints,
  availableLinks,
  cameras,
  endEffectorLink,
  hasLoadedFiles,
  hydrateDemoAssetsFromFiles,
  jointLimits,
  loadDemoUrdfTextWithFreshCameras,
  loadFilesFromFolderWithFreshCameras,
  playbackHandlers,
  removeCamera,
  removeObject,
  robot,
  robotBoundingBox,
  runtimePreviewMode,
  runtimeRobotBasePose,
  setIsImportingWorldLayout,
  setWorldLayoutImportDialogOpen,
  setWorldLayoutImportUrlDraft,
  skipDefaultWorldLayoutAutoImportRef,
  thumbnailMode,
  thumbnailParams,
  updateCamera,
  updateTrackedJoint,
  urdfAnalysis,
  urdfFileName,
  vizUrdfContent,
  originalUrdfContent,
}: UseCameraRuntimeOrchestrationParams) => {
  const runtimeObjects = useObjectStore((state) => state.objects);
  const [runtimeDemoScanPose, setRuntimeDemoScanPose] = useState<RuntimePose>(null);
  const [runtimeDemoNavigatePose, setRuntimeDemoNavigatePose] = useState<RuntimePose>(null);
  const [runtimeDemoSpeedMode, setRuntimeDemoSpeedMode] = useState<"slow" | "normal" | "fast">(
    "normal"
  );
  const effectiveRuntimePoseRef = useRef<RuntimePose>(null);
  const worldScenarioReferenceBoundingBoxRef = useRef<THREE.Box3 | null>(null);
  const worldScenarioReferenceSignatureRef = useRef<string | null>(null);
  const lastDefaultCameraBootstrapSignatureRef = useRef<string | null>(null);

  const cameraLoadSignature = useMemo(() => {
    const identity = activeUrdfPath || urdfFileName || "robot";
    const urdfLength = (vizUrdfContent || originalUrdfContent || "").length;
    const linksSignature = availableLinks.join("|");
    return `${identity}:${urdfLength}:${linksSignature}`;
  }, [activeUrdfPath, availableLinks, originalUrdfContent, urdfFileName, vizUrdfContent]);

  const { ensureDetectedCamerasForLoadedRobot, hasPendingAutoCameraGeometry } =
    useCameraAutoGeneration({
      robot,
      urdfAnalysis,
      availableLinks,
      thumbnailMode,
      loadSignature: cameraLoadSignature,
      addCamera,
      updateCamera,
      removeCamera,
    });

  useEffect(() => {
    if (worldScenarioReferenceSignatureRef.current !== cameraLoadSignature) {
      worldScenarioReferenceSignatureRef.current = cameraLoadSignature;
      worldScenarioReferenceBoundingBoxRef.current = robotBoundingBox
        ? robotBoundingBox.clone()
        : null;
      return;
    }
    if (!worldScenarioReferenceBoundingBoxRef.current && robotBoundingBox) {
      worldScenarioReferenceBoundingBoxRef.current = robotBoundingBox.clone();
    }
  }, [cameraLoadSignature, robotBoundingBox]);

  useEffect(() => {
    if (!thumbnailMode) {
      writeThumbnailRenderState({}, { reset: true });
      return;
    }
    if (!robotBoundingBox || robotBoundingBox.isEmpty()) {
      if (readThumbnailRenderState().phase === "error") {
        return;
      }
      writeThumbnailRenderState({
        phase: "loading",
        ready: false,
        hasBoundingBox: false,
        cameraApplied: false,
        error: null,
        cameraPosition: null,
        cameraTarget: null,
      });
      return;
    }
    const currentThumbnailState = readThumbnailRenderState();
    if (
      currentThumbnailState.phase === "ready" &&
      currentThumbnailState.ready &&
      currentThumbnailState.hasBoundingBox &&
      currentThumbnailState.cameraApplied &&
      !currentThumbnailState.error
    ) {
      return;
    }
    writeThumbnailRenderState({
      phase: "loading",
      ready: false,
      hasBoundingBox: true,
      cameraApplied: false,
      error: null,
      cameraPosition: null,
      cameraTarget: null,
    });
  }, [thumbnailMode, robotBoundingBox]);

  useEffect(() => {
    if (!thumbnailMode || typeof window === "undefined") return;
    const previousBody = document.body.style.background;
    const previousHtml = document.documentElement.style.background;
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    return () => {
      document.body.style.background = previousBody;
      document.documentElement.style.background = previousHtml;
    };
  }, [thumbnailMode]);

  const defaultCameraBootstrapSignature = useMemo(() => {
    const urdfSignature = (vizUrdfContent || originalUrdfContent || "").length;
    const linksSignature = availableLinks.join("|");
    return `${urdfSignature}:${linksSignature}`;
  }, [availableLinks, originalUrdfContent, vizUrdfContent]);

  const ensureDefaultCamerasForLoadedRobot = useCallback(() => {
    if (thumbnailMode || !robot || availableLinks.length === 0) return false;
    if (ensureDetectedCamerasForLoadedRobot(cameras)) return true;
    return cameras.length > 0;
  }, [availableLinks.length, cameras, ensureDetectedCamerasForLoadedRobot, robot, thumbnailMode]);

  useEffect(() => {
    if (!hasLoadedFiles) return;
    ensureDetectedCamerasForLoadedRobot(useCameraStore.getState().cameras);
  }, [cameras.length, ensureDetectedCamerasForLoadedRobot, hasLoadedFiles]);

  useEffect(() => {
    if (!hasLoadedFiles || thumbnailMode) return;
    if (!hasPendingAutoCameraGeometry()) return;

    let attemptCount = 0;
    let timeoutId = 0;
    let cancelled = false;
    const reconcile = () => {
      if (cancelled) return;
      attemptCount += 1;
      ensureDetectedCamerasForLoadedRobot(useCameraStore.getState().cameras);
      if (attemptCount >= CAMERA_AUTO_RECONCILE_MAX_ATTEMPTS) return;
      if (!hasPendingAutoCameraGeometry()) return;
      timeoutId = window.setTimeout(reconcile, CAMERA_AUTO_RECONCILE_INTERVAL_MS);
    };

    timeoutId = window.setTimeout(reconcile, CAMERA_AUTO_RECONCILE_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [ensureDetectedCamerasForLoadedRobot, hasLoadedFiles, hasPendingAutoCameraGeometry, thumbnailMode]);

  const applyWorldScenarioLayout = useCallback(
    ({ requireLeKiwi }: { requireLeKiwi: boolean }): boolean => {
      if (!robot || availableLinks.length === 0) return false;
      const robotNameCandidates = [urdfFileName ?? "", activeUrdfPath ?? "", vizUrdfContent];
      const isLeKiwi = robotNameCandidates.some((value) => /lekiwi/i.test(value));
      if (requireLeKiwi && !isLeKiwi) return false;

      const currentCameras = useCameraStore.getState().cameras;
      const hasAutoCameras = ensureDetectedCamerasForLoadedRobot(currentCameras);
      const scenarioBoundingBox = worldScenarioReferenceBoundingBoxRef.current ?? robotBoundingBox;
      const baseCenter = scenarioBoundingBox
        ? scenarioBoundingBox.getCenter(new THREE.Vector3())
        : new THREE.Vector3(0, 0, 0);
      const baseSize = scenarioBoundingBox
        ? scenarioBoundingBox.getSize(new THREE.Vector3())
        : new THREE.Vector3(0.5, 0.4, 0.4);
      const baseZ = scenarioBoundingBox ? scenarioBoundingBox.min.z : 0;
      const forwardOffset = Math.max(0.55, baseSize.x * 1.1 + 0.35);
      const ringRadius = Math.max(0.55, Math.max(baseSize.x, baseSize.y) * 1.8 + 0.22);
      const worldScenarioTimeline = buildWorldScenarioTimeline({
        baseCenter,
        baseSize,
        baseZ,
        ringRadius,
        forwardOffset,
        seed: WORLD_SCENARIO_DEFAULT_SEED,
      });
      const worldScenarioSnapshot = worldScenarioTimeline.sampleAt(0);
      const isFrameLike = (name: string) => /frame|dummy|target|origin|marker|site/i.test(name);
      const existingScenarioObjectIds = useObjectStore
        .getState()
        .objects.filter(
          (obj) =>
            obj.source === WORLD_SCENARIO_SOURCES.current ||
            obj.source === WORLD_SCENARIO_SOURCES.demoWorld
        )
        .map((obj) => obj.id);
      existingScenarioObjectIds.forEach((id) => removeObject(id));
      worldScenarioSnapshot.objects.forEach((objectSpec) => {
        addObject(objectSpec, { trackHistory: false, select: false });
      });
      const nonFrameLinks = availableLinks.filter((name) => !isFrameLike(name));
      const baseReference = nonFrameLinks[0] ?? availableLinks[0] ?? null;
      const distalReference =
        endEffectorLink && !isFrameLike(endEffectorLink)
          ? endEffectorLink
          : nonFrameLinks[nonFrameLinks.length - 1] ?? baseReference;
      if (baseReference) {
        const createdScenarioObjectIds = useObjectStore
          .getState()
          .objects.filter(
            (obj) =>
              obj.source === WORLD_SCENARIO_SOURCES.current ||
              obj.source === WORLD_SCENARIO_SOURCES.demoWorld
          )
          .map((obj) => obj.id);
        createdScenarioObjectIds.forEach((id, index) => {
          const targetReference = index % 2 === 0 ? baseReference : distalReference ?? baseReference;
          updateTrackedJoint(id, targetReference);
        });
      }
      return hasAutoCameras || Boolean(baseReference);
    },
    [
      activeUrdfPath,
      addObject,
      availableLinks,
      endEffectorLink,
      ensureDetectedCamerasForLoadedRobot,
      removeObject,
      robot,
      robotBoundingBox,
      updateTrackedJoint,
      urdfFileName,
      vizUrdfContent,
    ]
  );

  const prepareDemoScene = useCallback(
    () => applyWorldScenarioLayout({ requireLeKiwi: true }),
    [applyWorldScenarioLayout]
  );

  const applyDemoWorldLayoutForCurrentRobot = useCallback(
    () => applyWorldScenarioLayout({ requireLeKiwi: false }),
    [applyWorldScenarioLayout]
  );

  const handleImportDemoWorldLayoutFromDialog = useCallback(async () => {
    setIsImportingWorldLayout(true);
    try {
      const applied = applyDemoWorldLayoutForCurrentRobot();
      if (!applied) throw new Error("Demo world layout requires a loaded robot.");
      setWorldLayoutImportDialogOpen(false);
      setWorldLayoutImportUrlDraft("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to import demo world layout");
    } finally {
      setIsImportingWorldLayout(false);
    }
  }, [
    applyDemoWorldLayoutForCurrentRobot,
    setIsImportingWorldLayout,
    setWorldLayoutImportDialogOpen,
    setWorldLayoutImportUrlDraft,
  ]);

  const { handlePlayDemoMotion, loadBundledDemoRobot, pendingDemoMotion } = useDemoMotionFlow({
    activeUrdfPath,
    availableJoints,
    hasLoadedFiles,
    hydrateDemoAssetsFromFiles,
    isLeKiwiDemoRobot: /lekiwi/i.test(urdfFileName ?? "") || /lekiwi/i.test(activeUrdfPath ?? ""),
    jointLimits,
    loadDemoUrdfTextWithFreshCameras,
    loadFilesFromFolderWithFreshCameras,
    playbackHandlers,
    prepareDemoScene,
    robot,
    skipDefaultWorldLayoutAutoImportRef,
    urdfAnalysis,
  });

  const { loadError: runtimePreviewLoadError } = useThumbnailBootstrap({
    hasLoadedFiles,
    loadBundledDemoRobot,
    loadFilesFromFolderWithFreshCameras,
    runtimePreviewMode,
    thumbnailMode,
    thumbnailParams,
  });

  useEffect(() => {
    if (!pendingDemoMotion || !hasLoadedFiles || thumbnailMode) {
      lastDefaultCameraBootstrapSignatureRef.current = null;
      return;
    }
    if (cameras.length > 0) {
      lastDefaultCameraBootstrapSignatureRef.current = defaultCameraBootstrapSignature;
      return;
    }
    if (lastDefaultCameraBootstrapSignatureRef.current === defaultCameraBootstrapSignature) return;
    const applied = ensureDefaultCamerasForLoadedRobot();
    if (applied) {
      lastDefaultCameraBootstrapSignatureRef.current = defaultCameraBootstrapSignature;
    }
  }, [
    cameras.length,
    defaultCameraBootstrapSignature,
    ensureDefaultCamerasForLoadedRobot,
    hasLoadedFiles,
    pendingDemoMotion,
    thumbnailMode,
  ]);

  useEffect(() => {
    if (!runtimePreviewMode) return;

    let animationFrameId = 0;
    let clearTimeoutId: number | null = null;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (isRunRuntimeDemoScanMessage(event.data)) {
        const startTime = performance.now();
        const tick = (now: number) => {
          const progress = Math.min(1, (now - startTime) / RUNTIME_DEMO_SCAN_DURATION_MS);
          setRuntimeDemoNavigatePose(null);
          setRuntimeDemoScanPose(buildRuntimeDemoScanPose(progress));
          if (progress < 1) {
            animationFrameId = window.requestAnimationFrame(tick);
            return;
          }
          clearTimeoutId = window.setTimeout(() => setRuntimeDemoScanPose(null), 150);
        };
        if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
        if (clearTimeoutId !== null) window.clearTimeout(clearTimeoutId);
        animationFrameId = window.requestAnimationFrame(tick);
        return;
      }
      if (isSetRuntimeDemoSpeedMessage(event.data)) {
        if (!thumbnailParams.runtimeDemo) {
          return;
        }
        setRuntimeDemoSpeedMode(event.data.speedMode ?? "normal");
        return;
      }
      if (isDirectRuntimeDemoCommandMessage(event.data)) {
        if (!thumbnailParams.runtimeDemo) {
          return;
        }
        const command = event.data.command ?? "status";
        const startPose = effectiveRuntimePoseRef.current ?? runtimeRobotBasePose;
        if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
        if (clearTimeoutId !== null) {
          window.clearTimeout(clearTimeoutId);
          clearTimeoutId = null;
        }
        if (command === "stop" || command === "status") {
          setRuntimeDemoScanPose(null);
          setRuntimeDemoNavigatePose(startPose ?? null);
          return;
        }
        if (command === "move") {
          const durationMs = Math.max(
            RUNTIME_DEMO_DIRECT_MOVE_MIN_DURATION_MS,
            (event.data.durationS ?? 0) * RUNTIME_DEMO_MILLISECONDS_PER_SECOND
          );
          const xVel = event.data.xVel ?? 0;
          const yVel = event.data.yVel ?? 0;
          const startTime = performance.now();
          const tick = (now: number) => {
            const progress = Math.min(1, (now - startTime) / durationMs);
            setRuntimeDemoScanPose(null);
            setRuntimeDemoNavigatePose(
              computeRuntimeDemoDirectMovePose({
                startPose,
                xVel,
                yVel,
                durationS: event.data.durationS ?? 0,
                progress,
              })
            );
            if (progress < 1) {
              animationFrameId = window.requestAnimationFrame(tick);
              return;
            }
          };
          animationFrameId = window.requestAnimationFrame(tick);
          return;
        }
        if (command === "rotate") {
          const degrees = event.data.degrees ?? 0;
          const thetaVel = Math.abs(event.data.thetaVel ?? 45);
          const computedDurationMs =
            (Math.abs(degrees) / Math.max(thetaVel, 1)) * RUNTIME_DEMO_MILLISECONDS_PER_SECOND;
          const durationMs = Math.max(RUNTIME_DEMO_DIRECT_ROTATE_MIN_DURATION_MS, computedDurationMs);
          const startTime = performance.now();
          const tick = (now: number) => {
            const progress = Math.min(1, (now - startTime) / durationMs);
            setRuntimeDemoScanPose(null);
            setRuntimeDemoNavigatePose(
              computeRuntimeDemoDirectRotatePose({
                startPose,
                degrees,
                progress,
              })
            );
            if (progress < 1) {
              animationFrameId = window.requestAnimationFrame(tick);
              return;
            }
          };
          animationFrameId = window.requestAnimationFrame(tick);
          return;
        }
      }
      if (!isSetRuntimeDemoTrajectoryMessage(event.data)) return;
      const toLabel = event.data.toLabel?.trim() ?? "";
      if (!toLabel) return;
      const targetPosition = resolveRuntimePreviewTargetPosition({
        label: toLabel,
        runtimeObjects,
      });
      if (!targetPosition) return;

      const startPose = effectiveRuntimePoseRef.current ?? runtimeRobotBasePose;
      const startTime = performance.now();
      const navigationDurationMs =
        RUNTIME_DEMO_NAVIGATION_DURATION_BY_SPEED_MS[runtimeDemoSpeedMode];
      const tick = (now: number) => {
        const progress = Math.min(1, (now - startTime) / navigationDurationMs);
        setRuntimeDemoScanPose(null);
        setRuntimeDemoNavigatePose(
          computeRuntimeDemoNavigatePose({
            startPose,
            targetPosition,
            progress,
          })
        );
        if (progress < 1) {
          animationFrameId = window.requestAnimationFrame(tick);
          return;
        }
        if (runtimeRobotBasePose) {
          clearTimeoutId = window.setTimeout(() => setRuntimeDemoNavigatePose(null), 150);
        }
      };

      if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
      if (clearTimeoutId !== null) window.clearTimeout(clearTimeoutId);
      animationFrameId = window.requestAnimationFrame(tick);
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
      if (clearTimeoutId !== null) window.clearTimeout(clearTimeoutId);
    };
  }, [
    runtimeDemoSpeedMode,
    runtimeObjects,
    runtimePreviewMode,
    runtimeRobotBasePose,
    thumbnailParams.runtimeDemo,
  ]);

  const effectiveRuntimePose = runtimeDemoNavigatePose ?? runtimeDemoScanPose ?? runtimeRobotBasePose;

  useEffect(() => {
    effectiveRuntimePoseRef.current = effectiveRuntimePose;
  }, [effectiveRuntimePose]);

  useEffect(() => {
    if (!runtimePreviewMode || typeof window === "undefined" || window.parent === window) return;
    if (!effectiveRuntimePose) return;
    const yawRad =
      2 * Math.atan2(effectiveRuntimePose.quaternion.z, effectiveRuntimePose.quaternion.w);
    window.parent.postMessage(
      {
        type: RUNTIME_POSE_SAMPLE_MESSAGE_TYPE,
        requestId: String(Date.now()),
        x: effectiveRuntimePose.position.x,
        y: effectiveRuntimePose.position.y,
        yawDeg: (yawRad * 180) / Math.PI,
        tMs: Math.round(performance.now()),
      },
      window.location.origin
    );
  }, [effectiveRuntimePose, runtimePreviewMode]);

  return {
    effectiveRuntimePose,
    handleImportDemoWorldLayoutFromDialog,
    handlePlayDemoMotion,
    runtimePreviewLoadError: runtimePreviewMode ? runtimePreviewLoadError : null,
  };
};
