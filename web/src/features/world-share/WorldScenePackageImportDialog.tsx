import { Upload } from "lucide-react";

import { Button } from "@/shared/ui/button";
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
  onImportFromFile: () => void;
  isSubmitting?: boolean;
};

export const WorldScenePackageImportDialog = ({
  open,
  onOpenChange,
  onImportFromFile,
  isSubmitting = false,
}: WorldScenePackageImportDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-xl bg-[#1f1f1f] border-[#3d3d3d] text-[#d4d4d4]">
      <DialogHeader>
        <DialogTitle className="text-[#f0f0f0]">Import Scene Package</DialogTitle>
        <DialogDescription className="text-[#a8a8a8]">
          Load a world scene package from a local JSON file.
        </DialogDescription>
      </DialogHeader>
      <p className="text-xs text-[#9f9f9f]">
        Scene packages are imported from a file picker. Link imports are not supported here.
      </p>
      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onImportFromFile}
          disabled={isSubmitting}
          className="border-[#3d3d3d] bg-[#252526] text-[#d4d4d4] hover:bg-[#323233] hover:text-white"
        >
          <Upload className="mr-2 h-4 w-4" />
          {isSubmitting ? "Importing..." : "From File"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
