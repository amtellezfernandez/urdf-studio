import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

export type WorldScenePublishDraft = {
  packageId: string;
  version: string;
  title: string;
  description: string;
};

type WorldPublishDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  publishTargetLabel: string;
  draft: WorldScenePublishDraft;
  onDraftChange: (next: WorldScenePublishDraft) => void;
  onSubmit: () => void;
  isSubmitting?: boolean;
};

const updateDraftField = (
  draft: WorldScenePublishDraft,
  key: keyof WorldScenePublishDraft,
  value: string
): WorldScenePublishDraft => ({ ...draft, [key]: value });

export const WorldPublishDialog = ({
  open,
  onOpenChange,
  publishTargetLabel,
  draft,
  onDraftChange,
  onSubmit,
  isSubmitting = false,
}: WorldPublishDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-xl bg-[#1f1f1f] border-[#3d3d3d] text-[#d4d4d4]">
      <DialogHeader>
        <DialogTitle className="text-[#f0f0f0]">Publish World Package</DialogTitle>
        <DialogDescription className="text-[#a8a8a8]">
          Publish the current robot + cameras + world layout snapshot to {publishTargetLabel}.
          Static world layouts are saved with zero timeline duration.
        </DialogDescription>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="world-publish-package-id" className="text-[#d4d4d4]">
            Package ID
          </Label>
          <Input
            id="world-publish-package-id"
            value={draft.packageId}
            onChange={(event) =>
              onDraftChange(updateDraftField(draft, "packageId", event.target.value))
            }
            placeholder="my-robot-world"
            className="bg-[#252526] border-[#3d3d3d] text-[#e2e2e2]"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="world-publish-version" className="text-[#d4d4d4]">
              Version
            </Label>
            <Input
              id="world-publish-version"
              value={draft.version}
              onChange={(event) =>
                onDraftChange(updateDraftField(draft, "version", event.target.value))
              }
              placeholder="0.1.0"
              className="bg-[#252526] border-[#3d3d3d] text-[#e2e2e2]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="world-publish-title" className="text-[#d4d4d4]">
              Title
            </Label>
            <Input
              id="world-publish-title"
              value={draft.title}
              onChange={(event) =>
                onDraftChange(updateDraftField(draft, "title", event.target.value))
              }
              placeholder="URDF Studio Shared World"
              className="bg-[#252526] border-[#3d3d3d] text-[#e2e2e2]"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="world-publish-description" className="text-[#d4d4d4]">
            Description (Optional)
          </Label>
          <Textarea
            id="world-publish-description"
            value={draft.description}
            onChange={(event) =>
              onDraftChange(updateDraftField(draft, "description", event.target.value))
            }
            rows={3}
            placeholder="Short context for teammates."
            className="bg-[#252526] border-[#3d3d3d] text-[#e2e2e2]"
          />
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="border-[#3d3d3d] bg-[#252526] text-[#d4d4d4] hover:bg-[#323233] hover:text-white"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="bg-[#3d3d3d] text-white hover:bg-[#4a4a4a]"
          >
            {isSubmitting ? "Publishing..." : `Publish to ${publishTargetLabel}`}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
);
