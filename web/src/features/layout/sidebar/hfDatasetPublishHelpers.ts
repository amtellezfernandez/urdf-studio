import { extractHfRepoIdFromSourceName, resolveEpisodeHfRepoId, type Episode } from "@/features/dataset";
import { parseHfDatasetTargetInput } from "@/features/layout/sidebar/hfDatasetImportHelpers";
import type { DatasetSourceRecord } from "@/features/layout/sidebar/datasetSourceHelpers";
import {
  HF_DATASET_DEFAULT_VISIBILITY,
  HF_DATASET_PUBLISH_ARCHIVE_ROOT,
  HF_DATASET_PUBLISH_BRANCH_PREFIX,
} from "@/features/layout/sidebar/hfDatasetPublishParams";

export type HfDatasetVisibility = "public" | "private";

export const resolveDefaultHfDatasetPublishRepoId = ({
  episodes,
  datasetSources,
  identityName,
  robotBaseName,
}: {
  episodes: readonly Episode[];
  datasetSources: readonly DatasetSourceRecord[];
  identityName?: string;
  robotBaseName: string;
}) => {
  for (let index = episodes.length - 1; index >= 0; index -= 1) {
    const repoId = resolveEpisodeHfRepoId(episodes[index]);
    if (repoId) {
      const parsed = parseHfDatasetTargetInput(repoId);
      if (parsed?.repoId) {
        return parsed.repoId;
      }
    }
  }

  for (let index = datasetSources.length - 1; index >= 0; index -= 1) {
    const source = datasetSources[index];
    if (source?.type !== "hf") {
      continue;
    }
    const parsed = extractHfRepoIdFromSourceName(source.name);
    if (parsed) {
      return parsed;
    }
  }

  return identityName ? `${identityName}/${robotBaseName}-edits` : undefined;
};

const toPublishTimestamp = (value: Date) =>
  value.toISOString().replace(/[:.]/g, "-").replace("T", "-").toLowerCase();

export const buildDefaultHfDatasetPublishBranchName = (
  now = new Date()
) => `${HF_DATASET_PUBLISH_BRANCH_PREFIX}-${toPublishTimestamp(now)}`;

export const sanitizeHfDatasetPublishBranchName = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-./]+|[-./]+$/g, "");

export const normalizeHfDatasetVisibility = (
  value: string | null | undefined
): HfDatasetVisibility =>
  value?.trim().toLowerCase() === "public"
    ? "public"
    : HF_DATASET_DEFAULT_VISIBILITY;

export const buildHfDatasetPublishArchivePath = ({
  robotBaseName,
  publishedAt = new Date(),
}: {
  robotBaseName: string;
  publishedAt?: Date;
}) => `${HF_DATASET_PUBLISH_ARCHIVE_ROOT}/${robotBaseName}/${toPublishTimestamp(publishedAt)}.zip`;

export const resolveHfDatasetPublishUrls = ({
  repoId,
  branch,
  uploadPayload,
}: {
  repoId: string;
  branch: string;
  uploadPayload: Record<string, unknown> | null;
}) => {
  const prUrl =
    (typeof uploadPayload?.pullRequestUrl === "string" &&
      uploadPayload.pullRequestUrl) ||
    (typeof uploadPayload?.pr_url === "string" && uploadPayload.pr_url) ||
    (typeof uploadPayload?.url === "string" &&
      String(uploadPayload.url).includes("/discussions/") &&
      String(uploadPayload.url)) ||
    "";

  return {
    prUrl,
    branchUrl: `https://huggingface.co/datasets/${repoId}/tree/${encodeURIComponent(branch)}`,
    discussionsUrl: `https://huggingface.co/datasets/${repoId}/discussions`,
  };
};
