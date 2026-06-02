import { API_BASE_URL } from "@/shared/config/runtime";
import { guardedFetch } from "@/shared/lib/backendGuard";

export type IluGallerySource = {
  owner: string;
  repo: string;
  path?: string;
  branch?: string;
  urdfPath?: string;
};

export type IluGalleryRobotTraits = {
  primaryFamily: string;
  families: string[];
  linkCount: number;
  jointCount: number;
  controllableJointCount: number;
  dofCount: number;
  armCount: number;
  legCount: number;
  wheelCount: number;
};

export type IluGalleryPublishedRobot = {
  name?: string | null;
  file?: string | null;
  fileBase?: string | null;
};

export type IluGalleryPublishedRepo = {
  repo: string;
  repoKey?: string | null;
  path?: string | null;
  name?: string | null;
  summary: string;
  org: string;
  demo: string;
  tags: string[];
  robots: IluGalleryPublishedRobot[];
  hfDatasets: string[];
  authorWebsite: string;
  authorX: string;
  authorLinkedin: string;
  authorGithub: string;
  contact: string;
  extra: string;
  stars?: number | null;
  ownerLogin?: string | null;
  ownerAvatar?: string | null;
  authorLogin?: string | null;
  authorAvatar?: string | null;
  repoUpdatedAt?: string | null;
  updatedAt?: string | null;
  license: string;
};

export type IluGalleryEntry = {
  id: string;
  title: string;
  summary: string | null;
  attentionNotes?: string[];
  owner: string;
  repo: string;
  path?: string | null;
  branch?: string | null;
  urdfPath?: string | null;
  sourceFile?: string | null;
  thumbnailUrl?: string | null;
  previewUrl?: string | null;
  videoUrl?: string | null;
  galleryRepoKey?: string | null;
  galleryFileBase?: string | null;
  macroTags?: string[];
  meshCount?: number | null;
  linkCount?: number | null;
  jointCount?: number | null;
  armCount?: number | null;
  legCount?: number | null;
  wheelCount?: number | null;
  robotTraits?: IluGalleryRobotTraits | null;
  tags: string[];
};

export type IluGalleryRepoMetadata = {
  org: string;
  summary: string;
  demo: string;
  tags: string[];
  license: string;
  authorWebsite: string;
  authorX: string;
  authorLinkedin: string;
  authorGithub: string;
  contact: string;
  extra: string;
  hfDatasets: string[];
  stars?: number | null;
  ownerLogin?: string | null;
  ownerAvatar?: string | null;
  authorLogin?: string | null;
  authorAvatar?: string | null;
  repoUpdatedAt?: string | null;
};

export type IluGalleryJobStatus = "queued" | "running" | "completed" | "failed";
export type IluGalleryJobPhase = "inspect" | "generate";
export type IluGalleryGenerateMode = "repo" | "selected";
export type IluGalleryGenerateAssetKind = "image" | "video";

export type IluGalleryJobProgress = {
  completed: number;
  total: number;
  percent: number;
  currentStage?: "preparing" | "rendering" | null;
  currentStep?: number | null;
  currentItemId?: string | null;
  currentAssetKind?: string | null;
  currentLabel?: string | null;
};

