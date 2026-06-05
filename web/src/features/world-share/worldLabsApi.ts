import { API_BASE_URL } from "@/shared/config/api";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import { guardedFetch } from "@/shared/lib/backendGuard";
import type {
  WorldLabsCapabilitiesResponse,
  WorldLabsGenerateRequest,
  WorldLabsGenerateResponse,
  WorldLabsListWorldsRequest,
  WorldLabsListWorldsResponse,
  WorldLabsOperationStatusResponse,
  WorldLabsWorldImportResponse,
} from "@/features/world-share/worldLabsTypes";

const WORLD_LABS_API_ROOT = `${API_BASE_URL}/worlds/world-labs`;
const WORLD_LABS_API_OPTIONS = {
  requiredBackends: FEATURE_GATES.worldsRegistry.requiredBackends,
};
const WORLD_LABS_WORLD_ID_QUERY_KEYS = ["world_id", "worldId", "id"] as const;

const cleanWorldLabsWorldId = (value: string) =>
  decodeURIComponent(value.trim()).replace(/^worlds?\//i, "").replace(/\/+$/, "");

export const parseWorldLabsWorldId = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    for (const key of WORLD_LABS_WORLD_ID_QUERY_KEYS) {
      const queryValue = url.searchParams.get(key);
      if (queryValue) return cleanWorldLabsWorldId(queryValue);
    }
    const segments = url.pathname.split("/").filter(Boolean);
    const worldMarkerIndex = segments.findIndex((segment) =>
      ["world", "worlds"].includes(segment.toLowerCase())
    );
    const markedWorldId = worldMarkerIndex >= 0 ? segments[worldMarkerIndex + 1] : null;
    if (markedWorldId) return cleanWorldLabsWorldId(markedWorldId);
    const oneSegmentWorldId = segments.length === 1 ? segments[0] : null;
    if (
      oneSegmentWorldId &&
      !["dashboard", "explore", "library", "world", "worlds"].includes(
        oneSegmentWorldId.toLowerCase()
      )
    ) {
      return cleanWorldLabsWorldId(oneSegmentWorldId);
    }
    return "";
  } catch {
    const queryMatch = trimmed.match(/[?&](?:world_id|worldId|id)=([^&#\s]+)/);
    if (queryMatch?.[1]) return cleanWorldLabsWorldId(queryMatch[1]);
  }

  return cleanWorldLabsWorldId(trimmed);
};

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

const getJson = async <T>(path: string, context: string): Promise<T> => {
  const response = await guardedFetch(
    `${WORLD_LABS_API_ROOT}${path}`,
    { headers: { Accept: "application/json" } },
    { ...WORLD_LABS_API_OPTIONS, context }
  );
  if (!response.ok) {
    throw new Error(await readErrorText(response));
  }
  return (await response.json()) as T;
};

const postJson = async <T>(path: string, body: unknown, context: string): Promise<T> => {
  const response = await guardedFetch(
    `${WORLD_LABS_API_ROOT}${path}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    { ...WORLD_LABS_API_OPTIONS, context }
  );
  if (!response.ok) {
    throw new Error(await readErrorText(response));
  }
  return (await response.json()) as T;
};

export const getWorldLabsCapabilities = () =>
  getJson<WorldLabsCapabilitiesResponse>("/capabilities", "World Labs capabilities");

export const generateWorldLabsWorld = (request: WorldLabsGenerateRequest) =>
  postJson<WorldLabsGenerateResponse>("/generate", request, "World Labs generation");

export const getWorldLabsOperation = (operationId: string) =>
  getJson<WorldLabsOperationStatusResponse>(
    `/operations/${encodeURIComponent(operationId)}`,
    "World Labs operation"
  );

export const listWorldLabsWorlds = (request: WorldLabsListWorldsRequest = {}) =>
  postJson<WorldLabsListWorldsResponse>(
    "/worlds:list",
    request,
    "World Labs library"
  );

export const importWorldLabsWorld = (worldId: string) =>
  getJson<WorldLabsWorldImportResponse>(
    `/worlds/${encodeURIComponent(worldId)}`,
    "World Labs world import"
  );
