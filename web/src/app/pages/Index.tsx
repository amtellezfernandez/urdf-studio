import type { ComponentProps } from "react";
import { useState, useCallback, useMemo, startTransition, useEffect } from "react";
import { FolderUploadScreen } from "@/features/dataset/FolderUploadScreen";
import { toAnimationFrames, useDatasetActions } from "@/features/dataset";
import type { Episode } from "@/features/dataset";
import { toast } from "sonner";
import { useCameraStore } from "@/shared/store/useCameraStore";
import { autoComputeCameraPoseDefault, useCameraPanels } from "@/features/camera";
import type { FileWithPath } from "@/shared/types/file";
import type { URDFRobot } from "urdf-loader";
import { useUrdfEditHandlers } from "@/features/layout/page/useUrdfEditHandlers";
import { useUrdfUtilityHandlers } from "@/features/layout/page/useUrdfUtilityHandlers";
import { useDatasetPlaybackHandlers } from "@/features/layout/page/useDatasetPlaybackHandlers";
import { useUrdfMaterialHandlers } from "@/features/layout/page/useUrdfMaterialHandlers";
import { PageLayout } from "@/features/layout/page/PageLayout";

import type { RotationAxis, UrdfViewMode, AngleUnit } from "@/shared/types/feature";
import { useUrdfLoader, useUrdfSelection } from "@/features/urdf";
import { useObjectCreatorStore, useObjectStore } from "@/features/objects";
import { useLayout } from "@/features/layout";
import { useExportHandlers, useJointMappingPersistence } from "@/features/dataset/exports";
import { useThemeAndGPUMode } from "@/features/theme";
import { DEMO_ROBOT_URDF } from "@/shared/samples/demoRobot";
import { createDemoEpisodes } from "@/shared/samples/demoMotion";
import { viewerPlayback } from "@/features/viewer/playback/viewerPlayback";
import { API_BASE_URL } from "@/shared/config/api";
import { useIkConfigSync } from "@/features/ik/useIkConfigSync";
import { useIkRegistrySync } from "@/features/ik/useIkRegistrySync";
import * as THREE from "three";

