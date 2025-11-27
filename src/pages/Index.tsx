import type React from "react";
import { useState, useCallback, useMemo, startTransition } from "react";
import { Sidebar, DEFAULT_SIDEBAR_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } from "@/components/Sidebar";
import { Viewer3D } from "@/components/Viewer3D";
import type { CollisionVisibility } from "@/components/LinkEditor";
import { URDFComparison } from "@/components/URDFComparison";
import { FolderUploadScreen } from "@/components/FolderUploadScreen";
import { EpisodeViewer3DModal } from "@/components/EpisodeViewer3DModal";
import { useGPUMode } from "@/hooks/use-gpu-mode";
import { toast } from "sonner";
import { createVizFilename } from "@/urdf_corrections/addJointColors";
import { parseJointLimitsFromURDF, type JointLimits } from "@/urdf_corrections/parseJointLimits";
import { parseJointAxesFromURDF, type JointAxisMap } from "@/urdf_corrections/parseJointAxis";
import { updateJointAxisInURDF } from "@/urdf_corrections/updateJointAxis";
import { updateJointTypeInURDF } from "@/urdf_corrections/updateJointType";
import { updateJointNameInURDF } from "@/urdf_corrections/updateJointName";
import { rotateRobot90Degrees } from "@/urdf_corrections/rotateRobot";
import { useTheme } from "@/hooks/use-theme";
import { useJointStore } from "@/store/useJointStore";
import type { FileWithPath } from "@/types/file";
import { ChevronsRight, CheckCircle2, XCircle, AlertCircle, X } from "lucide-react";

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
  const [deletedJoints, setDeletedJoints] = useState<Set<string>>(new Set());
  const [urdfContentVersion, setUrdfContentVersion] = useState<number>(0);
  const [motionDataFile, setMotionDataFile] = useState<File | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasAnimationFrames, setHasAnimationFrames] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [collisionVisibility, setCollisionVisibility] = useState<CollisionVisibility>({});
  const [rotationPlaneVisible, setRotationPlaneVisible] = useState<boolean>(false);
  const [showUrdfEditor, setShowUrdfEditor] = useState<boolean>(false);
  const [urdfEditorSplitView, setUrdfEditorSplitView] = useState<boolean>(false);
  const [viewerSplitView, setViewerSplitView] = useState<boolean>(false);
  const [viewerEpisode, setViewerEpisode] = useState<any | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState<boolean>(false);
  const [showDebugDialog, setShowDebugDialog] = useState(false);
  const [debugMeshInfo, setDebugMeshInfo] = useState<Array<{
    filename: string;
    webkitRelativePath: string;
    found: boolean;
    urdfReference?: string;
    registeredPaths: string[];
  }>>([]);
  const [unmatchedURDFRefs, setUnmatchedURDFRefs] = useState<string[]>([]);

  const createUrdfFile = useCallback((content: string, filename: string = DEFAULT_URDF_FILENAME, timestamp?: number): File => {
    const vizFilename = createVizFilename(filename);
    // Add timestamp to filename to ensure uniqueness and force reload
    const uniqueFilename = timestamp 
      ? `${vizFilename.replace('.urdf', '')}_${timestamp}.urdf`
      : vizFilename;
    const blob = new Blob([content], { type: "application/xml" });
    return new File([blob], uniqueFilename, { type: "application/xml" });
  }, []);

  const updateUrdfFile = useCallback((content: string, filename: string = DEFAULT_URDF_FILENAME): void => {
    setVizUrdfContent(content);
    const limits = parseJointLimitsFromURDF(content);
    const axes = parseJointAxesFromURDF(content);
    setJointLimits(limits);
    setJointAxes(axes);
    setUrdfFile(createUrdfFile(content, filename));
  }, [createUrdfFile]);

  // Extract all mesh file references from URDF
  const extractMeshReferencesFromURDF = useCallback((urdfContent: string): string[] => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(urdfContent, "text/xml");
    const meshReferences = new Set<string>();
    
    // Find all mesh elements in visual and collision geometries
    const meshElements = xmlDoc.querySelectorAll("mesh");
    meshElements.forEach((mesh) => {
      const filename = mesh.getAttribute("filename");
      if (filename) {
        // Remove any package:// prefix and normalize
        const normalizedFilename = filename
          .replace(/^package:\/\/[^/]+\//, "")
          .replace(/^file:\/\//, "")
          .trim();
        if (normalizedFilename) {
          meshReferences.add(normalizedFilename);
        }
      }
    });
    
    return Array.from(meshReferences);
  }, []);

  const loadFilesFromFolder = async (fileList: FileList) => {
    try {
      setIsLoading(true);

      const urdfFiles = Array.from(fileList).filter(file => 
        file.name.toLowerCase().endsWith('.urdf')
      );

      if (urdfFiles.length === 0) {
        throw new Error("No URDF file found in selected folder");
      }

      // Ensure only one URDF file is used - if multiple found, use the first and warn
      if (urdfFiles.length > 1) {
        console.warn(`Multiple URDF files found (${urdfFiles.length}), using only the first one: ${urdfFiles[0].name}`);
      }

      const urdfFile = urdfFiles[0];
      const originalContent = await urdfFile.text();
      const urdfFilename = urdfFile.name;
      
      const parsedLimits = parseJointLimitsFromURDF(originalContent);
      const parsedAxes = parseJointAxesFromURDF(originalContent);

      setOriginalUrdfContent(originalContent);
      setJointLimits(parsedLimits);
      setJointAxes(parsedAxes);
      setOriginalJointAxes(parsedAxes);
      setVizUrdfContent(originalContent);
      setOriginalVizUrdfContent(originalContent);
      setUrdfFile(createUrdfFile(originalContent, urdfFilename));

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
            
            // Normalize path (remove leading/trailing slashes)
            const normalizedPath = relativePath.replace(/^\/+|\/+$/g, '');
            const pathParts = normalizedPath.split('/').filter(Boolean); // Filter out empty parts
            
            // Store blob with multiple path variations to match URDF references
            // This ensures compatibility with different path formats in URDF files
            // The URDF loader will try: exact path, filename, path without first folder, etc.
            
            // 1. Just filename (always store)
            meshes[filename] = blob;
            
            // 2. Full relative path (normalized) - this is the primary key
            // Example: "assets/base_motor_holder_so101_v1.stl"
            meshes[normalizedPath] = blob;
            
            // 3. Relative path with leading slash
            // Example: "/assets/base_motor_holder_so101_v1.stl"
            meshes[`/${normalizedPath}`] = blob;
            
            // 4. Store original relativePath if different from normalized
            if (relativePath !== normalizedPath) {
              meshes[relativePath] = blob;
              // Also store without leading slash
              const noLeadingSlash = relativePath.replace(/^\/+/, '');
              if (noLeadingSlash !== relativePath && noLeadingSlash !== normalizedPath) {
                meshes[noLeadingSlash] = blob;
              }
            }
            
            // 5. For paths with folders, create variations
            if (pathParts.length > 1) {
              // Last folder + filename (e.g., "assets/base_motor_holder_so101_v1.stl" -> "assets/base_motor_holder_so101_v1.stl")
              // This is already stored as normalizedPath, but ensure it's there
              const lastFolderAndFile = `${pathParts[pathParts.length - 2]}/${pathParts[pathParts.length - 1]}`;
              if (lastFolderAndFile !== normalizedPath) {
                meshes[lastFolderAndFile] = blob;
                meshes[`/${lastFolderAndFile}`] = blob;
              }
              
              // All suffixes starting from each folder level
              // For "robot/assets/base_motor_holder_so101_v1.stl":
              // - "robot/assets/base_motor_holder_so101_v1.stl"
              // - "assets/base_motor_holder_so101_v1.stl"
              // - "base_motor_holder_so101_v1.stl"
              for (let i = 0; i < pathParts.length; i++) {
                const suffixPath = pathParts.slice(i).join('/');
                meshes[suffixPath] = blob;
                meshes[`/${suffixPath}`] = blob;
              }
              
              // Also try without the first folder (common pattern in URDF files)
              // For "robot/assets/base_motor_holder_so101_v1.stl" -> "assets/base_motor_holder_so101_v1.stl"
              if (pathParts.length > 1) {
                const withoutFirst = pathParts.slice(1).join('/');
                meshes[withoutFirst] = blob;
                meshes[`/${withoutFirst}`] = blob;
              }
            }
            
            // 6. URL decoded variations (in case URDF has encoded paths)
            try {
              const decodedPath = decodeURIComponent(normalizedPath);
              if (decodedPath !== normalizedPath) {
                meshes[decodedPath] = blob;
                meshes[`/${decodedPath}`] = blob;
              }
            } catch {
              // Ignore decode errors
            }
            
            // 7. Try common mesh folder patterns (meshes/, mesh/, assets/, models/)
            const commonFolders = ['meshes', 'mesh', 'assets', 'models', 'visual', 'collision'];
            for (const folder of commonFolders) {
              meshes[`${folder}/${filename}`] = blob;
              meshes[`/${folder}/${filename}`] = blob;
            }
            
            if (import.meta.env.DEV) {
              console.log(`Mesh ${filename} registered with webkitRelativePath: "${relativePath}" (normalized: "${normalizedPath}")`);
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
      
      // Extract mesh references from URDF and check matches
      const urdfMeshReferences = extractMeshReferencesFromURDF(originalContent);
      
      // Check which STL files match URDF references
      const debugInfo: Array<{
        filename: string;
        webkitRelativePath: string;
        found: boolean;
        urdfReference?: string;
        registeredPaths: string[];
      }> = [];
      
      for (const file of stlFiles) {
        const fileWithPath = file as FileWithPath;
        const relativePath = fileWithPath.webkitRelativePath || file.name;
        const filename = file.name;
        
        // Get all registered paths for this file
        const fileBlob = meshes[filename];
        const registeredPaths = Object.keys(meshes).filter(key => meshes[key] === fileBlob);
        
        // Check if any URDF reference matches this file
        let found = false;
        let matchedReference: string | undefined;
        
        for (const urdfRef of urdfMeshReferences) {
          // Try to match URDF reference with registered paths
          // The URDF loader tries multiple variations, so we should check all of them
          const refFilename = urdfRef.split("/").pop() || urdfRef;
          const pathVariations = [
            urdfRef, // Full path as-is
            refFilename, // Just filename
            urdfRef.replace(/^.*?\//, ""), // Remove first folder
            urdfRef.replace(/^package:\/\/[^/]+\//, ""), // Remove ROS package prefix
          ];
          
          // Add URL decoded variations (handle errors)
          try {
            pathVariations.push(decodeURIComponent(urdfRef));
            pathVariations.push(decodeURIComponent(refFilename));
          } catch {
            // Ignore decode errors
          }
          
          // Normalize variations (remove leading/trailing slashes for comparison)
          const normalizedVariations = pathVariations
            .filter(Boolean)
            .map(v => v.replace(/^\/+|\/+$/g, ''));
          
          // Check if any registered path matches any variation
          const matchingPath = registeredPaths.find(p => {
            const normalizedPath = p.replace(/^\/+|\/+$/g, '');
            return normalizedVariations.some(v => 
              normalizedPath === v || 
              normalizedPath.endsWith('/' + v) || 
              normalizedPath === v.replace(/^\//, '')
            );
          });
          
          if (matchingPath) {
            found = true;
            matchedReference = urdfRef;
            break;
          }
        }
        
        debugInfo.push({
          filename,
          webkitRelativePath: relativePath,
          found,
          urdfReference: matchedReference,
          registeredPaths: registeredPaths.slice(0, 20), // Limit to first 20 paths
        });
      }
      
      // Check for URDF references that don't match any file
      const unmatchedRefs = urdfMeshReferences.filter(ref => {
        return !debugInfo.some(info => info.urdfReference === ref);
      });
      
      setDebugMeshInfo(debugInfo);
      setUnmatchedURDFRefs(unmatchedRefs);
      setShowDebugDialog(true);
      
      // Log mesh paths in development mode for debugging
      if (import.meta.env.DEV) {
        console.log(`Loaded ${stlFiles.length} mesh files with ${Object.keys(meshes).length} total path variations`);
        console.log(`URDF references: ${urdfMeshReferences.length} total, ${debugInfo.filter(m => m.found).length} matched, ${unmatchedRefs.length} unmatched`);
        if (unmatchedRefs.length > 0) {
          console.warn('Unmatched URDF references:', unmatchedRefs);
        }
        // Group paths by filename for clearer logging
        const pathsByFile = new Map<string, string[]>();
        for (const file of stlFiles) {
          const fileWithPath = file as FileWithPath;
          const relativePath = fileWithPath.webkitRelativePath || file.name;
          const pathsForFile = Object.keys(meshes).filter(key => {
            // Find all keys that point to this file's blob
            const fileBlob = meshes[file.name];
            return meshes[key] === fileBlob;
          });
          pathsByFile.set(file.name, pathsForFile);
        }
        pathsByFile.forEach((paths, filename) => {
          console.log(`  ${filename}: ${paths.length} path variations`);
          console.log(`    Primary: ${paths[0] || 'N/A'}`);
          if (paths.length > 1) {
            console.log(`    Others: ${paths.slice(1, 10).join(', ')}${paths.length > 10 ? '...' : ''}`);
          }
        });
      }
      
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


  const handleVizUrdfChange = useCallback((newContent: string): void => {
    updateUrdfFile(newContent);
    toast.success("Viz URDF updated from manual edit");
  }, [updateUrdfFile]);

  const handleJointAxisChange = useCallback((jointName: string, axis: [number, number, number]): void => {
    if (!vizUrdfContent) {
      toast.error("No URDF content available");
      return;
    }

    // Update the URDF content immediately
    const updatedContent = updateJointAxisInURDF(vizUrdfContent, jointName, axis);
    
    // Immediately update all state synchronously for consistency with other handlers
    // This ensures immediate UI updates without deferred transitions that could cause conflicts
    setVizUrdfContent(updatedContent);
    const limits = parseJointLimitsFromURDF(updatedContent);
    setJointLimits(limits);
    const axes = parseJointAxesFromURDF(updatedContent);
    setJointAxes(axes);
    setUrdfFile(createUrdfFile(updatedContent));
    setUrdfContentVersion(prev => prev + 1); // Force reload of 3D viewer and sidebar
    
    toast.success(`Updated axis for joint "${jointName}"`);
  }, [vizUrdfContent, createUrdfFile]);

  const handleResetAxis = useCallback((jointName: string): void => {
    if (!originalJointAxes[jointName]) {
      toast.error(`No original axis found for joint "${jointName}"`);
      return;
    }

    const originalAxis = originalJointAxes[jointName].xyz;
    handleJointAxisChange(jointName, originalAxis);
  }, [originalJointAxes, handleJointAxisChange]);

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

  const handleJointNameChange = useCallback((oldName: string, newName: string): void => {
    if (!vizUrdfContent) {
      toast.error("No URDF content available");
      return;
    }
    const updatedContent = updateJointNameInURDF(vizUrdfContent, oldName, newName);
    if (updatedContent === vizUrdfContent) {
      toast.error(`Failed to rename joint "${oldName}" to "${newName}". The name may already exist or be invalid.`);
      return;
    }
    updateUrdfFile(updatedContent);

    // Update availableJoints to reflect the new name
    setAvailableJoints(prev => prev.map(name => name === oldName ? newName : name));

    // Update selected joint if it was the one renamed
    if (selectedJoint === oldName) {
      setSelectedJoint(newName);
    }

    toast.success(`Renamed joint "${oldName}" to "${newName}"`);
  }, [vizUrdfContent, updateUrdfFile, selectedJoint]);

  const handleResetRotation = useCallback((): void => {
    if (!originalVizUrdfContent) {
      toast.error("No original URDF content found");
      return;
    }

    updateUrdfFile(originalVizUrdfContent);
    toast.success("Reset robot rotation to original position");
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

  const getExportUrdfContent = useCallback((): string => {
    if (!vizUrdfContent) return "";
    return deleteJointsFromURDF(vizUrdfContent, deletedJoints);
  }, [vizUrdfContent, deleteJointsFromURDF, deletedJoints]);

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
            onVizUrdfChange={handleVizUrdfChange}
            onJointAxisChange={handleJointAxisChange}
            onResetAxis={handleResetAxis}
            onJointTypeChange={handleJointTypeChange}
            onJointNameChange={handleJointNameChange}
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
            rotationPlaneVisible={rotationPlaneVisible}
            onRotationPlaneVisibilityChange={setRotationPlaneVisible}
            onFrameChange={setCurrentFrame}
            onUrdfEditorToggle={setShowUrdfEditor}
            showUrdfEditor={showUrdfEditor}
            viewerSplitView={viewerSplitView}
            onViewerSplitViewChange={setViewerSplitView}
            onViewerEpisodeChange={setViewerEpisode}
            onViewerOpenChange={setIsViewerOpen}
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
            <div className="flex-1 min-h-0 relative">
              {viewerSplitView && isViewerOpen && viewerEpisode ? (
                <div className="flex flex-col h-full">
                  {/* Visualizer in top half */}
                  <div className="flex-1 min-h-0 border-b border-border/20">
                    <Viewer3D
                      key={`urdf-${urdfContentVersion}`}
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
                      rotationPlaneVisible={rotationPlaneVisible}
                    />
                  </div>
                  {/* Viewer in bottom half */}
                  <div className="flex-1 min-h-0">
                    <EpisodeViewer3DModal
                      episode={viewerEpisode}
                      open={isViewerOpen}
                      onOpenChange={(open) => {
                        setIsViewerOpen(open);
                        if (!open) {
                          // Clear the episode first to signal we're closing (not toggling)
                          setViewerEpisode(null);
                          // Then close split view - Sidebar will check if episode is null
                          setViewerSplitView(false);
                        }
                      }}
                      inline={true}
                      onToggleViewMode={() => {
                        // Switch from split view to floating window
                        // The episode is already set via onViewerEpisodeChange
                        setViewerSplitView(false);
                        setIsViewerOpen(false);
                      }}
                      globalCurrentFrame={currentFrame}
                      onSetGlobalFrame={(frame: number) => {
                        (window as any).viewer3dSetFrame?.(frame);
                        setCurrentFrame(frame);
                      }}
                    />
                  </div>
                </div>
              ) : viewerSplitView && isViewerOpen && !viewerEpisode ? (
                <div className="flex flex-col h-full">
                  {/* Visualizer in top half */}
                  <div className="flex-1 min-h-0 border-b border-border/20">
                    <Viewer3D
                      key={`urdf-${urdfContentVersion}`}
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
                      rotationPlaneVisible={rotationPlaneVisible}
                    />
                  </div>
                  {/* Message in bottom half when no episodes */}
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
                </div>
              ) : showUrdfEditor && urdfEditorSplitView ? (
                <div className="flex flex-col h-full">
                  {/* Simulation in top half */}
                  <div className="flex-1 min-h-0 border-b border-border/20">
                    <Viewer3D
                      key={`urdf-${urdfContentVersion}`}
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
                      rotationPlaneVisible={rotationPlaneVisible}
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
                      githubToken={typeof window !== "undefined" && import.meta.env.VITE_GITHUB_TOKEN ? import.meta.env.VITE_GITHUB_TOKEN : null}
                      inline={true}
                      splitView={true}
                      onSplitViewToggle={setUrdfEditorSplitView}
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
                  githubToken={typeof window !== "undefined" && import.meta.env.VITE_GITHUB_TOKEN ? import.meta.env.VITE_GITHUB_TOKEN : null}
                  inline={true}
                  splitView={false}
                  onSplitViewToggle={setUrdfEditorSplitView}
                />
              ) : (
                <Viewer3D
                  key={`urdf-${urdfContentVersion}`}
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
                  rotationPlaneVisible={rotationPlaneVisible}
                />
              )}
            </div>
          </main>
        </>
      )}
      
      {/* Mesh Files Status Panel - Bottom Right */}
      {showDebugDialog && (
        <div className="fixed bottom-4 right-4 z-50 w-80 max-h-[40vh] bg-[#282828] border border-[#3d3d3d] rounded-lg shadow-lg flex flex-col">
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
    </div>
  );
};

export default Index;
