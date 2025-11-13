import type React from "react";
import { useState, useCallback, useMemo, startTransition } from "react";
import { Sidebar, DEFAULT_SIDEBAR_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } from "@/components/Sidebar";
import { Viewer3D } from "@/components/Viewer3D";
import type { CollisionVisibility } from "@/components/LinkEditor";
import { FolderUploadScreen } from "@/components/FolderUploadScreen";
import { useGPUMode } from "@/hooks/use-gpu-mode";
import { toast } from "sonner";
import { createVizFilename } from "@/urdf_corrections/addJointColors";
import { parseJointLimitsFromURDF, type JointLimits } from "@/urdf_corrections/parseJointLimits";
import { parseJointAxesFromURDF, type JointAxisMap } from "@/urdf_corrections/parseJointAxis";
import { updateJointTypeInURDF } from "@/urdf_corrections/updateJointType";
import { updateJointNameInURDF } from "@/urdf_corrections/updateJointName";
import { updateJointAxisInURDF } from "@/urdf_corrections/updateJointAxis";
import { rotateRobot90Degrees } from "@/urdf_corrections/rotateRobot";
import { useTheme } from "@/hooks/use-theme";
import { useJointStore } from "@/store/useJointStore";
import type { FileWithPath } from "@/types/file";
import { ChevronsRight } from "lucide-react";

interface MeshFiles {
  [key: string]: Blob;
}

type RotationAxis = "x" | "y" | "z";

const DEFAULT_URDF_FILENAME = "robot.urdf";
const AXIS_NAMES: Record<RotationAxis, string> = {
  x: "X",
  y: "Y",
  z: "Z",
} as const;

const SIDEBAR_RESIZER_WIDTH = 8;

interface WindowWithViewerHandlers extends Window {
  viewer3dUploadMotionData?: (file: File) => void;
  viewer3dPlayAnimation?: () => void;
}