const Index = () => {
  useIkConfigSync();
  useIkRegistrySync();
  const { gpuMode, setGPUMode } = useThemeAndGPUMode();
  const cameras = useCameraStore((state) => state.cameras);
  const selectedCameraId = useCameraStore((state) => state.selectedCameraId);
  const addCamera = useCameraStore((state) => state.addCamera);
  const objects = useObjectStore((state) => state.objects);
  const addObject = useObjectStore((state) => state.addObject);
  const objectCount = objects.length;
  const {
    selectedJoint,
    setSelectedJoint,
    selectedLink,
    setSelectedLink,
    hoveredJoint,
    setHoveredJoint,
    endEffectorLink,
    setEndEffectorLink,
    deletedJoints,
    toggleDeletedJoint,
    jointValues,
    setJointValue: setStoreJointValue,
    setJointValues,
    clearSelection,
    setContext: setSelectionContext,
  } = useUrdfSelection();
  const [availableJoints, setAvailableJoints] = useState<string[]>([]);
  const {
    urdfFile,
    meshFiles,
    isLoading,
    hasLoadedFiles,
    jointLimits,
    jointAxes,
    originalJointAxes,
    availableLinks,
    originalUrdfContent,
    vizUrdfContent,
    originalVizUrdfContent,
    savedVizUrdfContent,
    debugMeshInfo,
    unmatchedURDFRefs,
    showDebugDialog,
    setShowDebugDialog,
    urdfValidationError,
    showLoadIssues,
    setShowLoadIssues,
    setSavedVizUrdfContent,
    setOriginalVizUrdfContent,
    setJointLimits,
    setJointAxes,
    setOriginalJointAxes,
    setVizUrdfContent,
    setUrdfFile,
    createUrdfFile,
    updateUrdfFile,
    loadFilesFromFolder,
  } = useUrdfLoader({
    onClearSelection: clearSelection,
    onAutoSelectEndEffector: setEndEffectorLink,
  });
  const [urdfContentVersion, setUrdfContentVersion] = useState<number>(0);
  const [pendingDemoEpisodes, setPendingDemoEpisodes] = useState<Episode[] | null>(null);
  const [pendingDemoScene, setPendingDemoScene] = useState(false);
  const [pendingDemoLoad, setPendingDemoLoad] = useState(false);
  const {
    isPlaying,
    setIsPlaying,
    hasAnimationFrames,
    setHasAnimationFrames,
    currentFrame,
    setCurrentFrame,
    totalFrames,
    rotationPlaneVisible,
    setRotationPlaneVisible,
    collisionVisibility,
    setCollisionVisibility,
    viewerSplitView,
    setViewerSplitView,
    handleMotionDataUpload,
    handlePlayAnimation,
    handleFrameChange,
    motionDataFile,
    setMotionDataFile,
    viewerEpisode,
    setViewerEpisode,
    isViewerOpen,
    setIsViewerOpen,
    episodeSaveHandler,
    handleEpisodeSaveHandlerChange,
    episodeJointNames,
  } = useDatasetPlaybackHandlers();
  const {
    sidebarWidth,
    setSidebarWidth,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    rightSidebarWidth,
    setRightSidebarWidth,
    isRightSidebarCollapsed,
    recordingViewHeight,
    setRecordingViewHeight,
    clampRecordingViewHeight,
    handleSidebarToggle,
    handleSidebarResizeStart,
    handleRightSidebarResizeStart,
    handleViewerResizeStart,
  } = useLayout();
  const [showUrdfEditor, setShowUrdfEditor] = useState(false);
  const [urdfViewMode, setUrdfViewMode] = useState<UrdfViewMode>("split");
  const [rotationAxis, setRotationAxis] = useState<RotationAxis>("z");
  const [urdfEditorSplitView, setUrdfEditorSplitView] = useState(false);
  const [angleUnit, setAngleUnit] = useState<AngleUnit>("rad");
  const [pendingDemoMotion, setPendingDemoMotion] = useState(false);
  const {
    isExportDialogOpen,
    openExportDialog,
    closeExportDialog,
    handleSave,
    handleRevert,
    canRevert,
    exportCamerasAsJSON,
    exportCamerasAsYAML,
    hasCamerasToExport,
  } = useExportHandlers({
    vizUrdfContent,
    savedVizUrdfContent,
    updateUrdfFile,
    setSavedVizUrdfContent,
    cameras,
  });
  const {
    mappingDialogData,
    selectedMapping,
    showMappingDialog,
    showMappingListPanel,
    savedMappings,
    openMappingList,
    closeMappingList,
    selectMapping,
    deleteMappingById,
    applyMapping,
    closeMappingDialog,
  } = useJointMappingPersistence();

  // Object creation state
  const {
    isOpen: objectCreatorOpen,
    type: objectCreatorType,
    open: openObjectCreator,
    close: closeObjectCreator,
    robotBoundingBox,
    setRobotBoundingBox,
  } = useObjectCreatorStore();
  const [robot, setRobot] = useState<URDFRobot | null>(null);

  // Camera creation state
  const {
    showCameraCreator,
    setShowCameraCreator,
    showCameraUpload,
    setShowCameraUpload,
    showPovCameras,
    setShowPovCameras,
  } = useCameraPanels();

  const { datasetActions, handleDatasetActionsReady } = useDatasetActions();

  // Keep selection context in sync for auto end-effector selection and validity checks
  useEffect(() => {
    setSelectionContext({ vizUrdfContent, availableLinks });
  }, [vizUrdfContent, availableLinks, setSelectionContext]);

  const handleJointChange = useCallback((jointName: string, value: number) => {
    setStoreJointValue(jointName, value);
  }, [setStoreJointValue]);

  const handleIkApplied = useCallback((values: Record<string, number>) => {
    setJointValues(values);
  }, [setJointValues]);

  const resolveDemoJointNames = useCallback(() => {
    if (availableJoints.length > 0) return availableJoints;
    const limitNames = Object.keys(jointLimits ?? {});
    if (limitNames.length > 0) return limitNames;
    return [];
  }, [availableJoints, jointLimits]);

  const resolveParentLinkFromRobot = useCallback(
    (linkName: string) => {
      if (!robot) return null;
      const linkObj =
        robot.links?.[linkName] ??
        robot.getObjectByName?.(linkName) ??
        robot.getObjectByName?.(decodeURIComponent(linkName));
      if (!linkObj) return null;
      const linkNames = new Set(Object.keys(robot.links ?? {}));
      let cursor = linkObj.parent;
      while (cursor) {
        if (linkNames.has(cursor.name)) return cursor.name;
        cursor = cursor.parent;
      }
      return null;
    },
    [robot]
  );

  const resolveDemoCameraLink = useCallback(() => {
    if (availableLinks.length === 0) return null;
    const isFrameLike = (name: string) =>
      /frame|dummy|target|origin|marker|site/i.test(name);
    const isPreferred = (name: string) => /(gripper|tool|ee|end_effector)/i.test(name);

    const preferredFrame = availableLinks.find(
      (link) => /(gripper_frame|tool0|tcp|ee_frame)/i.test(link)
    );
    if (preferredFrame) return preferredFrame;

    if (endEffectorLink) {
      if (!isFrameLike(endEffectorLink)) return endEffectorLink;
      const parent = resolveParentLinkFromRobot(endEffectorLink);
      if (parent) return parent;
    }

    const preferred = availableLinks.find(
      (link) => isPreferred(link) && !isFrameLike(link)
    );
    if (preferred) return preferred;

    const fallback = availableLinks.find((link) => isPreferred(link));
    if (fallback) return fallback;

    return availableLinks[availableLinks.length - 1];
  }, [availableLinks, endEffectorLink, resolveParentLinkFromRobot]);

  const prepareDemoScene = useCallback(() => {
    const cameraLink = resolveDemoCameraLink();
    if (cameraLink) {
      const hasGripperCamera = cameras.some(
        (cam) => cam.parent_link === cameraLink && cam.name === "Gripper Top"
      );
      if (!hasGripperCamera) {
        const aimLink =
          availableLinks.find((link) =>
            /(gripper_frame|tool0|tool|tcp|end_effector|ee)/i.test(link)
          ) ?? null;
        const pose =
          autoComputeCameraPoseDefault(robot, cameraLink, {
            aimLink,
            robotBoundingBox,
            marginForward: 0.035,
            marginUp: 0.015,
          }) ?? {
            xyz: [0.02, 0, 0.08] as [number, number, number],
            rpy: [0, 0, 0] as [number, number, number],
          };
        addCamera({
          name: "Gripper Top",
          parent_link: cameraLink,
          pose,
          intrinsics: {
            width: 640,
            height: 480,
            fov_deg: 70,
          },
        });
      }
    }

    if (objectCount > 0) return Boolean(cameraLink);

    const baseCenter = robotBoundingBox
      ? robotBoundingBox.getCenter(new THREE.Vector3())
      : new THREE.Vector3(0, 0, 0);
    const baseSize = robotBoundingBox
      ? robotBoundingBox.getSize(new THREE.Vector3())
      : new THREE.Vector3(0.5, 0.4, 0.4);
    const baseZ = robotBoundingBox ? robotBoundingBox.min.z : 0;
    const forwardOffset = Math.max(0.35, baseSize.x * 0.6 + 0.2);
    const pedestalSize = new THREE.Vector3(
      Math.max(0.22, baseSize.x * 0.4),
      Math.max(0.18, baseSize.y * 0.3),
      0.06
    );
    const pedestalPosition = new THREE.Vector3(
      baseCenter.x + forwardOffset,
      baseCenter.y,
      baseZ + pedestalSize.z / 2
    );

    addObject({
      type: "cube",
      position: pedestalPosition,
      size: pedestalSize,
      color: "#1f2937",
      trackedJointName: null,
      isIkTarget: false,
    });

    const cubeSize = new THREE.Vector3(0.08, 0.08, 0.08);
    addObject({
      type: "cube",
      position: pedestalPosition.clone().add(
        new THREE.Vector3(-0.06, -0.05, (pedestalSize.z + cubeSize.z) / 2)
      ),
      size: cubeSize,
      color: "#f97316",
      trackedJointName: null,
      isIkTarget: false,
    });

    addObject({
      type: "cube",
      position: pedestalPosition.clone().add(
        new THREE.Vector3(0.05, 0.06, (pedestalSize.z + cubeSize.z) / 2)
      ),
      size: cubeSize,
      color: "#38bdf8",
      trackedJointName: null,
      isIkTarget: false,
    });

    const wallSize = new THREE.Vector3(0.05, 0.22, 0.18);
    addObject({
      type: "cube",
      position: pedestalPosition.clone().add(
        new THREE.Vector3(0.12, 0, (pedestalSize.z + wallSize.z) / 2)
      ),
      size: wallSize,
      color: "#64748b",
      trackedJointName: null,
      isIkTarget: false,
    });
    return Boolean(cameraLink);
  }, [
    addCamera,
    addObject,
    cameras,
    objectCount,
    resolveDemoCameraLink,
    robotBoundingBox,
    robot,
    availableLinks,
  ]);

  const playDemoEpisode = useCallback(
    (jointNames: string[]) => {
      if (jointNames.length === 0) {
        toast.error("Demo motion requires a robot with joints loaded.");
        return;
      }
      const demoEpisodes = createDemoEpisodes({
        jointNames,
        jointLimits,
      });
      const firstEpisode = demoEpisodes[0];
      if (datasetActions?.loadDemoEpisodes) {
        datasetActions.loadDemoEpisodes(demoEpisodes);
      } else {
        setPendingDemoEpisodes(demoEpisodes);
      }
      const didPrepare = prepareDemoScene();
      setPendingDemoScene(!didPrepare);
      if (!firstEpisode) {
        toast.error("Demo motion has no frames.");
        return;
      }
      setViewerEpisode(firstEpisode);
      setIsViewerOpen(true);
      viewerPlayback.playEpisode(toAnimationFrames(firstEpisode), { autoplay: true });
      setTimeout(() => {
        if (!hasAnimationFrames) {
          viewerPlayback.playEpisode(toAnimationFrames(firstEpisode), { autoplay: true });
        }
      }, 300);
    },
    [
      datasetActions,
      hasAnimationFrames,
      jointLimits,
      prepareDemoScene,
      setIsViewerOpen,
      setViewerEpisode,
    ]
  );

  const handleLoadQuickStart = useCallback(async () => {
    const fallbackToDemo = (reason?: string) => {
      if (reason) {
        toast.error(reason);
      }
      try {
        const demoFile = new File([DEMO_ROBOT_URDF], "demo_robot.urdf", {
          type: "application/xml",
        });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(demoFile);
        void loadFilesFromFolder(dataTransfer.files);
        setPendingDemoLoad(true);
        toast.success("Loaded demo robot");
      } catch {
        toast.error("Failed to load demo robot");
      }
    };

    try {
      const response = await fetch(`${API_BASE_URL}/samples/quickstart`);
      if (!response.ok) {
        let message = "Quick start sample unavailable";
        try {
          const payload = (await response.json()) as { detail?: string };
          if (payload?.detail) {
            message = payload.detail;
          }
        } catch {
          // Ignore parse errors.
        }
        throw new Error(message);
      }
      const data = (await response.json()) as {
        label?: string;
        files?: Array<{ path?: string; content_base64?: string; mime?: string }>;
      };
      if (!data?.files || data.files.length === 0) {
        throw new Error("Quick start sample has no files");
      }

      const dataTransfer = new DataTransfer();
      data.files.forEach((file) => {
        if (!file?.path || !file.content_base64) return;
        const binary = Uint8Array.from(atob(file.content_base64), (char) =>
          char.charCodeAt(0)
        );
        const blob = new Blob([binary], {
          type: file.mime || "application/octet-stream",
        });
        const filename = file.path.split("/").pop() || file.path;
        const fileObj = new File([blob], filename, { type: file.mime });
        Object.defineProperty(fileObj, "webkitRelativePath", {
          value: file.path,
          writable: false,
          enumerable: true,
          configurable: false,
        });
        dataTransfer.items.add(fileObj);
      });

      if (dataTransfer.files.length === 0) {
        throw new Error("Quick start sample files missing");
      }

      void loadFilesFromFolder(dataTransfer.files);
      setPendingDemoLoad(true);
      toast.success(`Loaded ${data.label ?? "SO-ARM100"} sample`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Quick start load failed";
      console.warn("Quick start load failed, falling back to demo:", error);
      fallbackToDemo(message);
    }
  }, [loadFilesFromFolder]);

  const handlePlayDemoMotion = useCallback(() => {
    if (!hasLoadedFiles) {
      setPendingDemoMotion(true);
      handleLoadQuickStart();
      return;
    }

    const jointNames = resolveDemoJointNames();
    if (jointNames.length === 0) {
      if (!pendingDemoMotion) {
        toast.info("Waiting for joints to finish loading...");
      }
      setPendingDemoMotion(true);
      return;
    }
    playDemoEpisode(jointNames);
  }, [
    handleLoadQuickStart,
    hasLoadedFiles,
    pendingDemoMotion,
    playDemoEpisode,
    resolveDemoJointNames,
  ]);

  useEffect(() => {
    if (!pendingDemoMotion || !hasLoadedFiles) return;

    const jointNames = resolveDemoJointNames();
    if (jointNames.length === 0) return;
    playDemoEpisode(jointNames);
    setPendingDemoMotion(false);
  }, [hasLoadedFiles, pendingDemoMotion, playDemoEpisode, resolveDemoJointNames]);

  useEffect(() => {
    if (!pendingDemoEpisodes || !datasetActions?.loadDemoEpisodes) return;
    datasetActions.loadDemoEpisodes(pendingDemoEpisodes);
    setPendingDemoEpisodes(null);
  }, [datasetActions, pendingDemoEpisodes]);

  useEffect(() => {
    if (!pendingDemoLoad || !hasLoadedFiles) return;
    if (datasetActions?.hasEpisodes) {
      setPendingDemoLoad(false);
      return;
    }
    const jointNames = resolveDemoJointNames();
    if (jointNames.length === 0) return;
    const demoEpisodes = createDemoEpisodes({
      jointNames,
      jointLimits,
    });
    if (datasetActions?.loadDemoEpisodes) {
      datasetActions.loadDemoEpisodes(demoEpisodes);
    } else {
      setPendingDemoEpisodes(demoEpisodes);
    }
    setPendingDemoLoad(false);
  }, [
    datasetActions,
    hasLoadedFiles,
    jointLimits,
    pendingDemoLoad,
    resolveDemoJointNames,
  ]);

  useEffect(() => {
    if (!pendingDemoScene) return;
    const didPrepare = prepareDemoScene();
    if (didPrepare) {
      setPendingDemoScene(false);
    }
  }, [pendingDemoScene, prepareDemoScene]);


  const {
    handleVizUrdfChange,
    handleLinkNameChange,
    handleJointAxisChange,
    handleResetAxis,
    handleJointTypeChange,
    handleJointVelocityChange,
    handleJointNameChange,
    handleJointLinkChange,
    handleResetRotation,
  } = useUrdfEditHandlers({
    vizUrdfContent,
    originalVizUrdfContent,
    originalJointAxes,
    selectedJoint,
    setSelectedJoint,
    setAvailableJoints,
    setJointLimits,
    setJointAxes,
    setUrdfFile,
    setVizUrdfContent,
    createUrdfFile,
    updateUrdfFile,
    setUrdfContentVersion,
  });

  const {
    handleCanonicalOrder,
    handlePrettyPrint,
    handleNormalizeAxes,
    handleFixMeshPaths,
    handleRotateRobot,
    getExportUrdfContent,
    robotName,
    handleDeleteJoint,
  } = useUrdfUtilityHandlers({
    vizUrdfContent,
    deletedJoints,
    toggleDeletedJoint,
    handleVizUrdfChange,
    updateUrdfFile,
  });

  const { handleMaterialChange } = useUrdfMaterialHandlers({
    vizUrdfContent,
    updateUrdfFile,
  });

  const handleRobotJointsLoaded = useCallback((joints: string[], angles: Record<string, number>) => {
    startTransition(() => {
      setAvailableJoints(joints);
      setJointValues(angles);
      // Don't automatically select a joint - let user choose what to select
    });
  }, [setJointValues]);

  const handleEpisodesResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const startY = event.clientY;
      const container = event.currentTarget.closest('.sidebar-panel') as HTMLElement;
      if (!container) return;

      const containerHeight = container.clientHeight;
      const startHeight = recordingViewHeight;
      const originalCursor = document.body.style.cursor;
      const originalUserSelect = document.body.style.userSelect;

      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientY - startY;
        const deltaRatio = delta / containerHeight;
        // Dragging up (negative delta) should make bottom section smaller
        // Dragging down (positive delta) should make bottom section bigger
        const nextHeight = clampRecordingViewHeight(startHeight + deltaRatio, containerHeight);
        setRecordingViewHeight(nextHeight);
      };

      const handlePointerUp = () => {
        document.body.style.cursor = originalCursor;
        document.body.style.userSelect = originalUserSelect;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [recordingViewHeight, clampRecordingViewHeight, setRecordingViewHeight]
  );

  const hasRotationChanges = useMemo(
    () => vizUrdfContent !== originalVizUrdfContent,
    [vizUrdfContent, originalVizUrdfContent]
  );

  // Show upload screen if no files loaded yet
  if (!hasLoadedFiles) {
    return (
      <FolderUploadScreen
        onFolderSelected={loadFilesFromFolder}
        onLoadQuickStart={handleLoadQuickStart}
        onPlayDemoMotion={handlePlayDemoMotion}
      />
    );
  }

  const githubToken =
    typeof window !== "undefined" && import.meta.env.VITE_GITHUB_TOKEN
      ? import.meta.env.VITE_GITHUB_TOKEN
      : null;

  const topNavBarProps: ComponentProps<typeof PageLayout>["topNavBarProps"] = {
    showMenus: Boolean(originalUrdfContent && vizUrdfContent),
    openExportDialog,
    onSave: handleSave,
    onRevert: handleRevert,
    canRevert,
    onResetRotation: handleResetRotation,
    hasRotationChanges,
    onCanonicalOrder: handleCanonicalOrder,
    onPrettyPrint: handlePrettyPrint,
    onNormalizeAxes: handleNormalizeAxes,
    onFixMeshPaths: handleFixMeshPaths,
    rotationAxis,
    setRotationAxis,
    onRotateRobot: handleRotateRobot,
    angleUnit,
    setAngleUnit,
    gpuMode,
    setGPUMode,
    showUrdfEditor,
    setShowUrdfEditor,
    urdfViewMode,
    setUrdfViewMode,
    showPovCameras,
    setShowPovCameras,
    openMappingList,
    datasetActions,
    openObjectCreator,
    setShowCameraCreator,
    setShowCameraUpload,
    exportCamerasAsJSON,
    exportCamerasAsYAML,
    hasCamerasToExport,
  };

  const leftSidebarProps: ComponentProps<typeof PageLayout>["leftSidebarProps"] = {
    isLoading,
    availableJoints,
    jointLimits,
    jointAxes,
    originalJointAxes,
    originalUrdfContent,
    vizUrdfContent,
    onJointChange: handleJointChange,
    onJointSelect: setSelectedJoint,
    selectedJoint,
    onVizUrdfChange: handleVizUrdfChange,
    onJointAxisChange: handleJointAxisChange,
    onResetAxis: handleResetAxis,
    onJointTypeChange: handleJointTypeChange,
    onJointNameChange: handleJointNameChange,
    onDeleteJoint: handleDeleteJoint,
    deletedJoints,
    getExportUrdfContent,
    onMotionDataUpload: handleMotionDataUpload,
    onPlayAnimation: handlePlayAnimation,
    isPlaying,
    motionDataFileName: motionDataFile?.name,
    hasAnimationFrames,
    currentFrame,
    totalFrames,
    sidebarWidth,
    isSidebarCollapsed,
    onToggleCollapse: handleSidebarToggle,
    meshFiles,
    onCollisionVisibilityChange: setCollisionVisibility,
    rotationPlaneVisible,
    onRotationPlaneVisibilityChange: setRotationPlaneVisible,
    onFrameChange: setCurrentFrame,
    onUrdfEditorToggle: setShowUrdfEditor,
    showUrdfEditor,
    viewerSplitView,
    onViewerSplitViewChange: setViewerSplitView,
    onViewerEpisodeChange: setViewerEpisode,
    onViewerOpenChange: setIsViewerOpen,
    onEpisodeSaveHandlerChange: handleEpisodeSaveHandlerChange,
    episodesViewHeight: recordingViewHeight,
    onEpisodesResizeStart: handleEpisodesResizeStart,
    onDatasetActionsReady: handleDatasetActionsReady,
    onSidebarResizeStart: handleSidebarResizeStart,
  };

  const viewerLayoutProps: ComponentProps<typeof PageLayout>["viewerLayoutProps"] = {
    isSidebarCollapsed,
    isRightSidebarCollapsed,
    sidebarWidth,
    rightSidebarWidth,
    showUrdfEditor,
    urdfEditorSplitView,
    recordingViewHeight,
    urdfContentVersion,
    urdfFile,
    meshFiles,
    hoveredJoint,
    selectedJoint,
    selectedLink,
    jointValues,
    jointLimits,
    jointAxes,
    collisionVisibility,
    rotationPlaneVisible,
    originalUrdfContent,
    vizUrdfContent,
    urdfViewMode,
    endEffectorLink,
    viewerEpisode,
    currentFrame,
    episodeSaveHandler,
    setUrdfEditorSplitView,
    setUrdfViewMode,
    setShowUrdfEditor,
    setMotionDataFile,
    setIsPlaying,
    setHasAnimationFrames,
    handleFrameChange,
    setRobotBoundingBox,
    robotBoundingBox,
    setRobot,
    handleIkApplied,
    handleViewerResizeStart,
    setSelectedJoint,
    setSelectedLink,
    setHoveredJoint,
    handleJointChange,
    handleRobotJointsLoaded,
    handleVizUrdfChange,
    getExportUrdfContent,
    setCurrentFrame,
    onViewerOpenChange: setIsViewerOpen,
  };

  const rightSidebarProps: ComponentProps<typeof PageLayout>["rightSidebarProps"] = {
    availableJoints,
    episodeJointNames,
    availableLinks,
    jointLimits,
    selectedJoint,
    selectedLink,
    onJointSelect: setSelectedJoint,
    onLinkSelect: setSelectedLink,
    hoveredJoint,
    onJointHover: setHoveredJoint,
    deletedJoints,
    rightSidebarWidth,
    isRightSidebarCollapsed,
    vizUrdfContent,
    jointAxes,
    originalJointAxes,
    onJointChange: handleJointChange,
    onJointAxisChange: handleJointAxisChange,
    onResetAxis: handleResetAxis,
    onJointTypeChange: handleJointTypeChange,
    onJointNameChange: handleJointNameChange,
    onDeleteJoint: handleDeleteJoint,
    onJointLinkChange: handleJointLinkChange,
    onJointVelocityChange: handleJointVelocityChange,
    angleUnit,
    onAngleUnitChange: setAngleUnit,
    meshFiles,
    onMaterialChange: handleMaterialChange,
    onLinkNameChange: handleLinkNameChange,
    onUrdfChange: handleVizUrdfChange,
    collisionVisibility,
    onCollisionVisibilityChange: setCollisionVisibility,
    endEffectorLink,
    onMarkAsEndEffector: setEndEffectorLink,
    robot,
    robotBoundingBox,
    onRightSidebarResizeStart: handleRightSidebarResizeStart,
  };

  const meshFilesStatusPanelProps: ComponentProps<
    typeof PageLayout
  >["meshFilesStatusPanelProps"] = {
    open: showDebugDialog,
    debugMeshInfo,
    unmatchedURDFRefs,
    isRightSidebarCollapsed,
    rightSidebarWidth,
    onClose: () => setShowDebugDialog(false),
  };

  const loadIssuesPanelProps: ComponentProps<
    typeof PageLayout
  >["loadIssuesPanelProps"] = {
    open: showLoadIssues,
    urdfError: urdfValidationError,
    unmatchedURDFRefs,
    onOpenMeshStatus: () => setShowDebugDialog(true),
    onFixMeshPaths: handleFixMeshPaths,
    onOpenUrdfEditor: () => setShowUrdfEditor(true),
    onClose: () => setShowLoadIssues(false),
  };

  const exportDialogProps: ComponentProps<typeof PageLayout>["exportDialogProps"] = {
    isOpen: isExportDialogOpen,
    onClose: closeExportDialog,
    urdfContent: getExportUrdfContent(),
    meshFiles,
    githubToken,
    robotName,
  };

  const povCamerasOverlayProps: ComponentProps<
    typeof PageLayout
  >["povCamerasOverlayProps"] = {
    open: showPovCameras,
    cameras,
    selectedCameraId,
    onClose: () => setShowPovCameras(false),
  };

  const mappingPanelsProps: ComponentProps<typeof PageLayout>["mappingPanelsProps"] = {
    showMappingListPanel,
    onCloseMappingList: closeMappingList,
    savedMappings,
    onSelectMapping: selectMapping,
    onDeleteMapping: deleteMappingById,
    mappingDialogData,
    showMappingDialog,
    onCloseMappingDialog: closeMappingDialog,
    availableJoints,
    selectedMapping,
    jointLimits,
    onApplyMapping: applyMapping,
  };

  const creationDialogsProps: ComponentProps<typeof PageLayout>["creationDialogsProps"] = {
    objectCreatorOpen,
    objectCreatorType,
    openObjectCreator,
    closeObjectCreator,
    robotBoundingBox,
    showCameraCreator,
    setShowCameraCreator,
    availableLinks,
    robot,
    showCameraUpload,
    setShowCameraUpload,
  };

  const pageLayoutProps: ComponentProps<typeof PageLayout> = {
    isLoading,
    topNavBarProps,
    leftSidebarProps,
    viewerLayoutProps,
    rightSidebarProps,
    meshFilesStatusPanelProps,
    loadIssuesPanelProps,
    exportDialogProps,
    povCamerasOverlayProps,
    mappingPanelsProps,
    creationDialogsProps,
  };

  return (
    <PageLayout {...pageLayoutProps} />
  );
};

export default Index;
