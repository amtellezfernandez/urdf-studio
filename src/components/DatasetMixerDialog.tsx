import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { X, Plus, Loader2, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";

interface DatasetMixerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentEpisodesCount: number;
  onMixComplete: () => void;
  exportCurrentEpisodes: () => Promise<Blob>; // Function to export current episodes as zip blob
  loadEpisodesFromZip: (zip: JSZip) => Promise<void>; // Function to load episodes from zip
}

export const DatasetMixerDialog = ({
  isOpen,
  onClose,
  currentEpisodesCount,
  onMixComplete,
  exportCurrentEpisodes,
  loadEpisodesFromZip,
}: DatasetMixerDialogProps) => {
  const [hfDatasets, setHfDatasets] = useState<string[]>([]);
  const [localFiles, setLocalFiles] = useState<File[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [isMixing, setIsMixing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addHfDataset = () => {
    const trimmed = searchInput.trim();
    if (trimmed && !hfDatasets.includes(trimmed)) {
      // Validate format (owner/dataset-name)
      if (!trimmed.includes("/") || trimmed.split("/").length !== 2) {
        toast.error("Invalid format. Use: owner/dataset-name (e.g., lerobot/svla_so100_pickplace)");
        return;
      }
      setHfDatasets([...hfDatasets, trimmed]);
      setSearchInput("");
    }
  };

  const removeHfDataset = (dataset: string) => {
    setHfDatasets(hfDatasets.filter((d) => d !== dataset));
  };

  const handleLocalFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    setLocalFiles([...localFiles, ...fileArray]);
  };

  const removeLocalFile = (index: number) => {
    setLocalFiles(localFiles.filter((_, i) => i !== index));
  };

  const handleMix = async () => {
    // Need at least one source (current episodes OR new datasets)
    if (hfDatasets.length === 0 && localFiles.length === 0 && currentEpisodesCount === 0) {
      toast.error("Add at least one dataset to mix");
      return;
    }

    setIsMixing(true);
    try {
      // Step 1: Export current episodes to temp blob if they exist
      let currentEpisodesBlob: Blob | null = null;
      if (currentEpisodesCount > 0) {
        toast.info("Exporting current episodes...");
        try {
          currentEpisodesBlob = await exportCurrentEpisodes();
        } catch (error) {
          console.error("Failed to export current episodes:", error);
          toast.error("Failed to export current episodes. Continuing with other datasets only.");
        }
      }

      // Step 2: Prepare local paths
      // For now, we'll need to upload local files to a temp location
      // or handle them differently. For simplicity, we'll focus on HF datasets
      // and current episodes first, and note that local file handling needs more work
      
      const localPaths: string[] = [];
      if (localFiles.length > 0) {
        toast.warning("Local file mixing is not yet fully implemented. Using Hugging Face datasets only.");
        // TODO: Implement local file handling
        // Would need to upload files to server or handle them client-side
      }

      // Step 3: If we have current episodes, we need to upload them to a temp location
      // For now, let's use a simpler approach: just mix HF datasets and note that
      // current episodes mixing requires server-side file handling
      
      if (currentEpisodesBlob && currentEpisodesCount > 0) {
        toast.warning("Mixing current episodes requires server-side file handling. This will be implemented in the next step.");
        // TODO: Upload blob to server, get path, then mix
      }

      // Step 4: Call mixing API (for now, just HF datasets)
      if (hfDatasets.length === 0) {
        toast.error("Please add at least one Hugging Face dataset to mix");
        setIsMixing(false);
        return;
      }

      toast.info("Mixing datasets...");
      const response = await fetch("http://localhost:3001/api/mix-datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoIds: hfDatasets,
          localPaths: localPaths.length > 0 ? localPaths : undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to mix datasets");
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || "Mixing failed");
      }

      // Step 5: For now, show success message
      // In a full implementation, we'd download and load the mixed dataset
      toast.success(
        `Successfully mixed ${result.total_episodes} episodes from ${result.info.datasets_loaded} dataset(s)!`
      );
      
      // TODO: Download and load the mixed dataset
      // This requires the Python script to save the mixed dataset and return a download URL
      // For now, we'll just show the success message
      
      toast.info("Dataset mixing complete! Full loading functionality will be implemented next.");
      
      // Reset state
      setHfDatasets([]);
      setLocalFiles([]);
      setSearchInput("");
      
      // Note: We're not calling onMixComplete yet since we need to implement
      // the actual loading of the mixed dataset
      // onMixComplete();
      // onClose();
    } catch (error) {
      console.error("Failed to mix datasets:", error);
      toast.error(error instanceof Error ? error.message : "Failed to mix datasets");
    } finally {
      setIsMixing(false);
    }
  };

  const totalSources =
    (currentEpisodesCount > 0 ? 1 : 0) + hfDatasets.length + localFiles.length;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mix Datasets</DialogTitle>
          <DialogDescription>
            Combine your current episodes with datasets from Hugging Face or local files
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current Episodes Section */}
          {currentEpisodesCount > 0 && (
            <div className="p-4 bg-muted/50 rounded-lg border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Current Episodes</span>
                <Badge variant="secondary">{currentEpisodesCount} episodes</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Episodes currently loaded in your workspace (from any source)
              </p>
            </div>
          )}

          {/* Tabs for adding new sources */}
          <Tabs defaultValue="huggingface" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="huggingface">Hugging Face</TabsTrigger>
              <TabsTrigger value="local">Local Files</TabsTrigger>
            </TabsList>

            {/* Hugging Face Tab */}
            <TabsContent value="huggingface" className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="e.g., lerobot/svla_so100_pickplace"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && addHfDataset()}
                />
                <Button onClick={addHfDataset} size="icon">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              {hfDatasets.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {hfDatasets.map((dataset) => (
                    <Badge key={dataset} variant="outline" className="gap-1 py-1 px-2">
                      {dataset}
                      <button
                        onClick={() => removeHfDataset(dataset)}
                        className="ml-1 hover:bg-muted rounded"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Enter Hugging Face dataset IDs in format: owner/dataset-name
              </p>
            </TabsContent>

            {/* Local Files Tab */}
            <TabsContent value="local" className="space-y-3">
              <div className="flex gap-2">
                <Input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleLocalFileSelect}
                  multiple
                  className="hidden"
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full"
                >
                  <FolderOpen className="w-4 h-4 mr-2" />
                  Select Dataset Files or Folders
                </Button>
              </div>

              {localFiles.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium">Selected files:</p>
                  <div className="space-y-1">
                    {localFiles.map((file, idx) => (
                      <Badge key={idx} variant="outline" className="gap-1 py-1 px-2">
                        {file.name}
                        <button
                          onClick={() => removeLocalFile(idx)}
                          className="ml-1 hover:bg-muted rounded"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Select local dataset files or zip archives containing LeRobot datasets
              </p>
            </TabsContent>
          </Tabs>

          {/* Summary */}
          <div className="p-3 bg-muted/50 rounded-lg border-t">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Total Sources:</span>
              <Badge>{totalSources}</Badge>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={onClose} disabled={isMixing}>
              Cancel
            </Button>
            <Button onClick={handleMix} disabled={isMixing || totalSources === 0}>
              {isMixing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Mixing...
                </>
              ) : (
                `Mix & Load (${totalSources} source${totalSources !== 1 ? "s" : ""})`
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

