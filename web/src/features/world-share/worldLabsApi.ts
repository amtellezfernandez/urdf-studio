import { API_BASE_URL } from "@/shared/config/api";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import { guardedFetch } from "@/shared/lib/backendGuard";
import type {
  WorldLabsCapabilitiesResponse,
  WorldLabsGenerateRequest,
  WorldLabsGenerateResponse,
  WorldLabsOperationStatusResponse,
} from "@/features/world-share/worldLabsTypes";

const WORLD_LABS_API_ROOT = `${API_BASE_URL}/worlds/world-labs`;
const WORLD_LABS_API_OPTIONS = {
  requiredBackends: FEATURE_GATES.worldsRegistry.requiredBackends,
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
