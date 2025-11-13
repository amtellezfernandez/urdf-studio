import { useRef, useCallback, memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FolderOpen, Github, AlertTriangle, Loader2 } from "lucide-react";
import { useGPUMode, type GPUMode } from "@/hooks/use-gpu-mode";
import { toast } from "sonner";
import {
  parseGitHubUrl,
  fetchRepoContents,
  checkRepoVisibility,
  findURDFCandidates,
  convertGitHubFilesToFileList,
  type URDFCandidate,
} from "@/utils/github-repo";

interface FolderUploadScreenProps {
  onFolderSelected: (files: FileList) => void;
}

export const FolderUploadScreen = memo(({ onFolderSelected }: FolderUploadScreenProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const { gpuMode, setGPUMode } = useGPUMode();
  const [isDragging, setIsDragging] = useState(false);
  const [githubUrl, setGithubUrl] = useState("");
  const [githubToken, setGithubToken] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    // Check environment variable first (set by setup script)
    if (import.meta.env.VITE_GITHUB_TOKEN) {
      return import.meta.env.VITE_GITHUB_TOKEN;
    }
    return null;
  });
  const [isLoadingGithub, setIsLoadingGithub] = useState(false);
  const [urdfCandidates, setUrdfCandidates] = useState<URDFCandidate[]>([]);
  const [showUrdfDialog, setShowUrdfDialog] = useState(false);
  const [repoWarning, setRepoWarning] = useState<string | null>(null);

  const handleFolderSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onFolderSelected(files);
    }
  }, [onFolderSelected]);

  const handleButtonClick = useCallback((): void => {
    fileInputRef.current?.click();
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    // Only set dragging to false if we're leaving the drop zone
    if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>): Promise<void> => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const items = e.dataTransfer.items;
      if (!items || items.length === 0) return;

      // Recursively get all files from the directory tree
      const getAllFiles = async (entry: FileSystemEntry | null, path = ""): Promise<File[]> => {
        if (!entry) return [];

        if (entry.isFile) {
          return new Promise<File[]>((resolve, reject) => {
            (entry as FileSystemFileEntry).file(
              (file) => {
                const fileWithPath = Object.assign(file, {
                  webkitRelativePath: path + file.name,
                });
                resolve([fileWithPath]);
              },
              reject
            );
          });
        } else if (entry.isDirectory) {
          const dirReader = (entry as FileSystemDirectoryEntry).createReader();
          const files: File[] = [];
          const dirName = entry.name;

          const readDir = (): Promise<File[]> => {
            return new Promise((resolve, reject) => {
              dirReader.readEntries(async (entries) => {
                if (entries.length === 0) {
                  resolve(files);
                } else {
                  for (const subEntry of entries) {
                    const subPath = path + dirName + "/";
                    const subFiles = await getAllFiles(subEntry, subPath);
                    files.push(...subFiles);
                  }
                  const moreFiles = await readDir();
                  files.push(...moreFiles);
                  resolve(files);
                }
              }, reject);
            });
          };

          return readDir();
        }
        return [];
      };

      try {
        const allFiles: File[] = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.kind === "file") {
            const entry = item.webkitGetAsEntry();
            if (entry) {
              const files = await getAllFiles(entry);
              allFiles.push(...files);
            }
          }
        }

        if (allFiles.length > 0) {
          // Create a FileList-like object
          const dataTransfer = new DataTransfer();
          allFiles.forEach((file) => dataTransfer.items.add(file));
          const fileList = dataTransfer.files;

          onFolderSelected(fileList);
        }
      } catch (error) {
        console.error("Error processing dropped folder:", error);
      }
    },
    [onFolderSelected]
  );

  const handleGPUModeToggle = useCallback((checked: boolean): void => {
    setGPUMode(checked ? "high" : "low");
  }, [setGPUMode]);

  const handleGithubLoad = useCallback(async (): Promise<void> => {
    if (!githubUrl.trim()) {
      toast.error("Please enter a GitHub repository URL");
      return;
    }

    const repoInfo = parseGitHubUrl(githubUrl.trim());
    if (!repoInfo) {
      toast.error("Invalid GitHub repository URL. Format: owner/repo or https://github.com/owner/repo");
      return;
    }

    // Check if token is provided
    const token = githubToken?.trim() || undefined;
    if (!token) {
      toast.error(
        "GitHub token required. Please run 'urdf-studio setup' and launch the app again to configure your GitHub token.",
        { duration: 6000 }
      );
      return;
    }

    setIsLoadingGithub(true);
    setRepoWarning(null);

    try {
      // Check if repository is accessible with token
      const visibilityCheck = await checkRepoVisibility(repoInfo.owner, repoInfo.repo, token);
      if (visibilityCheck.error) {
        // Token exists but has no access
        if (visibilityCheck.error.includes("no access") || visibilityCheck.error.includes("not found") || visibilityCheck.error.includes("403")) {
          toast.error("Token has no access to this repository. Please check your token permissions.");
          setIsLoadingGithub(false);
          return;
        }
        if (visibilityCheck.error.includes("rate limit")) {
          toast.error(visibilityCheck.error);
          setIsLoadingGithub(false);
          return;
        }
      }

      // Fetch repository contents
      const files = await fetchRepoContents(repoInfo.owner, repoInfo.repo, repoInfo.path, token);

      // Find URDF candidates
      const candidates = findURDFCandidates(files);

      if (candidates.length === 0) {
        toast.error("No .urdf file found in the repository");
        setIsLoadingGithub(false);
        return;
      }

      if (candidates.length === 1) {
        // Single URDF found, load it directly
        const fileList = await convertGitHubFilesToFileList(files, candidates[0].path, repoInfo.owner, repoInfo.repo, token);
        onFolderSelected(fileList);
        toast.success(`Loaded ${candidates[0].name} from GitHub`);
      } else {
        // Multiple URDF files found, show selection dialog
        setUrdfCandidates(candidates);
        setShowUrdfDialog(true);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to load repository";
      
      // Check for specific error types
      if (errorMessage.includes("403") || errorMessage.includes("access denied")) {
        toast.error("Token has no access to this repository. Please check your token permissions.");
      } else if (errorMessage.includes("404") || errorMessage.includes("not found")) {
        toast.error("Repository not found or token has no access.");
      } else if (errorMessage.includes("rate limit")) {
        toast.error(errorMessage);
      } else {
        toast.error(errorMessage);
      }
      console.error("GitHub repo load error:", error);
    } finally {
      setIsLoadingGithub(false);
    }
  }, [githubUrl, githubToken, onFolderSelected]);

  const handleUrdfSelect = useCallback(
    async (candidate: URDFCandidate): Promise<void> => {
      setShowUrdfDialog(false);
      
      // Check if token is provided
      const token = githubToken?.trim() || undefined;
      if (!token) {
        toast.error(
          "GitHub token required. Please run 'urdf-studio setup' and launch the app again to configure your GitHub token.",
          { duration: 6000 }
        );
        return;
      }

      setIsLoadingGithub(true);

      try {
        const repoInfo = parseGitHubUrl(githubUrl.trim());
        if (!repoInfo) {
          toast.error("Invalid repository information");
          return;
        }

        const files = await fetchRepoContents(repoInfo.owner, repoInfo.repo, repoInfo.path, token);
        const fileList = await convertGitHubFilesToFileList(files, candidate.path, repoInfo.owner, repoInfo.repo, token);
        onFolderSelected(fileList);
        toast.success(`Loaded ${candidate.name} from GitHub`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to load selected URDF";
        
        // Check for specific error types
        if (errorMessage.includes("403") || errorMessage.includes("access denied")) {
          toast.error("Token has no access to this repository. Please check your token permissions.");
        } else if (errorMessage.includes("404") || errorMessage.includes("not found")) {
          toast.error("Repository not found or token has no access.");
        } else {
          toast.error(errorMessage);
        }
        console.error("URDF load error:", error);
      } finally {
        setIsLoadingGithub(false);
      }
    },
    [githubUrl, githubToken, onFolderSelected]
  );

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-6">
      <div className="w-full max-w-2xl space-y-6">
        {/* Header Section */}
        <div className="text-center space-y-3">
          <img 
            src="/assets/urdf-studio-logo.png" 
            alt="URDF Studio" 
            className="h-48 w-auto object-contain mx-auto"
            style={{ maxHeight: '300px' }}
          />
          <p className="text-sm text-muted-foreground max-w-lg mx-auto">
            Load and visualize your robot simulation files. Edit joint properties, record motion data, and export datasets.
          </p>
        </div>

        {/* Performance Settings Section */}
        <div className="flex flex-col items-center space-y-2">
          <div className="flex items-center justify-center gap-3">
            <span className="text-sm text-foreground">
              {gpuMode === "high" ? "High Performance" : "Low GPU Mode"}
            </span>
            <Switch
              checked={gpuMode === "high"}
              onCheckedChange={handleGPUModeToggle}
              className="data-[state=checked]:bg-primary"
            />
          </div>
          <p className="text-xs text-muted-foreground text-center">
            {gpuMode === "high" 
              ? "Optimized for modern GPUs with advanced lighting and shadows"
              : "Optimized for low-end hardware and integrated GPUs"}
          </p>
        </div>

        {/* What You Need Section */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">What You Need</h2>
          <p className="text-sm text-muted-foreground">
            A folder containing your robot simulation files:
          </p>
          <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
            <li>URDF file (<code className="text-xs bg-muted px-1 py-0.5 rounded">.urdf</code>) - defines your robot structure</li>
            <li>Mesh files (<code className="text-xs bg-muted px-1 py-0.5 rounded">.stl</code>) - 3D models for robot parts</li>
          </ul>
          <p className="text-xs text-muted-foreground/80 mt-2">
            The folder structure will be preserved when loading.
          </p>
        </div>

        {/* Load Robot Section */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Load Robot</h2>

          {/* GitHub Repo Section */}
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">🐙 Load from GitHub Repository</label>
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="owner/repo or https://github.com/owner/repo"
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isLoadingGithub) {
                    handleGithubLoad();
                  }
                }}
                disabled={isLoadingGithub}
                className="flex-1"
              />
              <Button
                onClick={handleGithubLoad}
                disabled={isLoadingGithub || !githubUrl.trim()}
                size="sm"
                className="px-4"
              >
                {isLoadingGithub ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Github className="w-4 h-4 mr-2" />
                )}
                Load
              </Button>
            </div>
            {!githubToken && (
              <Alert variant="destructive" className="mt-2">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>GitHub Token Required</AlertTitle>
                <AlertDescription>
                  Please run <code className="text-xs bg-muted px-1 py-0.5 rounded">urdf-studio setup</code> and launch the app again to configure your GitHub token.
                </AlertDescription>
              </Alert>
            )}
            {repoWarning && (
              <Alert variant="destructive" className="mt-2">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Warning</AlertTitle>
                <AlertDescription>{repoWarning}</AlertDescription>
              </Alert>
            )}
            <p className="text-xs text-muted-foreground">
              The tool will automatically find and prioritize .urdf files in folders with meshes. Token must have access to the repository.
            </p>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or</span>
            </div>
          </div>
          
          <input
            ref={fileInputRef}
            type="file"
            {...({ webkitdirectory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
            multiple
            onChange={handleFolderSelect}
            className="hidden"
            aria-label="Select robot simulation files folder"
          />
          
          {/* Drag & Drop Zone */}
          <div
            ref={dropZoneRef}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`
              w-full border-2 border-dashed rounded-md p-6 transition-all
              ${isDragging 
                ? "border-primary bg-primary/10" 
                : "border-border hover:border-primary/50"
              }
            `}
          >
            <div className="flex flex-col items-center gap-2">
              <FolderOpen 
                className={`w-8 h-8 transition-colors ${
                  isDragging ? "text-primary" : "text-muted-foreground"
                }`} 
              />
              <p className="text-sm font-medium text-foreground">
                {isDragging ? "Drop folder here" : "Drag & drop folder"}
              </p>
            </div>
          </div>

          {/* Browse Button */}
          <div className="flex justify-center">
            <Button
              onClick={handleButtonClick}
              size="sm"
              className="px-6"
            >
              <FolderOpen className="w-4 h-4 mr-2" />
              Browse Folder
            </Button>
          </div>
        </div>

        {/* URDF Selection Dialog */}
        <Dialog open={showUrdfDialog} onOpenChange={setShowUrdfDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Multiple URDF Files Found</DialogTitle>
              <DialogDescription>
                Select which URDF file to load. Files in folders with meshes are prioritized.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {urdfCandidates.map((candidate, index) => (
                <Button
                  key={candidate.path}
                  variant={index === 0 ? "default" : "outline"}
                  className="w-full justify-start text-left h-auto py-3"
                  onClick={() => handleUrdfSelect(candidate)}
                >
                  <div className="flex flex-col items-start gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{candidate.name}</span>
                      {candidate.hasMeshesFolder && (
                        <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">
                          Has Meshes
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{candidate.path}</span>
                  </div>
                </Button>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowUrdfDialog(false)}>
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
});

