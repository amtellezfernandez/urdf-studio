import { WorldSceneJsonImportDialog } from "@/features/world-share/WorldSceneJsonImportDialog";

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
  <WorldSceneJsonImportDialog
    open={open}
    onOpenChange={onOpenChange}
    title="Import Scene Package"
    description="Load a world scene package from a local JSON file or a JSON link."
    urlInputId="world-package-url"
    urlLabel="Scene Package URL"
    url={worldPackageUrl}
    onUrlChange={onWorldPackageUrlChange}
    urlPlaceholder="https://raw.githubusercontent.com/org/repo/main/path/world-package.json"
    onImportFromFile={onImportFromFile}
    onImportFromLink={onImportFromLink}
    isSubmitting={isSubmitting}
  />
);
