import { useState, useCallback, useMemo, startTransition, useEffect } from "react";
import { FolderUploadScreen } from "@/components/FolderUploadScreen";
import { ExportDialog } from "@/components/ExportDialog";
import { JointMappingDialog } from "@/components/JointMappingDialog";
import { MappingListPanel } from "@/components/MappingListPanel";
import { ObjectCreator } from "@/components/ObjectCreator";
import { CameraCreator } from "@/components/CameraCreator";
import { CameraConfigUpload } from "@/components/CameraConfigUpload";
import { useDatasetActions } from "@/features/dataset";
import { toast } from "sonner";
import {
  canonicalizeUrdf,
  changeJointAxis,
  changeJointType,
  fixMeshPaths,
  normalizeAxes,
  parseURDF,
  prettifyUrdf,
  renameJoint,
  renameLink,
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


  const handleVizUrdfChange = useCallback((newContent: string) => {
    updateUrdfFile(newContent);
    toast.success("Viz URDF updated from manual edit");
  }, [updateUrdfFile]);

  const handleMaterialChange = useCallback((linkName: string, materialName: string, color: string) => {
    if (!vizUrdfContent) {
      toast.error("No URDF content available");
      return;
    }
    
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(vizUrdfContent, "text/xml");
      
      const parserError = xmlDoc.querySelector("parsererror");
      if (parserError) {
        toast.error("Invalid URDF XML");
        return;
      }

      // Find or create material element
      let material = xmlDoc.querySelector(`material[name="${materialName}"]`);
      if (!material) {
        // Create material in robot tag
        const robot = xmlDoc.querySelector("robot");
        if (!robot) {
          toast.error("No robot tag found in URDF");
          return;
        }
        material = xmlDoc.createElement("material");
        material.setAttribute("name", materialName);
        const colorElement = xmlDoc.createElement("color");
        // Convert hex to rgba
        const r = parseInt(color.slice(1, 3), 16) / 255;
        const g = parseInt(color.slice(3, 5), 16) / 255;
        const b = parseInt(color.slice(5, 7), 16) / 255;
        colorElement.setAttribute("rgba", `${r} ${g} ${b} 1.0`);
        material.appendChild(colorElement);
        robot.appendChild(material);
      } else {
        // Update existing material color
        let colorElement = material.querySelector("color");
        if (!colorElement) {
          colorElement = xmlDoc.createElement("color");
          material.appendChild(colorElement);
        }
        const r = parseInt(color.slice(1, 3), 16) / 255;
        const g = parseInt(color.slice(3, 5), 16) / 255;
        const b = parseInt(color.slice(5, 7), 16) / 255;
        colorElement.setAttribute("rgba", `${r} ${g} ${b} 1.0`);
      }

      // Find the link
      const link = xmlDoc.querySelector(`link[name="${linkName}"]`);
      if (!link) {
        toast.error(`Link "${linkName}" not found`);
        return;
      }

      // Find or create visual element
      let visual = link.querySelector("visual");
      if (!visual) {
        visual = xmlDoc.createElement("visual");
        const geometry = xmlDoc.createElement("geometry");
        const box = xmlDoc.createElement("box");
        box.setAttribute("size", "0.1 0.1 0.1");
        geometry.appendChild(box);
        visual.appendChild(geometry);
        link.appendChild(visual);
      }

      // Add or update material reference
      let materialRef = visual.querySelector("material");
      if (!materialRef) {
        materialRef = xmlDoc.createElement("material");
        visual.appendChild(materialRef);
      }
      materialRef.setAttribute("name", materialName);

      // Serialize back
      const serializer = new XMLSerializer();
      const newContent = serializer.serializeToString(xmlDoc);
      
      updateUrdfFile(newContent);
      toast.success(`Updated material for link "${linkName}"`);
    } catch (error) {
      console.error("Error updating material:", error);
      toast.error("Failed to update material");
    }
  }, [vizUrdfContent, updateUrdfFile]);

  const handleLinkNameChange = useCallback((oldName: string, newName: string) => {
    if (newName === oldName) return;
    if (!vizUrdfContent) {
      toast.error("No URDF content available");
      return;
    }

    try {
      const result = renameLink(vizUrdfContent, oldName, newName);
      if (!result.success) {
        toast.error(result.error ?? "Failed to update link name");
        return;
      }

      updateUrdfFile(result.content);
      toast.success(result.message ?? `Renamed link "${oldName}" to "${newName}"`);
    } catch (error) {
      console.error("Error updating link name:", error);
      toast.error("Failed to update link name");
    }
  }, [vizUrdfContent, updateUrdfFile]);

  const handleJointAxisChange = useCallback((jointName: string, axis: [number, number, number]) => {
    if (!vizUrdfContent) {
      toast.error("No URDF content available");
      return;
    }

    const result = changeJointAxis(vizUrdfContent, jointName, axis);
    if (!result.success) {
      toast.error(result.error ?? `Unable to update axis for joint "${jointName}"`);
      return;
    }

    // Immediately update all state synchronously for consistency with other handlers
    // This ensures immediate UI updates without deferred transitions that could cause conflicts
    setVizUrdfContent(result.content);
    if (result.jointLimits) {
      setJointLimits(result.jointLimits);
    }
    if (result.jointAxes) {
      setJointAxes(result.jointAxes);
    }
    setUrdfFile(createUrdfFile(result.content));
    setUrdfContentVersion(prev => prev + 1); // Force reload of 3D viewer and sidebar
    
    toast.success(result.message ?? `Updated axis for joint "${jointName}"`);
  }, [vizUrdfContent, createUrdfFile, setJointAxes, setJointLimits, setUrdfFile, setVizUrdfContent]);

  const handleResetAxis = useCallback((jointName: string) => {
    if (!originalJointAxes[jointName]) {
      toast.error(`No original axis found for joint "${jointName}"`);
      return;
    }

    const originalAxis = originalJointAxes[jointName].xyz;
    handleJointAxisChange(jointName, originalAxis);
  }, [originalJointAxes, handleJointAxisChange]);

  const handleJointTypeChange = useCallback((jointName: string, newType: string, lowerLimit?: number, upperLimit?: number) => {
    if (!vizUrdfContent) {
      toast.error("No URDF content available");
      return;
    }
    const result = changeJointType(vizUrdfContent, jointName, newType, lowerLimit, upperLimit);
    if (!result.success) {
      toast.error(result.error ?? `Failed to update joint "${jointName}"`);
      return;
    }

    updateUrdfFile(result.content);
    if (result.jointLimits) {
      setJointLimits(result.jointLimits);
    }
    if (result.jointAxes) {
      setJointAxes(result.jointAxes);
    }
    const limitMsg = lowerLimit !== undefined && upperLimit !== undefined
      ? ` with limits [${lowerLimit.toFixed(2)}, ${upperLimit.toFixed(2)}]`
      : "";
    toast.success(result.message ?? `Updated joint "${jointName}" type to ${newType}${limitMsg}`);
  }, [vizUrdfContent, updateUrdfFile, setJointAxes, setJointLimits]);

  const handleJointNameChange = useCallback((oldName: string, newName: string) => {
    if (!vizUrdfContent) {
      toast.error("No URDF content available");
      return;
    }
    const result = renameJoint(vizUrdfContent, oldName, newName);
    if (!result.success) {
      toast.error(result.error ?? `Failed to rename joint "${oldName}" to "${newName}". The name may already exist or be invalid.`);
      return;
    }
    updateUrdfFile(result.content);

    // Update availableJoints to reflect the new name
    setAvailableJoints(prev => prev.map(name => name === oldName ? newName : name));

    // Update selected joint if it was the one renamed
    if (selectedJoint === oldName) {
      setSelectedJoint(newName);
    }

    toast.success(result.message ?? `Renamed joint "${oldName}" to "${newName}"`);
  }, [vizUrdfContent, updateUrdfFile, selectedJoint, setAvailableJoints, setSelectedJoint]);

  const handleJointLinkChange = useCallback((jointName: string, parentLink: string, childLink: string) => {
    if (!vizUrdfContent) {
      toast.error("No URDF content available");
      return;
    }

    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(vizUrdfContent, "text/xml");

      const parserError = xmlDoc.querySelector("parsererror");
      if (parserError) {
        toast.error("Invalid URDF XML");
        return;
      }

      const joint = xmlDoc.querySelector(`joint[name="${jointName}"]`);
      if (!joint) {
        toast.error(`Joint "${jointName}" not found`);
        return;
      }

      // Preserve joint attributes
      const preservedName = joint.getAttribute("name");
      const preservedType = joint.getAttribute("type");

      // Update or create parent element
      let parentElement = joint.querySelector("parent");
      if (!parentElement) {
        parentElement = xmlDoc.createElement("parent");
        joint.insertBefore(parentElement, joint.firstChild);
      }
      parentElement.setAttribute("link", parentLink);

      // Update or create child element
      let childElement = joint.querySelector("child");
      if (!childElement) {
        childElement = xmlDoc.createElement("child");
        if (parentElement.nextSibling) {
          joint.insertBefore(childElement, parentElement.nextSibling);
        } else {
          joint.appendChild(childElement);
        }
      }
      childElement.setAttribute("link", childLink);

      // Restore preserved attributes
      if (preservedName) {
        joint.setAttribute("name", preservedName);
      }
      if (preservedType) {
        joint.setAttribute("type", preservedType);
      }

      // Serialize back
      const serializer = new XMLSerializer();
      const newContent = serializer.serializeToString(xmlDoc);

      updateUrdfFile(newContent);
      toast.success(`Updated links for joint "${jointName}"`);
    } catch (error) {
      console.error("Error updating joint links:", error);
      toast.error("Failed to update joint links");
    }
  }, [vizUrdfContent, updateUrdfFile]);

  const handleResetRotation = useCallback(() => {
    if (!originalVizUrdfContent) {
      toast.error("No original URDF content found");
      return;
    }

    updateUrdfFile(originalVizUrdfContent);
    toast.success("Reset to original loaded file");
  }, [originalVizUrdfContent, updateUrdfFile]);

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

      {/* Joint Mapping List Panel */}
      <MappingListPanel
        isOpen={showMappingListPanel}
        onClose={closeMappingList}
        mappings={savedMappings}
        onSelectMapping={selectMapping}
        onDeleteMapping={deleteMappingById}
      />

      {/* Joint Mapping Dialog */}
      {mappingDialogData && (
        <JointMappingDialog
          isOpen={showMappingDialog}
          onClose={closeMappingDialog}
          datasetJoints={mappingDialogData.datasetJoints}
          urdfJoints={availableJoints}
          jointRanges={mappingDialogData.jointRanges}
          existingMapping={selectedMapping}
          source={selectedMapping?.source}
          jointLimits={jointLimits}
          onApply={applyMapping}
        />
      )}

      {/* Object Creator Dialog */}
      <ObjectCreator
        open={objectCreatorOpen}
        onOpenChange={(open) => (open ? openObjectCreator() : closeObjectCreator())}
        defaultType={objectCreatorType}
        robotBoundingBox={robotBoundingBox}
      />

      {/* Camera Creator Dialog */}
      <CameraCreator
        open={showCameraCreator}
        onOpenChange={setShowCameraCreator}
        availableLinks={availableLinks}
        robot={robot}
      />

      {/* Camera Config Upload Dialog */}
      <CameraConfigUpload
        open={showCameraUpload}
        onOpenChange={setShowCameraUpload}
      />
    </div>
  );
};

export default Index;
