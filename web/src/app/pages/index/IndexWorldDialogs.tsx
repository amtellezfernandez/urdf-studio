import { Suspense, type ComponentProps } from "react";

import {
  ScenariosDialog,
  WaypointRecorderDialog,
  WorldPublishDialog,
  WorldRegistryPanel,
  WorldRolloutReviewPanel,
  WorldSceneImportDialog,
} from "@/app/pages/index/indexPageLazyComponents";
import type { WaypointRecorderContext } from "@/features/scenarios/WaypointRecorderPanel";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import { resolveFeatureGateAvailability } from "@/shared/lib/featureGateUi";

type WorldRegistryPanelProps = ComponentProps<typeof WorldRegistryPanel>;
type WorldPublishDialogProps = ComponentProps<typeof WorldPublishDialog>;
type WorldSceneImportDialogProps = ComponentProps<typeof WorldSceneImportDialog>;
type WorldRolloutReviewPanelProps = ComponentProps<typeof WorldRolloutReviewPanel>;

type IndexWorldDialogsProps = {
  show: boolean;
  worldRegistryOpen: WorldRegistryPanelProps["open"];
  onWorldRegistryOpenChange: WorldRegistryPanelProps["onOpenChange"];
  worldRegistryEntries: WorldRegistryPanelProps["entries"];
  worldRegistryFilterText: WorldRegistryPanelProps["filterText"];
  onWorldRegistryFilterTextChange: WorldRegistryPanelProps["onFilterTextChange"];
  worldRegistryLoading: WorldRegistryPanelProps["loading"];
  onRefreshWorldRegistry: WorldRegistryPanelProps["onRefresh"];
  onLoadWorldScenePackage: WorldRegistryPanelProps["onLoadPackage"];
  worldPublishDialogOpen: WorldPublishDialogProps["open"];
  onWorldPublishDialogOpenChange: WorldPublishDialogProps["onOpenChange"];
  publishTargetLabel: WorldPublishDialogProps["publishTargetLabel"];
  worldPublishDraft: WorldPublishDialogProps["draft"];
  onWorldPublishDraftChange: WorldPublishDialogProps["onDraftChange"];
  onSubmitWorldPublishDialog: WorldPublishDialogProps["onSubmit"];
  isPublishingWorldPackage: WorldPublishDialogProps["isSubmitting"];
  worldLayoutImportDialogOpen: WorldSceneImportDialogProps["open"];
  onWorldLayoutImportDialogOpenChange: WorldSceneImportDialogProps["onOpenChange"];
  worldLayoutImportUrlDraft: WorldSceneImportDialogProps["worldLayoutUrl"];
  onWorldLayoutImportUrlDraftChange: WorldSceneImportDialogProps["onWorldLayoutUrlChange"];
  onImportWorldLayoutFromLinkDialog: WorldSceneImportDialogProps["onImportFromLink"];
  onImportWorldLayoutFromFileDialog: NonNullable<WorldSceneImportDialogProps["onImportFromFile"]>;
  onImportWorldLayoutFromFolderDialog: NonNullable<
    WorldSceneImportDialogProps["onImportFromFolder"]
  >;
  onImportDefaultWorldLayoutFromDialog: WorldSceneImportDialogProps["onImportDefaultWorld"];
  onImportDemoWorldLayoutFromDialog: WorldSceneImportDialogProps["onImportDemoWorld"];
  isImportingWorldLayout: WorldSceneImportDialogProps["isSubmitting"];
  worldRolloutReviewOpen: WorldRolloutReviewPanelProps["open"];
  worldRolloutReview: WorldRolloutReviewPanelProps["result"];
  onWorldRolloutReviewOpenChange: (open: boolean) => void;
  scenariosDialogOpen: boolean;
  onScenariosDialogOpenChange: (open: boolean) => void;
  waypointRecorderOpen: boolean;
  onWaypointRecorderOpenChange: (open: boolean) => void;
  waypointRecorderContext: WaypointRecorderContext;
};

export const IndexWorldDialogs = ({
  show,
  worldRegistryOpen,
  onWorldRegistryOpenChange,
  worldRegistryEntries,
  worldRegistryFilterText,
  onWorldRegistryFilterTextChange,
  worldRegistryLoading,
  onRefreshWorldRegistry,
  onLoadWorldScenePackage,
  worldPublishDialogOpen,
  onWorldPublishDialogOpenChange,
  publishTargetLabel,
  worldPublishDraft,
  onWorldPublishDraftChange,
  onSubmitWorldPublishDialog,
  isPublishingWorldPackage,
  worldLayoutImportDialogOpen,
  onWorldLayoutImportDialogOpenChange,
  worldLayoutImportUrlDraft,
  onWorldLayoutImportUrlDraftChange,
  onImportWorldLayoutFromLinkDialog,
  onImportWorldLayoutFromFileDialog,
  onImportWorldLayoutFromFolderDialog,
  onImportDefaultWorldLayoutFromDialog,
  onImportDemoWorldLayoutFromDialog,
  isImportingWorldLayout,
  worldRolloutReviewOpen,
  worldRolloutReview,
  onWorldRolloutReviewOpenChange,
  scenariosDialogOpen,
  onScenariosDialogOpenChange,
  waypointRecorderOpen,
  onWaypointRecorderOpenChange,
  waypointRecorderContext,
}: IndexWorldDialogsProps) => {
  if (!show) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <WorldRegistryPanel
        open={worldRegistryOpen}
        onOpenChange={onWorldRegistryOpenChange}
        entries={worldRegistryEntries}
        filterText={worldRegistryFilterText}
        onFilterTextChange={onWorldRegistryFilterTextChange}
        loading={worldRegistryLoading}
        onRefresh={onRefreshWorldRegistry}
        onLoadPackage={onLoadWorldScenePackage}
        gate={resolveFeatureGateAvailability(FEATURE_GATES.worldsRegistry)}
      />
      <WorldPublishDialog
        open={worldPublishDialogOpen}
        onOpenChange={onWorldPublishDialogOpenChange}
        publishTargetLabel={publishTargetLabel}
        draft={worldPublishDraft}
        onDraftChange={onWorldPublishDraftChange}
        onSubmit={onSubmitWorldPublishDialog}
        isSubmitting={isPublishingWorldPackage}
      />
      <WorldSceneImportDialog
        open={worldLayoutImportDialogOpen}
        onOpenChange={onWorldLayoutImportDialogOpenChange}
        worldLayoutUrl={worldLayoutImportUrlDraft}
        onWorldLayoutUrlChange={onWorldLayoutImportUrlDraftChange}
        onImportFromLink={onImportWorldLayoutFromLinkDialog}
        onImportFromFile={onImportWorldLayoutFromFileDialog}
        onImportFromFolder={onImportWorldLayoutFromFolderDialog}
        onImportDefaultWorld={onImportDefaultWorldLayoutFromDialog}
        onImportDemoWorld={onImportDemoWorldLayoutFromDialog}
        isSubmitting={isImportingWorldLayout}
      />
      <WorldRolloutReviewPanel
        open={worldRolloutReviewOpen}
        result={worldRolloutReview}
        onClose={() => onWorldRolloutReviewOpenChange(false)}
      />
      <ScenariosDialog
        open={scenariosDialogOpen}
        onOpenChange={onScenariosDialogOpenChange}
      />
      <WaypointRecorderDialog
        open={waypointRecorderOpen}
        onOpenChange={onWaypointRecorderOpenChange}
        context={waypointRecorderContext}
      />
    </Suspense>
  );
};
