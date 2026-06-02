import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";

export type IluAssemblyManifestFile = {
  path: string;
  url: string;
  mime?: string | null;
};

export type IluAssemblySource = {
  type: "local";
  folder?: string | null;
};

export type IluAssemblyManifest = {
  label?: string | null;
  files: IluAssemblyManifestFile[];
  selectedPaths: string[];
  namesByPath: Record<string, string>;
  sourceByPath: Record<string, IluAssemblySource>;
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

export const getIluAssemblyManifestUrl = (assemblyId: string): string =>
  `${API_BASE_URL}/ilu-assembly/${encodeURIComponent(assemblyId)}/manifest`;

export const fetchIluAssemblyManifest = async (
  assemblyId: string
): Promise<IluAssemblyManifest> => {
  const response = await guardedFetch(getIluAssemblyManifestUrl(assemblyId), undefined, {
    ...CORE_API_OPTIONS,
    context: "Load ILU assembly",
  });
  await assertOk(response, "Failed to load ilu assembly.");
  return (await response.json()) as IluAssemblyManifest;
};
