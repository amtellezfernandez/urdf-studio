import type React from "react";
import { useState, useCallback, useMemo, startTransition } from "react";
import { Sidebar, DEFAULT_SIDEBAR_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } from "@/components/Sidebar";
import { JointListSidebar, DEFAULT_RIGHT_SIDEBAR_WIDTH, RIGHT_SIDEBAR_MIN_WIDTH, RIGHT_SIDEBAR_MAX_WIDTH } from "@/components/JointListSidebar";
import { Viewer3D } from "@/components/Viewer3D";
import type { CollisionVisibility } from "@/components/LinkEditor";
import { URDFComparison } from "@/components/URDFComparison";
import { FolderUploadScreen } from "@/components/FolderUploadScreen";
import { EpisodeViewer3DModal } from "@/components/EpisodeViewer3DModal";
import { ExportDialog } from "@/components/ExportDialog";
import { useGPUMode } from "@/hooks/use-gpu-mode";
import { toast } from "sonner";
import { createVizFilename } from "@/urdf_corrections/addJointColors";
import { parseJointLimitsFromURDF, type JointLimits } from "@/urdf_corrections/parseJointLimits";
import { parseJointAxesFromURDF, type JointAxisMap } from "@/urdf_corrections/parseJointAxis";
import { updateJointAxisInURDF } from "@/urdf_corrections/updateJointAxis";
import { updateJointTypeInURDF } from "@/urdf_corrections/updateJointType";
import { updateJointNameInURDF } from "@/urdf_corrections/updateJointName";
import { rotateRobot90Degrees } from "@/urdf_corrections/rotateRobot";
import { canonicalOrderURDF } from "@/urdf_corrections/canonicalOrdering";
import { prettyPrintURDF } from "@/urdf_corrections/prettyPrintURDF";
import { normalizeJointAxes } from "@/urdf_corrections/normalizeJointAxes";
import { fixMeshPaths } from "@/urdf_corrections/fixMeshPaths";
import { parseURDF } from "@/urdf_corrections/urdfParser";
import { useTheme } from "@/hooks/use-theme";
import { useJointStore } from "@/store/useJointStore";
import type { FileWithPath } from "@/types/file";
import { ChevronsRight, CheckCircle2, XCircle, AlertCircle, X } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
const VIEWER_RESIZER_HEIGHT = 4;
const DEFAULT_RECORDING_VIEW_HEIGHT = 0.4; // 40% of available height

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
  const [savedVizUrdfContent, setSavedVizUrdfContent] = useState<string>("");
  const [deletedJoints, setDeletedJoints] = useState<Set<string>>(new Set());
  const [urdfContentVersion, setUrdfContentVersion] = useState<number>(0);
  const [motionDataFile, setMotionDataFile] = useState<File | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasAnimationFrames, setHasAnimationFrames] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(DEFAULT_RIGHT_SIDEBAR_WIDTH);
  const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(false);
  const [collisionVisibility, setCollisionVisibility] = useState<CollisionVisibility>({});
  const [rotationPlaneVisible, setRotationPlaneVisible] = useState<boolean>(false);
  const [showUrdfEditor, setShowUrdfEditor] = useState<boolean>(false);
  const [urdfViewMode, setUrdfViewMode] = useState<"original" | "modified" | "split">("split");
  const [showExportDialog, setShowExportDialog] = useState<boolean>(false);
  const [rotationAxis, setRotationAxis] = useState<"x" | "y" | "z">("z");
  const [urdfEditorSplitView, setUrdfEditorSplitView] = useState<boolean>(false);
  const [viewerSplitView, setViewerSplitView] = useState<boolean>(false);
  const [viewerEpisode, setViewerEpisode] = useState<any | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState<boolean>(false);
  const [recordingViewHeight, setRecordingViewHeight] = useState<number>(DEFAULT_RECORDING_VIEW_HEIGHT);
  const [episodeSaveHandler, setEpisodeSaveHandler] = useState<((episode: any, saveAsNew: boolean, newName?: string) => void) | undefined>(undefined);
  const [showDebugDialog, setShowDebugDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<"joints" | "recording">("joints");
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
      setSavedVizUrdfContent(originalContent);
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
    toast.success("Reset to original loaded file");
  }, [originalVizUrdfContent, updateUrdfFile]);

  const handleSave = useCallback((): void => {
    if (!vizUrdfContent) {
      toast.error("No URDF content to save");
      return;
    }

    setSavedVizUrdfContent(vizUrdfContent);
    toast.success("Changes saved");
  }, [vizUrdfContent]);

  const handleRevert = useCallback((): void => {
    if (!savedVizUrdfContent) {
      toast.error("No saved URDF content found");
      return;
    }

    updateUrdfFile(savedVizUrdfContent);
    toast.success("Reverted to last saved file");
  }, [savedVizUrdfContent, updateUrdfFile]);

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
    const result = canonicalOrderURDF(vizUrdfContent);
    handleVizUrdfChange(result);
    toast.success("URDF elements reordered to canonical format");
  }, [vizUrdfContent, handleVizUrdfChange]);

  const handlePrettyPrint = useCallback(() => {
    if (!vizUrdfContent) return;
    const result = prettyPrintURDF(vizUrdfContent);
    handleVizUrdfChange(result);
    toast.success("URDF formatted with consistent indentation");
  }, [vizUrdfContent, handleVizUrdfChange]);

  const handleNormalizeAxes = useCallback(() => {
    if (!vizUrdfContent) return;
    const result = normalizeJointAxes(vizUrdfContent);
    handleVizUrdfChange(result.urdfContent);

    if (result.errors.length > 0) {
      toast.warning(`Normalized axes with ${result.errors.length} error(s) fixed`);
      result.errors.forEach(err => {
        console.warn(`Joint "${err.jointName}" (${err.jointType}): ${err.issue}`);
      });
    } else if (result.corrections.length > 0) {
      toast.success(`Normalized ${result.corrections.length} joint axis(es)`);
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
        console.info(`Fixed path: "${correction.oldPath}" -> "${correction.newPath}"`);
      });
    } else {
      toast.info("All mesh paths are already correct");
    }
  }, [vizUrdfContent, handleVizUrdfChange]);

  const getExportUrdfContent = useCallback((): string => {
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

  const clampRightSidebarWidth = useCallback(
    (width: number) => Math.min(RIGHT_SIDEBAR_MAX_WIDTH, Math.max(RIGHT_SIDEBAR_MIN_WIDTH, width)),
    []
  );

  const handleRightSidebarResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const startWidth = rightSidebarWidth;
      const originalCursor = document.body.style.cursor;
      const originalUserSelect = document.body.style.userSelect;

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        // For right sidebar, dragging left should increase width, dragging right should decrease
        const delta = startX - moveEvent.clientX;
        const nextWidth = clampRightSidebarWidth(startWidth + delta);
        setRightSidebarWidth(nextWidth);
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
    [rightSidebarWidth, clampRightSidebarWidth]
  );

  const clampRecordingViewHeight = useCallback(
    (height: number, containerHeight: number) => {
      // Minimum height to always show the header (approximately 50px)
      const MIN_HEADER_HEIGHT = 50;
      const minRatio = containerHeight > 0 ? MIN_HEADER_HEIGHT / containerHeight : 0.08;
      return Math.min(0.95, Math.max(minRatio, height));
    },
    []
  );

  const handleViewerResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const startY = event.clientY;
      const container = event.currentTarget.closest('.flex.flex-col.h-full') as HTMLElement;
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
        // Dragging up (negative delta) should make recording view smaller
        // Dragging down (positive delta) should make recording view bigger
        const nextHeight = clampRecordingViewHeight(startHeight - deltaRatio, containerHeight);
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
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "joints" | "recording")}>
              <TabsList className="h-5 bg-transparent gap-0 p-0">
                <TabsTrigger 
                  value="joints" 
                  className="h-5 px-2.5 text-[11px] font-normal text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d] data-[state=active]:bg-[#3d3d3d] data-[state=active]:text-white rounded-none border-l border-[#3d3d3d] flex items-center transition-none ml-1"
                >
                  Editor
                </TabsTrigger>
                <TabsTrigger 
                  value="recording" 
                  className="h-5 px-2.5 text-[11px] font-normal text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d] data-[state=active]:bg-[#3d3d3d] data-[state=active]:text-white rounded-none border-r border-[#3d3d3d] flex items-center transition-none"
                >
                  Recording
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {originalUrdfContent && vizUrdfContent && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="h-5 px-2.5 text-[11px] font-normal text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d] rounded-none border-l border-[#3d3d3d] flex items-center transition-none ml-1">
                    View
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48 bg-[#282828] border-[#3d3d3d]">
                  <DropdownMenuItem
                    onClick={() => setShowUrdfEditor(false)}
                    className={cn(
                      "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                      !showUrdfEditor && "bg-[#3d3d3d] text-white"
                    )}
                  >
                    3D Visualization
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
            viewerOpen={isViewerOpen}
            onEpisodeSaveReady={(handler) => {
              // Receive save handler from Sidebar and store it
              setEpisodeSaveHandler(() => handler);
            }}
            activeTab={activeTab}
            onTabChange={(tab) => {
              setActiveTab(tab);
              // Handle tab change logic
              if (tab === "joints") {
                setIsViewerOpen(false);
              }
              if (tab === "recording") {
                setShowUrdfEditor(false);
                setViewerSplitView(true);
                setIsViewerOpen(true);
              }
            }}
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
                            (window as any).viewer3dSetFrame?.(frame);
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
            jointLimits={jointLimits}
            selectedJoint={selectedJoint}
            onJointSelect={setSelectedJoint}
            deletedJoints={deletedJoints}
            width={rightSidebarWidth}
            isCollapsed={isRightSidebarCollapsed}
            urdfContent={vizUrdfContent}
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
      {/* Export Dialog */}
      {showUrdfEditor && (
        <ExportDialog
          isOpen={showExportDialog}
          onClose={() => setShowExportDialog(false)}
          urdfContent={getExportUrdfContent()}
          meshFiles={meshFiles}
          githubToken={typeof window !== "undefined" && import.meta.env.VITE_GITHUB_TOKEN ? import.meta.env.VITE_GITHUB_TOKEN : null}
          robotName={robotName}
        />
      )}
    </div>
  );
};

export default Index;
