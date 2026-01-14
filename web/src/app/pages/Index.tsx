import type { ComponentProps } from "react";
import { useState, useCallback, useMemo, startTransition, useEffect } from "react";
import { FolderUploadScreen } from "@/features/dataset/FolderUploadScreen";
import { toAnimationFrames, useDatasetActions } from "@/features/dataset";
import { toast } from "sonner";
import { useCameraStore } from "@/shared/store/useCameraStore";
import { useCameraPanels } from "@/features/camera";
import type { FileWithPath } from "@/shared/types/file";
import type { URDFRobot } from "urdf-loader";
import { useUrdfEditHandlers } from "@/features/layout/page/useUrdfEditHandlers";
import { useUrdfUtilityHandlers } from "@/features/layout/page/useUrdfUtilityHandlers";
import { useDatasetPlaybackHandlers } from "@/features/layout/page/useDatasetPlaybackHandlers";
import { useUrdfMaterialHandlers } from "@/features/layout/page/useUrdfMaterialHandlers";
import { PageLayout } from "@/features/layout/page/PageLayout";

import type { RotationAxis, UrdfViewMode, AngleUnit } from "@/shared/types/feature";
import { useUrdfLoader, useUrdfSelection } from "@/features/urdf";
import { useObjectCreatorStore } from "@/features/objects";
import { useLayout } from "@/features/layout";
import { useExportHandlers, useJointMappingPersistence } from "@/features/dataset/exports";
import { useThemeAndGPUMode } from "@/features/theme";
import { DEMO_ROBOT_URDF } from "@/shared/samples/demoRobot";
import { createDemoEpisode } from "@/shared/samples/demoMotion";
import { viewerPlayback } from "@/features/viewer/playback/viewerPlayback";

const Index = () => {
  const { gpuMode, setGPUMode } = useThemeAndGPUMode();
  const cameras = useCameraStore((state) => state.cameras);
  const selectedCameraId = useCameraStore((state) => state.selectedCameraId);
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

  const playDemoEpisode = useCallback(
    (jointNames: string[]) => {
      if (jointNames.length === 0) {
        toast.error("Demo motion requires a robot with joints loaded.");
        return;
      }
      const demoEpisode = createDemoEpisode({
        jointNames,
        jointLimits,
      });
      setViewerEpisode(demoEpisode);
      setIsViewerOpen(true);
      viewerPlayback.playEpisode(toAnimationFrames(demoEpisode), { autoplay: true });
      setTimeout(() => {
        if (!hasAnimationFrames) {
          viewerPlayback.playEpisode(toAnimationFrames(demoEpisode), { autoplay: true });
        }
      }, 300);
    },
    [hasAnimationFrames, jointLimits, setIsViewerOpen, setViewerEpisode]
  );

  const handleLoadDemo = useCallback(() => {
    try {
      const demoFile = new File([DEMO_ROBOT_URDF], "demo_robot.urdf", {
        type: "application/xml",
      });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(demoFile);
      void loadFilesFromFolder(dataTransfer.files);
      toast.success("Loaded demo robot");
    } catch (error) {
      toast.error("Failed to load demo robot");
    }
  }, [loadFilesFromFolder]);

  const handlePlayDemoMotion = useCallback(() => {
    if (!hasLoadedFiles) {
      setPendingDemoMotion(true);
      handleLoadDemo();
      return;
    }

    const jointNames = availableJoints.length > 0
      ? availableJoints
      : ["joint_1", "joint_2"];
    playDemoEpisode(jointNames);
  }, [availableJoints, handleLoadDemo, hasLoadedFiles, playDemoEpisode]);

  useEffect(() => {
    if (!pendingDemoMotion || !hasLoadedFiles) return;

    const jointNames = availableJoints.length > 0
      ? availableJoints
      : ["joint_1", "joint_2"];
    playDemoEpisode(jointNames);
    setPendingDemoMotion(false);
  }, [availableJoints, hasLoadedFiles, pendingDemoMotion, playDemoEpisode]);


  const {
    handleVizUrdfChange,
    handleLinkNameChange,
    handleJointAxisChange,
    handleResetAxis,
    handleJointTypeChange,
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
        onLoadDemo={handleLoadDemo}
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
