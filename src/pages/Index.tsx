import { useState, useCallback, useMemo, startTransition, useEffect } from "react";
import { FolderUploadScreen } from "@/components/FolderUploadScreen";
import { ExportDialog } from "@/components/ExportDialog";
import { useDatasetActions } from "@/features/dataset";
import { toast } from "sonner";
import {
  canonicalizeUrdf,
  fixMeshPaths,
  normalizeAxes,
  parseURDF,
  prettifyUrdf,
  rotateUrdf,
} from "@/features/urdf";
import { useCameraStore } from "@/store/useCameraStore";
import { useCameraPanels } from "@/features/camera";
import type { FileWithPath } from "@/types/file";
import type { URDFRobot } from "urdf-loader";
import { TopNavBar } from "@/pages/index/TopNavBar";
import { MeshFilesStatusPanel } from "@/pages/index/MeshFilesStatusPanel";
import { PovCamerasOverlay } from "@/pages/index/PovCamerasOverlay";
import { ViewerLayout } from "@/pages/index/ViewerLayout";
import { RightSidebarPanel } from "@/pages/index/RightSidebarPanel";
import { LeftSidebarPanel } from "@/pages/index/LeftSidebarPanel";
import { LoadingScreen } from "@/pages/index/LoadingScreen";
import { MappingPanels } from "@/pages/index/MappingPanels";
import { CreationDialogs } from "@/pages/index/CreationDialogs";
import { useUrdfEditHandlers } from "@/pages/index/useUrdfEditHandlers";

