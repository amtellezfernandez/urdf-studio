import {
  WorldSceneJsonImportDialog,
  type WorldSceneJsonImportDialogAction,
} from "@/features/world-share/WorldSceneJsonImportDialog";

type WorldSceneImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worldLayoutUrl: string;
  onWorldLayoutUrlChange: (value: string) => void;
  onImportFromFile?: () => void;
  onImportFromLink: () => void;
  onImportDefaultWorld?: () => void;
  onImportDemoWorld?: () => void;
  isSubmitting?: boolean;
};

export const WorldSceneImportDialog = ({
  open,
  onOpenChange,
  worldLayoutUrl,
  onWorldLayoutUrlChange,
  onImportFromFile,
  onImportFromLink,
  onImportDefaultWorld,
  onImportDemoWorld,
  isSubmitting = false,
}: WorldSceneImportDialogProps) => {
  const secondaryActions: WorldSceneJsonImportDialogAction[] = [];
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
      title="Import World Layout"
      description="Choose one import source: local JSON/assets, default layout, demo layout, or a custom JSON link."
      urlInputId="world-layout-url"
      urlLabel="World Layout URL"
      url={worldLayoutUrl}
      onUrlChange={onWorldLayoutUrlChange}
      urlPlaceholder="https://raw.githubusercontent.com/org/repo/main/path/world-layout.json"
      onImportFromFile={onImportFromFile}
      onImportFromLink={onImportFromLink}
      secondaryActions={secondaryActions}
      isSubmitting={isSubmitting}
    />
  );
};
