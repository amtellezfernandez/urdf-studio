/**
 * Hyperparameter configuration form for the training wizard.
 */

import { Info } from "lucide-react";

import { Label } from "@/shared/ui/label";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { useTrainingStore } from "./useTrainingStore";

const LR_SCHEDULERS = [
  { value: "cosine", label: "Cosine Annealing" },
  { value: "linear", label: "Linear Decay" },
  { value: "constant", label: "Constant" },
  { value: "cosine_with_restarts", label: "Cosine with Restarts" },
];

export function HyperparameterForm() {
  const { trainingParams, setTrainingParams } = useTrainingStore();

  const handleChange = (key: string, value: string | number) => {
    setTrainingParams({ [key]: value });
  };

  return (
    <div className="space-y-6">
      {/* Basic Parameters */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-muted-foreground" />
          <Label className="text-sm font-medium">Basic Parameters</Label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs">Batch Size</Label>
            <Input
              type="number"
              min={1}
              max={512}
              value={trainingParams.batchSize}
              onChange={(e) => handleChange("batchSize", parseInt(e.target.value) || 1)}
              className="h-8 text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              Samples per gradient update
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Learning Rate</Label>
            <Input
              type="number"
              step={0.00001}
              min={0}
              value={trainingParams.learningRate}
              onChange={(e) => handleChange("learningRate", parseFloat(e.target.value) || 0.0001)}
              className="h-8 text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              Initial learning rate
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Epochs</Label>
            <Input
              type="number"
              min={1}
              max={10000}
              value={trainingParams.epochs}
              onChange={(e) => handleChange("epochs", parseInt(e.target.value) || 1)}
              className="h-8 text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              Total training epochs
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Random Seed</Label>
            <Input
              type="number"
              min={0}
              value={trainingParams.seed}
              onChange={(e) => handleChange("seed", parseInt(e.target.value) || 42)}
              className="h-8 text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              For reproducibility
            </p>
          </div>
        </div>
      </div>

      {/* Optimization Parameters */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-muted-foreground" />
          <Label className="text-sm font-medium">Optimization</Label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs">LR Scheduler</Label>
            <Select
              value={trainingParams.lrScheduler}
              onValueChange={(v) => handleChange("lrScheduler", v)}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LR_SCHEDULERS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Warmup Steps</Label>
            <Input
              type="number"
              min={0}
              value={trainingParams.warmupSteps}
              onChange={(e) => handleChange("warmupSteps", parseInt(e.target.value) || 0)}
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Weight Decay</Label>
            <Input
              type="number"
              step={0.001}
              min={0}
              value={trainingParams.weightDecay}
              onChange={(e) => handleChange("weightDecay", parseFloat(e.target.value) || 0)}
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Max Grad Norm</Label>
            <Input
              type="number"
              step={0.1}
              min={0}
              value={trainingParams.maxGradNorm || 1.0}
              onChange={(e) => handleChange("maxGradNorm", parseFloat(e.target.value) || 1.0)}
              className="h-8 text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              Gradient clipping
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Gradient Accumulation Steps</Label>
            <Input
              type="number"
              min={1}
              value={trainingParams.gradientAccumulationSteps}
              onChange={(e) => handleChange("gradientAccumulationSteps", parseInt(e.target.value) || 1)}
              className="h-8 text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              Effective batch = batch_size × steps
            </p>
          </div>
        </div>
      </div>

      {/* Checkpointing */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-muted-foreground" />
          <Label className="text-sm font-medium">Checkpointing</Label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs">Checkpoint Interval (epochs)</Label>
            <Input
              type="number"
              min={1}
              value={trainingParams.checkpointInterval}
              onChange={(e) => handleChange("checkpointInterval", parseInt(e.target.value) || 10)}
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Keep Last N Checkpoints</Label>
            <Input
              type="number"
              min={1}
              value={trainingParams.keepLastNCheckpoints}
              onChange={(e) => handleChange("keepLastNCheckpoints", parseInt(e.target.value) || 3)}
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Early Stopping Patience</Label>
            <Input
              type="number"
              min={0}
              placeholder="Disabled"
              value={trainingParams.earlyStoppingPatience || ""}
              onChange={(e) => {
                const val = e.target.value ? parseInt(e.target.value) : undefined;
                handleChange("earlyStoppingPatience", val as number);
              }}
              className="h-8 text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              0 or empty = disabled
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Output Directory</Label>
            <Input
              type="text"
              value={trainingParams.outputDir}
              onChange={(e) => handleChange("outputDir", e.target.value)}
              className="h-8 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Run Name */}
      <div className="space-y-2">
        <Label className="text-xs">Run Name (optional)</Label>
        <Input
          type="text"
          placeholder="Auto-generated if empty"
          value={trainingParams.runName || ""}
          onChange={(e) => handleChange("runName", e.target.value)}
          className="h-8 text-sm"
        />
        <p className="text-[10px] text-muted-foreground">
          Human-readable name for this experiment
        </p>
      </div>
    </div>
  );
}
