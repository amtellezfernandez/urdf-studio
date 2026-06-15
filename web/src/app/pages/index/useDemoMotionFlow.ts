import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { toast } from "sonner";

import { DEMO_AUTOLOAD, DEMO_LOCAL_MANIFEST_URL, DEMO_MANIFEST_URL, DEMO_MODE } from "@/shared/config/demo";
import {
  loadDemoFileListFromManifestUrls,
  loadDemoFileListProgressivelyFromManifestUrls,
} from "@/app/pages/index/demoBootstrap";
import {
  shouldPrepareLeKiwiDemoScene,
  shouldPreserveScenarioWorldLayoutOnDemoMotion,
} from "@/app/pages/index/demoMotionPolicy";
import { resolveDemoJointNames } from "@/app/pages/index/demoMotionHelpers";
import { createDemoEpisodes } from "@/shared/samples/demoMotion";
import { viewerPlayback } from "@/features/viewer/playback/viewerPlayback";
import { toAnimationFrames, type Episode } from "@/features/dataset";
import type { DatasetActions } from "@/features/dataset/datasetActions";
import type { JointLimits } from "@/shared/lib/urdfBrowser";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import type { URDFRobot } from "urdf-loader";
import type { AnimationFrame } from "@/features/viewer/viewer-types";
import type { EpisodePlaybackOptions } from "@/shared/store/useViewerPlaybackStore";

