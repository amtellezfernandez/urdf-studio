import { guardedFetch } from "@/shared/lib/backendGuard";
import type { BackendIdList } from "@/shared/config/backends";
import type {
  WorldScenePackageListEntry,
  WorldScenePackageManifest,
  WorldScenePackagePublishResponse,
  WorldScenePackageValidationResponse,
  WorldScenePackageVersionRecord,
  WorldRegistryCapabilitiesResponse,
} from "@/features/world-share/worldScenePackageTypes";

const WORLD_SCENE_PACKAGE_API_ROOT = "/worlds/packages";

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const readErrorText = async (response: Response) => {
  const text = await response.text();
  if (!text) {
    return `HTTP ${response.status}`;
  }
  try {
    const json = JSON.parse(text) as { detail?: string };
    return json.detail || text;
  } catch {
    return text;
  }
};

const toQueryString = (query: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined) return;
    params.set(key, String(value));
  });
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
};

export type WorldScenePackageListQuery = {
  q?: string;
  owner?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
};

export const createWorldScenePackageClient = (
  baseUrl: string,
  requiredBackends: BackendIdList,
  contextLabel: string
) => {
  const root = `${trimTrailingSlash(baseUrl)}${WORLD_SCENE_PACKAGE_API_ROOT}`;

  const getJson = async <T>(path: string) => {
    const response = await guardedFetch(
      `${root}${path}`,
      {
        headers: { Accept: "application/json" },
      },
      {
        requiredBackends,
        context: contextLabel,
      }
    );
    if (!response.ok) {
      throw new Error(await readErrorText(response));
    }
    return (await response.json()) as T;
  };

  const postJson = async <T>(path: string, body: unknown) => {
    const response = await guardedFetch(
      `${root}${path}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      },
      {
        requiredBackends,
        context: contextLabel,
      }
    );
    if (!response.ok) {
      throw new Error(await readErrorText(response));
    }
    return (await response.json()) as T;
  };

  return {
    validateManifest: (manifest: WorldScenePackageManifest) =>
      postJson<WorldScenePackageValidationResponse>("/validate", manifest),
    publishManifest: (manifest: WorldScenePackageManifest) =>
      postJson<WorldScenePackagePublishResponse>("", manifest),
    listPackages: (query: WorldScenePackageListQuery = {}) => {
      const queryString = toQueryString({
        q: query.q,
        owner: query.owner,
        tags: query.tags?.join(","),
        limit: query.limit,
        offset: query.offset,
      });
      return getJson<WorldScenePackageListEntry[]>(queryString);
    },
    getPackageVersion: (packageId: string, version: string) =>
      getJson<WorldScenePackageVersionRecord>(
        `/${encodeURIComponent(packageId)}/versions/${encodeURIComponent(version)}`
      ),
    getCapabilities: () => getJson<WorldRegistryCapabilitiesResponse>("/capabilities"),
    getVersionUrl: (packageId: string, version: string) =>
      `${root}/${encodeURIComponent(packageId)}/versions/${encodeURIComponent(version)}`,
  };
};
