import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { toast } from "sonner";

import { DEMO_AUTOLOAD, DEMO_LOCAL_MANIFEST_URL, DEMO_MANIFEST_URL, DEMO_MODE } from "@/shared/config/demo";
import { getBrowserFileRelativePath } from "@/shared/lib/browserFilePaths";
import {
  loadDemoFileListFromManifestUrls,
  loadDemoFileListProgressivelyFromManifestUrls,
  type DemoRobotAssetPreferences,
} from "@/app/pages/index/demoBootstrap";
import {
  shouldPrepareDemoWorldLayoutOnMotion,
  shouldPreserveDemoWorldLayoutOnMotion,
} from "@/app/pages/index/demoMotionPolicy";
import { resolveDemoJointNames } from "@/app/pages/index/demoMotionHelpers";
import { createDemoMotionSequences, toDemoAnimationFrames } from "@/shared/samples/demoMotion";
import { viewerPlayback } from "@/features/viewer/playback/viewerPlayback";
import type { JointLimits } from "@/shared/lib/urdfBrowser";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import type { URDFRobot } from "urdf-loader";
import type { AnimationFrame } from "@/features/viewer/viewer-types";
import type { FramePlaybackOptions } from "@/shared/store/useViewerPlaybackStore";

type DemoPlaybackHandlers = {
  playFrames?: (frames: AnimationFrame[], options?: FramePlaybackOptions) => void;
};

type DemoUrdfTextLoadOptions = {
  activePath?: string;
  basePath?: string;
  filename?: string;
  packageRoots?: Record<string, string[]>;
  urdfDocuments?: Record<string, string>;
};

type DemoAssetHydrateOptions = {
  activePath?: string | null;
  shouldApply?: () => boolean;
  urdfContent?: string;
};

export type DemoManifestPreferencesLoad = {
  activePath: string;
  preferences: DemoRobotAssetPreferences;
};

type UseDemoMotionFlowParams = {
  activeUrdfPath: string | null;
  availableJoints: string[];
  hasLoadedFiles: boolean;
  hydrateDemoAssetsFromFiles?: (
    files: FileList,
    options?: DemoAssetHydrateOptions
  ) => Promise<boolean>;
  jointLimits: JointLimits;
  loadDemoUrdfTextWithFreshCameras?: (
    content: string,
    options?: DemoUrdfTextLoadOptions
  ) => void;
  loadFilesFromFolderWithFreshCameras: (
    files: FileList,
    options?: { preserveCameras?: boolean }
  ) => void | Promise<void>;
  onDemoManifestPreferences?: (load: DemoManifestPreferencesLoad) => void;
  playbackHandlers: DemoPlaybackHandlers;
  prepareDemoWorldLayoutOnMotion?: boolean;
  prepareDemoScene: () => boolean;
  preserveDemoWorldLayoutOnMotion?: boolean;
  robot: URDFRobot | null;
  skipDefaultWorldLayoutAutoImportRef: MutableRefObject<boolean>;
  urdfAnalysis: UrdfAnalysis | null;
};

const DEMO_MANIFEST_URL_CANDIDATES = [
  DEMO_MANIFEST_URL,
  DEMO_LOCAL_MANIFEST_URL,
  "/demo/manifest.json",
] as const;