export type IluGalleryJob = {
  jobId: string;
  status: IluGalleryJobStatus;
  phase: IluGalleryJobPhase;
  source: IluGallerySource;
  repoMetadata: IluGalleryRepoMetadata;
  publishedRepo?: IluGalleryPublishedRepo | null;
  items: IluGalleryEntry[];
  progress?: IluGalleryJobProgress | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IluGalleryRepoPreview = {
  source: IluGallerySource;
  publishedRepo?: IluGalleryPublishedRepo | null;
  items: IluGalleryEntry[];
};

export type IluGalleryRepoPreviewCandidate = {
  path: string;
  name?: string | null;
  displayName?: string | null;
  fileBase?: string | null;
  sourceFile?: string | null;
  hasMeshesFolder?: boolean | null;
  meshesFolderPath?: string | null;
  isXacro?: boolean | null;
  inspectionMode?: string | null;
  hasRenderableGeometry?: boolean | null;
  unresolvedMeshReferenceCount?: number | null;
};

export type IluGalleryPrDraft = {
  title: string;
  body: string;
  branchName: string;
  repoSlug: string;
  files: Array<{ path: string; content: string; encoding?: "utf-8" | "base64"; mediaType?: string | null }>;
};

export type IluGalleryPublishResult = {
  title: string;
  repoSlug: string;
  branchName: string;
  baseBranch: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  filesChanged: number;
  reusedExistingPullRequest: boolean;
};

const GALLERY_REQUIRED_BACKENDS = ["core-api"] as const;

const parseJobResponse = async (response: Response, context: string): Promise<IluGalleryJob> => {
  if (!response.ok) {
    const detail = await parseErrorResponseDetail(response);
    throw new Error(detail || `Failed to ${context} (${response.status})`);
  }
  return (await response.json()) as IluGalleryJob;
};

const parseErrorResponseDetail = async (response: Response): Promise<string | null> => {
  try {
    const payload = await response.clone().json();
    if (payload && typeof payload === "object" && "detail" in payload) {
      const detail = (payload as { detail?: unknown }).detail;
      if (typeof detail === "string" && detail.trim()) {
        return detail.trim();
      }
    }
  } catch {
    // Fall back to the generic status message below.
  }
  return null;
};

export const createIluGalleryJob = async (source: IluGallerySource): Promise<IluGalleryJob> => {
  const response = await guardedFetch(`${API_BASE_URL}/ilu/gallery/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ source }),
  }, {
    requiredBackends: [...GALLERY_REQUIRED_BACKENDS],
    context: "Create gallery job",
  });
  return parseJobResponse(response, "create gallery job");
};

export const getIluGalleryJob = async (jobId: string): Promise<IluGalleryJob> => {
  const response = await guardedFetch(`${API_BASE_URL}/ilu/gallery/jobs/${jobId}`, undefined, {
    requiredBackends: [...GALLERY_REQUIRED_BACKENDS],
    context: "Load gallery job",
  });
  return parseJobResponse(response, "load gallery job");
};

export const getIluGalleryRepoPreview = async (
  source: IluGallerySource,
  candidates?: IluGalleryRepoPreviewCandidate[]
): Promise<IluGalleryRepoPreview> => {
  const response = candidates === undefined
    ? await guardedFetch(
        `${API_BASE_URL}/ilu/repo-gallery-preview?${buildGalleryRepoPreviewQuery(source).toString()}`,
        undefined,
        {
          requiredBackends: [...GALLERY_REQUIRED_BACKENDS],
          context: "Load gallery repo preview",
        }
      )
    : await guardedFetch(`${API_BASE_URL}/ilu/repo-gallery-preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ source, candidates }),
      }, {
        requiredBackends: [...GALLERY_REQUIRED_BACKENDS],
        context: "Load gallery repo preview",
      });
  if (!response.ok) {
    throw new Error(`Failed to load gallery repo preview (${response.status})`);
  }
  return (await response.json()) as IluGalleryRepoPreview;
};

const buildGalleryRepoPreviewQuery = (source: IluGallerySource): URLSearchParams => {
  const params = new URLSearchParams();
  params.set("owner", source.owner);
  params.set("repo", source.repo);
  if (source.path) {
    params.set("path", source.path);
  }
  if (source.branch) {
    params.set("branch", source.branch);
  }
  return params;
};

export const generateIluGalleryJob = async (
  jobId: string,
  payload: { mode: IluGalleryGenerateMode; itemIds?: string[]; assetKinds?: IluGalleryGenerateAssetKind[] }
): Promise<IluGalleryJob> => {
  const response = await guardedFetch(`${API_BASE_URL}/ilu/gallery/jobs/${jobId}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }, {
    requiredBackends: [...GALLERY_REQUIRED_BACKENDS],
    context: "Generate gallery assets",
  });
  return parseJobResponse(response, "generate gallery assets");
};

export const updateIluGalleryJobMetadata = async (
  jobId: string,
  payload: {
    repoMetadata: IluGalleryRepoMetadata;
    items: Array<{ id: string; title: string }>;
  }
): Promise<IluGalleryJob> => {
  const response = await guardedFetch(`${API_BASE_URL}/ilu/gallery/jobs/${jobId}/metadata`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }, {
    requiredBackends: [...GALLERY_REQUIRED_BACKENDS],
    context: "Update gallery metadata",
  });
  return parseJobResponse(response, "update gallery metadata");
};

export const getIluGalleryJobBundleUrl = (jobId: string): string =>
  `${API_BASE_URL}/ilu/gallery/jobs/${jobId}/bundle`;

export const getIluGalleryPrDraft = async (jobId: string): Promise<IluGalleryPrDraft> => {
  const response = await guardedFetch(`${API_BASE_URL}/ilu/gallery/jobs/${jobId}/pr-draft`, undefined, {
    requiredBackends: [...GALLERY_REQUIRED_BACKENDS],
    context: "Load gallery PR draft",
  });
  if (!response.ok) {
    throw new Error(`Failed to load gallery PR draft (${response.status})`);
  }
  return (await response.json()) as IluGalleryPrDraft;
};

export const publishIluGalleryJob = async (jobId: string): Promise<IluGalleryPublishResult> => {
  const response = await guardedFetch(`${API_BASE_URL}/ilu/gallery/jobs/${jobId}/publish`, {
    method: "POST",
  }, {
    requiredBackends: [...GALLERY_REQUIRED_BACKENDS],
    context: "Publish gallery pull request",
  });
  if (!response.ok) {
    throw new Error(`Failed to publish gallery pull request (${response.status})`);
  }
  return (await response.json()) as IluGalleryPublishResult;
};
