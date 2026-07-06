import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";
import { readResponseErrorDetail } from "@/shared/lib/responseErrorDetails";
import { toWorldSceneRegistryEnvelope } from "@/features/world-share/worldScenePackageBuilder";
import type { WorldSceneRegistryEnvelope } from "@/features/world-share/worldScenePackageTypes";
import type {
  WorldRolloutImportRequest,
  WorldRolloutImportResponse,
  WorldRolloutJobCreateRequest,
  WorldRolloutJobResponse,
} from "@/features/world-share/worldRolloutTypes";

const WORLD_ROLLOUT_API_OPTIONS = {
  requiredBackends: ["core-api"] as const,
};

const isWorldSceneRegistryEnvelope = (
  value: WorldRolloutJobCreateRequest["world_package"]
): value is WorldSceneRegistryEnvelope => "world" in value;

export const createWorldRolloutJob = async (
  request: WorldRolloutJobCreateRequest
): Promise<WorldRolloutJobResponse> => {
  const normalizedRequest = {
    ...request,
    world_package: isWorldSceneRegistryEnvelope(request.world_package)
      ? request.world_package
      : toWorldSceneRegistryEnvelope(request.world_package),
  };
  const response = await guardedFetch(
    `${API_BASE_URL}/worlds/rollouts/jobs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalizedRequest),
    },
    { ...WORLD_ROLLOUT_API_OPTIONS, context: "World rollout job" }
  );
  if (!response.ok) {
    throw new Error(
      await readResponseErrorDetail(response, {
        fallback: `World rollout job failed (${response.status})`,
      })
    );
  }
  return (await response.json()) as WorldRolloutJobResponse;
};

export const getWorldRolloutJob = async (jobId: string): Promise<WorldRolloutJobResponse> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/worlds/rollouts/jobs/${encodeURIComponent(jobId)}`,
    undefined,
    { ...WORLD_ROLLOUT_API_OPTIONS, context: "World rollout job status" }
  );
  if (!response.ok) {
    throw new Error(
      await readResponseErrorDetail(response, {
        fallback: `World rollout job status failed (${response.status})`,
      })
    );
  }
  return (await response.json()) as WorldRolloutJobResponse;
};

export const importWorldRolloutResults = async (
  request: WorldRolloutImportRequest
): Promise<WorldRolloutImportResponse> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/worlds/rollouts/import`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
    { ...WORLD_ROLLOUT_API_OPTIONS, context: "World rollout import" }
  );
  if (!response.ok) {
    throw new Error(
      await readResponseErrorDetail(response, {
        fallback: `World rollout import failed (${response.status})`,
      })
    );
  }
  return (await response.json()) as WorldRolloutImportResponse;
};
