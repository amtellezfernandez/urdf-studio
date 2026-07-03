import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";
import { assertBackendResponseOk } from "@/shared/lib/backendResponse";
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
  await assertBackendResponseOk(response, "Failed to load ilu session.");
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
  await assertBackendResponseOk(response, "Failed to load ilu session assets.");
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
  await assertBackendResponseOk(response, "Failed to save ilu session.");
};
