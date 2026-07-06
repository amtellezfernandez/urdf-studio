import { guardedFetch } from "@/shared/lib/backendGuard";
import { readResponseErrorDetail } from "@/shared/lib/responseErrorDetails";
import type { BackendIdList } from "@/shared/config/backends";
import type {
  WorldSceneRegistryEnvelope,
  WorldScenePackageListEntry,
  WorldScenePackageManifest,
  WorldScenePackagePublishResponse,
  WorldScenePackageValidationResponse,
  WorldScenePackageVersionRecordPayload,
  WorldScenePackageVersionRecord,
  WorldRegistryCapabilitiesResponse,
} from "@/features/world-share/worldScenePackageTypes";

const WORLD_SCENE_PACKAGE_API_ROOT = "/worlds/packages";

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

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

  const requestJson = async <T>(
    path: string,
    options: { body?: unknown; method?: "GET" | "POST" } = {}
  ) => {
    const hasBody = options.body !== undefined;
    const response = await guardedFetch(
      `${root}${path}`,
      {
        method: options.method,
        headers: {
          Accept: "application/json",
          ...(hasBody ? { "Content-Type": "application/json" } : {}),
        },
        body: hasBody ? JSON.stringify(options.body) : undefined,
      },
      {
        requiredBackends,
        context: contextLabel,
      }
    );
    if (!response.ok) {
      throw new Error(
        await readResponseErrorDetail(response, { fallback: `HTTP ${response.status}` })
      );
    }
    return (await response.json()) as T;
  };

  return {
    validateManifest: (manifest: WorldScenePackageManifest | WorldSceneRegistryEnvelope) =>
      requestJson<WorldScenePackageValidationResponse>("/validate", {
        body: manifest,
        method: "POST",
      }),
    publishManifest: (manifest: WorldScenePackageManifest | WorldSceneRegistryEnvelope) =>
      requestJson<WorldScenePackagePublishResponse>("", { body: manifest, method: "POST" }),
    listPackages: (query: WorldScenePackageListQuery = {}) => {
      const queryString = toQueryString({
        q: query.q,
        owner: query.owner,
        tags: query.tags?.join(","),
        limit: query.limit,
        offset: query.offset,
      });
      return requestJson<WorldScenePackageListEntry[]>(queryString);
    },
    getPackageVersion: (packageId: string, version: string) =>
      requestJson<WorldScenePackageVersionRecordPayload>(
        `/${encodeURIComponent(packageId)}/versions/${encodeURIComponent(version)}`
      ),
    getCapabilities: () => requestJson<WorldRegistryCapabilitiesResponse>("/capabilities"),
    getVersionUrl: (packageId: string, version: string) =>
      `${root}/${encodeURIComponent(packageId)}/versions/${encodeURIComponent(version)}`,
  };
};