type DemoPlaybackHandlers = {
  playEpisode?: (frames: AnimationFrame[], options?: EpisodePlaybackOptions) => void;
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

type UseDemoMotionFlowParams = {
  activeUrdfPath: string | null;
  availableJoints: string[];
  datasetActions: DatasetActions | null;
  hasLoadedFiles: boolean;
  hydrateDemoAssetsFromFiles?: (
    files: FileList,
    options?: DemoAssetHydrateOptions
  ) => Promise<boolean>;
  isLeKiwiDemoRobot: boolean;
  jointLimits: JointLimits;
  loadDemoUrdfTextWithFreshCameras?: (
    content: string,
    options?: DemoUrdfTextLoadOptions
  ) => void;
  loadFilesFromFolderWithFreshCameras: (
    files: FileList,
    options?: { preserveCameras?: boolean }
  ) => void | Promise<void>;
  playbackHandlers: DemoPlaybackHandlers;
  prepareDemoScene: () => boolean;
  robot: URDFRobot | null;
  setIsViewerOpen: (open: boolean) => void;
  setViewerEpisode: (episode: Episode) => void;
  skipDefaultWorldLayoutAutoImportRef: MutableRefObject<boolean>;
  urdfAnalysis: UrdfAnalysis | null;
};

const DEMO_MANIFEST_URL_CANDIDATES = [
  DEMO_MANIFEST_URL,
  DEMO_LOCAL_MANIFEST_URL,
  "/demo/manifest.json",
] as const;

const getFileRelativePath = (file: File): string => {
  const withRelativePath = file as File & { webkitRelativePath?: string };
  return withRelativePath.webkitRelativePath || file.name;
};

export const useDemoMotionFlow = ({
  activeUrdfPath,
  availableJoints,
  datasetActions,
  hasLoadedFiles,
  hydrateDemoAssetsFromFiles,
  isLeKiwiDemoRobot,
  jointLimits,
  loadDemoUrdfTextWithFreshCameras,
  loadFilesFromFolderWithFreshCameras,
  playbackHandlers,
  prepareDemoScene,
  robot,
  setIsViewerOpen,
  setViewerEpisode,
  skipDefaultWorldLayoutAutoImportRef,
  urdfAnalysis,
}: UseDemoMotionFlowParams) => {
  const [pendingDemoMotion, setPendingDemoMotion] = useState(false);
  const [pendingDemoEpisodes, setPendingDemoEpisodes] = useState<Episode[] | null>(null);
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
  const pendingDemoEpisodesRequestRef = useRef(0);
  const appliedDemoEpisodesRequestRef = useRef(0);
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
      const activePath = getFileRelativePath(urdfFile);
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
  ]);

  const loadDemoBootstrapRobot = useCallback(async () => {
    await loadBundledDemoRobot();
  }, [loadBundledDemoRobot]);

  const playDemoEpisode = useCallback(
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

      const demoEpisodes = createDemoEpisodes({
        jointNames,
        jointLimits,
      });
      const firstEpisode = demoEpisodes[0];
      const episodesRequestId = pendingDemoEpisodesRequestRef.current + 1;
      pendingDemoEpisodesRequestRef.current = episodesRequestId;
      setPendingDemoEpisodes(demoEpisodes);
      if (datasetActions?.loadDemoEpisodes) {
        datasetActions.loadDemoEpisodes(demoEpisodes);
        appliedDemoEpisodesRequestRef.current = episodesRequestId;
        setPendingDemoEpisodes(null);
      }

      const shouldPrepareDemoScene = shouldPrepareLeKiwiDemoScene(isLeKiwiDemoRobot);
      const didPrepare = shouldPrepareDemoScene ? prepareDemoScene() : true;
      setPendingDemoScene(shouldPrepareDemoScene && !didPrepare);
      if (!firstEpisode) {
        toast.error("Demo motion has no frames.");
        return;
      }

      if (!openViewer) {
        return;
      }

      setViewerEpisode(firstEpisode);
      setIsViewerOpen(true);
      const demoFrames = toAnimationFrames(firstEpisode);

      const playbackRequestId = pendingDemoPlaybackRequestRef.current + 1;
      pendingDemoPlaybackRequestRef.current = playbackRequestId;
      if (playbackHandlers.playEpisode) {
        viewerPlayback.playEpisode(demoFrames, { autoplay, applyInitialFrame });
        appliedDemoPlaybackRequestRef.current = playbackRequestId;
        setPendingDemoPlaybackFrames(null);
      } else {
        setPendingDemoPlaybackFrames(demoFrames);
        setPendingDemoPlaybackAutoplay(autoplay);
        setPendingDemoPlaybackApplyInitialFrame(applyInitialFrame);
      }
    },
    [
      datasetActions,
      isLeKiwiDemoRobot,
      jointLimits,
      playbackHandlers.playEpisode,
      prepareDemoScene,
      setIsViewerOpen,
      setViewerEpisode,
    ]
  );

  const triggerDemoPlaybackFromLauncher = useCallback(
    (jointNames: string[]) => {
      const shouldAutoplay = demoMotionLoadedRef.current;
      playDemoEpisode(jointNames, {
        autoplay: shouldAutoplay,
        applyInitialFrame: shouldAutoplay,
        openViewer: true,
      });
      demoMotionLoadedRef.current = true;
    },
    [playDemoEpisode]
  );

  const handlePlayDemoMotion = useCallback(() => {
    if (
      shouldPreserveScenarioWorldLayoutOnDemoMotion({
        hasLoadedFiles,
        isLeKiwiDemoRobot,
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
    isLeKiwiDemoRobot,
    loadDemoBootstrapRobot,
    pendingDemoMotion,
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
    playDemoEpisode(jointNames, {
      autoplay: false,
      openViewer: false,
    });
    demoMotionPrimedRef.current = true;
  }, [hasLoadedFiles, playDemoEpisode, resolveCurrentDemoJointNames]);

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
    if (!pendingDemoEpisodes) return;
    if (!datasetActions?.loadDemoEpisodes) return;
    if (appliedDemoEpisodesRequestRef.current === pendingDemoEpisodesRequestRef.current) {
      return;
    }
    datasetActions.loadDemoEpisodes(pendingDemoEpisodes);
    appliedDemoEpisodesRequestRef.current = pendingDemoEpisodesRequestRef.current;
    setPendingDemoEpisodes(null);
  }, [datasetActions, pendingDemoEpisodes]);

  useEffect(() => {
    if (!pendingDemoScene) return;
    if (!shouldPrepareLeKiwiDemoScene(isLeKiwiDemoRobot)) {
      setPendingDemoScene(false);
      return;
    }
    const didPrepare = prepareDemoScene();
    if (didPrepare) {
      setPendingDemoScene(false);
    }
  }, [isLeKiwiDemoRobot, pendingDemoScene, prepareDemoScene]);

  useEffect(() => {
    if (!pendingDemoPlaybackFrames) return;
    if (!playbackHandlers.playEpisode) return;
    if (appliedDemoPlaybackRequestRef.current === pendingDemoPlaybackRequestRef.current) {
      return;
    }
    viewerPlayback.playEpisode(pendingDemoPlaybackFrames, {
      autoplay: pendingDemoPlaybackAutoplay,
      applyInitialFrame: pendingDemoPlaybackApplyInitialFrame,
    });
    appliedDemoPlaybackRequestRef.current = pendingDemoPlaybackRequestRef.current;
    setPendingDemoPlaybackFrames(null);
  }, [
    pendingDemoPlaybackApplyInitialFrame,
    pendingDemoPlaybackAutoplay,
    pendingDemoPlaybackFrames,
    playbackHandlers.playEpisode,
  ]);

  return {
    handlePlayDemoMotion,
    loadBundledDemoRobot,
    pendingDemoMotion,
  };
};