const Index = () => {
  useTheme(); // Initialize dark mode
  const { gpuMode } = useGPUMode();
  const [urdfFile, setUrdfFile] = useState<File | null>(null);
  const [meshFiles, setMeshFiles] = useState<MeshFiles>({});
  const [selectedJoint, setSelectedJoint] = useState<string | null>(null);
  const [jointValues, setJointValues] = useState<Record<string, number>>({});
  const [availableJoints, setAvailableJoints] = useState<string[]>([]);
  const setStoreJointValue = useJointStore((s) => s.setJointValue);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadedFiles, setHasLoadedFiles] = useState(false);
  const [jointLimits, setJointLimits] = useState<JointLimits>({});
  const [jointAxes, setJointAxes] = useState<JointAxisMap>({});
  const [originalUrdfContent, setOriginalUrdfContent] = useState<string>("");
  const [vizUrdfContent, setVizUrdfContent] = useState<string>("");
  const [originalJointAxes, setOriginalJointAxes] = useState<JointAxisMap>({});
  const [originalVizUrdfContent, setOriginalVizUrdfContent] = useState<string>("");
  const [jointNameMapping, setJointNameMapping] = useState<Map<string, string>>(new Map());
  const [deletedJoints, setDeletedJoints] = useState<Set<string>>(new Set());
  const [motionDataFile, setMotionDataFile] = useState<File | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasAnimationFrames, setHasAnimationFrames] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [collisionVisibility, setCollisionVisibility] = useState<CollisionVisibility>({});

  const createUrdfFile = useCallback((content: string, filename: string = DEFAULT_URDF_FILENAME): File => {
    const vizFilename = createVizFilename(filename);
    const blob = new Blob([content], { type: "application/xml" });
    return new File([blob], vizFilename, { type: "application/xml" });
  }, []);

  const updateUrdfFile = useCallback((content: string, filename: string = DEFAULT_URDF_FILENAME): void => {
    startTransition(() => {
      setVizUrdfContent(content);
      const limits = parseJointLimitsFromURDF(content);
      const axes = parseJointAxesFromURDF(content);
      setJointLimits(limits);
      setJointAxes(axes);
      setUrdfFile(createUrdfFile(content, filename));
    });
  }, [createUrdfFile]);

  const loadFilesFromFolder = async (fileList: FileList) => {
    try {
      setIsLoading(true);

      const urdfFiles = Array.from(fileList).filter(file => 
        file.name.toLowerCase().endsWith('.urdf')
      );

      if (urdfFiles.length === 0) {
        throw new Error("No URDF file found in selected folder");
      }

      const urdfFile = urdfFiles[0];
      const originalContent = await urdfFile.text();
      const urdfFilename = urdfFile.name;
      
      const parsedLimits = parseJointLimitsFromURDF(originalContent);
      const parsedAxes = parseJointAxesFromURDF(originalContent);
      
      startTransition(() => {
        setOriginalUrdfContent(originalContent);
        setJointLimits(parsedLimits);
        setJointAxes(parsedAxes);
        setOriginalJointAxes(parsedAxes);
        setVizUrdfContent(originalContent);
        setOriginalVizUrdfContent(originalContent);
        setUrdfFile(createUrdfFile(originalContent, urdfFilename));
      });

      const stlFiles = Array.from(fileList).filter(file => 
        file.name.toLowerCase().endsWith('.stl')
      );

      const meshes: MeshFiles = {};
      const blobCache = new Map<string, Blob>();
      
      await Promise.all(
        stlFiles.map(async (file) => {
          try {
            const fileWithPath = file as FileWithPath;
            const relativePath = fileWithPath.webkitRelativePath || file.name;
            const filename = file.name;
            
            let blob = blobCache.get(filename);
            if (!blob) {
              blob = new Blob([await file.arrayBuffer()]);
              blobCache.set(filename, blob);
            }
            
            const pathParts = relativePath.split('/');
            const folderName = pathParts.length > 1 ? pathParts[pathParts.length - 2] : '';
            
            meshes[filename] = blob;
            if (folderName) {
              meshes[`${folderName}/${filename}`] = blob;
              meshes[`/${folderName}/${filename}`] = blob;
            }
            meshes[relativePath] = blob;
            const relativePathNoSlash = relativePath.replace(/^\//, '');
            if (relativePathNoSlash !== relativePath) {
              meshes[relativePathNoSlash] = blob;
            }
          } catch (err) {
            if (import.meta.env.DEV) {
              console.warn(`Failed to load mesh: ${file.name}`, err);
            }
          }
        })
      );
      
      setMeshFiles(meshes);
      setHasLoadedFiles(true);
      toast.success(`Loaded ${urdfFilename} with ${stlFiles.length} mesh files`);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Failed to load robot files:", error);
      }
      toast.error(error instanceof Error ? error.message : "Failed to load robot files");
    } finally {
      setIsLoading(false);
    }
  };

  const handleJointChange = useCallback((jointName: string, value: number): void => {
    const limited = setStoreJointValue(jointName, value);
    setJointValues((prev) => {
      if (prev[jointName] === limited) return prev;
      return { ...prev, [jointName]: limited };
    });
  }, [setStoreJointValue]);

  const handleJointTypeChange = useCallback((jointName: string, newType: string, lowerLimit?: number, upperLimit?: number): void => {
    if (!vizUrdfContent) {
      toast.error("No URDF content available");
      return;
    }

    const updatedContent = updateJointTypeInURDF(vizUrdfContent, jointName, newType, lowerLimit, upperLimit);
    updateUrdfFile(updatedContent);

    const limitMsg = lowerLimit !== undefined && upperLimit !== undefined 
      ? ` with limits [${lowerLimit.toFixed(2)}, ${upperLimit.toFixed(2)}]`
      : "";
    toast.success(`Updated joint "${jointName}" type to ${newType}${limitMsg}`);
  }, [vizUrdfContent, updateUrdfFile]);

  const handleVizUrdfChange = useCallback((newContent: string): void => {
    updateUrdfFile(newContent);
    toast.success("Viz URDF updated from manual edit");
  }, [updateUrdfFile]);

  const handleJointNameChange = useCallback((oldName: string, newName: string): void => {
    if (newName === oldName) return;

    if (!vizUrdfContent) {
      toast.error("No URDF content available");
      return;
    }

    // Check if new name already exists in current joints
    const currentJointNames = Object.keys(jointLimits);
    if (currentJointNames.includes(newName)) {
      toast.error(`Joint "${newName}" already exists`);
      return;
    }

    // Update the URDF content immediately
    const updatedContent = updateJointNameInURDF(vizUrdfContent, oldName, newName);
    if (updatedContent === vizUrdfContent) {
      toast.error(`Failed to rename joint "${oldName}"`);
      return;
    }

    // Update joint name mapping for export
    setJointNameMapping((prev) => {
      const newMapping = new Map(prev);
      newMapping.set(oldName, newName);
      return newMapping;
    });

    // Update availableJoints array
    setAvailableJoints((prev) => {
      const index = prev.indexOf(oldName);
      if (index === -1) return prev;
      const updated = [...prev];
      updated[index] = newName;
      return updated;
    });

    // Update selected joint if it was the renamed one
    if (selectedJoint === oldName) {
      setSelectedJoint(newName);
    }

    // Update joint values in store
    const storeJointValues = useJointStore.getState().jointValues;
    if (storeJointValues[oldName] !== undefined) {
      const newValues = { ...storeJointValues };
      newValues[newName] = newValues[oldName];
      delete newValues[oldName];
      useJointStore.getState().setJointValues(newValues);
    }

    const velocityOverrides = useJointStore.getState().jointVelocityLimits;
    if (velocityOverrides[oldName] !== undefined) {
      const overrideValue = velocityOverrides[oldName];
      if (overrideValue !== undefined && overrideValue !== null) {
        useJointStore.getState().setJointMaxVelocity(newName, overrideValue);
      }
      useJointStore.getState().setJointMaxVelocity(oldName, null);
    }

    // Update URDF file (this will re-parse limits and axes with new names)
    updateUrdfFile(updatedContent);

    toast.success(`Joint "${oldName}" renamed to "${newName}"`);
  }, [availableJoints, vizUrdfContent, jointLimits, selectedJoint, updateUrdfFile]);

  const handleJointAxisChange = useCallback((jointName: string, axis: [number, number, number]): void => {
    if (!vizUrdfContent) {
      toast.error("No URDF content available");
      return;
    }

    const updatedContent = updateJointAxisInURDF(vizUrdfContent, jointName, axis);
    updateUrdfFile(updatedContent);
    toast.success(`Updated axis for joint "${jointName}"`);
  }, [vizUrdfContent, updateUrdfFile]);

  const handleResetAxis = useCallback((jointName: string): void => {
    if (!originalJointAxes[jointName]) {
      toast.error(`No original axis found for joint "${jointName}"`);
      return;
    }

    const originalAxis = originalJointAxes[jointName].xyz;
    handleJointAxisChange(jointName, originalAxis);
  }, [originalJointAxes, handleJointAxisChange]);

  const handleResetRotation = useCallback((): void => {
    if (!originalVizUrdfContent) {
      toast.error("No original URDF content found");
      return;
    }

    updateUrdfFile(originalVizUrdfContent);
    toast.success("Reset robot rotation to original position");
  }, [originalVizUrdfContent, updateUrdfFile]);

  const applyJointNameMappings = useCallback((urdfContent: string): string => {
    return Array.from(jointNameMapping.entries())
      .reverse()
      .reduce((content, [oldName, newName]) => 
        updateJointNameInURDF(content, oldName, newName),
        urdfContent
      );
  }, [jointNameMapping]);

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

  const getExportUrdfContent = useCallback((): string => {
    if (!vizUrdfContent) return "";
    return deleteJointsFromURDF(
      applyJointNameMappings(vizUrdfContent),
      deletedJoints
    );
  }, [vizUrdfContent, applyJointNameMappings, deleteJointsFromURDF, deletedJoints]);

  const handleDeleteJoint = useCallback((jointName: string): void => {
    setDeletedJoints((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(jointName)) {
        newSet.delete(jointName);
        toast.success(`Joint "${jointName}" will be included in exported URDF`);
      } else {
        newSet.add(jointName);
        toast.success(`Joint "${jointName}" will be removed from exported URDF`);
      }
      return newSet;
    });
  }, []);

  const handleRotateRobot = useCallback((axis: RotationAxis): void => {
    if (!vizUrdfContent) {
      toast.error("No URDF loaded");
      return;
    }

    const rotatedContent = rotateRobot90Degrees(vizUrdfContent, axis);

    if (rotatedContent === vizUrdfContent) {
      toast.error("Failed to rotate robot");
      return;
    }

    updateUrdfFile(rotatedContent);
    toast.success(`Robot rotated 90° around ${AXIS_NAMES[axis]}-axis`);
  }, [vizUrdfContent, updateUrdfFile]);

  const handleMotionDataUpload = useCallback((file: File): void => {
    (window as WindowWithViewerHandlers).viewer3dUploadMotionData?.(file);
  }, []);

  const handlePlayAnimation = useCallback((): void => {
    (window as WindowWithViewerHandlers).viewer3dPlayAnimation?.();
  }, []);

  const handleFrameChange = useCallback((frame: number, total: number): void => {
    setCurrentFrame(frame);
    setTotalFrames(total);
  }, []);

  const handleRobotJointsLoaded = useCallback((joints: string[], angles: Record<string, number>): void => {
    startTransition(() => {
      setAvailableJoints(joints);
      setJointValues(angles);
      if (!selectedJoint && joints.length > 0) {
        setSelectedJoint(joints[0]);
      }
    });
  }, [selectedJoint]);

  const clampSidebarWidth = useCallback(
    (width: number) => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)),
    []
  );

  const handleSidebarToggle = useCallback(() => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      if (!next) {
        setSidebarWidth((current) => clampSidebarWidth(current));
      }
      return next;
    });
  }, [clampSidebarWidth]);

  const handleSidebarResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const startWidth = sidebarWidth;
      const originalCursor = document.body.style.cursor;
      const originalUserSelect = document.body.style.userSelect;

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - startX;
        const nextWidth = clampSidebarWidth(startWidth + delta);
        setSidebarWidth(nextWidth);
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
    [sidebarWidth, clampSidebarWidth]
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
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">Loading robot...</span>
          </div>
        </div>
      ) : (
        <>
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
            onJointTypeChange={handleJointTypeChange}
            onVizUrdfChange={handleVizUrdfChange}
            onJointNameChange={handleJointNameChange}
            onJointAxisChange={handleJointAxisChange}
            onResetAxis={handleResetAxis}
            onDeleteJoint={handleDeleteJoint}
            deletedJoints={deletedJoints}
            getExportUrdf={getExportUrdfContent}
            onRotateRobot={handleRotateRobot}
            onResetRotation={handleResetRotation}
            hasRotationChanges={hasRotationChanges}
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
          />

          {!isSidebarCollapsed && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              onPointerDown={handleSidebarResizeStart}
              className="fixed top-0 bottom-0 z-40 cursor-col-resize select-none"
              style={{
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
            className="flex-1 flex flex-col overflow-hidden bg-background transition-[margin-left] duration-200 ease-out"
            style={{ marginLeft: isSidebarCollapsed ? 0 : sidebarWidth }}
          >
            <div className="flex-1 min-h-0">
              <Viewer3D
                urdfFile={urdfFile}
                initialMeshFiles={meshFiles}
                selectedJoint={selectedJoint}
                jointValues={jointValues}
                jointLimits={jointLimits}
                jointAxes={jointAxes}
                gpuMode={gpuMode}
                onJointSelect={setSelectedJoint}
                onJointChange={handleJointChange}
                onRobotJointsLoaded={handleRobotJointsLoaded}
                onMotionFileChange={setMotionDataFile}
                onPlayingChange={setIsPlaying}
                onAnimationFramesChange={setHasAnimationFrames}
                onFrameChange={handleFrameChange}
                collisionVisibility={collisionVisibility}
              />
            </div>
          </main>
        </>
      )}
    </div>
  );
};

export default Index;
