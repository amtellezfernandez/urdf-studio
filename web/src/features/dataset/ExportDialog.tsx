import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import {
  Download,
  X,
  Package,
  Loader2,
  Folder,
  FolderOpen,
  File,
} from "lucide-react";
import { toast } from "sonner";
import {
  convertUrdfToMjcfCached,
  convertUrdfToUsdCached,
  convertUrdfToXacroCached,
} from "@/features/urdf/convert/urdfProcessing";
import {
  extractMeshReferencesFromURDF,
} from "@/features/urdf/github/githubRepo";
import { resolveMeshBlobFromReference } from "@/shared/lib/urdfBrowser";
import {
  buildUrdfBakedMeshPlan,
  buildUrdfBakePreviewStats,
  type UrdfBakePreviewSession,
} from "@/features/urdf/bake/virtualBake";
import { executeBakeExportViaBackend } from "@/features/urdf/inertia/robotMasteringApi";
import { BlenderPanel, BlenderPropertyRow } from "@/shared/ui/blender-panel";
import { cn } from "@/shared/lib/utils";
import { useCameraStore } from "@/shared/store/useCameraStore";
import { exportCamerasToJSON, exportCamerasToYAML } from "@/features/camera";
import {
  buildRobotConversionDiagnosticsSidecar,
  type RobotConversionDiagnosticsSidecar,
} from "@/features/dataset/exportConversionDiagnostics";
import type { WindowWithViewerHandlers } from "@/shared/types/feature";

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  urdfContent: string;
  originalUrdfContent?: string;
  meshFiles?: Record<string, Blob>;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
  robotName?: string;
  stagedBakeSession?: UrdfBakePreviewSession | null;
}

type RobotExportFormat = "urdf" | "xacro" | "mujoco" | "usd";

type FormatSelections = Record<
  RobotExportFormat | "meshes" | "cameraJson" | "cameraYaml",
  boolean
>;

const robotExportFormats = [
  { key: "urdf", label: "URDF" },
  { key: "xacro", label: "XACRO" },
  { key: "mujoco", label: "MJCF" },
  { key: "usd", label: "USD" },
] as const satisfies readonly { key: RobotExportFormat; label: string }[];

const robotExportFilename = (baseName: string, format: RobotExportFormat): string => {
  switch (format) {
    case "urdf":
      return `${baseName}.urdf`;
    case "xacro":
      return `${baseName}.urdf.xacro`;
    case "mujoco":
      return `${baseName}.xml`;
    case "usd":
      return `${baseName}.usda`;
  }
};

const robotExportMimeType = (format: RobotExportFormat): string => {
  switch (format) {
    case "usd":
      return "model/vnd.usda";
    case "urdf":
    case "xacro":
    case "mujoco":
      return "application/xml";
  }
};

