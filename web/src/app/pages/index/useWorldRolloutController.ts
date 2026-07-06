import { useCallback, useState } from "react";
import { toast } from "sonner";

import { readUnknownErrorMessage } from "@/shared/lib/errorMessages";
import { WORLD_ROLLOUT_IMPORT_ACCEPT } from "@/features/world-share/worldRolloutParams";
import type { WorldSceneRegistryEnvelope } from "@/features/world-share/worldScenePackageTypes";
import type {
  WorldRolloutImportResponse,
  WorldRolloutJobResponse,
} from "@/features/world-share/worldRolloutTypes";
import {
  buildWorldRolloutCampaignManifest,
  createWorldRolloutCheckerProfile,
  createWorldRolloutJobFromState,
  downloadWorldRolloutCampaignManifest,
  importWorldRolloutResultPayload,
  resolveWorldRolloutImportPayload,
} from "@/app/pages/index/worldSceneRuntime";
import {
  downloadJsonDocument,
  openFileSelectionDialog,
  readWorldRolloutConfigDraft,
  waitForWorldRolloutJob,
} from "@/app/pages/index/worldSceneManagerHelpers";

type WorldRolloutInputs = {
  worldPackage: WorldSceneRegistryEnvelope;
  checkerProfile: Parameters<typeof buildWorldRolloutCampaignManifest>[0]["checkerProfile"];
  rolloutParams: Parameters<typeof buildWorldRolloutCampaignManifest>[0]["rolloutParams"];
  runnerParams: Parameters<typeof buildWorldRolloutCampaignManifest>[0]["runnerParams"];
};

type UseWorldRolloutControllerParams = {
  buildCurrentWorldSceneRegistryEnvelope: () => Promise<WorldSceneRegistryEnvelope>;
  resolvedRobotName: string | null;
};

export type UseWorldRolloutControllerResult = {
  handleExportWorldRolloutCampaign: () => Promise<void>;
  handleImportWorldRolloutResults: () => void;
  handleRunLocalWorldRollout: () => Promise<void>;
  setWorldRolloutReviewOpen: (open: boolean) => void;
  worldRolloutReview: WorldRolloutImportResponse | null;
  worldRolloutReviewOpen: boolean;
};

const toWorldRolloutCompletionMessage = (job: WorldRolloutJobResponse) =>
  `World rollout completed: ${job.decision_count} decisions, ${job.stop_count} stops, ${job.escalation_count} escalations`;

export const useWorldRolloutController = ({
  buildCurrentWorldSceneRegistryEnvelope,
  resolvedRobotName,
}: UseWorldRolloutControllerParams): UseWorldRolloutControllerResult => {
  const [worldRolloutReviewOpen, setWorldRolloutReviewOpen] = useState(false);
  const [worldRolloutReview, setWorldRolloutReview] =
    useState<WorldRolloutImportResponse | null>(null);

  const buildWorldRolloutInputs = useCallback(async (): Promise<WorldRolloutInputs | null> => {
    const defaultCheckerProfile = createWorldRolloutCheckerProfile({
      resolvedRobotName,
      params: {},
    });
    const rolloutConfig = readWorldRolloutConfigDraft(defaultCheckerProfile);
    if (!rolloutConfig) {
      return null;
    }

    return {
      worldPackage: await buildCurrentWorldSceneRegistryEnvelope(),
      checkerProfile: rolloutConfig.checkerProfile,
      rolloutParams: rolloutConfig.rolloutParams,
      runnerParams: rolloutConfig.runnerParams,
    };
  }, [buildCurrentWorldSceneRegistryEnvelope, resolvedRobotName]);

  const handleExportWorldRolloutCampaign = useCallback(async () => {
    try {
      const rolloutInputs = await buildWorldRolloutInputs();
      if (!rolloutInputs) {
        return;
      }
      const campaign = buildWorldRolloutCampaignManifest(rolloutInputs);
      downloadWorldRolloutCampaignManifest(campaign, downloadJsonDocument);
      toast.success("World rollout campaign exported");
    } catch (error) {
      toast.error(readUnknownErrorMessage(error, "Failed to export rollout campaign"));
    }
  }, [buildWorldRolloutInputs]);

  const handleRunLocalWorldRollout = useCallback(async () => {
    try {
      const rolloutInputs = await buildWorldRolloutInputs();
      if (!rolloutInputs) {
        return;
      }
      const createdJob = await createWorldRolloutJobFromState(rolloutInputs);
      toast.info(`World rollout job started: ${createdJob.job_id}`);

      const completedJob = await waitForWorldRolloutJob(createdJob.job_id);
      if (completedJob.status === "failed") {
        toast.error(completedJob.error || "World rollout job failed");
        return;
      }
      if (completedJob.status !== "completed") {
        toast.warning(`World rollout job still ${completedJob.status}: ${completedJob.job_id}`);
        return;
      }

      toast.success(toWorldRolloutCompletionMessage(completedJob));
    } catch (error) {
      toast.error(readUnknownErrorMessage(error, "Failed to run world rollout"));
    }
  }, [buildWorldRolloutInputs]);

  const handleImportWorldRolloutResults = useCallback(() => {
    openFileSelectionDialog({
      accept: WORLD_ROLLOUT_IMPORT_ACCEPT,
      multiple: true,
      onFiles: async (files) => {
        try {
          const fileDrafts = await Promise.all(
            files.map(async (file) => ({ name: file.name, text: await file.text() }))
          );
          const payload = resolveWorldRolloutImportPayload(fileDrafts);
          const importedReview = await importWorldRolloutResultPayload(payload);
          setWorldRolloutReview(importedReview);
          setWorldRolloutReviewOpen(true);
          toast.success(
            `World rollout imported: ${importedReview.decision_count} decisions, ${importedReview.stop_count} stops, ${importedReview.escalation_count} escalations`
          );
        } catch (error) {
          toast.error(readUnknownErrorMessage(error, "Failed to import rollout results"));
        }
      },
    });
  }, []);

  return {
    handleExportWorldRolloutCampaign,
    handleImportWorldRolloutResults,
    handleRunLocalWorldRollout,
    setWorldRolloutReviewOpen,
    worldRolloutReview,
    worldRolloutReviewOpen,
  };
};
