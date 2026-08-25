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

type WorldSceneImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worldLayoutUrl: string;
  onWorldLayoutUrlChange: (value: string) => void;
  onImportFromLink: () => void;
  onImportDefaultWorld?: () => void;
  onImportDemoWorld?: () => void;
  onImportHkPortWorld?: () => void;
  isSubmitting?: boolean;
};

export const WorldSceneImportDialog = ({
  open,
  onOpenChange,
  worldLayoutUrl,
  onWorldLayoutUrlChange,
  onImportFromLink,
  onImportDefaultWorld,
  onImportDemoWorld,
  onImportHkPortWorld,
  isSubmitting = false,
}: WorldSceneImportDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-xl bg-[#1f1f1f] border-[#3d3d3d] text-[#d4d4d4]">
      <DialogHeader>
        <DialogTitle className="text-[#f0f0f0]">Import World Layout</DialogTitle>
        <DialogDescription className="text-[#a8a8a8]">
          Choose one import source: default layout, demo layout, bundled port world, or a custom JSON link.
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
          <Label htmlFor="world-layout-url" className="text-[#d4d4d4]">
            World Layout URL
          </Label>
          <Input
            id="world-layout-url"
            value={worldLayoutUrl}
            onChange={(event) => onWorldLayoutUrlChange(event.target.value)}
            placeholder="https://raw.githubusercontent.com/org/repo/main/path/world-layout.json"
            className="bg-[#252526] border-[#3d3d3d] text-[#e2e2e2]"
          />
          <p className="text-xs text-[#9f9f9f]">
            GitHub blob links are accepted and converted automatically.
          </p>
        </div>
        <DialogFooter className="gap-2">
          {onImportDefaultWorld ? (
            <Button
              type="button"
              variant="outline"
              onClick={onImportDefaultWorld}
              disabled={isSubmitting}
              className="border-[#3d3d3d] bg-[#252526] text-[#d4d4d4] hover:bg-[#323233] hover:text-white"
            >
              Default Layout
            </Button>
          ) : null}
          {onImportDemoWorld ? (
            <Button
              type="button"
              variant="outline"
              onClick={onImportDemoWorld}
              disabled={isSubmitting}
              className="border-[#3d3d3d] bg-[#252526] text-[#d4d4d4] hover:bg-[#323233] hover:text-white"
            >
              Demo Layout
            </Button>
          ) : null}
          {onImportHkPortWorld ? (
            <Button
              type="button"
              variant="outline"
              onClick={onImportHkPortWorld}
              disabled={isSubmitting}
              className="border-[#3d3d3d] bg-[#252526] text-[#d4d4d4] hover:bg-[#323233] hover:text-white"
            >
              HK Port World
            </Button>
          ) : null}
          <Button
            type="submit"
            disabled={isSubmitting || worldLayoutUrl.trim().length === 0}
            className="bg-[#3d3d3d] text-white hover:bg-[#4a4a4a]"
          >
            {isSubmitting ? "Importing..." : "From Link"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
);
