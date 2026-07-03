import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";
import { assertBackendResponseOk } from "@/shared/lib/backendResponse";

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

export const getIluAssemblyManifestUrl = (assemblyId: string): string =>
  `${API_BASE_URL}/ilu-assembly/${encodeURIComponent(assemblyId)}/manifest`;

export const fetchIluAssemblyManifest = async (
  assemblyId: string
): Promise<IluAssemblyManifest> => {
  const response = await guardedFetch(getIluAssemblyManifestUrl(assemblyId), undefined, {
    ...CORE_API_OPTIONS,
    context: "Load ILU assembly",
  });
  await assertBackendResponseOk(response, "Failed to load ilu assembly.");
  return (await response.json()) as IluAssemblyManifest;
};