export const ExportDialog = ({
  isOpen,
  onClose,
  urdfContent,
  originalUrdfContent,
  meshFiles = {},
  urdfBasePath,
  packageRoots,
  robotName = "robot",
  stagedBakeSession = null,
}: ExportDialogProps) => {
  const cameras = useCameraStore((state) => state.cameras);
  const hasCameras = cameras.length > 0;
  const [isExporting, setIsExporting] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<FileSystemDirectoryHandle | null>(null);

  // Local folder options
  const [useSubfolder, setUseSubfolder] = useState(false);
  const [subfolderName, setSubfolderName] = useState("");

  // Format selections
  const [formatSelections, setFormatSelections] = useState<FormatSelections>({
    urdf: true,
    xacro: false,
    mujoco: false,
    usd: false,
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
  const currentExportUrdfContent = stagedBakeSession?.stagedContent ?? urdfContent;
  const stagedBakePreview = useMemo(
    () => (stagedBakeSession ? buildUrdfBakePreviewStats(stagedBakeSession) : null),
    [stagedBakeSession]
  );
  const stagedBakePlan = useMemo(
    () => (stagedBakeSession ? buildUrdfBakedMeshPlan(stagedBakeSession) : null),
    [stagedBakeSession]
  );
  const hasStagedBakePreview = Boolean(stagedBakePreview && stagedBakePreview.entryCount > 0);
  const stagedBakeBlockingReason = useMemo(() => {
    if (!hasStagedBakePreview || !exportCurrent) {
      return null;
    }
    if (!formatSelections.meshes) {
      return "Current export is blocked while a bake preview is staged. Enable mesh export so the cleaned URDF and baked meshes stay in sync.";
    }
    if (exportOriginal) {
      return "Current + original export is blocked while a bake preview is staged because both variants would require different mesh payloads.";
    }
    if ((stagedBakePlan?.conflicts.length ?? 0) > 0) {
      return "Current export is blocked because the staged bake references shared mesh files with conflicting transforms.";
    }
    return null;
  }, [
    exportCurrent,
    exportOriginal,
    formatSelections.meshes,
    hasStagedBakePreview,
    stagedBakePlan?.conflicts.length,
  ]);
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

  // Update subfolder name when robot name changes
  useEffect(() => {
    if (isOpen && !subfolderName) {
      setSubfolderName(currentBaseName);
    }
  }, [isOpen, currentBaseName, subfolderName]);

  const handleSelectFolder = async () => {
    try {
      // Check if File System Access API is supported
      if (!("showDirectoryPicker" in window)) {
        toast.error("Folder selection is not supported in this browser. Please use a modern browser.");
        return;
      }

      const directoryHandle = await (window as WindowWithViewerHandlers).showDirectoryPicker({
        mode: "readwrite",
      });
      setSelectedFolder(directoryHandle);
      toast.success("Folder selected");
    } catch (error: unknown) {
      const isAbort =
        error instanceof DOMException && error.name === "AbortError";
      if (!isAbort) {
        console.error("Error selecting folder:", error);
        toast.error("Failed to select folder");
      }
    }
  };

  // Match URDF mesh reference to actual file in meshFiles
  const findMeshFileForReference = useCallback(
    (meshRef: string, meshFileMap: Record<string, Blob>): { path: string; blob: Blob } | null =>
      resolveMeshBlobFromReference(meshRef, meshFileMap, urdfBasePath, packageRoots),
    [urdfBasePath, packageRoots]
  );

  // Get meshes actually referenced in the URDF content(s) being exported
  const getReferencedMeshes = useMemo(() => {
    const referencedMeshes = new Map<string, { path: string; blob: Blob }>();
    
    // Extract mesh references from current URDF if exporting current
    if (exportCurrent) {
      const meshRefs = extractMeshReferencesFromURDF(currentExportUrdfContent);
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
  }, [
    currentExportUrdfContent,
    exportCurrent,
    exportOriginal,
    originalUrdfContent,
    meshFiles,
    findMeshFileForReference,
  ]);

  // Generate local folder structure preview
  const exportPreview = useMemo(() => {
    const structure: Array<{ path: string; type: "file" | "folder" }> = [];
    
    // Determine base path prefix for local
    let basePath = "";
    if (selectedFolder && useSubfolder && subfolderName) {
      basePath = `${subfolderName}/`;
    }
    
    const addRobotPreview = (baseName: string) => {
      robotExportFormats.forEach(({ key }) => {
        if (formatSelections[key]) {
          structure.push({ path: `${basePath}${robotExportFilename(baseName, key)}`, type: "file" });
        }
      });
    };

    if (exportCurrent) {
      addRobotPreview(currentBaseName);
    }

    if (exportOriginal && originalUrdfContent) {
      addRobotPreview(originalBaseName);
    }

    if (hasCameras) {
      if (formatSelections.cameraJson) {
        structure.push({
          path: `${basePath}${cameraFilenameBase}.json`,
          type: "file",
        });
      }
      if (formatSelections.cameraYaml) {
        structure.push({
          path: `${basePath}${cameraFilenameBase}.yaml`,
          type: "file",
        });
      }
    }

    if (formatSelections.meshes && getReferencedMeshes.length > 0) {
      structure.push({ path: `${basePath}meshes/`, type: "folder" });
      // Show first few mesh files as preview
      const meshKeys = getReferencedMeshes.slice(0, 3);
      meshKeys.forEach((mesh) => {
        const filename = mesh.path.split("/").pop() || mesh.path;
        structure.push({ path: `${basePath}meshes/${filename}`, type: "file" });
      });
      if (getReferencedMeshes.length > 3) {
        structure.push({ path: `${basePath}meshes/...`, type: "file" });
      }
    }

    return structure;
  }, [exportCurrent, exportOriginal, formatSelections, currentBaseName, originalBaseName, getReferencedMeshes, selectedFolder, useSubfolder, subfolderName, hasCameras, cameraFilenameBase, originalUrdfContent]);

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

  const handleExport = async () => {
    if (stagedBakeBlockingReason) {
      toast.error(stagedBakeBlockingReason);
      return;
    }

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

    setIsExporting(true);

    try {
      const exportedFiles: string[] = [];
      let bakedMeshOverrides = new Map<
        string,
        Awaited<ReturnType<typeof executeBakeExportViaBackend>>["overrides"][number]
      >();

      if (exportCurrent && stagedBakePlan && stagedBakePlan.entries.length > 0) {
        const bakeExecution = await executeBakeExportViaBackend({
          plan: stagedBakePlan,
          meshFiles,
          urdfBasePath,
          packageRoots,
        });
        if (bakeExecution.unsupported.length > 0) {
          toast.error(
            `Current export is blocked because ${bakeExecution.unsupported.length} staged mesh entr${bakeExecution.unsupported.length === 1 ? "y is" : "ies are"} unsupported for bake export.`
          );
          return;
        }
        bakedMeshOverrides = new Map(
          bakeExecution.overrides.map((override) => [override.resolvedPath, override])
        );
      }

      const exportRobotFileSet = async (baseName: string, content: string) => {
        for (const { key } of robotExportFormats) {
          if (!formatSelections[key]) {
            continue;
          }
          const filename = robotExportFilename(baseName, key);
          let fileContent = content;
          let diagnosticsSidecar: RobotConversionDiagnosticsSidecar | null = null;
          if (key === "xacro") {
            fileContent = convertUrdfToXacroCached(content).xacroContent;
          } else if (key === "mujoco") {
            const conversion = convertUrdfToMjcfCached(content);
            fileContent = conversion.mjcfContent;
            diagnosticsSidecar = buildRobotConversionDiagnosticsSidecar(key, filename, conversion);
          } else if (key === "usd") {
            const conversion = convertUrdfToUsdCached(content);
            fileContent = conversion.usdContent;
            diagnosticsSidecar = buildRobotConversionDiagnosticsSidecar(key, filename, conversion);
          }
          await downloadFile(
            fileContent,
            filename,
            selectedFolder || undefined,
            useSubfolder,
            subfolderName,
            robotExportMimeType(key)
          );
          exportedFiles.push(filename);
          if (diagnosticsSidecar) {
            await downloadFile(
              diagnosticsSidecar.content,
              diagnosticsSidecar.filename,
              selectedFolder || undefined,
              useSubfolder,
              subfolderName,
              "application/json"
            );
            exportedFiles.push(diagnosticsSidecar.filename);
          }
        }
      };

      // Export current version if selected
      if (exportCurrent) {
        await exportRobotFileSet(currentBaseName, currentExportUrdfContent);
      }

      // Export original version if selected
      if (exportOriginal && originalUrdfContent) {
        await exportRobotFileSet(originalBaseName, originalUrdfContent);
      }

      // Export meshes (only the ones actually referenced in URDF)
      if (formatSelections.meshes && getReferencedMeshes.length > 0) {
        const meshesForExport = getReferencedMeshes.map((mesh) => ({
          ...mesh,
          bakedOverride: bakedMeshOverrides.get(mesh.path) ?? null,
          blob: bakedMeshOverrides.get(mesh.path)?.blob ?? mesh.blob,
        }));
        const bakedMeshSidecars = meshesForExport.flatMap((mesh) =>
          mesh.bakedOverride?.sidecars.map((sidecar) => ({
            ...sidecar,
            resolvedPath: `${mesh.path}#${sidecar.filename}`,
          })) ?? []
        );
        if (selectedFolder) {
          // Save meshes to folder
          try {
            let targetFolder = selectedFolder;

            if (useSubfolder && subfolderName) {
              targetFolder = await selectedFolder.getDirectoryHandle(subfolderName, { create: true });
            }

            const meshesFolder = await targetFolder.getDirectoryHandle("meshes", { create: true });
            for (const mesh of meshesForExport) {
              const filename = mesh.path.split("/").pop() || mesh.path;
              const fileHandle = await meshesFolder.getFileHandle(filename, { create: true });
              const writable = await fileHandle.createWritable();
              const arrayBuffer = await mesh.blob.arrayBuffer();
              await writable.write(arrayBuffer);
              await writable.close();
            }
            for (const sidecar of bakedMeshSidecars) {
              const fileHandle = await meshesFolder.getFileHandle(sidecar.filename, { create: true });
              const writable = await fileHandle.createWritable();
              const arrayBuffer = await sidecar.blob.arrayBuffer();
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

          for (const mesh of meshesForExport) {
            const filename = mesh.path.split("/").pop() || mesh.path;
            meshFolder?.file(filename, mesh.blob);
          }
          for (const sidecar of bakedMeshSidecars) {
            meshFolder?.file(sidecar.filename, sidecar.blob);
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
        exportedFiles.push(
          `meshes/ (${meshesForExport.length + bakedMeshSidecars.length} files)`
        );
      }

      if (hasCameras) {
        if (formatSelections.cameraJson) {
          const filename = `${cameraFilenameBase}.json`;
          const content = exportCamerasToJSON(cameras);
          await downloadFile(content, filename, selectedFolder || undefined, useSubfolder, subfolderName, "application/json");
          exportedFiles.push(filename);
        }

        if (formatSelections.cameraYaml) {
          const filename = `${cameraFilenameBase}.yaml`;
          const content = exportCamerasToYAML(cameras);
          await downloadFile(content, filename, selectedFolder || undefined, useSubfolder, subfolderName, "text/yaml");
          exportedFiles.push(filename);
        }
      }

      if (selectedFolder) {
        toast.success(`Exported ${exportedFiles.length} file(s) to selected folder`);
      } else {
        toast.success(`Exported ${exportedFiles.length} file(s)`);
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
              {robotExportFormats.map(({ key, label }) => (
                <div key={key} className="flex items-center gap-1.5 py-0.5">
                  <Checkbox
                    id={key}
                    checked={formatSelections[key]}
                    onCheckedChange={(checked) =>
                      setFormatSelections((prev) => ({ ...prev, [key]: checked as boolean }))
                    }
                    className="h-3 w-3 border-border data-[state=checked]:bg-muted data-[state=checked]:border-muted-foreground/50 data-[state=checked]:text-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <label htmlFor={key} className={cn(
                    "text-[10px] cursor-pointer select-none",
                    !formatSelections[key] && "text-muted-foreground/60"
                  )}>
                    {label}
                  </label>
                </div>
              ))}
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
          </BlenderPanel>

          <BlenderPanel title="Preview" defaultOpen={true}>
            <div className="space-y-0.5 px-1 py-0.5">
              {exportPreview.length === 0 ? (
                <div className="text-[10px] text-muted-foreground italic">No files selected</div>
              ) : (
                exportPreview.map((item, index) => (
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
          {hasStagedBakePreview ? (
            <BlenderPanel title="Bake Export" defaultOpen={true}>
              <div className="space-y-1 px-1 py-0.5 text-[10px] text-muted-foreground">
                <div>
                  {stagedBakePreview.entryCount} staged entr
                  {stagedBakePreview.entryCount === 1 ? "y" : "ies"} across{" "}
                  {stagedBakePreview.linkNames.length} link
                  {stagedBakePreview.linkNames.length === 1 ? "" : "s"}.
                </div>
                <div>Mesh-backed entries: {stagedBakePreview.meshBackedEntryCount}</div>
                {stagedBakePreview.linkNames.length > 0 ? (
                  <div className="line-clamp-2">Links: {stagedBakePreview.linkNames.join(", ")}</div>
                ) : null}
                {stagedBakePlan && stagedBakePlan.conflicts.length > 0 ? (
                  <div className="text-amber-300">
                    Conflicts: {stagedBakePlan.conflicts.map((conflict) => conflict.meshReference).join(", ")}
                  </div>
                ) : null}
                {stagedBakeBlockingReason ? (
                  <div className="text-amber-300">{stagedBakeBlockingReason}</div>
                ) : (
                  <div className="text-emerald-300">
                    Current export will bake supported staged meshes into the exported mesh payload.
                  </div>
                )}
              </div>
            </BlenderPanel>
          ) : null}
          <div className="px-1 py-1 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void handleExport();
              }}
              disabled={isExporting || Boolean(stagedBakeBlockingReason)}
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
