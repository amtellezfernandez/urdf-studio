import { Link2, Upload } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

type WorldScenePackageImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worldPackageUrl: string;
  onWorldPackageUrlChange: (value: string) => void;
  onImportFromFile: () => void;
  onImportFromLink: () => void;
  isSubmitting?: boolean;
};

export const WorldScenePackageImportDialog = ({
  open,
  onOpenChange,
  worldPackageUrl,
  onWorldPackageUrlChange,
  onImportFromFile,
  onImportFromLink,
  isSubmitting = false,
}: WorldScenePackageImportDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-xl bg-[#1f1f1f] border-[#3d3d3d] text-[#d4d4d4]">
      <DialogHeader>
        <DialogTitle className="text-[#f0f0f0]">Import Scene Package</DialogTitle>
        <DialogDescription className="text-[#a8a8a8]">
          Load a world scene package from a local JSON file or a JSON link.
        </DialogDescription>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onImportFromLink();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="world-package-url" className="text-[#d4d4d4]">
            Scene Package URL
          </Label>
          <Input
            id="world-package-url"
            value={worldPackageUrl}
            onChange={(event) => onWorldPackageUrlChange(event.target.value)}
            placeholder="https://raw.githubusercontent.com/org/repo/main/path/world-package.json"
            className="bg-[#252526] border-[#3d3d3d] text-[#e2e2e2]"
          />
          <p className="text-xs text-[#9f9f9f]">
            GitHub blob links are accepted and converted automatically.
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onImportFromFile}
            disabled={isSubmitting}
            className="border-[#3d3d3d] bg-[#252526] text-[#d4d4d4] hover:bg-[#323233] hover:text-white"
          >
            <Upload className="mr-2 h-4 w-4" />
            From File
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting || worldPackageUrl.trim().length === 0}
            className="bg-[#3d3d3d] text-white hover:bg-[#4a4a4a]"
          >
            <Link2 className="mr-2 h-4 w-4" />
            {isSubmitting ? "Importing..." : "From Link"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
);
