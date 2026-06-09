import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";
import type { WorldScenePackageManifest } from "@/features/world-share/worldScenePackageTypes";
import {
  DEFAULT_SIMULATOR_RUNTIME_DESCRIPTORS,
  MAX_SIMULATOR_ASSET_ALIASES,
  SIMULATOR_API_BASE_PATH,
  type SimulatorRuntimeDescriptor,
  type SimulatorId,
} from "@/features/world-share/simulatorRuntimeParams";

export type { SimulatorId, SimulatorRuntimeDescriptor };

export type SimulatorMeshAssetUpload = {
  path: string;
  aliases: string[];
  content_base64: string;
  mime?: string | null;
};

export type SimulatorWorldOpenResponse = {
  simulator_id: SimulatorId;
  started: boolean;
  pid: number;
  command: string[];
  log_path?: string | null;
  world_package_path: string;
  robot_urdf_path: string;
  simulator_asset_path?: string | null;
  simulator_asset_format?: "urdf" | "mjcf" | "usd" | null;
  bundled_mesh_count: number;
  unresolved_mesh_refs: string[];
};

export type SimulatorRuntimeStatus = {
  runtimeName: SimulatorId;
  available: boolean;
  status: string;
  dependencies: { name: string; available: boolean }[];
};

export type SimulatorRuntimeListResponse = {
  simulators: SimulatorRuntimeDescriptor[];
};

export type OpenSimulatorWorldParams = {
  simulatorId: SimulatorId;
  worldPackage: WorldScenePackageManifest;
  urdfAssetPath?: string | null;
  meshFiles: Record<string, Blob>;
  packageRoots?: Record<string, string[]>;
  iluSessionId?: string | null;
};

const simulatorRuntimePath = (simulatorId: SimulatorId, path: string): string =>
  `${SIMULATOR_API_BASE_PATH}/${simulatorId}${path}`;

const simulatorDisplayNames = new Map<SimulatorId, string>(
  DEFAULT_SIMULATOR_RUNTIME_DESCRIPTORS.map((descriptor) => [
    descriptor.simulatorId,
    descriptor.label,
  ])
);

const formatSimulatorName = (simulatorId: SimulatorId): string => {
  return simulatorDisplayNames.get(simulatorId) ?? simulatorId;
};

const normalizeUploadPath = (value: string): string | null => {
  const normalized = value.replace(/\\/g, "/").trim().replace(/^\/+/, "").replace(/\/+/g, "/");
  if (!normalized || normalized.includes("\0") || normalized.includes(":")) return null;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "..")) return null;
  return parts.filter((part) => part !== ".").join("/");
};

const addAlias = (aliases: Set<string>, value: string | null | undefined): void => {
  if (!value || aliases.size >= MAX_SIMULATOR_ASSET_ALIASES) return;
  const normalized = normalizeUploadPath(value);
  if (normalized) aliases.add(normalized);
};

const buildAssetAliases = (
  path: string,
  packageRoots: Record<string, string[]> | undefined
): string[] => {
  const aliases = new Set<string>();
  const normalizedPath = normalizeUploadPath(path);
  addAlias(aliases, normalizedPath);
  if (!normalizedPath || !packageRoots) return [...aliases];

  Object.entries(packageRoots).forEach(([packageName, roots]) => {
    const normalizedPackageName = normalizeUploadPath(packageName);
    if (!normalizedPackageName) return;
    roots.forEach((root) => {
      const normalizedRoot = normalizeUploadPath(root);
      if (!normalizedRoot) return;
      if (normalizedPath === normalizedRoot) {
        addAlias(aliases, normalizedPackageName);
        return;
      }
      if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
        addAlias(
          aliases,
          `${normalizedPackageName}/${normalizedPath.slice(normalizedRoot.length + 1)}`
        );
      }
    });
    if (normalizedPath.startsWith("meshes/") || normalizedPath.startsWith("assets/")) {
      addAlias(aliases, `${normalizedPackageName}/${normalizedPath}`);
    }
  });

  return [...aliases];
};

const blobToBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};

export const buildSimulatorMeshAssetUploads = async (
  meshFiles: Record<string, Blob>,
  packageRoots?: Record<string, string[]>
): Promise<SimulatorMeshAssetUpload[]> => {
  const pathsByBlob = new Map<Blob, Set<string>>();
  const blobByAlias = new Map<string, Blob>();

  Object.entries(meshFiles).forEach(([path, blob]) => {
    const aliases = buildAssetAliases(path, packageRoots);
    aliases.forEach((alias) => {
      const current = blobByAlias.get(alias);
      if (current && current !== blob) return;
      blobByAlias.set(alias, blob);
      const paths = pathsByBlob.get(blob) ?? new Set<string>();
      paths.add(alias);
      pathsByBlob.set(blob, paths);
    });
  });

  return Promise.all(
    [...pathsByBlob.entries()].map(async ([blob, paths]) => {
      const sortedPaths = [...paths].sort((left, right) => left.localeCompare(right));
      const [path, ...aliases] = sortedPaths;
      return {
        path,
        aliases: aliases.slice(0, MAX_SIMULATOR_ASSET_ALIASES),
        content_base64: await blobToBase64(blob),
        mime: blob.type || null,
      };
    })
  );
};

const readErrorDetail = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.clone().json()) as { detail?: unknown };
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      return payload.detail.trim();
    }
  } catch {
    // Fall back to response text below.
  }
  return (await response.text()).trim();
};

export const openSimulatorWorld = async ({
  simulatorId,
  worldPackage,
  urdfAssetPath,
  meshFiles,
  packageRoots,
  iluSessionId,
}: OpenSimulatorWorldParams): Promise<SimulatorWorldOpenResponse> => {
  const meshAssets = await buildSimulatorMeshAssetUploads(meshFiles, packageRoots);
  const response = await guardedFetch(
    `${API_BASE_URL}${simulatorRuntimePath(simulatorId, "/world/open")}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        world_package: worldPackage,
        urdf_asset_path: urdfAssetPath || undefined,
        mesh_assets: meshAssets,
        package_roots: packageRoots ?? {},
        ilu_session_id: iluSessionId || undefined,
      }),
    },
    {
      requiredBackends: ["core-api"],
      context: `Open ${formatSimulatorName(simulatorId)} world`,
    }
  );
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `${simulatorId} launch failed (${response.status})`);
  }
  return (await response.json()) as SimulatorWorldOpenResponse;
};

export const fetchSimulatorRuntimeStatus = async (
  simulatorId: SimulatorId
): Promise<SimulatorRuntimeStatus> => {
  const response = await guardedFetch(
    `${API_BASE_URL}${simulatorRuntimePath(simulatorId, "/runtime")}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
    {
      requiredBackends: ["core-api"],
      context: `Check ${formatSimulatorName(simulatorId)} runtime`,
    }
  );
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `${simulatorId} runtime check failed (${response.status})`);
  }
  return (await response.json()) as SimulatorRuntimeStatus;
};

export const fetchSimulatorRuntimes = async (): Promise<SimulatorRuntimeDescriptor[]> => {
  const response = await guardedFetch(
    `${API_BASE_URL}${SIMULATOR_API_BASE_PATH}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
    {
      requiredBackends: ["core-api"],
      context: "List simulator runtimes",
    }
  );
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Simulator runtime list failed (${response.status})`);
  }
  const payload = (await response.json()) as SimulatorRuntimeListResponse;
  return payload.simulators;
};
