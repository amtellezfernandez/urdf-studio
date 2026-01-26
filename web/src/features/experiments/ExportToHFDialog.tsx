/**
 * ExportToHFDialog component - Dialog for exporting models to HuggingFace Hub
 */

import { useState } from "react";
import { Loader2, ExternalLink, CheckCircle, XCircle } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { API_BASE_URL } from "@/shared/config/api";

// ============================================================================
// Types
// ============================================================================

interface ExportToHFDialogProps {
  open: boolean;
  onClose: () => void;
  runId: string;
  checkpoints: string[];
}

interface ExportResult {
  success: boolean;
  repo_url?: string;
  commit_hash?: string;
  error?: string;
}

// ============================================================================
// Component
// ============================================================================

export function ExportToHFDialog({
  open,
  onClose,
  runId,
  checkpoints,
}: ExportToHFDialogProps) {
  const [repoId, setRepoId] = useState("");
  const [checkpoint, setCheckpoint] = useState(
    checkpoints.includes("final_model") ? "final_model" : checkpoints[0] || ""
  );
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);

  const handleExport = async () => {
    if (!repoId.trim()) {
      return;
    }

    setExporting(true);
    setResult(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/models/export/hf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          run_id: runId,
          checkpoint_name: checkpoint,
          repo_id: repoId.trim(),
        }),
      });
      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : "Export failed",
      });
    } finally {
      setExporting(false);
    }
  };

  const handleClose = () => {
    setRepoId("");
    setCheckpoint(
      checkpoints.includes("final_model") ? "final_model" : checkpoints[0] || ""
    );
    setResult(null);
    onClose();
  };

  const isValidRepoId = repoId.includes("/") && repoId.split("/").length === 2;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export to HuggingFace</DialogTitle>
          <DialogDescription>
            Export your trained model to HuggingFace Hub for sharing and deployment.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          // Result view
          <div className="py-4">
            {result.success ? (
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="p-3 bg-green-500/20 rounded-full">
                  <CheckCircle className="h-8 w-8 text-green-500" />
                </div>
                <div>
                  <h3 className="font-medium text-lg">Export Successful!</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Your model has been uploaded to HuggingFace Hub.
                  </p>
                </div>
                {result.repo_url && (
                  <Button
                    variant="outline"
                    onClick={() => window.open(result.repo_url, "_blank")}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    View on HuggingFace
                  </Button>
                )}
                {result.commit_hash && (
                  <p className="text-xs text-muted-foreground font-mono">
                    Commit: {result.commit_hash}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="p-3 bg-red-500/20 rounded-full">
                  <XCircle className="h-8 w-8 text-red-500" />
                </div>
                <div>
                  <h3 className="font-medium text-lg">Export Failed</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {result.error || "An unknown error occurred."}
                  </p>
                </div>
                <Button variant="outline" onClick={() => setResult(null)}>
                  Try Again
                </Button>
              </div>
            )}
          </div>
        ) : (
          // Form view
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="repo-id">Repository ID</Label>
              <Input
                id="repo-id"
                placeholder="username/model-name"
                value={repoId}
                onChange={(e) => setRepoId(e.target.value)}
                disabled={exporting}
              />
              <p className="text-xs text-muted-foreground">
                Format: username/model-name (e.g., myuser/my-robot-policy)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="checkpoint">Checkpoint</Label>
              <Select
                value={checkpoint}
                onValueChange={setCheckpoint}
                disabled={exporting || checkpoints.length <= 1}
              >
                <SelectTrigger id="checkpoint">
                  <SelectValue placeholder="Select checkpoint" />
                </SelectTrigger>
                <SelectContent>
                  {checkpoints.map((cp) => (
                    <SelectItem key={cp} value={cp}>
                      {cp}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <p className="font-medium mb-2">Bundle will include:</p>
              <ul className="text-muted-foreground space-y-1 text-xs">
                <li>- Model weights and config</li>
                <li>- Training configuration</li>
                <li>- Dataset reference with version</li>
                <li>- URDF hash (if available)</li>
                <li>- README.md model card</li>
              </ul>
            </div>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={handleClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={exporting}>
                Cancel
              </Button>
              <Button
                onClick={handleExport}
                disabled={exporting || !isValidRepoId}
              >
                {exporting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Exporting...
                  </>
                ) : (
                  "Export"
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