export const useDemoMotionFlow = ({
  activeUrdfPath,
  availableJoints,
  hasLoadedFiles,
  hydrateDemoAssetsFromFiles,
  jointLimits,
  loadDemoUrdfTextWithFreshCameras,
  loadFilesFromFolderWithFreshCameras,
  onDemoManifestPreferences,
  playbackHandlers,
  prepareDemoWorldLayoutOnMotion = false,
  prepareDemoScene,
  preserveDemoWorldLayoutOnMotion = false,
  robot,
  skipDefaultWorldLayoutAutoImportRef,
  urdfAnalysis,
}: UseDemoMotionFlowParams) => {
  const [pendingDemoMotion, setPendingDemoMotion] = useState(false);
  const [pendingDemoPlaybackFrames, setPendingDemoPlaybackFrames] = useState<
    AnimationFrame[] | null
  >(null);
  const [pendingDemoPlaybackAutoplay, setPendingDemoPlaybackAutoplay] = useState(true);
  const [pendingDemoPlaybackApplyInitialFrame, setPendingDemoPlaybackApplyInitialFrame] =
    useState(true);
  const [pendingDemoScene, setPendingDemoScene] = useState(false);
  const demoAutoLoadedRef = useRef(false);
  const demoMotionPrimedRef = useRef(false);
  const demoMotionLoadedRef = useRef(false);
  const pendingDemoPlaybackRequestRef = useRef(0);
  const appliedDemoPlaybackRequestRef = useRef(0);
  const activeUrdfPathRef = useRef(activeUrdfPath);

  useEffect(() => {
    activeUrdfPathRef.current = activeUrdfPath;
  }, [activeUrdfPath]);

  const resolveCurrentDemoJointNames = useCallback(
    () =>
      resolveDemoJointNames({
        availableJoints,
        jointLimits,
        robot,
        urdfAnalysis,
      }),
    [availableJoints, jointLimits, robot, urdfAnalysis]
  );

  const loadBundledDemoRobot = useCallback(async () => {
    if (loadDemoUrdfTextWithFreshCameras && hydrateDemoAssetsFromFiles) {
      const progressiveFileList = await loadDemoFileListProgressivelyFromManifestUrls(
        DEMO_MANIFEST_URL_CANDIDATES
      );
      const initialFiles = Array.from(progressiveFileList.initialFileList);
      const urdfFile = initialFiles[0];
      if (!urdfFile) {
        throw new Error("Demo progressive bootstrap did not return a URDF file.");
      }

      const urdfContent = await urdfFile.text();
      const activePath = getBrowserFileRelativePath(urdfFile);
      onDemoManifestPreferences?.({
        activePath,
        preferences: progressiveFileList.preferences,
      });
      loadDemoUrdfTextWithFreshCameras(urdfContent, {
        activePath,
        filename: urdfFile.name,
      });
      activeUrdfPathRef.current = activePath;

      void progressiveFileList
        .loadRemainingFileList()
        .then(async (remainingFiles) => {
          if (remainingFiles.length === 0) return;
          await hydrateDemoAssetsFromFiles(remainingFiles, {
            activePath,
            shouldApply: () => activeUrdfPathRef.current === activePath,
            urdfContent,
          });
        })
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : "Failed to finish loading demo assets";
          toast.error(message);
        });
      return;
    }

    const fileList = await loadDemoFileListFromManifestUrls(DEMO_MANIFEST_URL_CANDIDATES);
    await loadFilesFromFolderWithFreshCameras(fileList);
  }, [
    hydrateDemoAssetsFromFiles,
    loadDemoUrdfTextWithFreshCameras,
    loadFilesFromFolderWithFreshCameras,
    onDemoManifestPreferences,
  ]);

  const loadDemoBootstrapRobot = useCallback(async () => {
    await loadBundledDemoRobot();
  }, [loadBundledDemoRobot]);

  const playDemoMotionSequence = useCallback(
    (
      jointNames: string[],
      options?: {
        autoplay?: boolean;
        applyInitialFrame?: boolean;
        openViewer?: boolean;
      }
    ) => {
      if (jointNames.length === 0) {
        toast.error("Demo motion requires a robot with joints loaded.");
        return;
      }
      const autoplay = options?.autoplay ?? true;
      const applyInitialFrame = options?.applyInitialFrame ?? autoplay;
      const openViewer = options?.openViewer ?? true;

      const demoMotionSequences = createDemoMotionSequences({
        jointNames,
        jointLimits,
      });
      const firstSequence = demoMotionSequences[0];

      const shouldPrepareDemoScene = shouldPrepareDemoWorldLayoutOnMotion(
        prepareDemoWorldLayoutOnMotion
      );
      const didPrepare = shouldPrepareDemoScene ? prepareDemoScene() : true;
      setPendingDemoScene(shouldPrepareDemoScene && !didPrepare);
      if (!firstSequence) {
        toast.error("Demo motion has no frames.");
        return;
      }

      if (!openViewer) {
        return;
      }

      const demoFrames = toDemoAnimationFrames(firstSequence);

      const playbackRequestId = pendingDemoPlaybackRequestRef.current + 1;
      pendingDemoPlaybackRequestRef.current = playbackRequestId;
      if (playbackHandlers.playFrames) {
        viewerPlayback.playFrames(demoFrames, { autoplay, applyInitialFrame });
        appliedDemoPlaybackRequestRef.current = playbackRequestId;
        setPendingDemoPlaybackFrames(null);
      } else {
        setPendingDemoPlaybackFrames(demoFrames);
        setPendingDemoPlaybackAutoplay(autoplay);
        setPendingDemoPlaybackApplyInitialFrame(applyInitialFrame);
      }
    },
    [
      jointLimits,
      playbackHandlers.playFrames,
      prepareDemoWorldLayoutOnMotion,
      prepareDemoScene,
    ]
  );

  const triggerDemoPlaybackFromLauncher = useCallback(
    (jointNames: string[]) => {
      const shouldAutoplay = demoMotionLoadedRef.current;
      playDemoMotionSequence(jointNames, {
        autoplay: shouldAutoplay,
        applyInitialFrame: shouldAutoplay,
        openViewer: true,
      });
      demoMotionLoadedRef.current = true;
    },
    [playDemoMotionSequence]
  );

  const handlePlayDemoMotion = useCallback(() => {
    if (
      shouldPreserveDemoWorldLayoutOnMotion({
        hasLoadedFiles,
        preserveDemoWorldLayoutOnMotion,
      })
    ) {
      // Demo motion needs ownership of spawned scenario objects.
      // Prevent default world-layout auto-import from clearing them afterwards.
      skipDefaultWorldLayoutAutoImportRef.current = true;
    }
    if (!hasLoadedFiles) {
      setPendingDemoMotion(true);
      loadDemoBootstrapRobot().catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to load demo robot";
        toast.error(message);
      });
      return;
    }

    const jointNames = resolveCurrentDemoJointNames();
    if (jointNames.length === 0) {
      if (!pendingDemoMotion) {
        toast.info("Waiting for joints to finish loading...");
      }
      setPendingDemoMotion(true);
      return;
    }
    triggerDemoPlaybackFromLauncher(jointNames);
  }, [
    hasLoadedFiles,
    loadDemoBootstrapRobot,
    pendingDemoMotion,
    preserveDemoWorldLayoutOnMotion,
    resolveCurrentDemoJointNames,
    skipDefaultWorldLayoutAutoImportRef,
    triggerDemoPlaybackFromLauncher,
  ]);

  useEffect(() => {
    if (!DEMO_MODE || !DEMO_AUTOLOAD || demoAutoLoadedRef.current || hasLoadedFiles) return;
    demoAutoLoadedRef.current = true;
    loadDemoBootstrapRobot().catch((error) => {
      const message = error instanceof Error ? error.message : "Failed to load demo robot";
      toast.error(message);
    });
  }, [hasLoadedFiles, loadDemoBootstrapRobot]);

  useEffect(() => {
    if (!DEMO_MODE || !DEMO_AUTOLOAD || demoMotionPrimedRef.current) return;
    if (!hasLoadedFiles) return;
    const jointNames = resolveCurrentDemoJointNames();
    if (jointNames.length === 0) return;
    playDemoMotionSequence(jointNames, {
      autoplay: false,
      openViewer: false,
    });
    demoMotionPrimedRef.current = true;
  }, [hasLoadedFiles, playDemoMotionSequence, resolveCurrentDemoJointNames]);

  useEffect(() => {
    if (!pendingDemoMotion || !hasLoadedFiles) return;
    const jointNames = resolveCurrentDemoJointNames();
    if (jointNames.length === 0) return;
    triggerDemoPlaybackFromLauncher(jointNames);
    setPendingDemoMotion(false);
  }, [
    hasLoadedFiles,
    pendingDemoMotion,
    resolveCurrentDemoJointNames,
    triggerDemoPlaybackFromLauncher,
  ]);

  useEffect(() => {
    if (!pendingDemoScene) return;
    if (!shouldPrepareDemoWorldLayoutOnMotion(prepareDemoWorldLayoutOnMotion)) {
      setPendingDemoScene(false);
      return;
    }
    const didPrepare = prepareDemoScene();
    if (didPrepare) {
      setPendingDemoScene(false);
    }
  }, [pendingDemoScene, prepareDemoScene, prepareDemoWorldLayoutOnMotion]);

  useEffect(() => {
    if (!pendingDemoPlaybackFrames) return;
    if (!playbackHandlers.playFrames) return;
    if (appliedDemoPlaybackRequestRef.current === pendingDemoPlaybackRequestRef.current) {
      return;
    }
    viewerPlayback.playFrames(pendingDemoPlaybackFrames, {
      autoplay: pendingDemoPlaybackAutoplay,
      applyInitialFrame: pendingDemoPlaybackApplyInitialFrame,
    });
    appliedDemoPlaybackRequestRef.current = pendingDemoPlaybackRequestRef.current;
    setPendingDemoPlaybackFrames(null);
  }, [
    pendingDemoPlaybackApplyInitialFrame,
    pendingDemoPlaybackAutoplay,
    pendingDemoPlaybackFrames,
    playbackHandlers.playFrames,
  ]);

  return {
    handlePlayDemoMotion,
    loadBundledDemoRobot,
    pendingDemoMotion,
  };
};
