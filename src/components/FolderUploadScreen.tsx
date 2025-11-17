import { useRef, useCallback, memo, useState, useEffect } from "react";
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
import { FolderOpen, Github, AlertTriangle, Loader2, X, Clock, Folder } from "lucide-react";
import { useGPUMode } from "@/hooks/use-gpu-mode";
import { useRecentGitHubRepos } from "@/hooks/use-recent-github-repos";
import { toast } from "sonner";
import {
  parseGitHubUrl,
  fetchRepoContents,
  checkRepoVisibility,
  findURDFCandidates,
  checkCandidatesForUnsupportedFormats,
  convertGitHubFilesToFileList,
  type URDFCandidate,
  type GitHubFile,
} from "@/utils/github-repo";

interface FolderUploadScreenProps {
  onFolderSelected: (files: FileList) => void;
}

export const FolderUploadScreen = memo(({ onFolderSelected }: FolderUploadScreenProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { gpuMode, setGPUMode } = useGPUMode();
  const { recentRepos, addRecentRepo, removeRecentRepo } = useRecentGitHubRepos();
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
  const [fetchedFiles, setFetchedFiles] = useState<GitHubFile[]>([]);
  const [repoInfo, setRepoInfo] = useState<{ owner: string; repo: string; path?: string; token: string } | null>(null);

  // Last uploaded local folder
  const [lastLocalFolder, setLastLocalFolder] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem("urdfstudio:lastLocalFolder");
    } catch {
      return null;
    }
  });

  // Save last folder to localStorage
  useEffect(() => {
    if (typeof window !== "undefined" && lastLocalFolder) {
      localStorage.setItem("urdfstudio:lastLocalFolder", lastLocalFolder);
    }
  }, [lastLocalFolder]);

  const clearLastLocalFolder = useCallback(() => {
    setLastLocalFolder(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem("urdfstudio:lastLocalFolder");
    }
  }, []);

  const handleFolderSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files;
    if (files && files.length > 0) {
      // Extract folder name from the first file's webkitRelativePath
      const firstFile = files[0] as File & { webkitRelativePath?: string };
      if (firstFile.webkitRelativePath) {
        const pathParts = firstFile.webkitRelativePath.split("/");
        if (pathParts.length > 0) {
          const folderName = pathParts[0];
          setLastLocalFolder(folderName);
        }
      }
      onFolderSelected(files);
    }
  }, [onFolderSelected]);

  const handleButtonClick = useCallback((): void => {
    fileInputRef.current?.click();
  }, []);

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

      // Store fetched files and repo info for reuse
      setFetchedFiles(files);
      setRepoInfo({ owner: repoInfo.owner, repo: repoInfo.repo, path: repoInfo.path, token });

      // Find URDF candidates
      let candidates = findURDFCandidates(files);

      if (candidates.length === 0) {
        toast.error("No .urdf file found in the repository");
        setIsLoadingGithub(false);
        return;
      }

      // Check for unsupported formats
      candidates = await checkCandidatesForUnsupportedFormats(candidates, files, repoInfo.owner, repoInfo.repo, token);
      
      if (candidates.length === 1) {
        // Single URDF found - check if it has unsupported formats
        if (candidates[0].hasUnsupportedFormats === true) {
          const formats = candidates[0].unsupportedFormats?.join(", ") || "unknown";
          toast.error(`URDF uses unsupported mesh formats (${formats}). Only .stl files are supported.`, { duration: 6000 });
          setIsLoadingGithub(false);
          return;
        }
        
        // Warn about unmatched mesh references but still allow loading
        if (candidates[0].unmatchedMeshReferences && candidates[0].unmatchedMeshReferences.length > 0) {
          const unmatchedCount = candidates[0].unmatchedMeshReferences.length;
          const unmatchedList = candidates[0].unmatchedMeshReferences.slice(0, 3).join(", ");
          const moreText = unmatchedCount > 3 ? ` and ${unmatchedCount - 3} more` : "";
          toast.warning(
            `Warning: ${unmatchedCount} mesh file(s) referenced in URDF but not found in repository: ${unmatchedList}${moreText}`,
            { duration: 8000 }
          );
        }

        // Single URDF found, load it directly
        const fileList = await convertGitHubFilesToFileList(files, candidates[0].path, repoInfo.owner, repoInfo.repo, token);
        
        // Add to recent repos
        addRecentRepo(repoInfo.owner, repoInfo.repo, repoInfo.path, githubUrl.trim());
        
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
      // Block access to unsupported URDFs
      if (candidate.hasUnsupportedFormats === true) {
        const formats = candidate.unsupportedFormats?.join(", ") || "unknown";
        toast.error(`This URDF uses unsupported mesh formats (${formats}). Only .stl files are supported.`, { duration: 6000 });
        return;
      }
      
      setShowUrdfDialog(false);
      
      // Use stored repo info and files if available (avoid re-fetching)
      if (!repoInfo || fetchedFiles.length === 0) {
        // Fallback: re-fetch if we don't have stored data
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
          const parsedRepoInfo = parseGitHubUrl(githubUrl.trim());
          if (!parsedRepoInfo) {
            toast.error("Invalid repository information");
            setIsLoadingGithub(false);
            return;
          }

          const files = await fetchRepoContents(parsedRepoInfo.owner, parsedRepoInfo.repo, parsedRepoInfo.path, token);
          setFetchedFiles(files);
          setRepoInfo({ owner: parsedRepoInfo.owner, repo: parsedRepoInfo.repo, path: parsedRepoInfo.path, token });

          const fileList = await convertGitHubFilesToFileList(files, candidate.path, parsedRepoInfo.owner, parsedRepoInfo.repo, token);
          
          // Add to recent repos
          addRecentRepo(parsedRepoInfo.owner, parsedRepoInfo.repo, parsedRepoInfo.path, githubUrl.trim());
          
          onFolderSelected(fileList);
          toast.success(`Loaded ${candidate.name} from GitHub`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Failed to load selected URDF";
          console.error("[GitHub] URDF load error:", error);
          
          // Check for specific error types
          if (errorMessage.includes("403") || errorMessage.includes("access denied")) {
            toast.error("Token has no access to this repository. Please check your token permissions.");
          } else if (errorMessage.includes("404") || errorMessage.includes("not found")) {
            toast.error("Repository not found or token has no access.");
          } else {
            toast.error(errorMessage);
          }
        } finally {
          setIsLoadingGithub(false);
        }
      } else {
        // Use stored files (no re-fetch needed)
        setIsLoadingGithub(true);
        try {
          const fileList = await convertGitHubFilesToFileList(fetchedFiles, candidate.path, repoInfo.owner, repoInfo.repo, repoInfo.token);
          
          // Add to recent repos (use repoInfo for consistency, fallback to githubUrl if needed)
          const repoUrl = githubUrl.trim() || `${repoInfo.owner}/${repoInfo.repo}${repoInfo.path ? `/${repoInfo.path}` : ''}`;
          addRecentRepo(repoInfo.owner, repoInfo.repo, repoInfo.path, repoUrl);
          
          onFolderSelected(fileList);
          toast.success(`Loaded ${candidate.name} from GitHub`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Failed to load selected URDF";
          console.error("[GitHub] URDF load error:", error);
          toast.error(errorMessage);
        } finally {
          setIsLoadingGithub(false);
        }
      }
    },
    [githubUrl, githubToken, onFolderSelected, repoInfo, fetchedFiles, addRecentRepo]
  );

  /**
   * Load a repository from recent repos
   */
  const loadRecentRepo = useCallback(
    async (recentRepo: { owner: string; repo: string; path?: string; url: string }): Promise<void> => {
      // Set the URL in the input field
      setGithubUrl(recentRepo.url);
      
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
        const visibilityCheck = await checkRepoVisibility(recentRepo.owner, recentRepo.repo, token);
        if (visibilityCheck.error) {
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
        const files = await fetchRepoContents(recentRepo.owner, recentRepo.repo, recentRepo.path, token);

        // Store fetched files and repo info for reuse
        setFetchedFiles(files);
        setRepoInfo({ owner: recentRepo.owner, repo: recentRepo.repo, path: recentRepo.path, token });

        // Find URDF candidates
        let candidates = findURDFCandidates(files);

        if (candidates.length === 0) {
          toast.error("No .urdf file found in the repository");
          setIsLoadingGithub(false);
          return;
        }

        // Check for unsupported formats (same validation as handleGithubLoad)
        candidates = await checkCandidatesForUnsupportedFormats(candidates, files, recentRepo.owner, recentRepo.repo, token);
        
        if (candidates.length === 1) {
          // Single URDF found - check if it has unsupported formats
          if (candidates[0].hasUnsupportedFormats === true) {
            const formats = candidates[0].unsupportedFormats?.join(", ") || "unknown";
            toast.error(`URDF uses unsupported mesh formats (${formats}). Only .stl files are supported.`, { duration: 6000 });
            setIsLoadingGithub(false);
            return;
          }
          
          // Warn about unmatched mesh references but still allow loading
          if (candidates[0].unmatchedMeshReferences && candidates[0].unmatchedMeshReferences.length > 0) {
            const unmatchedCount = candidates[0].unmatchedMeshReferences.length;
            const unmatchedList = candidates[0].unmatchedMeshReferences.slice(0, 3).join(", ");
            const moreText = unmatchedCount > 3 ? ` and ${unmatchedCount - 3} more` : "";
            toast.warning(
              `Warning: ${unmatchedCount} mesh file(s) referenced in URDF but not found in repository: ${unmatchedList}${moreText}`,
              { duration: 8000 }
            );
          }

          // Single URDF found, load it directly
          const fileList = await convertGitHubFilesToFileList(files, candidates[0].path, recentRepo.owner, recentRepo.repo, token);
          
          // Update recent repo (will update lastAccessed timestamp)
          addRecentRepo(recentRepo.owner, recentRepo.repo, recentRepo.path, recentRepo.url);
          
          onFolderSelected(fileList);
          toast.success(`Loaded ${candidates[0].name} from GitHub`);
        } else {
          // Multiple URDF files found, show selection dialog
          setUrdfCandidates(candidates);
          setShowUrdfDialog(true);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to load repository";
        
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
    },
    [githubToken, onFolderSelected, addRecentRepo]
  );

  /**
   * Handle removing a recent repo (with event stopPropagation to prevent loading)
   */
  const handleRemoveRecentRepo = useCallback(
    (e: React.MouseEvent, recentRepo: { owner: string; repo: string; path?: string }): void => {
      e.stopPropagation();
      removeRecentRepo(recentRepo.owner, recentRepo.repo, recentRepo.path);
      toast.success("Removed from recent repositories");
    },
    [removeRecentRepo]
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
            
            {/* Recent Repositories */}
            {recentRepos.length > 0 && (
              <div className="space-y-2 mb-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  <span>Recent Repositories</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {recentRepos.map((repo) => (
                    <div
                      key={`${repo.owner}/${repo.repo}${repo.path ? `/${repo.path}` : ''}`}
                      className="group relative flex items-center gap-2 px-3 py-1.5 bg-muted hover:bg-muted/80 rounded-md cursor-pointer transition-colors"
                      onClick={() => loadRecentRepo(repo)}
                    >
                      <Github className="w-3 h-3 flex-shrink-0" />
                      <span className="text-xs font-medium text-foreground truncate max-w-[200px]">
                        {repo.displayName}
                      </span>
                      <button
                        onClick={(e) => handleRemoveRecentRepo(e, repo)}
                        className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-0.5 hover:bg-destructive/20 rounded transition-opacity"
                        aria-label="Remove from recent"
                      >
                        <X className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
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

          {/* Last Uploaded Folder */}
          {lastLocalFolder && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                <span>Last Uploaded Folder</span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="group relative flex items-center gap-2 px-3 py-1.5 bg-muted hover:bg-muted/80 rounded-md cursor-pointer transition-colors"
                  onClick={handleButtonClick}
                  title={`Click to browse and select "${lastLocalFolder}" folder again`}
                >
                  <Folder className="w-3 h-3 flex-shrink-0" />
                  <span className="text-xs font-medium text-foreground truncate max-w-[200px]">
                    {lastLocalFolder}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      clearLastLocalFolder();
                      toast.success("Cleared last folder");
                    }}
                    className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-0.5 hover:bg-destructive/20 rounded transition-opacity"
                    aria-label="Clear last folder"
                  >
                    <X className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground/80">
                Due to browser security, you need to re-select the folder. Click to open the file browser.
              </p>
            </div>
          )}

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
              {urdfCandidates.map((candidate, index) => {
                const isUnsupported = candidate.hasUnsupportedFormats === true;
                const hasUnmatched = (candidate.unmatchedMeshReferences?.length ?? 0) > 0;
                const formats = candidate.unsupportedFormats?.join(", ") || "";
                const unmatchedRefs = candidate.unmatchedMeshReferences || [];
                
                return (
                  <div key={candidate.path} className="space-y-2">
                    <Button
                      variant="secondary"
                      className={`w-full justify-start text-left h-auto py-3 ${
                        isUnsupported 
                          ? "opacity-50 cursor-not-allowed bg-muted text-muted-foreground" 
                          : index === 0 ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""
                      }`}
                      onClick={() => {
                        if (isUnsupported) {
                          toast.error(`This URDF uses unsupported mesh formats (${formats}). Only .stl files are supported.`, { duration: 6000 });
                          return;
                        }
                        handleUrdfSelect(candidate);
                      }}
                      disabled={isUnsupported}
                    >
                      <div className="flex flex-col items-start gap-1 w-full">
                        <div className="flex items-center gap-2 w-full">
                          <span className={`font-medium ${isUnsupported ? "text-muted-foreground" : ""}`}>
                            {candidate.name}
                          </span>
                          {!isUnsupported && candidate.hasMeshesFolder && (
                            <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">
                              Has Meshes
                            </span>
                          )}
                          {isUnsupported && (
                            <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              Unsupported Formats
                            </span>
                          )}
                          {!isUnsupported && hasUnmatched && (
                            <span className="text-xs bg-yellow-500/20 text-yellow-600 dark:text-yellow-500 px-2 py-0.5 rounded flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              Missing Meshes
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">{candidate.path}</span>
                        {isUnsupported && (
                          <span className="text-xs text-muted-foreground font-medium mt-1">
                            ⚠️ Uses unsupported formats: {formats}. Only .stl files are supported.
                          </span>
                        )}
                      </div>
                    </Button>
                    {!isUnsupported && hasUnmatched && (
                      <div className="ml-4 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
                        <div className="text-xs font-medium text-yellow-700 dark:text-yellow-400 mb-1">
                          Unmatched URDF References
                        </div>
                        <div className="text-xs text-yellow-600 dark:text-yellow-500 mb-1">
                          These mesh files are referenced in the URDF but were not found:
                        </div>
                        <ul className="text-xs text-yellow-600 dark:text-yellow-500 list-disc list-inside space-y-0.5">
                          {unmatchedRefs.map((ref, idx) => (
                            <li key={idx}>{ref}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
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

