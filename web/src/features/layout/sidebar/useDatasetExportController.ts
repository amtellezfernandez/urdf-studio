import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  sanitizeSpaceName,
  validateEpisodesForStandardizedExport,
  type Episode,
} from "@/features/dataset";
import { buildDatasetArchiveArtifact } from "@/features/layout/sidebar/datasetArchiveExport";
import type { DatasetSourceRecord } from "@/features/layout/sidebar/datasetSourceHelpers";
import {
  DEFAULT_HF_DATASET_REPO,
  parseHfDatasetTargetInput,
  type HfDatasetTarget,
} from "@/features/layout/sidebar/hfDatasetImportHelpers";
import {
  buildDefaultHfDatasetPublishBranchName,
  buildHfDatasetPublishArchivePath,
  normalizeHfDatasetVisibility,
  resolveDefaultHfDatasetPublishRepoId,
  resolveHfDatasetPublishUrls,
  sanitizeHfDatasetPublishBranchName,
  type HfDatasetVisibility,
} from "@/features/layout/sidebar/hfDatasetPublishHelpers";
import type { JointLimits } from "@/shared/lib/urdfBrowser";
import type { JointLimitMode } from "@/shared/types/feature";

type JSZipConstructor = typeof import("jszip");

type HfIdentity = {
  name: string;
  fullname?: string;
};

type UseDatasetExportControllerParams = {
  episodes: Episode[];
  datasetSources: DatasetSourceRecord[];
  getHfLazyEpisodeRef: (episode: Episode) => unknown;
  robotBaseName: string;
  robotName: string;
  availableJoints: string[];
  exportLimitMode: JointLimitMode;
  jointLimits: JointLimits;
  metricsEnabled: boolean;
  loadJSZip: () => Promise<JSZipConstructor>;
  effectiveHfToken: string | null;
  hfTokenUnavailableReason: string;
  logMetric: (name: string, payload: Record<string, unknown>) => void;
};

const createHfApiHeaders = (token: string | null) => {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};

const fetchHfDatasetInfo = async (
  token: string | null,
  owner: string,
  dataset: string
) =>
  fetch(
    `https://huggingface.co/api/datasets/${encodeURIComponent(owner)}/${encodeURIComponent(dataset)}`,
    {
      headers: createHfApiHeaders(token),
    }
  );

const createHfDataset = async ({
  token,
  identityName,
  owner,
  dataset,
  visibility,
}: {
  token: string;
  identityName?: string;
  owner: string;
  dataset: string;
  visibility: HfDatasetVisibility;
}) => {
  const body: Record<string, unknown> = {
    name: sanitizeSpaceName(dataset),
    type: "dataset",
    private: visibility === "private",
  };
  if (identityName && owner !== identityName) {
    body.organization = owner;
  }

  const response = await fetch("https://huggingface.co/api/repos/create", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to create Hugging Face Dataset");
  }
};

const createHfDatasetBranch = async ({
  token,
  owner,
  dataset,
  branch,
  baseRevision = "main",
}: {
  token: string;
  owner: string;
  dataset: string;
  branch: string;
  baseRevision?: string;
}) => {
  const response = await fetch(
    `https://huggingface.co/api/datasets/${encodeURIComponent(owner)}/${encodeURIComponent(dataset)}/branch/${encodeURIComponent(branch)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ startingPoint: baseRevision }),
    }
  );

  if (response.status === 409) {
    return { created: false, existed: true };
  }
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to create Hugging Face dataset branch");
  }
  return { created: true, existed: false };
};

const uploadFileToHfDataset = async ({
  token,
  owner,
  dataset,
  revision,
  pathInRepo,
  file,
  createPr,
}: {
  token: string;
  owner: string;
  dataset: string;
  revision: string;
  pathInRepo: string;
  file: File;
  createPr: boolean;
}) => {
  const encodedPath = pathInRepo
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const params = createPr ? "?create_pr=1" : "";
  const endpoint = `https://huggingface.co/api/datasets/${encodeURIComponent(owner)}/${encodeURIComponent(dataset)}/upload/${encodeURIComponent(revision)}/${encodedPath}${params}`;
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to upload to Hugging Face Dataset");
  }
  return (await response.json().catch(() => null)) as Record<string, unknown> | null;
};

