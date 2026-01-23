/**
 * Dataset selection component for the training wizard.
 */

import { useState } from "react";
import { Search, Database, FolderOpen, ExternalLink } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
import { useTrainingStore } from "./useTrainingStore";
import type { DatasetSource } from "./types";

// Popular LeRobot datasets for quick selection
const POPULAR_DATASETS = [
  {
    id: "lerobot/aloha_sim_insertion_human",
    name: "ALOHA Sim Insertion",
    description: "Bimanual insertion task in simulation",
    episodes: 50,
  },
  {
    id: "lerobot/aloha_sim_transfer_cube_human",
    name: "ALOHA Sim Transfer",
    description: "Cube transfer task in simulation",
    episodes: 50,
  },
  {
    id: "lerobot/pusht",
    name: "Push-T",
    description: "T-shaped block pushing task",
    episodes: 206,
  },
  {
    id: "lerobot/xarm_lift_medium",
    name: "xArm Lift",
    description: "Object lifting with xArm robot",
    episodes: 100,
  },
];

export function DatasetSelector() {
  const { datasetConfig, setDatasetConfig } = useTrainingStore();

  const [source, setSource] = useState<DatasetSource>(
    datasetConfig?.source || "huggingface"
  );
  const [repoId, setRepoId] = useState(datasetConfig?.repoId || "");
  const [localPath, setLocalPath] = useState(datasetConfig?.localPath || "");
  const [searchQuery, setSearchQuery] = useState("");

  const handleSourceChange = (value: DatasetSource) => {
    setSource(value);
    // Clear the other field
    if (value === "huggingface") {
      setLocalPath("");
    } else {
      setRepoId("");
    }
  };

  const handleSelectDataset = (datasetId: string) => {
    setRepoId(datasetId);
    setDatasetConfig({
      source: "huggingface",
      repoId: datasetId,
    });
  };

  const handleConfirm = () => {
    if (source === "huggingface" && repoId) {
      setDatasetConfig({
        source: "huggingface",
        repoId,
      });
    } else if (source === "local" && localPath) {
      setDatasetConfig({
        source: "local",
        localPath,
      });
    }
  };

  const filteredDatasets = POPULAR_DATASETS.filter(
    (d) =>
      d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const isSelected = (datasetId: string) => {
    return datasetConfig?.repoId === datasetId;
  };

  return (
    <div className="space-y-4">
      {/* Source selection */}
      <div className="space-y-2">
        <Label>Dataset Source</Label>
        <RadioGroup
          value={source}
          onValueChange={(v) => handleSourceChange(v as DatasetSource)}
          className="flex gap-4"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="huggingface" id="source-hf" />
            <Label htmlFor="source-hf" className="cursor-pointer flex items-center gap-1">
              <Database className="w-4 h-4" />
              HuggingFace Hub
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="local" id="source-local" />
            <Label htmlFor="source-local" className="cursor-pointer flex items-center gap-1">
              <FolderOpen className="w-4 h-4" />
              Local Directory
            </Label>
          </div>
        </RadioGroup>
      </div>

      {source === "huggingface" ? (
        <>
          {/* Search */}
          <div className="space-y-2">
            <Label>Search Datasets</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search LeRobot datasets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {/* Popular datasets */}
          <div className="space-y-2">
            <Label>Popular Datasets</Label>
            <div className="grid gap-2">
              {filteredDatasets.map((dataset) => (
                <button
                  key={dataset.id}
                  onClick={() => handleSelectDataset(dataset.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    isSelected(dataset.id)
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50 hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-sm">{dataset.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {dataset.description}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {dataset.episodes} episodes
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 font-mono">
                    {dataset.id}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Manual entry */}
          <div className="space-y-2">
            <Label>Or Enter Dataset ID</Label>
            <div className="flex gap-2">
              <Input
                placeholder="lerobot/your-dataset"
                value={repoId}
                onChange={(e) => setRepoId(e.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`https://huggingface.co/datasets/${repoId}`, "_blank")}
                disabled={!repoId}
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            </div>
            <Button
              onClick={handleConfirm}
              disabled={!repoId}
              className="w-full"
            >
              Select Dataset
            </Button>
          </div>
        </>
      ) : (
        /* Local path */
        <div className="space-y-2">
          <Label>Local Dataset Path</Label>
          <p className="text-xs text-muted-foreground">
            Path to a LeRobot v3 dataset directory
          </p>
          <Input
            placeholder="/path/to/dataset"
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
          />
          <Button
            onClick={handleConfirm}
            disabled={!localPath}
            className="w-full"
          >
            Select Directory
          </Button>
        </div>
      )}

      {/* Current selection */}
      {datasetConfig && (
        <div className="p-3 bg-muted/50 rounded-lg">
          <div className="text-xs text-muted-foreground">Selected Dataset</div>
          <div className="text-sm font-medium mt-1">
            {datasetConfig.source === "huggingface"
              ? datasetConfig.repoId
              : datasetConfig.localPath}
          </div>
        </div>
      )}
    </div>
  );
}
