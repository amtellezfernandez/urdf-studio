import type React from "react";
import { useState, useCallback, useMemo, startTransition, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { JointListSidebar } from "@/components/JointListSidebar";
import { Viewer3D } from "@/components/Viewer3D";
import { URDFComparison } from "@/components/URDFComparison";
import { FolderUploadScreen } from "@/components/FolderUploadScreen";
import { EpisodeViewer3DModal } from "@/components/EpisodeViewer3DModal";
import { ExportDialog } from "@/components/ExportDialog";
import { JointMappingDialog } from "@/components/JointMappingDialog";
import { MappingListPanel } from "@/components/MappingListPanel";
import { ObjectCreator } from "@/components/ObjectCreator";
import { CameraCreator } from "@/components/CameraCreator";
import { CameraConfigUpload } from "@/components/CameraConfigUpload";
import { useGPUMode } from "@/hooks/use-gpu-mode";
import { getSavedMappings, deleteMapping, saveMapping } from "@/utils/jointMappingUtils";
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
import { exportCamerasToJSON, exportCamerasToYAML } from "@/utils/cameraConfig";
import { useTheme } from "@/hooks/use-theme";
import type { FileWithPath } from "@/types/file";
import { ChevronsRight, CheckCircle2, XCircle, AlertCircle, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type {
  MeshFiles,
  RotationAxis,
  UrdfViewMode,
  AngleUnit,
  WindowWithViewerHandlers,
  DebugMeshInfo,
  ViewerEpisode,
  EpisodeSaveHandler,
  SavedMapping,
} from "@/features/types";
import {
  AXIS_NAMES,
  SIDEBAR_RESIZER_WIDTH,
  VIEWER_RESIZER_HEIGHT,
} from "@/pages/index/constants";
import { useUrdfLoader } from "@/features/urdf-loader/useUrdfLoader";
import { useDatasetActions } from "@/features/dataset/useDatasetActions";
import { useCameraPanels } from "@/features/camera/useCameraPanels";
import { useObjectCreatorStore } from "@/features/object-creator";
import { useUrdfViewer } from "@/features/urdf-viewer";
import { useUrdfSelection } from "@/features/urdf-selection";
import { useLayout } from "@/features/layout";

const Index = () => {
  useTheme(); // Initialize dark mode
  const { gpuMode, setGPUMode } = useGPUMode();
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
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [rotationAxis, setRotationAxis] = useState<RotationAxis>("z");
  const [urdfEditorSplitView, setUrdfEditorSplitView] = useState(false);
  const [viewerEpisode, setViewerEpisode] = useState<ViewerEpisode | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [episodeSaveHandler, setEpisodeSaveHandler] = useState<EpisodeSaveHandler | undefined>(undefined);
  const [angleUnit, setAngleUnit] = useState<AngleUnit>("rad");

  // Object creation state
  const {
    isOpen: objectCreatorOpen,
    type: objectCreatorType,
    open: openObjectCreator,
    close: closeObjectCreator,
    robotBoundingBox,
    setRobotBoundingBox,
  } = useObjectCreatorStore();
  const [robot, setRobot] = useState<any>(null);

  // Camera creation state
  const {
    showCameraCreator,
    setShowCameraCreator,
    showCameraUpload,
    setShowCameraUpload,
    showPovCameras,
    setShowPovCameras,
  } = useCameraPanels();

  // Joint Mapping state
  const [showMappingListPanel, setShowMappingListPanel] = useState(false);
  const [showMappingDialog, setShowMappingDialog] = useState(false);
  const [selectedMapping, setSelectedMapping] = useState<SavedMapping | undefined>(undefined);
  const [mappingDialogData, setMappingDialogData] = useState<{
    datasetJoints: string[];
    jointRanges: Record<string, { min: number; max: number }>;
  } | null>(null);

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
  }, [vizUrdfContent, createUrdfFile, setJointAxes, setJointLimits]);

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
  }, [vizUrdfContent, updateUrdfFile, selectedJoint]);

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

  const handleSave = useCallback(() => {
    if (!vizUrdfContent) {
      toast.error("No URDF content to save");
      return;
    }

    setSavedVizUrdfContent(vizUrdfContent);
    toast.success("Changes saved");
  }, [vizUrdfContent]);

  const handleRevert = useCallback(() => {
    if (!savedVizUrdfContent) {
      toast.error("No saved URDF content found");
      return;
    }

    updateUrdfFile(savedVizUrdfContent);
    toast.success("Reverted to last saved file");
  }, [savedVizUrdfContent, updateUrdfFile]);

  const handleExportCamerasJSON = useCallback(() => {
    if (cameras.length === 0) {
      toast.error("No cameras to export");
      return;
    }

    try {
      const jsonContent = exportCamerasToJSON(cameras);
      const blob = new Blob([jsonContent], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "camera-config.json";
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${cameras.length} camera(s) to JSON`);
    } catch (error) {
      toast.error("Failed to export cameras");
      console.error(error);
    }
  }, [cameras]);

  const handleExportCamerasYAML = useCallback(() => {
    if (cameras.length === 0) {
      toast.error("No cameras to export");
      return;
    }

    try {
      const yamlContent = exportCamerasToYAML(cameras);
      const blob = new Blob([yamlContent], { type: "text/yaml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "camera-config.yaml";
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${cameras.length} camera(s) to YAML`);
    } catch (error) {
      toast.error("Failed to export cameras");
      console.error(error);
    }
  }, [cameras]);

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
    [recordingViewHeight, clampRecordingViewHeight]
  );

  const hasRotationChanges = useMemo(
    () => vizUrdfContent !== originalVizUrdfContent,
    [vizUrdfContent, originalVizUrdfContent]
  );

  // Joint Mapping handlers
  const handleOpenMappingList = useCallback(() => {
    setShowMappingListPanel(true);
  }, []);

  const handleSelectMapping = useCallback((mapping: SavedMapping) => {
    // Extract dataset joints from the saved mapping
    const datasetJoints = mapping.mappings.map(m => m.datasetJoint);
    
    // Use stored joint ranges if available, otherwise create empty ranges
    const jointRanges: Record<string, { min: number; max: number }> = mapping.jointRanges || {};
    
    // Ensure all dataset joints have ranges (even if empty)
    datasetJoints.forEach(joint => {
      if (!jointRanges[joint]) {
        jointRanges[joint] = { min: 0, max: 0 };
      }
    });

    // Set up dialog data
    setMappingDialogData({
      datasetJoints,
      jointRanges,
    });
    setSelectedMapping(mapping);
    setShowMappingListPanel(false);
    setShowMappingDialog(true);
  }, []);

  const handleDeleteMappingById = useCallback((id: string) => {
    deleteMapping(id);
    toast.success("Mapping deleted");
    // Force re-render by toggling the panel
    setShowMappingListPanel(false);
    setTimeout(() => setShowMappingListPanel(true), 0);
  }, []);

  const handleApplyMapping = useCallback((mappings: any[], degToRad: boolean) => {
    // This will be called from the dialog when editing an existing mapping
    if (selectedMapping && mappingDialogData) {
      // Build offset map from new mappings (per dataset joint)
      const newOffsets: Record<string, number> = {};
      const newMapping: Record<string, string> = {}; // dataset joint -> URDF joint
      mappings.forEach(m => {
        if (m.urdfJoint && m.urdfJoint !== "?") {
          newMapping[m.datasetJoint] = m.urdfJoint;
          if (m.offset !== undefined) {
            newOffsets[m.datasetJoint] = m.offset;
          }
        }
      });
      
      // Compare with old mapping to detect structural changes
      const oldMapping: Record<string, string> = {};
      const oldOffsets: Record<string, number> = {};
      selectedMapping.mappings.forEach((m: any) => {
        if (m.urdfJoint && m.urdfJoint !== "?") {
          oldMapping[m.datasetJoint] = m.urdfJoint;
          if (m.offset !== undefined) {
            oldOffsets[m.datasetJoint] = m.offset;
          }
        }
      });
      
      // Check if mapping structure changed (connections or degToRad)
      const mappingStructureChanged = 
        selectedMapping.degToRad !== degToRad ||
        JSON.stringify(oldMapping) !== JSON.stringify(newMapping);
      
      // Save the updated mapping with joint ranges
      saveMapping(selectedMapping.source, mappings, degToRad, mappingDialogData.jointRanges);
      
      // Notify Sidebar to update episodes from this mapping source
      window.dispatchEvent(new CustomEvent('mapping:updated', {
        detail: {
          mappingSource: selectedMapping.source,
          newOffsets,
          newMapping,
          oldOffsets,
          oldMapping,
          oldDegToRad: selectedMapping.degToRad,
          newDegToRad: degToRad,
          mappingStructureChanged, // Flag indicating if structure changed (needs full reload)
        }
      }));
      
      toast.success(mappingStructureChanged
        ? "Joint mapping updated - episodes will be reloaded"
        : "Joint mapping updated");
      setShowMappingDialog(false);
      setMappingDialogData(null);
      setSelectedMapping(undefined);
      
      // Refresh the mapping list panel if it was open
      if (showMappingListPanel) {
        setShowMappingListPanel(false);
        setTimeout(() => setShowMappingListPanel(true), 0);
      }
    } else {
      toast.success("Joint mapping applied");
    }
  }, [selectedMapping, mappingDialogData, showMappingListPanel]);

  // Show upload screen if no files loaded yet
  if (!hasLoadedFiles) {
    return <FolderUploadScreen onFolderSelected={loadFilesFromFolder} />;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">Loading robot...</span>
          </div>
        </div>
      ) : (
        <>
          {/* Fixed Top Navigation Bar - Blender Style */}
          <div className="fixed top-0 left-0 right-0 z-50 h-7 bg-[#282828] border-b border-[#3d3d3d] flex items-center px-1">
            <img 
              src="/assets/urdf-studio-logo.png" 
              alt="URDF Studio" 
              className="h-5 w-auto object-contain ml-1 mr-3"
            />
            {originalUrdfContent && vizUrdfContent && (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="h-5 px-2.5 text-[11px] font-normal text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d] rounded-none border-l border-[#3d3d3d] flex items-center transition-none ml-1">
                      File
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56 bg-[#282828] border-[#3d3d3d]">
                    <DropdownMenuItem
                      onClick={() => setShowExportDialog(true)}
                      className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
                    >
                      Export
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleSave}
                      className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
                    >
                      Save
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleRevert}
                      disabled={!savedVizUrdfContent || savedVizUrdfContent === vizUrdfContent}
                      className={cn(
                        "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                        (!savedVizUrdfContent || savedVizUrdfContent === vizUrdfContent) && "opacity-50 cursor-not-allowed"
                      )}
                      title="Reloads the last saved file"
                    >
                      Revert
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleResetRotation}
                      disabled={!hasRotationChanges}
                      className={cn(
                        "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                        !hasRotationChanges && "opacity-50 cursor-not-allowed"
                      )}
                      title="Reloads the original loaded file"
                    >
                      Reset
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="h-5 px-2.5 text-[11px] font-normal text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d] rounded-none border-l border-[#3d3d3d] flex items-center transition-none">
                      Utils
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48 bg-[#282828] border-[#3d3d3d]">
                    <DropdownMenuItem
                      onClick={handleCanonicalOrder}
                      className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
                    >
                      Canonical Order
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handlePrettyPrint}
                      className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
                    >
                      Pretty Print
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleNormalizeAxes}
                      className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
                    >
                      Normalize Axes
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleFixMeshPaths}
                      className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
                    >
                      Fix Mesh Paths
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger
                        className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
                      >
                        Rotate
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-32 bg-[#282828] border-[#3d3d3d]">
                        <DropdownMenuItem
                          onClick={() => {
                            setRotationAxis("x");
                            handleRotateRobot("x");
                          }}
                          className={cn(
                            "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                            rotationAxis === "x" && "bg-[#3d3d3d] text-white"
                          )}
                        >
                          X
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setRotationAxis("y");
                            handleRotateRobot("y");
                          }}
                          className={cn(
                            "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                            rotationAxis === "y" && "bg-[#3d3d3d] text-white"
                          )}
                        >
                          Y
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setRotationAxis("z");
                            handleRotateRobot("z");
                          }}
                          className={cn(
                            "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                            rotationAxis === "z" && "bg-[#3d3d3d] text-white"
                          )}
                        >
                          Z
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
            {originalUrdfContent && vizUrdfContent && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="h-5 px-2.5 text-[11px] font-normal text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d] rounded-none border-l border-[#3d3d3d] flex items-center transition-none ml-1">
                    View
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48 bg-[#282828] border-[#3d3d3d]">
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
                    >
                      Angle Unit
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-32 bg-[#282828] border-[#3d3d3d]">
                      <DropdownMenuItem
                        onClick={() => setAngleUnit("rad")}
                        className={cn(
                          "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                          angleUnit === "rad" && "bg-[#3d3d3d] text-white"
                        )}
                      >
                        Radians
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setAngleUnit("deg")}
                        className={cn(
                          "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                          angleUnit === "deg" && "bg-[#3d3d3d] text-white"
                        )}
                      >
                        Degrees
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
                    >
                      GPU Mode
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-40 bg-[#282828] border-[#3d3d3d]">
                      <DropdownMenuItem
                        onClick={() => setGPUMode("low")}
                        className={cn(
                          "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                          gpuMode === "low" && "bg-[#3d3d3d] text-white"
                        )}
                      >
                        Low GPU Mode
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setGPUMode("high")}
                        className={cn(
                          "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                          gpuMode === "high" && "bg-[#3d3d3d] text-white"
                        )}
                      >
                        High GPU Mode
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem
                    onClick={() => setShowUrdfEditor(false)}
                    className={cn(
                      "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                      !showUrdfEditor && "bg-[#3d3d3d] text-white"
                    )}
                  >
                    3D Visualization
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setShowPovCameras(true)}
                    className={cn(
                      "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                      showPovCameras && "bg-[#3d3d3d] text-white"
                    )}
                  >
                    POV Cameras
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      className={cn(
                        "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                        showUrdfEditor && "bg-[#3d3d3d] text-white"
                      )}
                    >
                      URDF File
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-40 bg-[#282828] border-[#3d3d3d]">
                      <DropdownMenuItem
                        onClick={() => {
                          setShowUrdfEditor(true);
                          setUrdfViewMode("original");
                        }}
                        className={cn(
                          "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                          showUrdfEditor && urdfViewMode === "original" && "bg-[#3d3d3d] text-white"
                        )}
                      >
                        Original
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setShowUrdfEditor(true);
                          setUrdfViewMode("modified");
                        }}
                        className={cn(
                          "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                          showUrdfEditor && urdfViewMode === "modified" && "bg-[#3d3d3d] text-white"
                        )}
                      >
                        Modified
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setShowUrdfEditor(true);
                          setUrdfViewMode("split");
                        }}
                        className={cn(
                          "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                          showUrdfEditor && urdfViewMode === "split" && "bg-[#3d3d3d] text-white"
                        )}
                      >
                        Split View
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {originalUrdfContent && vizUrdfContent && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="h-5 px-2.5 text-[11px] font-normal text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d] rounded-none border-l border-[#3d3d3d] flex items-center transition-none ml-1">
                    Dataset
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48 bg-[#282828] border-[#3d3d3d]">
                  <DropdownMenuItem
                    onClick={handleOpenMappingList}
                    className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
                  >
                    Joint Mappings
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
                    >
                      Load Episodes
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-48 bg-[#282828] border-[#3d3d3d]">
                      <DropdownMenuItem
                        onClick={() => datasetActions?.loadFromLocal()}
                        disabled={!datasetActions}
                        className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        From Local File
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => datasetActions?.loadFromHuggingFace()}
                        disabled={!datasetActions || datasetActions.isImportingFromHF}
                        className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {datasetActions?.isImportingFromHF ? "Loading from HF..." : "From Hugging Face"}
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
                    >
                      Export Episodes
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-48 bg-[#282828] border-[#3d3d3d]">
                      <DropdownMenuItem
                        onClick={() => datasetActions?.exportToLocal()}
                        disabled={!datasetActions || !datasetActions.hasEpisodes || datasetActions.isExportingDataset}
                        className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {datasetActions?.isExportingDataset ? "Exporting..." : "To Local File"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => datasetActions?.exportToHuggingFace()}
                        disabled={!datasetActions || !datasetActions.hasEpisodes || datasetActions.isUploadingToHF}
                        className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {datasetActions?.isUploadingToHF ? "Uploading to HF..." : "To Hugging Face"}
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {originalUrdfContent && vizUrdfContent && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="h-5 px-2.5 text-[11px] font-normal text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d] rounded-none border-l border-[#3d3d3d] flex items-center transition-none ml-1">
                    Create
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48 bg-[#282828] border-[#3d3d3d]">
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
                    >
                      Objects
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-32 bg-[#282828] border-[#3d3d3d]">
                      <DropdownMenuItem
                        onClick={() => {
                          openObjectCreator("cube");
                        }}
                        className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
                      >
                        Cube
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          openObjectCreator("point");
                        }}
                        className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
                      >
                        Point
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
                    >
                      Camera
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-48 bg-[#282828] border-[#3d3d3d]">
                      <DropdownMenuItem
                        onClick={() => setShowCameraCreator(true)}
                        className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
                      >
                        Add Camera
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setShowCameraUpload(true)}
                        className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
                      >
                        Upload Camera Config
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={handleExportCamerasJSON}
                        disabled={cameras.length === 0}
                        className={cn(
                          "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                          cameras.length === 0 && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        Export as JSON
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={handleExportCamerasYAML}
                        disabled={cameras.length === 0}
                        className={cn(
                          "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                          cameras.length === 0 && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        Export as YAML
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          <Sidebar
            isLoading={isLoading}
            availableJoints={availableJoints}
            jointLimits={jointLimits}
            jointAxes={jointAxes}
            originalJointAxes={originalJointAxes}
            originalUrdf={originalUrdfContent}
            vizUrdf={vizUrdfContent}
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
            getExportUrdf={getExportUrdfContent}
            onMotionDataUpload={handleMotionDataUpload}
            onPlayAnimation={handlePlayAnimation}
            isPlaying={isPlaying}
            motionDataFileName={motionDataFile?.name}
            hasAnimationFrames={hasAnimationFrames}
            currentFrame={currentFrame}
            totalFrames={totalFrames}
            width={sidebarWidth}
            isCollapsed={isSidebarCollapsed}
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
            onViewerEpisodeChange={(episode) => {
              setViewerEpisode(episode);
            }}
            onViewerOpenChange={setIsViewerOpen}
            onEpisodeSaveHandlerChange={handleEpisodeSaveHandlerChange}
            episodesViewHeight={recordingViewHeight}
            onEpisodesResizeStart={handleEpisodesResizeStart}
            onDatasetActionsReady={handleDatasetActionsReady}
          />

          {!isSidebarCollapsed && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              onPointerDown={handleSidebarResizeStart}
              className="fixed z-40 cursor-col-resize select-none"
              style={{
                top: "32px",
                bottom: 0,
                left: sidebarWidth - SIDEBAR_RESIZER_WIDTH / 2,
                width: SIDEBAR_RESIZER_WIDTH,
              }}
            >
              <span className="pointer-events-none absolute top-1/2 left-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border/70" />
            </div>
          )}

          {isSidebarCollapsed && (
            <button
              type="button"
              onClick={handleSidebarToggle}
              className="fixed bottom-6 left-4 z-40 flex items-center gap-1 rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm shadow-sm transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ChevronsRight className="h-3 w-3" />
              Panel
            </button>
          )}

          <main
            className="flex-1 flex flex-col overflow-hidden bg-background transition-[margin-left,margin-right] duration-200 ease-out"
            style={{
              marginLeft: isSidebarCollapsed ? 0 : sidebarWidth,
              marginRight: isRightSidebarCollapsed ? 0 : rightSidebarWidth,
              marginTop: "28px"
            }}
          >
            <div className="flex-1 min-h-0 relative">
              {showUrdfEditor && urdfEditorSplitView ? (
                <div className="flex flex-col h-full">
                  {/* Simulation in top half */}
                  <div className="flex-1 min-h-0 border-b border-border/20">
                    <Viewer3D
                      key={`urdf-${urdfContentVersion}`}
                      urdfFile={urdfFile}
                      initialMeshFiles={meshFiles}
                      selectedJoint={hoveredJoint || selectedJoint}
                      selectedLink={selectedLink}
                      jointValues={jointValues}
                      jointLimits={jointLimits}
                      jointAxes={jointAxes}
                      onJointSelect={setSelectedJoint}
                      onLinkSelect={setSelectedLink}
                      onJointHover={setHoveredJoint}
                      onJointChange={handleJointChange}
                      onRobotJointsLoaded={handleRobotJointsLoaded}
                      onMotionFileChange={setMotionDataFile}
                      onPlayingChange={setIsPlaying}
                      onAnimationFramesChange={setHasAnimationFrames}
                      onFrameChange={handleFrameChange}
                      collisionVisibility={collisionVisibility}
                      rotationPlaneVisible={rotationPlaneVisible}
                      onRobotBoundingBoxChange={setRobotBoundingBox}
                      onRobotLoaded={setRobot}
                      endEffectorLink={endEffectorLink}
                      onIkApplied={handleIkApplied}
                    />
                  </div>
                  {/* Editor in bottom half */}
                  <div className="flex-1 min-h-0">
                    <URDFComparison
                      originalUrdf={originalUrdfContent}
                      vizUrdf={vizUrdfContent}
                      isOpen={true}
                      onClose={() => setShowUrdfEditor(false)}
                      onVizUrdfChange={handleVizUrdfChange}
                      getExportUrdf={getExportUrdfContent}
                      meshFiles={meshFiles}
                      githubToken={typeof window !== "undefined" ? import.meta.env.VITE_GITHUB_TOKEN || null : null}
                      inline={true}
                      splitView={true}
                      onSplitViewToggle={setUrdfEditorSplitView}
                      selectedView={urdfViewMode}
                      onSelectedViewChange={setUrdfViewMode}
                    />
                  </div>
                </div>
              ) : showUrdfEditor ? (
                <div className="flex flex-col h-full">
                  {/* Simulation in top half */}
                  <div className="flex-1 min-h-0 border-b border-border/20">
                    <Viewer3D
                      key={`urdf-${urdfContentVersion}`}
                      urdfFile={urdfFile}
                      initialMeshFiles={meshFiles}
                      selectedJoint={hoveredJoint || selectedJoint}
                      selectedLink={selectedLink}
                      jointValues={jointValues}
                      jointLimits={jointLimits}
                      jointAxes={jointAxes}
                      onJointSelect={setSelectedJoint}
                      onLinkSelect={setSelectedLink}
                      onJointHover={setHoveredJoint}
                      onJointChange={handleJointChange}
                      onRobotJointsLoaded={handleRobotJointsLoaded}
                      onMotionFileChange={setMotionDataFile}
                      onPlayingChange={setIsPlaying}
                      onAnimationFramesChange={setHasAnimationFrames}
                      onFrameChange={handleFrameChange}
                      collisionVisibility={collisionVisibility}
                      rotationPlaneVisible={rotationPlaneVisible}
                      onRobotBoundingBoxChange={setRobotBoundingBox}
                      onRobotLoaded={setRobot}
                      endEffectorLink={endEffectorLink}
                      onIkApplied={handleIkApplied}
                    />
                  </div>
                  {/* Editor in bottom half */}
                  <div className="flex-1 min-h-0">
                    <URDFComparison
                      originalUrdf={originalUrdfContent}
                      vizUrdf={vizUrdfContent}
                      isOpen={true}
                      onClose={() => setShowUrdfEditor(false)}
                      onVizUrdfChange={handleVizUrdfChange}
                      getExportUrdf={getExportUrdfContent}
                      meshFiles={meshFiles}
                      githubToken={typeof window !== "undefined" ? import.meta.env.VITE_GITHUB_TOKEN || null : null}
                      inline={true}
                      splitView={true}
                      onSplitViewToggle={setUrdfEditorSplitView}
                      selectedView={urdfViewMode}
                      onSelectedViewChange={setUrdfViewMode}
                    />
                  </div>
                </div>
              ) : showUrdfEditor ? (
                <URDFComparison
                  originalUrdf={originalUrdfContent}
                  vizUrdf={vizUrdfContent}
                  isOpen={true}
                  onClose={() => setShowUrdfEditor(false)}
                  onVizUrdfChange={handleVizUrdfChange}
                  getExportUrdf={getExportUrdfContent}
                  meshFiles={meshFiles}
                  selectedView={urdfViewMode}
                  onSelectedViewChange={setUrdfViewMode}
                  githubToken={typeof window !== "undefined" && import.meta.env.VITE_GITHUB_TOKEN ? import.meta.env.VITE_GITHUB_TOKEN : null}
                  inline={true}
                  splitView={false}
                  onSplitViewToggle={setUrdfEditorSplitView}
                />
              ) : (
                <div className="flex flex-col h-full">
                  {/* 3D Viewer in top half */}
                  <div 
                    className="min-h-0 border-b border-border/20"
                    style={{ flex: `0 0 ${(1 - recordingViewHeight) * 100}%` }}
                  >
                    <Viewer3D
                      key={`urdf-${urdfContentVersion}`}
                      urdfFile={urdfFile}
                      initialMeshFiles={meshFiles}
                      selectedJoint={hoveredJoint || selectedJoint}
                      selectedLink={selectedLink}
                      jointValues={jointValues}
                      jointLimits={jointLimits}
                      jointAxes={jointAxes}
                      onJointSelect={setSelectedJoint}
                      onLinkSelect={setSelectedLink}
                      onJointHover={setHoveredJoint}
                      onJointChange={handleJointChange}
                      onRobotJointsLoaded={handleRobotJointsLoaded}
                      onMotionFileChange={setMotionDataFile}
                      onPlayingChange={setIsPlaying}
                      onAnimationFramesChange={setHasAnimationFrames}
                      onFrameChange={handleFrameChange}
                      collisionVisibility={collisionVisibility}
                      rotationPlaneVisible={rotationPlaneVisible}
                      onRobotBoundingBoxChange={setRobotBoundingBox}
                      onRobotLoaded={setRobot}
                      endEffectorLink={endEffectorLink}
                      onIkApplied={handleIkApplied}
                    />
                  </div>
                  {/* Vertical Resizer - always visible */}
                  <div
                    onPointerDown={handleViewerResizeStart}
                    className="cursor-row-resize select-none bg-border/30 hover:bg-border/60 transition-colors relative group flex-shrink-0 z-10"
                    style={{ height: VIEWER_RESIZER_HEIGHT }}
                    aria-label="Resize viewer"
                  >
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-12 h-0.5 bg-border/40 group-hover:bg-border/80 transition-colors rounded-full" />
                    </div>
                  </div>
                  {/* Recording view in bottom half - always shows header */}
                  <div 
                    className="min-h-0 overflow-hidden flex flex-col"
                    style={{ 
                      flex: `0 0 ${recordingViewHeight * 100}%`,
                    }}
                  >
                    {viewerEpisode ? (
                        <EpisodeViewer3DModal
                          episode={viewerEpisode}
                          open={true}
                          onOpenChange={(open) => {
                            // Don't allow closing - always keep it open
                            if (!open) {
                              setIsViewerOpen(true);
                            }
                          }}
                          inline={true}
                          globalCurrentFrame={currentFrame}
                          onSetGlobalFrame={(frame: number) => {
                            (window as WindowWithViewerHandlers).viewer3dSetFrame?.(frame);
                            setCurrentFrame(frame);
                          }}
                          showOnlyHeader={recordingViewHeight <= 0.08}
                          onSaveEpisode={episodeSaveHandler}
                        />
                    ) : (
                        <div className="flex-1 min-h-0 flex items-center justify-center bg-background border-t border-border">
                          <div className="flex flex-col items-center gap-3 text-center px-6">
                            <div className="text-sm font-medium text-muted-foreground">
                              No episodes available
                            </div>
                            <div className="text-xs text-muted-foreground/70 max-w-md">
                              Record an episode or import episodes from files to view them here.
                            </div>
                          </div>
                        </div>
                      )}
                  </div>
                </div>
              )}
            </div>
          </main>

          {/* Right Sidebar - Joint List */}
          <JointListSidebar
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
            width={rightSidebarWidth}
            isCollapsed={isRightSidebarCollapsed}
            urdfContent={vizUrdfContent}
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
          />

          {/* Right Sidebar Resizer */}
          {!isRightSidebarCollapsed && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize right sidebar"
              onPointerDown={handleRightSidebarResizeStart}
              className="fixed z-40 cursor-col-resize select-none"
              style={{
                top: "32px",
                bottom: 0,
                right: rightSidebarWidth - SIDEBAR_RESIZER_WIDTH / 2,
                width: SIDEBAR_RESIZER_WIDTH,
              }}
            >
              <span className="pointer-events-none absolute top-1/2 left-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border/70" />
            </div>
          )}

        </>
      )}

      {/* Mesh Files Status Panel - Bottom Right */}
      {showDebugDialog && (
        <div
          className="fixed bottom-4 z-50 w-80 max-h-[40vh] bg-[#282828] border border-[#3d3d3d] rounded-lg shadow-lg flex flex-col"
          style={{
            right: isRightSidebarCollapsed ? "1rem" : `${rightSidebarWidth + 16}px`
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-2 border-b border-[#3d3d3d]">
            <div className="text-xs font-medium text-[#d4d4d4]">Mesh Files Status</div>
            <button
              onClick={() => setShowDebugDialog(false)}
              className="text-[#9d9d9d] hover:text-[#d4d4d4] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          
          {/* Summary */}
          <div className="px-2 py-1.5 text-xs border-b border-[#3d3d3d] bg-[#1e1e1e]">
            <div className="text-[#9d9d9d]">
              Total: {debugMeshInfo.length} | 
              <span className="text-[#6d9d6d] ml-1">✓ {debugMeshInfo.filter(m => m.found).length}</span> | 
              <span className="text-[#9d6d6d] ml-1">✗ {debugMeshInfo.filter(m => !m.found).length}</span>
              {unmatchedURDFRefs.length > 0 && (
                <span className="text-[#9d6d6d] ml-2">⚠ {unmatchedURDFRefs.length}</span>
              )}
            </div>
          </div>
          
          {/* Content */}
          <div className="overflow-y-auto flex-1 p-2 space-y-1 blender-scrollbar">
            {unmatchedURDFRefs.length > 0 && (
              <div className="mb-2 p-1.5 bg-[#2a1e1e] border border-[#4a2d2d] rounded text-xs">
                <div className="flex items-center gap-1 mb-1">
                  <AlertCircle className="h-3 w-3 text-[#9d6d6d]" />
                  <span className="font-medium text-[#9d6d6d]">Unmatched: {unmatchedURDFRefs.length}</span>
                </div>
              </div>
            )}
            
            {debugMeshInfo.map((info, index) => (
              <div
                key={index}
                className={`text-xs p-1.5 rounded border ${
                  info.found
                    ? "bg-[#1e2a1e] border-[#3d4a3d]"
                    : "bg-[#2a1e1e] border-[#4a3d3d]"
                }`}
              >
                <div className="flex items-start gap-1.5">
                  {info.found ? (
                    <CheckCircle2 className="h-3 w-3 text-[#6d9d6d] flex-shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="h-3 w-3 text-[#9d6d6d] flex-shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[#d4d4d4] truncate">{info.filename}</div>
                    {info.found && info.urdfReference && (
                      <div className="text-[#9d9d9d] text-[10px] mt-0.5 truncate">
                        {info.urdfReference}
                      </div>
                    )}
                    {!info.found && (
                      <div className="text-[#9d6d6d] text-[10px] mt-0.5">
                        Not found
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Export Dialog - Always available, even when on 3D viewer */}
      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        urdfContent={getExportUrdfContent()}
        meshFiles={meshFiles}
        githubToken={typeof window !== "undefined" && import.meta.env.VITE_GITHUB_TOKEN ? import.meta.env.VITE_GITHUB_TOKEN : null}
        robotName={robotName}
      />

      {showPovCameras && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-5xl rounded-xl border border-border bg-[#101010]/95 p-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-border/50">
              <div>
                <div className="text-sm font-semibold text-foreground">POV Cameras</div>
                <p className="text-[11px] text-muted-foreground">Camera definitions (preview removed).</p>
              </div>
              <button
                onClick={() => setShowPovCameras(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
                aria-label="Close POV split view"
              >
                Close
              </button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {cameras.map((camera, index) => (
                <div
                  key={camera.id}
                  className={cn(
                    "flex flex-col gap-2 rounded-lg border bg-gradient-to-b from-[#151515] to-[#0b0b0b] p-3 shadow-lg",
                    selectedCameraId === camera.id
                      ? "border-primary/60 ring-2 ring-primary/20"
                      : "border-border/50"
                  )}
                >
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span>Camera {index + 1}</span>
                    <span className="text-[9px] text-muted-foreground/70">{camera.parent_link}</span>
                  </div>
                  <div className="text-sm font-semibold text-foreground truncate">{camera.name}</div>
                  <div className="w-full rounded-md border border-border/40 bg-[#0b0b0b] p-3 text-[11px] text-muted-foreground">
                    <div>Parent link: <span className="text-foreground">{camera.parent_link}</span></div>
                    <div>Pose xyz: {camera.pose.xyz.join(", ")}</div>
                    <div>Pose rpy: {camera.pose.rpy.join(", ")}</div>
                    <div>Intrinsics: {camera.intrinsics.width}×{camera.intrinsics.height}, FOV {camera.intrinsics.fov_deg}°</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Joint Mapping List Panel */}
      <MappingListPanel
        isOpen={showMappingListPanel}
        onClose={() => setShowMappingListPanel(false)}
        mappings={getSavedMappings()}
        onSelectMapping={handleSelectMapping}
        onDeleteMapping={handleDeleteMappingById}
      />

      {/* Joint Mapping Dialog */}
      {mappingDialogData && (
        <JointMappingDialog
          isOpen={showMappingDialog}
          onClose={() => {
            setShowMappingDialog(false);
            setMappingDialogData(null);
            setSelectedMapping(undefined);
          }}
          datasetJoints={mappingDialogData.datasetJoints}
          urdfJoints={availableJoints}
          jointRanges={mappingDialogData.jointRanges}
          existingMapping={selectedMapping}
          source={selectedMapping?.source}
          jointLimits={jointLimits}
          onApply={handleApplyMapping}
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
