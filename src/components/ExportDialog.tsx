import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Download,
  X,
  Github,
  Package,
  Loader2,
  Folder,
  FolderOpen,
  File,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { convertURDFToMJCF, convertURDFToXacro, extractMeshReferencesFromURDF, fetchRepoContents } from "@/features/urdf";
import { BlenderPanel, BlenderPropertyRow } from "@/components/ui/blender-panel";
import { cn } from "@/lib/utils";
import { useCameraStore } from "@/store/useCameraStore";
import { exportCamerasToJSON, exportCamerasToYAML } from "@/features/camera";

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  urdfContent: string;
  originalUrdfContent?: string;
  meshFiles?: Record<string, Blob>;
  githubToken?: string | null;
  robotName?: string;
}

interface GitHubRepo {
  owner: string;
  name: string;
  fullName: string;
  isOrg: boolean;
}

export const ExportDialog = ({
  isOpen,
  onClose,
  urdfContent,
  originalUrdfContent,
  meshFiles = {},
  githubToken,
  robotName = "robot",
}: ExportDialogProps) => {
  const cameras = useCameraStore((state) => state.cameras);
  const hasCameras = cameras.length > 0;
  const [isExporting, setIsExporting] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [selectedGitHubRepo, setSelectedGitHubRepo] = useState<string>("");
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  
  // Destination selection: "local" or "github"
  const [destinationType, setDestinationType] = useState<"local" | "github">("local");
  
  // Local folder options
  const [useSubfolder, setUseSubfolder] = useState(false);
  const [subfolderName, setSubfolderName] = useState("");
  
  // GitHub folder options
  const [githubFolders, setGithubFolders] = useState<string[]>([]);
  const [selectedGitHubFolder, setSelectedGitHubFolder] = useState<string>("");
  const [useNewGitHubFolder, setUseNewGitHubFolder] = useState(true);
  const [newGitHubFolderName, setNewGitHubFolderName] = useState("");
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);

  // Format selections
  const [formatSelections, setFormatSelections] = useState({
    urdf: true,
    xacro: false,
    mujoco: false,
    meshes: true,
    cameraJson: false,
    cameraYaml: false,
  });

  // Robot File Version selection: allow both current AND/OR original
  const [exportCurrent, setExportCurrent] = useState(true);
  const [exportOriginal, setExportOriginal] = useState(false);

  // Base names for files (user can edit)
  const [currentBaseName, setCurrentBaseName] = useState(robotName);
  const [originalBaseName, setOriginalBaseName] = useState("");
  const [cameraConfigBaseName, setCameraConfigBaseName] = useState("");
  const defaultCameraBaseName = useMemo(() => {
    const trimmedCurrent = currentBaseName.trim();
    const trimmedRobot = robotName.trim();
    const base = (trimmedCurrent || trimmedRobot || "robot").replace(/\s+/g, "_");
    return `${base}_cameras`;
  }, [currentBaseName, robotName]);
  const cameraFilenameBase = useMemo(() => {
    const trimmed = cameraConfigBaseName.trim();
    return trimmed || defaultCameraBaseName || "camera_config";
  }, [cameraConfigBaseName, defaultCameraBaseName]);

  // Extract version number from name (e.g., "robot_v4" -> { base: "robot", version: 4 })
  const extractVersion = (name: string): { base: string; version: number | null } => {
    const match = name.match(/^(.+?)_v(\d+)$/);
    if (match) {
      return { base: match[1], version: parseInt(match[2], 10) };
    }
    return { base: name, version: null };
  };

  // Generate versioned name
  const makeVersionedName = (base: string, version: number | null): string => {
    if (version !== null) {
      return `${base}_v${version}`;
    }
    return base;
  };

  // Update base names when robotName changes or dialog opens
  useEffect(() => {
    if (isOpen) {
      const { base, version } = extractVersion(robotName);

      if (version !== null) {
        // If loaded file has version (e.g., _v4), propose _v4 for original and _v5 for current
        setOriginalBaseName(makeVersionedName(base, version));
        setCurrentBaseName(makeVersionedName(base, version + 1));
      } else {
        // If no version, propose v1 for original and v2 for current
        setOriginalBaseName(makeVersionedName(base, 1));
        setCurrentBaseName(makeVersionedName(base, 2));
      }
    }
  }, [robotName, isOpen]);

  useEffect(() => {
    if (isOpen && hasCameras && cameraConfigBaseName.trim() === "") {
      setCameraConfigBaseName(defaultCameraBaseName);
    }
  }, [isOpen, hasCameras, cameraConfigBaseName, defaultCameraBaseName]);

  useEffect(() => {
    if (!hasCameras && cameraConfigBaseName !== "") {
      setCameraConfigBaseName("");
    }
  }, [hasCameras, cameraConfigBaseName]);

  useEffect(() => {
    if (!hasCameras) {
      setFormatSelections((prev) => {
        if (!prev.cameraJson && !prev.cameraYaml) {
          return prev;
        }
        return { ...prev, cameraJson: false, cameraYaml: false };
      });
    }
  }, [hasCameras]);

  // Fetch GitHub repositories when dialog opens and token is available
  useEffect(() => {
    if (isOpen && githubToken) {
      fetchGitHubRepos();
    }
  }, [isOpen, githubToken]);

  // Fetch GitHub folders when repository is selected
  useEffect(() => {
    if (selectedGitHubRepo && githubToken) {
      fetchGitHubFolders();
      // Reset folder selection when repo changes
      setSelectedGitHubFolder("");
      setUseNewGitHubFolder(true);
      setNewGitHubFolderName("");
    } else {
      setGithubFolders([]);
      setSelectedGitHubFolder("");
      setUseNewGitHubFolder(true);
      setNewGitHubFolderName("");
    }
  }, [selectedGitHubRepo, githubToken]);

  // Update subfolder name when robot name changes
  useEffect(() => {
    if (isOpen && !subfolderName) {
      setSubfolderName(currentBaseName);
    }
  }, [isOpen, currentBaseName]);

  const fetchGitHubRepos = async () => {
    if (!githubToken) return;
    
    setIsLoadingRepos(true);
    try {
      // Fetch user repos
      const userReposResponse = await fetch("https://api.github.com/user/repos?per_page=100&affiliation=owner", {
        headers: {
          Authorization: `token ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (!userReposResponse.ok) {
        throw new Error("Failed to fetch user repositories");
      }

      const userRepos: any[] = await userReposResponse.json();
      
      // Fetch organizations
      const orgsResponse = await fetch("https://api.github.com/user/orgs", {
        headers: {
          Authorization: `token ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      const orgs: any[] = orgsResponse.ok ? await orgsResponse.json() : [];
      
      // Fetch repos for each organization
      const orgReposPromises = orgs.map(async (org) => {
        const response = await fetch(`https://api.github.com/orgs/${org.login}/repos?per_page=100`, {
          headers: {
            Authorization: `token ${githubToken}`,
            Accept: "application/vnd.github.v3+json",
          },
        });
        if (response.ok) {
          const repos: any[] = await response.json();
          return repos.map((repo) => ({
            owner: org.login,
            name: repo.name,
            fullName: `${org.login}/${repo.name}`,
            isOrg: true,
          }));
        }
        return [];
      });

      const orgReposArrays = await Promise.all(orgReposPromises);
      const orgRepos = orgReposArrays.flat();

      // Combine user and org repos
      const allRepos: GitHubRepo[] = [
        ...userRepos.map((repo) => ({
          owner: repo.owner.login,
          name: repo.name,
          fullName: repo.full_name,
          isOrg: false,
        })),
        ...orgRepos,
      ];

      setGithubRepos(allRepos);
    } catch (error) {
      console.error("Failed to fetch GitHub repositories:", error);
      toast.error("Failed to load GitHub repositories");
    } finally {
      setIsLoadingRepos(false);
    }
  };

  const fetchGitHubFolders = async () => {
    if (!selectedGitHubRepo || !githubToken) {
      setGithubFolders([]);
      return;
    }
    
    setIsLoadingFolders(true);
    try {
      const [owner, repo] = selectedGitHubRepo.split("/");
      if (!owner || !repo) {
        throw new Error("Invalid repository format");
      }
      
      const files = await fetchRepoContents(owner, repo, "", githubToken);
      
      // Extract unique folder paths (directories only)
      const folders = new Set<string>();
      files.forEach((file) => {
        if (file.type === "dir") {
          folders.add(file.path);
        } else {
          // Also extract parent directories from file paths
          const pathParts = file.path.split("/");
          if (pathParts.length > 1) {
            // Add parent directories
            for (let i = 1; i < pathParts.length; i++) {
              folders.add(pathParts.slice(0, i).join("/"));
            }
          }
        }
      });
      
      const sortedFolders = Array.from(folders).sort();
      setGithubFolders(sortedFolders);
    } catch (error) {
      console.error("Failed to fetch GitHub folders:", error);
      toast.error("Failed to load repository folders");
      setGithubFolders([]);
    } finally {
      setIsLoadingFolders(false);
    }
  };

  const handleSelectFolder = async () => {
    try {
      // Check if File System Access API is supported
      if (!("showDirectoryPicker" in window)) {
        toast.error("Folder selection is not supported in this browser. Please use a modern browser.");
        return;
      }

      const directoryHandle = await (window as any).showDirectoryPicker({
        mode: "readwrite",
      });
      setSelectedFolder(directoryHandle);
      toast.success("Folder selected");
    } catch (error: any) {
      if (error.name !== "AbortError") {
        console.error("Error selecting folder:", error);
        toast.error("Failed to select folder");
      }
    }
  };

  // Match URDF mesh reference to actual file in meshFiles
  const findMeshFileForReference = (meshRef: string, meshFiles: Record<string, Blob>): { path: string; blob: Blob } | null => {
    // Normalize the reference
    const normalized = meshRef
      .replace(/^package:\/\/[^/]+\//, "")
      .replace(/^file:\/\//, "")
      .trim();
    
    const filename = normalized.split("/").pop() || normalized;
    
    // Try multiple path variations
    const pathVariations = [
      normalized, // Full path as-is
      filename, // Just filename
      normalized.replace(/^.*?\//, ""), // Remove first folder
      `meshes/${filename}`, // Common mesh folder
      `assets/${filename}`, // Assets folder
      `/meshes/${filename}`, // With leading slash
      `/assets/${filename}`, // With leading slash
    ];

    // Also try URL decoded variations
    try {
      pathVariations.push(decodeURIComponent(normalized));
      pathVariations.push(decodeURIComponent(filename));
    } catch {
      // Ignore decode errors
    }

    // Try to find matching file
    for (const variant of pathVariations) {
      if (meshFiles[variant]) {
        return { path: variant, blob: meshFiles[variant] };
      }
    }

    // Try case-insensitive match by filename
    const lowerFilename = filename.toLowerCase();
    for (const [path, blob] of Object.entries(meshFiles)) {
      const pathFilename = path.split("/").pop() || path;
      if (pathFilename.toLowerCase() === lowerFilename && pathFilename.toLowerCase().endsWith(".stl")) {
        return { path, blob };
      }
    }

    return null;
  };

  // Get meshes actually referenced in the URDF content(s) being exported
  const getReferencedMeshes = useMemo(() => {
    const referencedMeshes = new Map<string, { path: string; blob: Blob }>();
    
    // Extract mesh references from current URDF if exporting current
    if (exportCurrent) {
      const meshRefs = extractMeshReferencesFromURDF(urdfContent);
      for (const meshRef of meshRefs) {
        const match = findMeshFileForReference(meshRef, meshFiles);
        if (match && !referencedMeshes.has(match.path)) {
          referencedMeshes.set(match.path, match);
        }
      }
    }

    // Extract mesh references from original URDF if exporting original
    if (exportOriginal && originalUrdfContent) {
      const meshRefs = extractMeshReferencesFromURDF(originalUrdfContent);
      for (const meshRef of meshRefs) {
        const match = findMeshFileForReference(meshRef, meshFiles);
        if (match && !referencedMeshes.has(match.path)) {
          referencedMeshes.set(match.path, match);
        }
      }
    }

    return Array.from(referencedMeshes.values());
  }, [exportCurrent, exportOriginal, urdfContent, originalUrdfContent, meshFiles]);

  // Generate local folder structure preview
  const localPreview = useMemo(() => {
    const structure: Array<{ path: string; name: string; type: "file" | "folder" }> = [];
    
    // Determine base path prefix for local
    let basePath = "";
    if (selectedFolder && useSubfolder && subfolderName) {
      basePath = `${subfolderName}/`;
    }
    
    if (exportCurrent) {
      if (formatSelections.urdf) {
        structure.push({ path: `${basePath}${currentBaseName}.urdf`, name: `${currentBaseName}.urdf`, type: "file" });
      }
      if (formatSelections.xacro) {
        structure.push({ path: `${basePath}${currentBaseName}.urdf.xacro`, name: `${currentBaseName}.urdf.xacro`, type: "file" });
      }
      if (formatSelections.mujoco) {
        structure.push({ path: `${basePath}${currentBaseName}.xml`, name: `${currentBaseName}.xml`, type: "file" });
      }
    }

    if (exportOriginal && originalUrdfContent) {
      if (formatSelections.urdf) {
        structure.push({ path: `${basePath}${originalBaseName}.urdf`, name: `${originalBaseName}.urdf`, type: "file" });
      }
      if (formatSelections.xacro) {
        structure.push({ path: `${basePath}${originalBaseName}.urdf.xacro`, name: `${originalBaseName}.urdf.xacro`, type: "file" });
      }
      if (formatSelections.mujoco) {
        structure.push({ path: `${basePath}${originalBaseName}.xml`, name: `${originalBaseName}.xml`, type: "file" });
      }
    }

    if (hasCameras) {
      if (formatSelections.cameraJson) {
        structure.push({
          path: `${basePath}${cameraFilenameBase}.json`,
          name: `${cameraFilenameBase}.json`,
          type: "file",
        });
      }
      if (formatSelections.cameraYaml) {
        structure.push({
          path: `${basePath}${cameraFilenameBase}.yaml`,
          name: `${cameraFilenameBase}.yaml`,
          type: "file",
        });
      }
    }

    if (formatSelections.meshes && getReferencedMeshes.length > 0) {
      structure.push({ path: `${basePath}meshes/`, name: "meshes/", type: "folder" });
      // Show first few mesh files as preview
      const meshKeys = getReferencedMeshes.slice(0, 3);
      meshKeys.forEach((mesh) => {
        const filename = mesh.path.split("/").pop() || mesh.path;
        structure.push({ path: `${basePath}meshes/${filename}`, name: filename, type: "file" });
      });
      if (getReferencedMeshes.length > 3) {
        structure.push({ path: `${basePath}meshes/...`, name: `... (+${getReferencedMeshes.length - 3} more)`, type: "file" });
      }
    }

    return structure;
  }, [exportCurrent, exportOriginal, formatSelections, currentBaseName, originalBaseName, getReferencedMeshes, selectedFolder, useSubfolder, subfolderName, hasCameras, cameraFilenameBase]);

  // Generate GitHub folder structure preview
  const githubPreview = useMemo(() => {
    if (!selectedGitHubRepo) return [];
    
    const structure: Array<{ path: string; name: string; type: "file" | "folder" }> = [];
    
    // Determine base path prefix for GitHub
    let basePath = "";
    if (useNewGitHubFolder && newGitHubFolderName) {
      basePath = `${newGitHubFolderName}/`;
    } else if (!useNewGitHubFolder) {
      // selectedGitHubFolder can be "" for root, which is valid
      basePath = selectedGitHubFolder ? `${selectedGitHubFolder}/` : "";
    }
    
    if (exportCurrent) {
      if (formatSelections.urdf) {
        structure.push({ path: `${basePath}${currentBaseName}.urdf`, name: `${currentBaseName}.urdf`, type: "file" });
      }
      if (formatSelections.xacro) {
        structure.push({ path: `${basePath}${currentBaseName}.urdf.xacro`, name: `${currentBaseName}.urdf.xacro`, type: "file" });
      }
      if (formatSelections.mujoco) {
        structure.push({ path: `${basePath}${currentBaseName}.xml`, name: `${currentBaseName}.xml`, type: "file" });
      }
    }

    if (exportOriginal && originalUrdfContent) {
      if (formatSelections.urdf) {
        structure.push({ path: `${basePath}${originalBaseName}.urdf`, name: `${originalBaseName}.urdf`, type: "file" });
      }
      if (formatSelections.xacro) {
        structure.push({ path: `${basePath}${originalBaseName}.urdf.xacro`, name: `${originalBaseName}.urdf.xacro`, type: "file" });
      }
      if (formatSelections.mujoco) {
        structure.push({ path: `${basePath}${originalBaseName}.xml`, name: `${originalBaseName}.xml`, type: "file" });
      }
    }

    if (hasCameras) {
      if (formatSelections.cameraJson) {
        structure.push({ path: `${basePath}${cameraFilenameBase}.json`, name: `${cameraFilenameBase}.json`, type: "file" });
      }
      if (formatSelections.cameraYaml) {
        structure.push({ path: `${basePath}${cameraFilenameBase}.yaml`, name: `${cameraFilenameBase}.yaml`, type: "file" });
      }
    }

    if (formatSelections.meshes && getReferencedMeshes.length > 0) {
      structure.push({ path: `${basePath}meshes/`, name: "meshes/", type: "folder" });
      // Show first few mesh files as preview
      const meshKeys = getReferencedMeshes.slice(0, 3);
      meshKeys.forEach((mesh) => {
        const filename = mesh.path.split("/").pop() || mesh.path;
        structure.push({ path: `${basePath}meshes/${filename}`, name: filename, type: "file" });
      });
      if (getReferencedMeshes.length > 3) {
        structure.push({ path: `${basePath}meshes/...`, name: `... (+${getReferencedMeshes.length - 3} more)`, type: "file" });
      }
    }

    return structure;
  }, [exportCurrent, exportOriginal, formatSelections, currentBaseName, originalBaseName, getReferencedMeshes, selectedGitHubRepo, useNewGitHubFolder, newGitHubFolderName, selectedGitHubFolder, hasCameras, cameraFilenameBase]);

  const downloadFile = async (
    content: string | Blob,
    filename: string,
    folderHandle?: FileSystemDirectoryHandle,
    useSubfolder?: boolean,
    subfolderName?: string,
    mimeType = "application/xml"
  ) => {
    if (folderHandle) {
      // Save to selected folder using File System Access API
      try {
        let targetFolder = folderHandle;
        
        // Create subfolder if requested
        if (useSubfolder && subfolderName) {
          targetFolder = await folderHandle.getDirectoryHandle(subfolderName, { create: true });
        }
        
        const fileHandle = await targetFolder.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
      } catch (error) {
        console.error("Error writing file:", error);
        toast.error(`Failed to save ${filename}`);
        throw error;
      }
    } else {
      // Fallback to browser download
      const blob = typeof content === "string" ? new Blob([content], { type: mimeType }) : content;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleExport = async (method: "download" | "github") => {
    const selectedFormats = Object.entries(formatSelections)
      .filter(([_, selected]) => selected)
      .map(([format]) => format);

    if (selectedFormats.length === 0) {
      toast.error("Please select at least one file type to export");
      return;
    }

    if (!exportCurrent && !exportOriginal) {
      toast.error("Please select at least one Robot File Version to export");
      return;
    }

    if (method === "github" && !githubToken) {
      toast.error("GitHub token is required for GitHub export");
      return;
    }

    if (method === "github" && !selectedGitHubRepo) {
      toast.error("Please select a GitHub repository");
      return;
    }

    setIsExporting(true);

    try {
      const exportedFiles: string[] = [];

      // Determine target folder path for GitHub
      const githubFolderPath = method === "github" 
        ? (useNewGitHubFolder 
            ? (newGitHubFolderName || "")
            : (selectedGitHubFolder || ""))
        : "";

      // Export current version if selected
      if (exportCurrent) {
        if (formatSelections.urdf) {
          const filename = `${currentBaseName}.urdf`;
          if (method === "download") {
            await downloadFile(urdfContent, filename, selectedFolder || undefined, useSubfolder, subfolderName);
          }
          exportedFiles.push(filename);
        }

        if (formatSelections.xacro) {
          const xacroResult = convertURDFToXacro(urdfContent);
          const filename = `${currentBaseName}.urdf.xacro`;
          if (method === "download") {
            await downloadFile(xacroResult.xacroContent, filename, selectedFolder || undefined, useSubfolder, subfolderName);
          }
          exportedFiles.push(filename);
        }

        if (formatSelections.mujoco) {
          const mjcfResult = convertURDFToMJCF(urdfContent);
          const filename = `${currentBaseName}.xml`;
          if (method === "download") {
            await downloadFile(mjcfResult.mjcfContent, filename, selectedFolder || undefined, useSubfolder, subfolderName);
          }
          exportedFiles.push(filename);
        }
      }

      // Export original version if selected
      if (exportOriginal && originalUrdfContent) {
        if (formatSelections.urdf) {
          const filename = `${originalBaseName}.urdf`;
          if (method === "download") {
            await downloadFile(originalUrdfContent, filename, selectedFolder || undefined, useSubfolder, subfolderName);
          }
          exportedFiles.push(filename);
        }

        if (formatSelections.xacro) {
          const xacroResult = convertURDFToXacro(originalUrdfContent);
          const filename = `${originalBaseName}.urdf.xacro`;
          if (method === "download") {
            await downloadFile(xacroResult.xacroContent, filename, selectedFolder || undefined, useSubfolder, subfolderName);
          }
          exportedFiles.push(filename);
        }

        if (formatSelections.mujoco) {
          const mjcfResult = convertURDFToMJCF(originalUrdfContent);
          const filename = `${originalBaseName}.xml`;
          if (method === "download") {
            await downloadFile(mjcfResult.mjcfContent, filename, selectedFolder || undefined, useSubfolder, subfolderName);
          }
          exportedFiles.push(filename);
        }
      }

      // Export meshes (only the ones actually referenced in URDF)
      if (formatSelections.meshes && getReferencedMeshes.length > 0) {
        if (method === "download") {
          if (selectedFolder) {
            // Save meshes to folder
            try {
              let targetFolder = selectedFolder;
              
              // Create subfolder if requested
              if (useSubfolder && subfolderName) {
                targetFolder = await selectedFolder.getDirectoryHandle(subfolderName, { create: true });
              }
              
              const meshesFolder = await targetFolder.getDirectoryHandle("meshes", { create: true });
              for (const mesh of getReferencedMeshes) {
                const filename = mesh.path.split("/").pop() || mesh.path;
                const fileHandle = await meshesFolder.getFileHandle(filename, { create: true });
                const writable = await fileHandle.createWritable();
                const arrayBuffer = await mesh.blob.arrayBuffer();
                await writable.write(arrayBuffer);
                await writable.close();
              }
            } catch (error) {
              console.error("Error saving meshes:", error);
              toast.error("Failed to save meshes folder");
            }
          } else {
            // Fallback to zip download
            const JSZip = (await import("jszip")).default;
            const zip = new JSZip();
            const meshFolder = zip.folder("meshes");

            for (const mesh of getReferencedMeshes) {
              const filename = mesh.path.split("/").pop() || mesh.path;
              meshFolder?.file(filename, mesh.blob);
            }

            const zipBlob = await zip.generateAsync({ type: "blob" });
            const filename = `${currentBaseName}_meshes.zip`;
            const url = URL.createObjectURL(zipBlob);
            const link = document.createElement("a");
            link.href = url;
            link.download = filename;
            link.click();
            URL.revokeObjectURL(url);
          }
        }
        exportedFiles.push(`meshes/ (${getReferencedMeshes.length} files)`);
      }

      if (hasCameras) {
        if (formatSelections.cameraJson) {
          const filename = `${cameraFilenameBase}.json`;
          const content = exportCamerasToJSON(cameras);
          if (method === "download") {
            await downloadFile(content, filename, selectedFolder || undefined, useSubfolder, subfolderName, "application/json");
          }
          exportedFiles.push(filename);
        }

        if (formatSelections.cameraYaml) {
          const filename = `${cameraFilenameBase}.yaml`;
          const content = exportCamerasToYAML(cameras);
          if (method === "download") {
            await downloadFile(content, filename, selectedFolder || undefined, useSubfolder, subfolderName, "text/yaml");
          }
          exportedFiles.push(filename);
        }
      }

      if (method === "download") {
        if (selectedFolder) {
          toast.success(`Exported ${exportedFiles.length} file(s) to selected folder`);
        } else {
          toast.success(`Exported ${exportedFiles.length} file(s)`);
        }
        // Don't close dialog - user might want to export to GitHub too
      } else {
        // GitHub export
        toast.info(`GitHub export: ${exportedFiles.join(", ")}`);
        // TODO: Integrate with SaveToGitHubDialog
        toast.warning("GitHub export integration coming soon");
        // Don't close dialog - user might want to download too
      }
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Failed to export files");
    } finally {
      setIsExporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg shadow-lg max-w-md w-full m-4 max-h-[90vh] flex flex-col">
        {/* Header - Compact Blender Style */}
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-border/50 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5" />
            <h3 className="text-xs font-medium">Export</h3>
          </div>
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={onClose}>
            <X className="w-3 h-3" />
          </Button>
        </div>

        {/* Content - Compact Blender Style */}
        <div className="p-2 space-y-1 overflow-y-auto flex-1 blender-scrollbar">
          {/* Robot File Name Input */}
          <BlenderPanel title="Robot File Name" defaultOpen={true}>
            {originalUrdfContent && (
              <BlenderPropertyRow label="Original (uploaded)">
                <div className="flex items-center gap-1.5 flex-1">
                  <Checkbox
                    id="export-original"
                    checked={exportOriginal}
                    onCheckedChange={(checked) => setExportOriginal(checked as boolean)}
                    className="h-3 w-3 border-border data-[state=checked]:bg-muted data-[state=checked]:border-muted-foreground/50 data-[state=checked]:text-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <Input
                    value={originalBaseName}
                    onChange={(e) => setOriginalBaseName(e.target.value)}
                    disabled={!exportOriginal}
                    className={cn(
                      "h-6 text-xs px-1.5 flex-1",
                      !exportOriginal && "opacity-50 bg-transparent cursor-not-allowed"
                    )}
                    placeholder="robot_v1"
                  />
                </div>
              </BlenderPropertyRow>
            )}
            <BlenderPropertyRow label="Current (edited)">
              <div className="flex items-center gap-1.5 flex-1">
                <Checkbox
                  id="export-current"
                  checked={exportCurrent}
                  onCheckedChange={(checked) => setExportCurrent(checked as boolean)}
                  className="h-3 w-3 border-border data-[state=checked]:bg-muted data-[state=checked]:border-muted-foreground/50 data-[state=checked]:text-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <Input
                  value={currentBaseName}
                  onChange={(e) => setCurrentBaseName(e.target.value)}
                  disabled={!exportCurrent}
                  className={cn(
                    "h-6 text-xs px-1.5 flex-1",
                    !exportCurrent && "opacity-50 bg-transparent cursor-not-allowed"
                  )}
                  placeholder="robot_v2"
                />
              </div>
            </BlenderPropertyRow>
            <div className="text-[9px] text-muted-foreground px-1 pt-0.5 italic">
              Note: If loaded file has version (e.g., _v4), original proposes _v4 and current proposes _v5. Otherwise, proposes v1/v2.
            </div>
          </BlenderPanel>

          {/* Format Selection */}
          <BlenderPanel title="Formats" defaultOpen={true}>
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 py-0.5">
                <Checkbox
                  id="urdf"
                  checked={formatSelections.urdf}
                  onCheckedChange={(checked) =>
                    setFormatSelections((prev) => ({ ...prev, urdf: checked as boolean }))
                  }
                  className="h-3 w-3 border-border data-[state=checked]:bg-muted data-[state=checked]:border-muted-foreground/50 data-[state=checked]:text-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <label htmlFor="urdf" className={cn(
                  "text-[10px] cursor-pointer select-none",
                  !formatSelections.urdf && "text-muted-foreground/60"
                )}>
                  URDF
                </label>
              </div>
              <div className="flex items-center gap-1.5 py-0.5">
                <Checkbox
                  id="xacro"
                  checked={formatSelections.xacro}
                  onCheckedChange={(checked) =>
                    setFormatSelections((prev) => ({ ...prev, xacro: checked as boolean }))
                  }
                  className="h-3 w-3 border-border data-[state=checked]:bg-muted data-[state=checked]:border-muted-foreground/50 data-[state=checked]:text-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <label htmlFor="xacro" className={cn(
                  "text-[10px] cursor-pointer select-none",
                  !formatSelections.xacro && "text-muted-foreground/60"
                )}>
                  XACRO
                </label>
              </div>
              <div className="flex items-center gap-1.5 py-0.5">
                <Checkbox
                  id="mujoco"
                  checked={formatSelections.mujoco}
                  onCheckedChange={(checked) =>
                    setFormatSelections((prev) => ({ ...prev, mujoco: checked as boolean }))
                  }
                  className="h-3 w-3 border-border data-[state=checked]:bg-muted data-[state=checked]:border-muted-foreground/50 data-[state=checked]:text-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <label htmlFor="mujoco" className={cn(
                  "text-[10px] cursor-pointer select-none",
                  !formatSelections.mujoco && "text-muted-foreground/60"
                )}>
                  MUJOCO
                </label>
              </div>
              <div className="flex items-center gap-1.5 py-0.5">
                <Checkbox
                  id="meshes"
                  checked={formatSelections.meshes}
                  onCheckedChange={(checked) =>
                    setFormatSelections((prev) => ({ ...prev, meshes: checked as boolean }))
                  }
                  disabled={Object.keys(meshFiles).length === 0}
                  className="h-3 w-3 border-border data-[state=checked]:bg-muted data-[state=checked]:border-muted-foreground/50 data-[state=checked]:text-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <label
                  htmlFor="meshes"
                  className={cn(
                    "text-[10px] cursor-pointer select-none",
                    !formatSelections.meshes && "text-muted-foreground/60",
                    getReferencedMeshes.length === 0 && "opacity-50"
                  )}
                >
                  Meshes ({getReferencedMeshes.length} referenced)
                </label>
              </div>
            </div>
          </BlenderPanel>

          {hasCameras && (
            <BlenderPanel title="Camera Config" defaultOpen={true}>
              <BlenderPropertyRow label="File Name">
                <Input
                  value={cameraConfigBaseName}
                  onChange={(e) => setCameraConfigBaseName(e.target.value)}
                  className="h-6 text-xs px-1.5"
                  placeholder={defaultCameraBaseName}
                />
              </BlenderPropertyRow>
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 py-0.5">
                  <Checkbox
                    id="camera-json"
                    checked={formatSelections.cameraJson}
                    onCheckedChange={(checked) =>
                      setFormatSelections((prev) => ({ ...prev, cameraJson: checked as boolean }))
                    }
                    className="h-3 w-3 border-border data-[state=checked]:bg-muted data-[state=checked]:border-muted-foreground/50 data-[state=checked]:text-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <label
                    htmlFor="camera-json"
                    className={cn(
                      "text-[10px] cursor-pointer select-none",
                      !formatSelections.cameraJson && "text-muted-foreground/60"
                    )}
                  >
                    JSON (.json)
                  </label>
                </div>
                <div className="flex items-center gap-1.5 py-0.5">
                  <Checkbox
                    id="camera-yaml"
                    checked={formatSelections.cameraYaml}
                    onCheckedChange={(checked) =>
                      setFormatSelections((prev) => ({ ...prev, cameraYaml: checked as boolean }))
                    }
                    className="h-3 w-3 border-border data-[state=checked]:bg-muted data-[state=checked]:border-muted-foreground/50 data-[state=checked]:text-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <label
                    htmlFor="camera-yaml"
                    className={cn(
                      "text-[10px] cursor-pointer select-none",
                      !formatSelections.cameraYaml && "text-muted-foreground/60"
                    )}
                  >
                    YAML (.yaml)
                  </label>
                </div>
              </div>
              <div className="text-[9px] text-muted-foreground px-1 pt-0.5 italic">
                Include camera poses you created or edited in this session alongside the robot files.
              </div>
            </BlenderPanel>
          )}

          {/* Destination Selection */}
          <BlenderPanel title="Destination" defaultOpen={true}>
            <BlenderPropertyRow label="Type">
              <RadioGroup value={destinationType} onValueChange={(v) => setDestinationType(v as "local" | "github")} className="flex gap-4">
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="local" id="dest-local" className="h-3 w-3 border-border text-foreground data-[state=checked]:border-muted-foreground/50 data-[state=checked]:text-foreground focus-visible:ring-0 focus-visible:ring-offset-0" />
                  <label htmlFor="dest-local" className="text-[10px] cursor-pointer select-none">Local Folder</label>
                </div>
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="github" id="dest-github" className="h-3 w-3 border-border text-foreground data-[state=checked]:border-muted-foreground/50 data-[state=checked]:text-foreground focus-visible:ring-0 focus-visible:ring-offset-0" disabled={!githubToken} />
                  <label htmlFor="dest-github" className={cn(
                    "text-[10px] cursor-pointer select-none",
                    !githubToken && "text-muted-foreground/60 cursor-not-allowed"
                  )}>GitHub</label>
                </div>
              </RadioGroup>
            </BlenderPropertyRow>
            
            {destinationType === "local" && (
              <>
                <BlenderPropertyRow label="Local Folder">
              <div className="flex items-center gap-1 flex-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSelectFolder}
                  className={cn(
                    "h-6 px-2 text-xs flex-shrink-0",
                    !selectedFolder && "bg-muted/30 border-muted text-muted-foreground/70"
                  )}
                >
                  <Folder className="w-3 h-3 mr-1" />
                  {selectedFolder ? "Change" : "Select"}
                </Button>
                <span className={cn(
                  "text-[10px] truncate flex-1",
                  selectedFolder ? "text-muted-foreground" : "text-muted-foreground/60"
                )}>
                  {selectedFolder ? "Folder selected" : "No folder selected (downloads to default)"}
                </span>
              </div>
            </BlenderPropertyRow>
            <BlenderPropertyRow label="">
              <div className="flex items-center gap-1.5 flex-1">
                <Checkbox
                  id="use-subfolder"
                  checked={useSubfolder}
                  onCheckedChange={(checked) => setUseSubfolder(checked as boolean)}
                  disabled={!selectedFolder}
                  className="h-3 w-3 border-border data-[state=checked]:bg-muted data-[state=checked]:border-muted-foreground/50 data-[state=checked]:text-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <label htmlFor="use-subfolder" className={cn(
                  "text-[10px] cursor-pointer select-none",
                  !selectedFolder && "text-muted-foreground/60 cursor-not-allowed"
                )}>
                  Create subfolder
                </label>
              </div>
            </BlenderPropertyRow>
            <BlenderPropertyRow label="Folder Name">
              <Input
                value={subfolderName}
                onChange={(e) => setSubfolderName(e.target.value)}
                disabled={!selectedFolder || !useSubfolder}
                className={cn(
                  "h-6 text-xs px-1.5",
                  (!selectedFolder || !useSubfolder) && "bg-muted/30 border-muted text-muted-foreground/60 cursor-not-allowed"
                )}
                placeholder="robot_export"
              />
            </BlenderPropertyRow>
              </>
            )}
            
            {destinationType === "github" && (
              <>
                <BlenderPropertyRow label="GitHub Repo">
                  {githubToken ? (
                    <Select value={selectedGitHubRepo} onValueChange={setSelectedGitHubRepo}>
                      <SelectTrigger className={cn(
                        "h-6 text-xs px-1.5",
                        !selectedGitHubRepo && "bg-muted/30 border-muted text-muted-foreground/70"
                      )}>
                        <SelectValue placeholder={isLoadingRepos ? "Loading..." : "Select repository"} />
                      </SelectTrigger>
                      <SelectContent>
                        {githubRepos.map((repo) => (
                          <SelectItem key={repo.fullName} value={repo.fullName} className="text-xs">
                            {repo.isOrg && <span className="text-muted-foreground">[{repo.owner}] </span>}
                            {repo.fullName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex items-center gap-1.5 flex-1">
                      <Input
                        disabled
                        value=""
                        placeholder="GitHub token required"
                        className="h-6 text-xs px-1.5 bg-muted/30 border-muted text-muted-foreground/60 cursor-not-allowed"
                      />
                    </div>
                  )}
                </BlenderPropertyRow>
                <BlenderPropertyRow label="">
                  <div className="flex items-center gap-1.5 flex-1">
                    <Checkbox
                      id="use-existing-folder"
                      checked={!useNewGitHubFolder}
                      onCheckedChange={(checked) => setUseNewGitHubFolder(!checked)}
                      disabled={!githubToken || !selectedGitHubRepo}
                      className="h-3 w-3 border-border data-[state=checked]:bg-muted data-[state=checked]:border-muted-foreground/50 data-[state=checked]:text-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                    <label htmlFor="use-existing-folder" className={cn(
                      "text-[10px] cursor-pointer select-none",
                      (!githubToken || !selectedGitHubRepo) && "text-muted-foreground/60 cursor-not-allowed"
                    )}>
                      Use existing folder
                    </label>
                  </div>
                </BlenderPropertyRow>
                {!useNewGitHubFolder ? (
                  <BlenderPropertyRow label="Folder">
                    <Select 
                      value={selectedGitHubFolder === "" ? "root" : selectedGitHubFolder} 
                      onValueChange={(value) => setSelectedGitHubFolder(value === "root" ? "" : value)}
                      disabled={!githubToken || !selectedGitHubRepo || isLoadingFolders}
                    >
                      <SelectTrigger className={cn(
                        "h-6 text-xs px-1.5",
                        (!githubToken || !selectedGitHubRepo) && "bg-muted/30 border-muted text-muted-foreground/60"
                      )}>
                        <SelectValue placeholder={isLoadingFolders ? "Loading..." : "Select folder"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="root" className="text-xs">Root (/)</SelectItem>
                        {githubFolders.map((folder) => (
                          <SelectItem key={folder} value={folder} className="text-xs">
                            {folder}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </BlenderPropertyRow>
                ) : (
                  <BlenderPropertyRow label="New Folder">
                    <Input
                      value={newGitHubFolderName}
                      onChange={(e) => setNewGitHubFolderName(e.target.value)}
                      disabled={!githubToken || !selectedGitHubRepo}
                      className={cn(
                        "h-6 text-xs px-1.5",
                        (!githubToken || !selectedGitHubRepo) && "bg-muted/30 border-muted text-muted-foreground/60 cursor-not-allowed"
                      )}
                      placeholder="robot_export"
                    />
                  </BlenderPropertyRow>
                )}
              </>
            )}
          </BlenderPanel>

          {/* Preview - Local */}
          {destinationType === "local" && (
            <>
              <BlenderPanel title="Preview (Local)" defaultOpen={true}>
                <div className="space-y-0.5 px-1 py-0.5">
                  {localPreview.length === 0 ? (
                    <div className="text-[10px] text-muted-foreground italic">No files selected</div>
                  ) : (
                    localPreview.map((item, index) => (
                      <div key={index} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        {item.type === "folder" ? (
                          <>
                            <FolderOpen className="w-3 h-3" />
                            <span className="font-medium">{item.path}</span>
                          </>
                        ) : (
                          <>
                            <File className="w-3 h-3" />
                            <span className="font-mono" title={item.path}>{item.path}</span>
                          </>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </BlenderPanel>
              <div className="px-1 py-1 flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleExport("download")}
                  disabled={isExporting}
                  className="h-5 px-2 text-[10px] bg-muted/50 hover:bg-muted border-border text-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
                >
                  {isExporting ? (
                    <>
                      <Loader2 className="w-2.5 h-2.5 mr-1 animate-spin" />
                      Exporting...
                    </>
                  ) : (
                    <>
                      <Download className="w-2.5 h-2.5 mr-1" />
                      Download
                    </>
                  )}
                </Button>
              </div>
            </>
          )}

          {/* Preview - GitHub */}
          {destinationType === "github" && (
            <>
              <BlenderPanel title="Preview (GitHub)" defaultOpen={true}>
                <div className="space-y-0.5 px-1 py-0.5">
                  {!selectedGitHubRepo ? (
                    <div className="text-[10px] text-muted-foreground italic">No repository selected</div>
                  ) : githubPreview.length === 0 ? (
                    <div className="text-[10px] text-muted-foreground italic">No files selected</div>
                  ) : (
                    githubPreview.map((item, index) => (
                      <div key={index} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        {item.type === "folder" ? (
                          <>
                            <FolderOpen className="w-3 h-3" />
                            <span className="font-medium">{item.path}</span>
                          </>
                        ) : (
                          <>
                            <File className="w-3 h-3" />
                            <span className="font-mono" title={item.path}>{item.path}</span>
                          </>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </BlenderPanel>
              <div className="px-1 py-1 flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleExport("github")}
                  disabled={isExporting || !githubToken || !selectedGitHubRepo}
                  className={cn(
                    "h-5 px-2 text-[10px] bg-muted/50 hover:bg-muted border-border text-foreground focus-visible:ring-0",
                    (!githubToken || !selectedGitHubRepo) && "bg-muted/30 border-muted text-muted-foreground/60 cursor-not-allowed"
                  )}
                >
                  {isExporting ? (
                    <>
                      <Loader2 className="w-2.5 h-2.5 mr-1 animate-spin" />
                      Exporting...
                    </>
                  ) : (
                    <>
                      <Github className="w-2.5 h-2.5 mr-1" />
                      Upload to GitHub
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Footer - Only Close button */}
        <div className="border-t border-border/50 px-2 py-1.5 flex justify-end flex-shrink-0">
          <Button variant="outline" size="sm" onClick={onClose} className="h-6 px-2 text-xs bg-muted/50 hover:bg-muted border-border text-foreground focus-visible:ring-0 focus-visible:ring-offset-0">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
