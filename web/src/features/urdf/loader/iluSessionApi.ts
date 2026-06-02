import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";
import {
  getIluSharedSessionGitHubSource,
  type IluSharedSessionGitHubSource,
  type IluSharedSessionSnapshot,
} from "@/shared/lib/urdfBrowser";

type IluSessionSnapshotResponse = IluSharedSessionSnapshot & {
  urdfContent: string;
};

export type IluSessionSnapshot = IluSharedSessionSnapshot & {
  urdfContent: string;
  githubSource: IluSharedSessionGitHubSource | null;
};

export type IluSessionAssetManifestFile = {
  path: string;
  url: string;
  mime?: string | null;
};

export type IluSessionAssetManifest = {
  label?: string | null;
  files: IluSessionAssetManifestFile[];
};

const CORE_API_OPTIONS = {
  requiredBackends: ["core-api"] as const,
};

const assertOk = async (response: Response, fallbackMessage: string) => {
  if (response.ok) {
    return;
  }
  let detail = fallbackMessage;
  try {
    const payload = (await response.json()) as { detail?: string };
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      detail = payload.detail;
    }
  } catch {
    // Ignore invalid JSON error payloads.
  }
  throw new Error(detail);
};

const mapIluSessionSnapshot = (
  payload: IluSessionSnapshotResponse
): IluSessionSnapshot => ({
  ...payload,
  githubSource: getIluSharedSessionGitHubSource(payload.loadedSource),
});

export const fetchIluSessionSnapshot = async (sessionId: string): Promise<IluSessionSnapshot> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/ilu-session/${encodeURIComponent(sessionId)}`,
    undefined,
    {
      ...CORE_API_OPTIONS,
      context: "Load ILU session",
    }
  );
  await assertOk(response, "Failed to load ilu session.");
  return mapIluSessionSnapshot((await response.json()) as IluSessionSnapshotResponse);
};

export const getIluSessionAssetManifestUrl = (sessionId: string): string =>
  `${API_BASE_URL}/ilu-session/${encodeURIComponent(sessionId)}/manifest`;

export const fetchIluSessionAssetManifest = async (
  sessionId: string
): Promise<IluSessionAssetManifest> => {
  const response = await guardedFetch(getIluSessionAssetManifestUrl(sessionId), undefined, {
    ...CORE_API_OPTIONS,
    context: "Load ILU session assets",
  });
  await assertOk(response, "Failed to load ilu session assets.");
  return (await response.json()) as IluSessionAssetManifest;
};

export const saveIluSessionSnapshot = async (
  sessionId: string,
  urdfContent: string
): Promise<void> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/ilu-session/${encodeURIComponent(sessionId)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        urdfContent,
      }),
    },
    {
      ...CORE_API_OPTIONS,
      context: "Save ILU session",
    }
  );
  await assertOk(response, "Failed to save ilu session.");
};
