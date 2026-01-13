import { useState, useCallback, useMemo, startTransition, useEffect } from "react";
import { FolderUploadScreen } from "@/components/FolderUploadScreen";
import { ExportDialog } from "@/components/ExportDialog";
import { useDatasetActions } from "@/features/dataset";
import { toast } from "sonner";
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
import { useUrdfUtilityHandlers } from "@/pages/index/useUrdfUtilityHandlers";
import { useDatasetPlaybackHandlers } from "@/pages/index/useDatasetPlaybackHandlers";

import type {
  MeshFiles,
  RotationAxis,
  UrdfViewMode,
  AngleUnit,
} from "@/features/types";
import { useUrdfLoader } from "@/features/urdf-loader/useUrdfLoader";
import { useObjectCreatorStore } from "@/features/object-creator";
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
