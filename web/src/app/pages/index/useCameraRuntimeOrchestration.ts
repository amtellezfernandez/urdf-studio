import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import type { Camera } from "@/shared/types/camera";
import type { URDFRobot } from "urdf-loader";

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
  onDemoManifestPreferences?: UseDemoMotionFlowParams["onDemoManifestPreferences"];
  playbackHandlers: UseDemoMotionFlowParams["playbackHandlers"];
  prepareDemoWorldLayoutOnMotion?: boolean;
  preserveDemoWorldLayoutOnMotion?: boolean;
  removeCamera: (cameraId: string) => void;
  removeObject: (id: string) => void;
  robot: URDFRobot | null;
  robotBoundingBox: THREE.Box3 | null;
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
  onDemoManifestPreferences,
  playbackHandlers,
  prepareDemoWorldLayoutOnMotion,
  preserveDemoWorldLayoutOnMotion,
  removeCamera,
  removeObject,
  robot,
  robotBoundingBox,
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
    (): boolean => {
      if (!robot || availableLinks.length === 0) return false;

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
      addObject,
      availableLinks,
      endEffectorLink,
      ensureDetectedCamerasForLoadedRobot,
      removeObject,
      robot,
      robotBoundingBox,
      updateTrackedJoint,
    ]
  );

  const prepareDemoScene = useCallback(
    () => applyWorldScenarioLayout(),
    [applyWorldScenarioLayout]
  );

  const applyDemoWorldLayoutForCurrentRobot = useCallback(
    () => applyWorldScenarioLayout(),
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
    jointLimits,
    loadDemoUrdfTextWithFreshCameras,
    loadFilesFromFolderWithFreshCameras,
    onDemoManifestPreferences,
    playbackHandlers,
    prepareDemoWorldLayoutOnMotion,
    prepareDemoScene,
    preserveDemoWorldLayoutOnMotion,
    robot,
    skipDefaultWorldLayoutAutoImportRef,
    urdfAnalysis,
  });

  useThumbnailBootstrap({
    hasLoadedFiles,
    loadBundledDemoRobot,
    loadFilesFromFolderWithFreshCameras,
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

  return {
    handleImportDemoWorldLayoutFromDialog,
    handlePlayDemoMotion,
  };
};
