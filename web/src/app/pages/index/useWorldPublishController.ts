import { useCallback, useState } from "react";
import { toast } from "sonner";

import { FEATURE_GATES } from "@/shared/config/featureGates";
import { requireFeatureGate } from "@/shared/lib/backendGuard";
import { readUnknownErrorMessage } from "@/shared/lib/errorMessages";
import type { WorldScenePublishDraft } from "@/features/world-share/WorldPublishDialog";
import type { WorldSceneRegistryEnvelope } from "@/features/world-share/worldScenePackageTypes";
import {
  createDefaultWorldPublishDraft,
  prepareWorldPublishManifestOverrides,
  toWorldPublishFailureMessage,
  toWorldPublishSuccessLabel,
  toWorldPublishTargetLabel,
  type WorldPublishTarget,
} from "@/app/pages/index/indexPageHelpers";
import { publishWorldScenePackage } from "@/app/pages/index/worldSceneRuntime";

type WorldPublishManifestOverrides = Partial<
  Pick<WorldSceneRegistryEnvelope, "package_id" | "version" | "description"> & {
    title: string;
  }
>;

type UseWorldPublishControllerParams = {
  buildCurrentWorldSceneRegistryEnvelope: (
    overrides?: WorldPublishManifestOverrides
  ) => Promise<WorldSceneRegistryEnvelope>;
  resolvedRobotName: string | null;
};

export type UseWorldPublishControllerResult = {
  handlePublishCurrentWorldScenePackage: () => void;
  handlePublishCurrentWorldScenePackageToHub: () => void;
  handleSubmitWorldPublishDialog: () => Promise<void>;
  isPublishingWorldPackage: boolean;
  publishTargetLabel: string;
  setWorldPublishDialogOpen: (open: boolean) => void;
  setWorldPublishDraft: (draft: WorldScenePublishDraft) => void;
  worldPublishDialogOpen: boolean;
  worldPublishDraft: WorldScenePublishDraft;
  worldPublishTarget: WorldPublishTarget;
};

const requirePublishTarget = (target: WorldPublishTarget): void => {
  if (target === "hub") {
    requireFeatureGate(FEATURE_GATES.worldsHubRegistry, "URDF Star publish");
    return;
  }
  requireFeatureGate(FEATURE_GATES.worldsRegistry, "World package publish");
};

export const useWorldPublishController = ({
  buildCurrentWorldSceneRegistryEnvelope,
  resolvedRobotName,
}: UseWorldPublishControllerParams): UseWorldPublishControllerResult => {
  const [worldPublishDialogOpen, setWorldPublishDialogOpen] = useState(false);
  const [worldPublishTarget, setWorldPublishTarget] = useState<WorldPublishTarget>("registry");
  const [worldPublishDraft, setWorldPublishDraft] = useState<WorldScenePublishDraft>(() =>
    createDefaultWorldPublishDraft(null)
  );
  const [isPublishingWorldPackage, setIsPublishingWorldPackage] = useState(false);

  const openWorldPublishDialog = useCallback(
    (target: WorldPublishTarget) => {
      setWorldPublishTarget(target);
      setWorldPublishDraft(createDefaultWorldPublishDraft(resolvedRobotName));
      setWorldPublishDialogOpen(true);
    },
    [resolvedRobotName]
  );

  const handlePublishCurrentWorldScenePackage = useCallback(() => {
    openWorldPublishDialog("registry");
  }, [openWorldPublishDialog]);

  const handlePublishCurrentWorldScenePackageToHub = useCallback(() => {
    openWorldPublishDialog("hub");
  }, [openWorldPublishDialog]);

  const handleSubmitWorldPublishDialog = useCallback(async () => {
    const publishDraftPreparation = prepareWorldPublishManifestOverrides({
      draft: worldPublishDraft,
      resolvedRobotName,
    });
    if (publishDraftPreparation.ok === false) {
      toast.error(publishDraftPreparation.errorMessage);
      return;
    }

    setIsPublishingWorldPackage(true);
    try {
      requirePublishTarget(worldPublishTarget);
      const manifest = await buildCurrentWorldSceneRegistryEnvelope(
        publishDraftPreparation.manifestOverrides
      );
      const publish = await publishWorldScenePackage(manifest, worldPublishTarget);
      const destinationLabel = toWorldPublishSuccessLabel(worldPublishTarget);
      toast.success(
        `${destinationLabel} ${publish.package_id}@${publish.version} (${publish.digest_sha256.slice(0, 12)}...)`
      );
      setWorldPublishDialogOpen(false);
    } catch (error) {
      toast.error(
        readUnknownErrorMessage(error, toWorldPublishFailureMessage(worldPublishTarget))
      );
    } finally {
      setIsPublishingWorldPackage(false);
    }
  }, [
    buildCurrentWorldSceneRegistryEnvelope,
    resolvedRobotName,
    worldPublishDraft,
    worldPublishTarget,
  ]);

  return {
    handlePublishCurrentWorldScenePackage,
    handlePublishCurrentWorldScenePackageToHub,
    handleSubmitWorldPublishDialog,
    isPublishingWorldPackage,
    publishTargetLabel: toWorldPublishTargetLabel(worldPublishTarget),
    setWorldPublishDialogOpen,
    setWorldPublishDraft,
    worldPublishDialogOpen,
    worldPublishDraft,
    worldPublishTarget,
  };
};
