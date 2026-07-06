import type { ComponentType } from "react";
import { Link2 } from "lucide-react";

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

export type WorldSceneJsonImportDialogAction = {
  label: string;
  onClick: () => void;
  icon?: ComponentType<{ className?: string }>;
};

type WorldSceneJsonImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  urlInputId: string;
  urlLabel: string;
  url: string;
  onUrlChange: (value: string) => void;
  urlPlaceholder: string;
  onImportFromLink: () => void;
  secondaryActions?: readonly WorldSceneJsonImportDialogAction[];
  isSubmitting?: boolean;
};

const WORLD_SCENE_JSON_IMPORT_DIALOG_CLASS_NAMES = {
  outlineButton:
    "border-[#3d3d3d] bg-[#252526] text-[#d4d4d4] hover:bg-[#323233] hover:text-white",
} as const;

export const WorldSceneJsonImportDialog = ({
  open,
  onOpenChange,
  title,
  description,
  urlInputId,
  urlLabel,
  url,
  onUrlChange,
  urlPlaceholder,
  onImportFromLink,
  secondaryActions = [],
  isSubmitting = false,
}: WorldSceneJsonImportDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-xl bg-[#1f1f1f] border-[#3d3d3d] text-[#d4d4d4]">
      <DialogHeader>
        <DialogTitle className="text-[#f0f0f0]">{title}</DialogTitle>
        <DialogDescription className="text-[#a8a8a8]">{description}</DialogDescription>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onImportFromLink();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor={urlInputId} className="text-[#d4d4d4]">
            {urlLabel}
          </Label>
          <Input
            id={urlInputId}
            value={url}
            onChange={(event) => onUrlChange(event.target.value)}
            placeholder={urlPlaceholder}
            className="bg-[#252526] border-[#3d3d3d] text-[#e2e2e2]"
          />
          <p className="text-xs text-[#9f9f9f]">
            GitHub blob links are accepted and converted automatically.
          </p>
        </div>
        <DialogFooter className="gap-2">
          {secondaryActions.map((action) => {
            const ActionIcon = action.icon;
            return (
              <Button
                key={action.label}
                type="button"
                variant="outline"
                onClick={action.onClick}
                disabled={isSubmitting}
                className={WORLD_SCENE_JSON_IMPORT_DIALOG_CLASS_NAMES.outlineButton}
              >
                {ActionIcon ? <ActionIcon className="mr-2 h-4 w-4" /> : null}
                {action.label}
              </Button>
            );
          })}
          <Button
            type="submit"
            disabled={isSubmitting || url.trim().length === 0}
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