import type {
  MeshFiles,
  RotationAxis,
  UrdfViewMode,
  AngleUnit,
  ViewerEpisode,
  EpisodeSaveHandler,
} from "@/features/types";
import { AXIS_NAMES } from "@/pages/index/constants";
import { useUrdfLoader } from "@/features/urdf-loader/useUrdfLoader";
import { useObjectCreatorStore } from "@/features/object-creator";
import { useUrdfViewer } from "@/features/urdf-viewer";
import { useUrdfSelection } from "@/features/urdf-selection";
import { useLayout } from "@/features/layout";
import { useExportHandlers, useJointMappingPersistence } from "@/features/export";
import { useThemeAndGPUMode } from "@/features/theme-gpu";

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
  const [motionDataFile, setMotionDataFile] = useState<File | null>(null);
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
  } = useUrdfViewer();
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
  const [viewerEpisode, setViewerEpisode] = useState<ViewerEpisode | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [episodeSaveHandler, setEpisodeSaveHandler] = useState<EpisodeSaveHandler | undefined>(undefined);
  const [angleUnit, setAngleUnit] = useState<AngleUnit>("rad");
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

  const episodeJointNames = useMemo(() => {
    if (!viewerEpisode) return [];

    const metadata = viewerEpisode.metadata as { joint_names?: unknown } | undefined;
    const metadataNames = Array.isArray(metadata?.joint_names)
      ? (metadata.joint_names as unknown[])
          .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
      : [];

    const frameNames =
      viewerEpisode.frames.length > 0
        ? Object.keys(viewerEpisode.frames[0].jointPositions)
        : [];

    const combined = (metadataNames.length > 0 ? metadataNames : frameNames).filter(
      (name): name is string => typeof name === "string" && name.length > 0
    );

    return Array.from(new Set(combined)).sort();
  }, [viewerEpisode]);

  const handleEpisodeSaveHandlerChange = useCallback(
    (handler?: EpisodeSaveHandler) => {
      setEpisodeSaveHandler(() => handler);
    },
    []
  );

  const handleJointChange = useCallback((jointName: string, value: number) => {
    setStoreJointValue(jointName, value);
  }, [setStoreJointValue]);

  const handleIkApplied = useCallback((values: Record<string, number>) => {
    setJointValues(values);
  }, [setJointValues]);


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

  const deleteJointsFromURDF = useCallback((urdfContent: string, jointsToDelete: Set<string>): string => {
    if (jointsToDelete.size === 0) return urdfContent;
    
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(urdfContent, "text/xml");
    
    // Check for parsing errors
    const parserError = xmlDoc.querySelector("parsererror");
    if (parserError) {
      const errorText = parserError.textContent || "Unknown XML parsing error";
      console.error("URDF parsing error:", errorText);
      return urdfContent;
    }
    
    // Validate robot element exists
    const robot = xmlDoc.querySelector("robot");
    if (!robot) {
      console.error("No <robot> element found in URDF");
      return urdfContent;
    }
    
    jointsToDelete.forEach((jointName) => {
      xmlDoc.querySelector(`joint[name="${jointName}"]`)?.remove();
    });
    
    return new XMLSerializer().serializeToString(xmlDoc);
  }, []);

  // URDF Utility Handlers
  const handleCanonicalOrder = useCallback(() => {
    if (!vizUrdfContent) return;
    const result = canonicalizeUrdf(vizUrdfContent);
    if (!result.success) {
      toast.error(result.error ?? "Failed to reorder URDF");
      return;
    }
    handleVizUrdfChange(result.content);
    toast.success(result.message ?? "URDF elements reordered to canonical format");
  }, [vizUrdfContent, handleVizUrdfChange]);

  const handlePrettyPrint = useCallback(() => {
    if (!vizUrdfContent) return;
    const result = prettifyUrdf(vizUrdfContent);
    if (!result.success) {
      toast.error(result.error ?? "Failed to format URDF");
      return;
    }
    handleVizUrdfChange(result.content);
    toast.success(result.message ?? "URDF formatted with consistent indentation");
  }, [vizUrdfContent, handleVizUrdfChange]);

  const handleNormalizeAxes = useCallback(() => {
    if (!vizUrdfContent) return;
    const result = normalizeAxes(vizUrdfContent);
    if (!result.success) {
      toast.error(result.error ?? "Failed to normalize joint axes");
      return;
    }
    handleVizUrdfChange(result.content);

    if (result.issues.length > 0) {
      toast.warning(`Normalized axes with ${result.issues.length} error(s) fixed`);
      result.issues.forEach(err => {
        console.warn(`Joint "${err.jointName}" (${err.jointType}): ${err.issue}`);
      });
    } else if (result.corrections.length > 0) {
      toast.success(result.message ?? `Normalized ${result.corrections.length} joint axis(es)`);
      result.corrections.forEach(correction => {
        console.info(`Joint "${correction.jointName}": ${correction.reason}`);
      });
    } else {
      toast.info("All joint axes are already normalized");
    }
  }, [vizUrdfContent, handleVizUrdfChange]);

  const handleFixMeshPaths = useCallback(() => {
    if (!vizUrdfContent) return;
    const result = fixMeshPaths(vizUrdfContent);
    handleVizUrdfChange(result.urdfContent);

    if (result.corrections.length > 0) {
      toast.success(`Fixed ${result.corrections.length} mesh path(s)`);
      result.corrections.forEach(correction => {
        console.info(`Fixed path: "${correction.original}" -> "${correction.corrected}"`);
      });
    } else {
      toast.info("All mesh paths are already correct");
    }
  }, [vizUrdfContent, handleVizUrdfChange]);

  const getExportUrdfContent = useCallback(() => {
    if (!vizUrdfContent) return "";
    return deleteJointsFromURDF(vizUrdfContent, deletedJoints);
  }, [vizUrdfContent, deleteJointsFromURDF, deletedJoints]);

  const robotName = useMemo(() => {
    if (!vizUrdfContent) return "robot";
    const parsed = parseURDF(vizUrdfContent);
    if (!parsed.isValid) return "robot";
    const robot = parsed.document.querySelector("robot");
    return robot?.getAttribute("name") || "robot";
  }, [vizUrdfContent]);

  const handleDeleteJoint = useCallback((jointName: string) => {
    const willRemove = !deletedJoints.has(jointName);
    toggleDeletedJoint(jointName);
    toast.success(
      willRemove
        ? `Joint "${jointName}" will be removed from exported URDF`
        : `Joint "${jointName}" will be included in exported URDF`
    );
  }, [deletedJoints, toggleDeletedJoint]);

  const handleRotateRobot = useCallback((axis: RotationAxis) => {
    if (!vizUrdfContent) {
      toast.error("No URDF loaded");
      return;
    }

    const result = rotateUrdf(vizUrdfContent, axis);

    if (!result.success) {
      toast.error(result.error ?? "Failed to rotate robot");
      return;
    }

    updateUrdfFile(result.content);
    toast.success(result.message ?? `Robot rotated 90° around ${AXIS_NAMES[axis]}-axis`);
  }, [vizUrdfContent, updateUrdfFile]);

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
    return <FolderUploadScreen onFolderSelected={loadFilesFromFolder} />;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {isLoading ? (
        <LoadingScreen />
      ) : (
        <>
          <TopNavBar
            showMenus={Boolean(originalUrdfContent && vizUrdfContent)}
            openExportDialog={openExportDialog}
            onSave={handleSave}
            onRevert={handleRevert}
            canRevert={canRevert}
            onResetRotation={handleResetRotation}
            hasRotationChanges={hasRotationChanges}
            onCanonicalOrder={handleCanonicalOrder}
            onPrettyPrint={handlePrettyPrint}
            onNormalizeAxes={handleNormalizeAxes}
            onFixMeshPaths={handleFixMeshPaths}
            rotationAxis={rotationAxis}
            setRotationAxis={setRotationAxis}
            onRotateRobot={handleRotateRobot}
            angleUnit={angleUnit}
            setAngleUnit={setAngleUnit}
            gpuMode={gpuMode}
            setGPUMode={setGPUMode}
            showUrdfEditor={showUrdfEditor}
            setShowUrdfEditor={setShowUrdfEditor}
            urdfViewMode={urdfViewMode}
            setUrdfViewMode={setUrdfViewMode}
            showPovCameras={showPovCameras}
            setShowPovCameras={setShowPovCameras}
            openMappingList={openMappingList}
            datasetActions={datasetActions}
            openObjectCreator={openObjectCreator}
            setShowCameraCreator={setShowCameraCreator}
            setShowCameraUpload={setShowCameraUpload}
            exportCamerasAsJSON={exportCamerasAsJSON}
            exportCamerasAsYAML={exportCamerasAsYAML}
            hasCamerasToExport={hasCamerasToExport}
          />

          <LeftSidebarPanel
            isLoading={isLoading}
            availableJoints={availableJoints}
            jointLimits={jointLimits}
            jointAxes={jointAxes}
            originalJointAxes={originalJointAxes}
            originalUrdfContent={originalUrdfContent}
            vizUrdfContent={vizUrdfContent}
            onJointChange={handleJointChange}
            onJointSelect={setSelectedJoint}
            selectedJoint={selectedJoint}
            onVizUrdfChange={handleVizUrdfChange}
            onJointAxisChange={handleJointAxisChange}
            onResetAxis={handleResetAxis}
            onJointTypeChange={handleJointTypeChange}
            onJointNameChange={handleJointNameChange}
            onDeleteJoint={handleDeleteJoint}
            deletedJoints={deletedJoints}
            getExportUrdfContent={getExportUrdfContent}
            onMotionDataUpload={handleMotionDataUpload}
            onPlayAnimation={handlePlayAnimation}
            isPlaying={isPlaying}
            motionDataFileName={motionDataFile?.name}
            hasAnimationFrames={hasAnimationFrames}
            currentFrame={currentFrame}
            totalFrames={totalFrames}
            sidebarWidth={sidebarWidth}
            isSidebarCollapsed={isSidebarCollapsed}
            onToggleCollapse={handleSidebarToggle}
            meshFiles={meshFiles}
            onCollisionVisibilityChange={setCollisionVisibility}
            rotationPlaneVisible={rotationPlaneVisible}
            onRotationPlaneVisibilityChange={setRotationPlaneVisible}
            onFrameChange={setCurrentFrame}
            onUrdfEditorToggle={setShowUrdfEditor}
            showUrdfEditor={showUrdfEditor}
            viewerSplitView={viewerSplitView}
            onViewerSplitViewChange={setViewerSplitView}
            onViewerEpisodeChange={setViewerEpisode}
            onViewerOpenChange={setIsViewerOpen}
            onEpisodeSaveHandlerChange={handleEpisodeSaveHandlerChange}
            episodesViewHeight={recordingViewHeight}
            onEpisodesResizeStart={handleEpisodesResizeStart}
            onDatasetActionsReady={handleDatasetActionsReady}
            onSidebarResizeStart={handleSidebarResizeStart}
          />

          <ViewerLayout
            isSidebarCollapsed={isSidebarCollapsed}
            isRightSidebarCollapsed={isRightSidebarCollapsed}
            sidebarWidth={sidebarWidth}
            rightSidebarWidth={rightSidebarWidth}
            showUrdfEditor={showUrdfEditor}
            urdfEditorSplitView={urdfEditorSplitView}
            recordingViewHeight={recordingViewHeight}
            urdfContentVersion={urdfContentVersion}
            urdfFile={urdfFile}
            meshFiles={meshFiles}
            hoveredJoint={hoveredJoint}
            selectedJoint={selectedJoint}
            selectedLink={selectedLink}
            jointValues={jointValues}
            jointLimits={jointLimits}
            jointAxes={jointAxes}
            collisionVisibility={collisionVisibility}
            rotationPlaneVisible={rotationPlaneVisible}
            originalUrdfContent={originalUrdfContent}
            vizUrdfContent={vizUrdfContent}
            urdfViewMode={urdfViewMode}
            endEffectorLink={endEffectorLink}
            viewerEpisode={viewerEpisode}
            currentFrame={currentFrame}
            episodeSaveHandler={episodeSaveHandler}
            setUrdfEditorSplitView={setUrdfEditorSplitView}
            setUrdfViewMode={setUrdfViewMode}
            setShowUrdfEditor={setShowUrdfEditor}
            setMotionDataFile={setMotionDataFile}
            setIsPlaying={setIsPlaying}
            setHasAnimationFrames={setHasAnimationFrames}
            handleFrameChange={handleFrameChange}
            setRobotBoundingBox={setRobotBoundingBox}
            setRobot={setRobot}
            handleIkApplied={handleIkApplied}
            handleViewerResizeStart={handleViewerResizeStart}
            setSelectedJoint={setSelectedJoint}
            setSelectedLink={setSelectedLink}
            setHoveredJoint={setHoveredJoint}
            handleJointChange={handleJointChange}
            handleRobotJointsLoaded={handleRobotJointsLoaded}
            handleVizUrdfChange={handleVizUrdfChange}
            getExportUrdfContent={getExportUrdfContent}
            setCurrentFrame={setCurrentFrame}
            onViewerOpenChange={setIsViewerOpen}
          />

          <RightSidebarPanel
            availableJoints={availableJoints}
            episodeJointNames={episodeJointNames}
            availableLinks={availableLinks}
            jointLimits={jointLimits}
            selectedJoint={selectedJoint}
            selectedLink={selectedLink}
            onJointSelect={setSelectedJoint}
            onLinkSelect={setSelectedLink}
            hoveredJoint={hoveredJoint}
            onJointHover={setHoveredJoint}
            deletedJoints={deletedJoints}
            rightSidebarWidth={rightSidebarWidth}
            isRightSidebarCollapsed={isRightSidebarCollapsed}
            vizUrdfContent={vizUrdfContent}
            jointAxes={jointAxes}
            originalJointAxes={originalJointAxes}
            onJointChange={handleJointChange}
            onJointAxisChange={handleJointAxisChange}
            onResetAxis={handleResetAxis}
            onJointTypeChange={handleJointTypeChange}
            onJointNameChange={handleJointNameChange}
            onDeleteJoint={handleDeleteJoint}
            onJointLinkChange={handleJointLinkChange}
            angleUnit={angleUnit}
            onAngleUnitChange={setAngleUnit}
            meshFiles={meshFiles}
            onLinkNameChange={handleLinkNameChange}
            onUrdfChange={handleVizUrdfChange}
            collisionVisibility={collisionVisibility}
            onCollisionVisibilityChange={setCollisionVisibility}
            endEffectorLink={endEffectorLink}
            onMarkAsEndEffector={setEndEffectorLink}
            robot={robot}
            onRightSidebarResizeStart={handleRightSidebarResizeStart}
          />

        </>
      )}

      <MeshFilesStatusPanel
        open={showDebugDialog}
        debugMeshInfo={debugMeshInfo}
        unmatchedURDFRefs={unmatchedURDFRefs}
        isRightSidebarCollapsed={isRightSidebarCollapsed}
        rightSidebarWidth={rightSidebarWidth}
        onClose={() => setShowDebugDialog(false)}
      />
      {/* Export Dialog - Always available, even when on 3D viewer */}
      <ExportDialog
        isOpen={isExportDialogOpen}
        onClose={closeExportDialog}
        urdfContent={getExportUrdfContent()}
        meshFiles={meshFiles}
        githubToken={typeof window !== "undefined" && import.meta.env.VITE_GITHUB_TOKEN ? import.meta.env.VITE_GITHUB_TOKEN : null}
        robotName={robotName}
      />

      <PovCamerasOverlay
        open={showPovCameras}
        cameras={cameras}
        selectedCameraId={selectedCameraId}
        onClose={() => setShowPovCameras(false)}
      />

      <MappingPanels
        showMappingListPanel={showMappingListPanel}
        onCloseMappingList={closeMappingList}
        savedMappings={savedMappings}
        onSelectMapping={selectMapping}
        onDeleteMapping={deleteMappingById}
        mappingDialogData={mappingDialogData}
        showMappingDialog={showMappingDialog}
        onCloseMappingDialog={closeMappingDialog}
        availableJoints={availableJoints}
        selectedMapping={selectedMapping}
        jointLimits={jointLimits}
        onApplyMapping={applyMapping}
      />

      <CreationDialogs
        objectCreatorOpen={objectCreatorOpen}
        objectCreatorType={objectCreatorType}
        openObjectCreator={openObjectCreator}
        closeObjectCreator={closeObjectCreator}
        robotBoundingBox={robotBoundingBox}
        showCameraCreator={showCameraCreator}
        setShowCameraCreator={setShowCameraCreator}
        availableLinks={availableLinks}
        robot={robot}
        showCameraUpload={showCameraUpload}
        setShowCameraUpload={setShowCameraUpload}
      />
    </div>
  );
};

export default Index;
