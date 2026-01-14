import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertCircle } from "lucide-react";

interface EpisodeSelectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  totalEpisodes: number;
  episodeIndices: number[];
  onContinue: (selectedMode: SelectionMode) => void;
  datasetName: string;
  loadedEpisodeIndex?: number; // The preview episode that was already loaded
}

export interface SelectionMode {
  type: "specific" | "all";
  specificEpisodes?: number[];
}

export const EpisodeSelectionDialog = ({
  isOpen,
  onClose,
  totalEpisodes,
  episodeIndices,
  onContinue,
  datasetName,
  loadedEpisodeIndex,
}: EpisodeSelectionDialogProps) => {
  const [selectionType, setSelectionType] = useState<"specific" | "all">("all");
  const [specificMode, setSpecificMode] = useState<"numbers" | "interval">("numbers");
  const [numbersInput, setNumbersInput] = useState<string>("");
  const [intervalStart, setIntervalStart] = useState<string>("");
  const [intervalEnd, setIntervalEnd] = useState<string>("");
  const [error, setError] = useState<string>("");

  // Filter out the already loaded episode
  const availableEpisodes = episodeIndices.filter(idx => idx !== loadedEpisodeIndex);
  const remainingCount = availableEpisodes.length;

  const handleContinue = () => {
    setError("");

    if (selectionType === "specific") {
      let selectedEpisodes: number[] = [];

      if (specificMode === "numbers") {
        // Parse comma-separated numbers
        const numbers = numbersInput
          .split(",")
          .map((n) => n.trim())
          .filter((n) => n !== "");

        if (numbers.length === 0) {
          setError("Please enter at least one episode number");
          return;
        }

        for (const num of numbers) {
          const episodeNum = parseInt(num, 10);
          if (isNaN(episodeNum)) {
            setError(`Invalid episode number: ${num}`);
            return;
          }
          if (episodeNum === loadedEpisodeIndex) {
            setError(`Episode ${episodeNum} is already loaded`);
            return;
          }
          if (!episodeIndices.includes(episodeNum)) {
            setError(`Episode ${episodeNum} not found in dataset`);
            return;
          }
          selectedEpisodes.push(episodeNum);
        }
      } else {
        // Parse interval
        const start = parseInt(intervalStart, 10);
        const end = parseInt(intervalEnd, 10);

        if (isNaN(start) || isNaN(end)) {
          setError("Please enter valid start and end episode numbers");
          return;
        }

        if (start > end) {
          setError("Start episode must be less than or equal to end episode");
          return;
        }

        // Get all episodes in the interval that exist in the dataset (excluding loaded episode)
        selectedEpisodes = availableEpisodes.filter((idx) => idx >= start && idx <= end);

        if (selectedEpisodes.length === 0) {
          setError(`No episodes found in range ${start}-${end} (excluding already loaded episodes)`);
          return;
        }
      }

      onContinue({
        type: "specific",
        specificEpisodes: selectedEpisodes,
      });
    } else {
      onContinue({
        type: "all",
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Load More Episodes</DialogTitle>
          <DialogDescription>
            Dataset: <span className="font-semibold">{datasetName}</span>
            <br />
            {loadedEpisodeIndex !== undefined && (
              <>
                Preview episode {loadedEpisodeIndex} is already loaded.
                <br />
              </>
            )}
            <span className="font-semibold">{remainingCount}</span> remaining episode(s) available
            {remainingCount > 0 && (
              <>
                {" "}(indices: {availableEpisodes.slice(0, 10).join(", ")}
                {availableEpisodes.length > 10 ? "..." : ""})
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <RadioGroup
            value={selectionType}
            onValueChange={(value) => {
              if (value === "specific" || value === "all") {
                setSelectionType(value);
              }
            }}
          >
            {/* Import All Mode */}
            <div className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-accent/50 transition-colors">
              <RadioGroupItem value="all" id="all" className="mt-1" />
              <div className="flex-1">
                <Label htmlFor="all" className="text-base font-semibold cursor-pointer">
                  Import all remaining episodes
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Apply the same transforms to all {remainingCount} remaining episode(s)
                </p>
              </div>
            </div>

            {/* Specific Episodes Mode */}
            <div className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-accent/50 transition-colors">
              <RadioGroupItem value="specific" id="specific" className="mt-1" />
              <div className="flex-1">
                <Label htmlFor="specific" className="text-base font-semibold cursor-pointer">
                  Select specific episodes
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Choose episodes by numbers or interval
                </p>

                {selectionType === "specific" && (
                  <div className="mt-3 space-y-3">
                    <RadioGroup
                      value={specificMode}
                      onValueChange={(v) => setSpecificMode(v as "numbers" | "interval")}
                      className="flex gap-4"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="numbers" id="numbers" />
                        <Label htmlFor="numbers" className="cursor-pointer">
                          By numbers
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="interval" id="interval" />
                        <Label htmlFor="interval" className="cursor-pointer">
                          By interval
                        </Label>
                      </div>
                    </RadioGroup>

                    {specificMode === "numbers" ? (
                      <div>
                        <Label htmlFor="numbers-input" className="text-sm">
                          Episode numbers (comma-separated):
                        </Label>
                        <Input
                          id="numbers-input"
                          type="text"
                          placeholder="e.g., 0,5,10,15"
                          value={numbersInput}
                          onChange={(e) => setNumbersInput(e.target.value)}
                          className="mt-1"
                        />
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label htmlFor="interval-start" className="text-sm">
                            Start episode:
                          </Label>
                          <Input
                            id="interval-start"
                            type="number"
                            placeholder="e.g., 0"
                            value={intervalStart}
                            onChange={(e) => setIntervalStart(e.target.value)}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label htmlFor="interval-end" className="text-sm">
                            End episode:
                          </Label>
                          <Input
                            id="interval-end"
                            type="number"
                            placeholder={`e.g., ${totalEpisodes - 1}`}
                            value={intervalEnd}
                            onChange={(e) => setIntervalEnd(e.target.value)}
                            className="mt-1"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </RadioGroup>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
              <AlertCircle className="h-4 w-4 text-destructive" />
              <span className="text-sm text-destructive">{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleContinue} disabled={remainingCount === 0}>
            Load Episodes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
