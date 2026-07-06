import { Suspense, type ComponentProps } from "react";

import {
  WorldPublishDialog,
  WorldRegistryPanel,
  WorldRolloutReviewPanel,
  WorldSceneImportDialog,
  WorldScenePackageImportDialog,
} from "@/app/pages/index/indexPageLazyComponents";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import { resolveFeatureGateAvailability } from "@/shared/lib/featureGateUi";

type WorldRegistryPanelProps = ComponentProps<typeof WorldRegistryPanel>;
type WorldPublishDialogProps = ComponentProps<typeof WorldPublishDialog>;
type WorldSceneImportDialogProps = ComponentProps<typeof WorldSceneImportDialog>;
type WorldScenePackageImportDialogProps = ComponentProps<typeof WorldScenePackageImportDialog>;
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
  onImportWorldLayoutFromFileDialog: WorldSceneImportDialogProps["onImportFromFile"];
  onImportWorldLayoutFromLinkDialog: WorldSceneImportDialogProps["onImportFromLink"];
  onImportDefaultWorldLayoutFromDialog: WorldSceneImportDialogProps["onImportDefaultWorld"];
  onImportDemoWorldLayoutFromDialog: WorldSceneImportDialogProps["onImportDemoWorld"];
  isImportingWorldLayout: WorldSceneImportDialogProps["isSubmitting"];
  worldScenePackageImportDialogOpen: WorldScenePackageImportDialogProps["open"];
  onWorldScenePackageImportDialogOpenChange: WorldScenePackageImportDialogProps["onOpenChange"];
  worldScenePackageImportUrlDraft: WorldScenePackageImportDialogProps["worldPackageUrl"];
  onWorldScenePackageImportUrlDraftChange: WorldScenePackageImportDialogProps["onWorldPackageUrlChange"];
  onImportWorldScenePackageFromFileDialog: WorldScenePackageImportDialogProps["onImportFromFile"];
  onImportWorldScenePackageFromLinkDialog: WorldScenePackageImportDialogProps["onImportFromLink"];
  isImportingWorldScenePackage: WorldScenePackageImportDialogProps["isSubmitting"];
  worldRolloutReviewOpen: WorldRolloutReviewPanelProps["open"];
  worldRolloutReview: WorldRolloutReviewPanelProps["result"];
  onWorldRolloutReviewOpenChange: (open: boolean) => void;
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
  onImportWorldLayoutFromFileDialog,
  onImportWorldLayoutFromLinkDialog,
  onImportDefaultWorldLayoutFromDialog,
  onImportDemoWorldLayoutFromDialog,
  isImportingWorldLayout,
  worldScenePackageImportDialogOpen,
  onWorldScenePackageImportDialogOpenChange,
  worldScenePackageImportUrlDraft,
  onWorldScenePackageImportUrlDraftChange,
  onImportWorldScenePackageFromFileDialog,
  onImportWorldScenePackageFromLinkDialog,
  isImportingWorldScenePackage,
  worldRolloutReviewOpen,
  worldRolloutReview,
  onWorldRolloutReviewOpenChange,
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
        onImportFromFile={onImportWorldLayoutFromFileDialog}
        onImportFromLink={onImportWorldLayoutFromLinkDialog}
        onImportDefaultWorld={onImportDefaultWorldLayoutFromDialog}
        onImportDemoWorld={onImportDemoWorldLayoutFromDialog}
        isSubmitting={isImportingWorldLayout}
      />
      <WorldScenePackageImportDialog
        open={worldScenePackageImportDialogOpen}
        onOpenChange={onWorldScenePackageImportDialogOpenChange}
        worldPackageUrl={worldScenePackageImportUrlDraft}
        onWorldPackageUrlChange={onWorldScenePackageImportUrlDraftChange}
        onImportFromFile={onImportWorldScenePackageFromFileDialog}
        onImportFromLink={onImportWorldScenePackageFromLinkDialog}
        isSubmitting={isImportingWorldScenePackage}
      />
      <WorldRolloutReviewPanel
        open={worldRolloutReviewOpen}
        result={worldRolloutReview}
        onClose={() => onWorldRolloutReviewOpenChange(false)}
      />
    </Suspense>
  );
};
