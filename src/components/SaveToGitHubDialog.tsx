import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Github, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  parseGitHubUrl,
  uploadFileToGitHub,
  updateURDFMeshPathsToAssets,
  extractMeshReferencesFromURDF,
  checkFileExists,
  checkAssetsFolderExists,
  generateCommitMessage,
} from "@/utils/github-repo";

interface SaveToGitHubDialogProps {
  isOpen: boolean;
  onClose: () => void;
  urdfContent: string;
  meshFiles: Record<string, Blob>;
  accessToken: string;
  onSuccess?: (repoUrl: string) => void;
}

/**
 * Match URDF mesh reference to actual file in meshFiles
 * Tries multiple path variations similar to Viewer3D
 */
function findMeshFileForReference(meshRef: string, meshFiles: Record<string, Blob>): { path: string; blob: Blob } | null {
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
}

export const SaveToGitHubDialog = ({
  isOpen,
  onClose,
  urdfContent,
  meshFiles,
  accessToken,
  onSuccess,
}: SaveToGitHubDialogProps) => {
  const [repoUrl, setRepoUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [overwriteInfo, setOverwriteInfo] = useState<{
    urdfExists: boolean;
    assetsExists: boolean;
    owner: string;
    repo: string;
  } | null>(null);

  const performSave = useCallback(async (repoInfo: { owner: string; repo: string }, confirmed: boolean = false) => {
    setIsSaving(true);
    setError(null);

    try {
      // Check for existing files if not already confirmed
      if (!confirmed) {
        const [urdfCheck, assetsCheck] = await Promise.all([
          checkFileExists(repoInfo.owner, repoInfo.repo, "robot.urdf", accessToken),
          checkAssetsFolderExists(repoInfo.owner, repoInfo.repo, accessToken),
        ]);

        if (urdfCheck.exists || assetsCheck) {
          setOverwriteInfo({
            urdfExists: urdfCheck.exists,
            assetsExists: assetsCheck,
            owner: repoInfo.owner,
            repo: repoInfo.repo,
          });
          setShowOverwriteConfirm(true);
          setIsSaving(false);
          return;
        }
      }

      // Get SHA for existing URDF if it exists
      const urdfCheck = await checkFileExists(repoInfo.owner, repoInfo.repo, "robot.urdf", accessToken);
      // Extract mesh references from URDF
      const meshReferences = extractMeshReferencesFromURDF(urdfContent);
      
      // Find matching .stl files for each reference
      const filesToUpload: Array<{ fileName: string; blob: Blob; originalRef: string }> = [];
      const matchedRefs = new Set<string>();
      
      for (const meshRef of meshReferences) {
        const normalized = meshRef
          .replace(/^package:\/\/[^/]+\//, "")
          .replace(/^file:\/\//, "")
          .trim();
        
        // Only process .stl files
        const fileName = normalized.split("/").pop() || normalized;
        if (!fileName.toLowerCase().endsWith(".stl")) {
          continue;
        }
        
        const match = findMeshFileForReference(meshRef, meshFiles);
        if (match) {
          const fileName = match.path.split("/").pop() || match.path;
          // Avoid duplicates
          if (!matchedRefs.has(fileName)) {
            filesToUpload.push({
              fileName,
              blob: match.blob,
              originalRef: meshRef,
            });
            matchedRefs.add(fileName);
          }
        }
      }

      // Update URDF to use assets/ folder for meshes
      const updatedUrdf = updateURDFMeshPathsToAssets(urdfContent);

      // Upload URDF file with commit message
      toast.info(urdfCheck.exists ? "Updating URDF file..." : "Uploading URDF file...");
      await uploadFileToGitHub(
        repoInfo.owner,
        repoInfo.repo,
        "robot.urdf",
        updatedUrdf,
        generateCommitMessage("Update robot URDF"),
        accessToken,
        urdfCheck.sha
      );

      // Upload only the .stl files referenced in URDF
      if (filesToUpload.length > 0) {
        toast.info(`Uploading ${filesToUpload.length} mesh file(s) to assets/ folder...`);
        
        // Upload meshes in batches to avoid rate limits
        const BATCH_SIZE = 5;
        for (let i = 0; i < filesToUpload.length; i += BATCH_SIZE) {
          const batch = filesToUpload.slice(i, i + BATCH_SIZE);
          
          await Promise.all(
            batch.map(async ({ fileName, blob }) => {
              // Check if file already exists to get SHA for overwrite
              const fileCheck = await checkFileExists(
                repoInfo.owner,
                repoInfo.repo,
                `assets/${fileName}`,
                accessToken
              );
              
              const arrayBuffer = await blob.arrayBuffer();
              
              await uploadFileToGitHub(
                repoInfo.owner,
                repoInfo.repo,
                `assets/${fileName}`,
                arrayBuffer,
                generateCommitMessage(`Update mesh file: ${fileName}`),
                accessToken,
                fileCheck.sha
              );
            })
          );

          // Small delay between batches
          if (i + BATCH_SIZE < filesToUpload.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
      } else {
        toast.warning("No .stl mesh files found that match URDF references");
      }

      const finalRepoUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}`;
      toast.success(`Successfully saved to GitHub!`);
      toast.info(`Repository: ${finalRepoUrl}`, { duration: 5000 });
      
      onSuccess?.(finalRepoUrl);
      onClose();
      
      // Reset form
      setRepoUrl("");
      setShowOverwriteConfirm(false);
      setOverwriteInfo(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to save to GitHub";
      setError(errorMessage);
      toast.error(errorMessage);
      console.error("Save to GitHub error:", error);
    } finally {
      setIsSaving(false);
    }
  }, [urdfContent, meshFiles, accessToken, onSuccess, onClose]);

  const handleSave = useCallback(async () => {
    if (!repoUrl.trim()) {
      setError("Repository URL is required");
      return;
    }

    // Parse repository URL
    const repoInfo = parseGitHubUrl(repoUrl.trim());
    if (!repoInfo) {
      setError("Invalid GitHub repository URL. Format: owner/repo or https://github.com/owner/repo");
      return;
    }

    await performSave(repoInfo, false);
  }, [repoUrl, performSave]);

  const handleConfirmOverwrite = useCallback(async () => {
    if (!overwriteInfo) return;
    setShowOverwriteConfirm(false);
    await performSave({ owner: overwriteInfo.owner, repo: overwriteInfo.repo }, true);
  }, [overwriteInfo, performSave]);

  const handleClose = useCallback(() => {
    if (!isSaving) {
      setError(null);
      onClose();
    }
  }, [isSaving, onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="w-5 h-5" />
            Save to GitHub
          </DialogTitle>
          <DialogDescription>
            Add your modified URDF and referenced mesh files to an existing GitHub repository.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="repo-url">Repository URL *</Label>
            <Input
              id="repo-url"
              placeholder="owner/repo or https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              disabled={isSaving}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isSaving && repoUrl.trim()) {
                  handleSave();
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              Enter the GitHub repository where you want to save the files
            </p>
          </div>

          <div className="rounded-md bg-muted p-3 space-y-1">
            <p className="text-xs font-medium">Files to upload:</p>
            <ul className="text-xs text-muted-foreground space-y-0.5 ml-4 list-disc">
              <li>robot.urdf (with updated mesh paths pointing to assets/)</li>
              <li>assets/ folder with only .stl files referenced in the URDF</li>
            </ul>
            <p className="text-xs text-muted-foreground mt-2 italic">
              Note: Only .stl mesh files that are actually referenced in the URDF will be uploaded.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !repoUrl.trim()}>
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Github className="w-4 h-4 mr-2" />
                Save to Repository
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Overwrite Confirmation Dialog */}
      <Dialog open={showOverwriteConfirm} onOpenChange={(open) => !open && setShowOverwriteConfirm(false)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              Overwrite Existing Files?
            </DialogTitle>
            <DialogDescription>
              The following files/folders already exist in the repository:
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="rounded-md bg-muted p-3 space-y-2">
              {overwriteInfo?.urdfExists && (
                <div className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-yellow-500" />
                  <span><code className="text-xs bg-background px-1 py-0.5 rounded">robot.urdf</code> already exists</span>
                </div>
              )}
              {overwriteInfo?.assetsExists && (
                <div className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-yellow-500" />
                  <span><code className="text-xs bg-background px-1 py-0.5 rounded">assets/</code> folder already exists</span>
                </div>
              )}
            </div>

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Overwriting will replace the existing files. This action cannot be undone.
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOverwriteConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmOverwrite} variant="default">
              Yes, Overwrite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
};

