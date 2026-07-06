import {
  WorldSceneJsonImportDialog,
  type WorldSceneJsonImportDialogAction,
} from "@/features/world-share/WorldSceneJsonImportDialog";

type WorldSceneImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worldLayoutUrl: string;
  onWorldLayoutUrlChange: (value: string) => void;
  onImportFromLink: () => void;
  onImportFromFile?: () => void;
  onImportFromFolder?: () => void;
  onImportDefaultWorld?: () => void;
  onImportDemoWorld?: () => void;
  isSubmitting?: boolean;
};

export const WorldSceneImportDialog = ({
  open,
  onOpenChange,
  worldLayoutUrl,
  onWorldLayoutUrlChange,
  onImportFromLink,
  onImportFromFile,
  onImportFromFolder,
  onImportDefaultWorld,
  onImportDemoWorld,
  isSubmitting = false,
}: WorldSceneImportDialogProps) => {
  const secondaryActions: WorldSceneJsonImportDialogAction[] = [];
  if (onImportFromFolder) {
    secondaryActions.push({ label: "From Folder", onClick: onImportFromFolder });
  }
  if (onImportFromFile) {
    secondaryActions.push({ label: "From File", onClick: onImportFromFile });
  }
  if (onImportDefaultWorld) {
    secondaryActions.push({ label: "Default Layout", onClick: onImportDefaultWorld });
  }
  if (onImportDemoWorld) {
    secondaryActions.push({ label: "Demo Layout", onClick: onImportDemoWorld });
  }

  return (
    <WorldSceneJsonImportDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Import World JSON"
      description="Choose one import source: a JSON link, local files, local folder, default world, or demo world."
      urlInputId="world-layout-url"
      urlLabel="World JSON URL"
      url={worldLayoutUrl}
      onUrlChange={onWorldLayoutUrlChange}
      urlPlaceholder="https://raw.githubusercontent.com/org/repo/main/path/world.json"
      onImportFromLink={onImportFromLink}
      secondaryActions={secondaryActions}
      isSubmitting={isSubmitting}
    />
  );
};