export const useDatasetExportController = ({
  episodes,
  datasetSources,
  getHfLazyEpisodeRef,
  robotBaseName,
  robotName,
  availableJoints,
  exportLimitMode,
  jointLimits,
  metricsEnabled,
  loadJSZip,
  effectiveHfToken,
  hfTokenUnavailableReason,
  logMetric,
}: UseDatasetExportControllerParams) => {
  const [isExportingDataset, setIsExportingDataset] = useState(false);
  const [isUploadingToHF, setIsUploadingToHF] = useState(false);
  const hfIdentityRef = useRef<HfIdentity | null>(null);

  useEffect(() => {
    hfIdentityRef.current = null;
  }, [effectiveHfToken]);

  const ensureHfToken = useCallback(async () => {
    if (!effectiveHfToken) {
      toast.error(
        hfTokenUnavailableReason || "Hugging Face export requires backend-managed auth."
      );
      return null;
    }

    return effectiveHfToken;
  }, [effectiveHfToken, hfTokenUnavailableReason]);

  const fetchHfIdentity = useCallback(async (token: string): Promise<HfIdentity> => {
    if (hfIdentityRef.current) {
      return hfIdentityRef.current;
    }
    const response = await fetch("https://huggingface.co/api/whoami-v2", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || "Failed to fetch Hugging Face profile");
    }
    const data = (await response.json()) as HfIdentity;
    hfIdentityRef.current = data;
    return data;
  }, []);

  const promptForDataset = useCallback(
    (defaultOwner?: string, defaultRepoId?: string): HfDatasetTarget | null => {
      const input = window
        .prompt(
          `Enter the Hugging Face Dataset repo (format owner/dataset). You can paste a full URL.\n\nRecommended:\n${DEFAULT_HF_DATASET_REPO}`,
          defaultRepoId ?? (defaultOwner ? `${defaultOwner}/` : DEFAULT_HF_DATASET_REPO)
        )
        ?.trim();
      if (!input) {
        toast.info("Cancelled Hugging Face operation");
        return null;
      }
      const parsed = parseHfDatasetTargetInput(input, defaultOwner);
      if (!parsed) {
        toast.error("Hugging Face Dataset must be provided as owner/dataset");
        return null;
      }
      return parsed;
    },
    []
  );

  const resolveEpisodesForExport = useCallback(() => {
    const indexedOnlyEpisodes = episodes.filter(
      (episode) => episode.frames.length === 0 && Boolean(getHfLazyEpisodeRef(episode))
    );
    let episodesToExport = episodes;
    let skippedIndexedCount = 0;

    if (indexedOnlyEpisodes.length > 0) {
      const loadedEpisodes = episodes.filter((episode) => episode.frames.length > 0);
      if (loadedEpisodes.length === 0) {
        toast.error(
          "All episodes are indexed-only. Load at least one episode before exporting."
        );
        return null;
      }

      const proceed = window.confirm(
        `Detected ${indexedOnlyEpisodes.length} indexed-only episode(s) without loaded frames.\n\nExport will include only ${loadedEpisodes.length} loaded episode(s).\nContinue?`
      );
      if (!proceed) {
        toast.info("Export cancelled");
        return null;
      }
      episodesToExport = loadedEpisodes;
      skippedIndexedCount = indexedOnlyEpisodes.length;
    }

    const alignmentValidation =
      validateEpisodesForStandardizedExport(episodesToExport);
    if (!alignmentValidation.valid) {
      const issuePreview = alignmentValidation.issues
        .slice(0, 3)
        .map((issue) => `E${issue.episodeNumber}: ${issue.reason}`)
        .join("; ");
      toast.error(
        `Export blocked: dataset is not aligned for standardized reuse. ${issuePreview}`
      );
      return null;
    }

    return {
      episodesToExport,
      skippedIndexedCount,
    };
  }, [episodes, getHfLazyEpisodeRef]);

  const exportDatasetToLeRobotFormat = useCallback(async () => {
    if (episodes.length === 0) {
      toast.error("No episodes available for dataset export");
      return;
    }

    setIsExportingDataset(true);
    try {
      const exportSelection = resolveEpisodesForExport();
      if (!exportSelection) return;

      const { episodesToExport, skippedIndexedCount } = exportSelection;
      const { blob, datasetName, totalFrames, packDurationMs } =
        await buildDatasetArchiveArtifact({
          episodes: episodesToExport,
          robotBaseName,
          robotName,
          availableJoints,
          exportLimitMode,
          jointLimits,
          loadJSZip,
          metricsEnabled,
        });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${datasetName}.zip`;
      link.click();
      URL.revokeObjectURL(url);

      logMetric("dataset.export.local", {
        datasetName,
        episodes: episodesToExport.length,
        totalFrames,
        blobBytes: blob.size ?? 0,
        durationMs: packDurationMs,
      });

      toast.success("LeRobotDataset v3 archive generated");
      if (skippedIndexedCount > 0) {
        toast.info(
          `Skipped ${skippedIndexedCount} indexed-only episode(s) with no loaded frames.`
        );
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to export LeRobotDataset archive");
    } finally {
      setIsExportingDataset(false);
    }
  }, [
    availableJoints,
    episodes.length,
    exportLimitMode,
    jointLimits,
    loadJSZip,
    logMetric,
    metricsEnabled,
    resolveEpisodesForExport,
    robotBaseName,
    robotName,
  ]);

  const uploadEpisodesToHuggingFace = useCallback(async () => {
    if (isUploadingToHF) return;
    if (episodes.length === 0) {
      toast.error("No episodes available for upload");
      return;
    }

    setIsUploadingToHF(true);
    try {
      const token = await ensureHfToken();
      if (!token) return;

      let identity: HfIdentity | null = null;
      try {
        identity = await fetchHfIdentity(token);
      } catch (error) {
        console.error("Failed to fetch Hugging Face identity:", error);
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : "Failed to fetch Hugging Face profile"
        );
        return;
      }

      const defaultDataset = resolveDefaultHfDatasetPublishRepoId({
        episodes,
        datasetSources,
        identityName: identity?.name,
        robotBaseName,
      });
      const targetDataset = promptForDataset(identity?.name, defaultDataset);
      if (!targetDataset) return;

      const infoResponse = await fetchHfDatasetInfo(
        token,
        targetDataset.owner,
        targetDataset.name
      );
      if (infoResponse.status === 404) {
        const shouldCreate = window.confirm(
          `Hugging Face Dataset ${targetDataset.repoId} does not exist. Create it now?`
        );
        if (!shouldCreate) {
          toast.error("Dataset not found. Please create it on Hugging Face first.");
          return;
        }
        const visibilityPrompt = window
          .prompt(
            "Set visibility for the new dataset (public/private).",
            "private"
          )
          ?.trim();
        const visibility = normalizeHfDatasetVisibility(visibilityPrompt);
        try {
          await createHfDataset({
            token,
            identityName: identity?.name,
            owner: targetDataset.owner,
            dataset: targetDataset.name,
            visibility,
          });
          toast.success(
            `Created Hugging Face Dataset ${targetDataset.repoId} (${visibility})`
          );
        } catch (error) {
          console.error("Failed to create Hugging Face Dataset:", error);
          toast.error(
            error instanceof Error && error.message
              ? error.message.replace(/space/gi, "dataset")
              : "Failed to create Hugging Face Dataset"
          );
          return;
        }
      } else if (!infoResponse.ok) {
        const message = await infoResponse.text();
        toast.error(message || "Failed to access Hugging Face Dataset");
        return;
      }

      const defaultBranch = buildDefaultHfDatasetPublishBranchName();
      const branchInput = window
        .prompt("Enter branch name for this dataset publish.", defaultBranch)
        ?.trim();
      if (!branchInput) {
        toast.info("Cancelled Hugging Face operation");
        return;
      }
      const branch = sanitizeHfDatasetPublishBranchName(branchInput);
      if (!branch) {
        toast.error("Branch name must contain at least one valid character.");
        return;
      }

      const branchStatus = await createHfDatasetBranch({
        token,
        owner: targetDataset.owner,
        dataset: targetDataset.name,
        branch,
      });
      if (branchStatus.existed) {
        toast.info(`Using existing branch ${branch}`);
      }

      const exportSelection = resolveEpisodesForExport();
      if (!exportSelection) return;
      const { episodesToExport, skippedIndexedCount } = exportSelection;
      const { blob, datasetName, totalFrames, packDurationMs } =
        await buildDatasetArchiveArtifact({
          episodes: episodesToExport,
          robotBaseName,
          robotName,
          availableJoints,
          exportLimitMode,
          jointLimits,
          loadJSZip,
          metricsEnabled,
        });

      const archivePath = buildHfDatasetPublishArchivePath({ robotBaseName });
      const archiveFile = new File([blob], `${datasetName}.zip`, {
        type: "application/zip",
      });

      toast.info(
        `Publishing dataset edit branch ${branch} to ${targetDataset.repoId}...`
      );

      const uploadStart = metricsEnabled ? performance.now() : 0;
      let uploadPayload: Record<string, unknown> | null = null;
      let openedPr = false;
      try {
        uploadPayload = await uploadFileToHfDataset({
          token,
          owner: targetDataset.owner,
          dataset: targetDataset.name,
          revision: branch,
          pathInRepo: archivePath,
          file: archiveFile,
          createPr: true,
        });
        openedPr = true;
      } catch (error) {
        console.warn("Auto PR publish failed, retrying without PR:", error);
        uploadPayload = await uploadFileToHfDataset({
          token,
          owner: targetDataset.owner,
          dataset: targetDataset.name,
          revision: branch,
          pathInRepo: archivePath,
          file: archiveFile,
          createPr: false,
        });
      }

      const { prUrl, branchUrl, discussionsUrl } = resolveHfDatasetPublishUrls({
        repoId: targetDataset.repoId,
        branch,
        uploadPayload,
      });

      logMetric("dataset.upload.hf", {
        datasetName,
        episodes: episodesToExport.length,
        totalFrames,
        blobBytes: blob.size ?? 0,
        packDurationMs,
        uploadDurationMs: metricsEnabled ? performance.now() - uploadStart : 0,
        dataset: targetDataset.repoId,
        branch,
        openedPr,
      });

      if (openedPr) {
        toast.success(
          `Published edit PR for ${targetDataset.repoId} (${episodesToExport.length} episodes, ${totalFrames} frames).`
        );
      } else {
        toast.success(
          `Published to branch ${branch} on ${targetDataset.repoId}. Open PR from Discussions.`
        );
      }

      if (skippedIndexedCount > 0) {
        toast.info(
          `Skipped ${skippedIndexedCount} indexed-only episode(s) with no loaded frames.`
        );
      }

      if (prUrl) {
        if (window.confirm("Open the generated PR now?")) {
          window.open(prUrl, "_blank", "noopener,noreferrer");
        }
      } else if (
        window.confirm(
          "Open the dataset branch now? You can open a PR from the Discussions tab."
        )
      ) {
        window.open(branchUrl, "_blank", "noopener,noreferrer");
        window.open(discussionsUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      console.error("Failed to upload dataset to Hugging Face:", error);
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Failed to upload dataset to Hugging Face"
      );
    } finally {
      setIsUploadingToHF(false);
    }
  }, [
    availableJoints,
    datasetSources,
    ensureHfToken,
    episodes,
    exportLimitMode,
    fetchHfIdentity,
    isUploadingToHF,
    jointLimits,
    loadJSZip,
    logMetric,
    metricsEnabled,
    promptForDataset,
    resolveEpisodesForExport,
    robotBaseName,
    robotName,
  ]);

  return {
    isExportingDataset,
    isUploadingToHF,
    exportDatasetToLeRobotFormat,
    uploadEpisodesToHuggingFace,
  };
};
