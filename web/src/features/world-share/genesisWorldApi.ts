import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";

export type GenesisDynamicContainerMode = "mesh" | "box" | "visual-only";

export type GenesisWorldOpenResponse = {
  started: boolean;
  pid: number;
  command: string[];
  dynamic_container_mode: GenesisDynamicContainerMode;
};

export const openGenesisWorld = async (
  dynamicContainerMode: GenesisDynamicContainerMode = "mesh"
): Promise<GenesisWorldOpenResponse> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/worlds/genesis/open`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dynamic_container_mode: dynamicContainerMode,
      }),
    },
    {
      requiredBackends: ["core-api"],
      context: "Open Genesis world",
    }
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Genesis launch failed (${response.status})`);
  }
  return (await response.json()) as GenesisWorldOpenResponse;
};
