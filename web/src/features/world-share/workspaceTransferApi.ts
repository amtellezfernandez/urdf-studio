import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";
import type { WorldScenePackageManifest } from "@/features/world-share/worldScenePackageTypes";
import {
  WORKSPACE_TRANSFER_PARAMS,
  type WorkspaceTransferTargetDescriptor,
  type WorkspaceTransferTargetId,
} from "@/features/world-share/workspaceTransferParams";

export type { WorkspaceTransferTargetDescriptor, WorkspaceTransferTargetId };

export type WorkspaceTransferMeshAssetUpload = {
  path: string;
  aliases: string[];
  content_base64: string;
  mime?: string | null;
};

export type WorkspaceOpenResponse = {
  targetId: WorkspaceTransferTargetId;
  started: boolean;
  pid: number;
  command: string[];
  logPath?: string | null;
  worldPackagePath: string;
  robotUrdfPath: string;
  targetAssetPath?: string | null;
  targetAssetFormat?: "urdf" | "mjcf" | "usd" | "native" | null;
  bundledMeshCount: number;
  unresolvedMeshRefs: string[];
  worldObjectCount: number;
  cameraCount: number;
};

export type WorkspaceTransferTargetStatus = {
  targetId: WorkspaceTransferTargetId;
  available: boolean;
  status: string;
  dependencies: { name: string; available: boolean }[];
};

export type WorkspaceTransferTargetListResponse = {
  targets: WorkspaceTransferTargetDescriptor[];
};

export type WorkspaceChangeSetApplyResponse = {
  targetId: WorkspaceTransferTargetId;
  world_package: WorldScenePackageManifest;
  appliedChangeCount: number;
  reviewOnlyCount: number;
};

export type OpenWorkspaceTransferTargetParams = {
  targetId: WorkspaceTransferTargetId;
  worldPackage: WorldScenePackageManifest;
  urdfAssetPath?: string | null;
  meshFiles: Record<string, Blob>;
  packageRoots?: Record<string, string[]>;
  iluSessionId?: string | null;
  targetLabel?: string | null;
};

const workspaceTransferTargetPath = (
  targetId: WorkspaceTransferTargetId,
  path: string
): string => `${workspaceTransferBasePath()}/targets/${targetId}${path}`;

const workspaceTransferBasePath = (): string => "/workspace-transfer";

const loadWorldScenePackageBuilderModule = () =>
  import("@/features/world-share/worldScenePackageBuilder");

const refreshWorkspaceWorldPackageDigest = async (
  worldPackage: WorldScenePackageManifest
): Promise<WorldScenePackageManifest> => {
  const { refreshWorldScenePackageSnapshotDigest } =
    await loadWorldScenePackageBuilderModule();
  return refreshWorldScenePackageSnapshotDigest(worldPackage);
};

const formatTargetName = (
  targetId: WorkspaceTransferTargetId,
  targetLabel?: string | null
): string => targetLabel?.trim() || targetId;

const normalizeUploadPath = (value: string): string | null => {
  const normalized = value.replace(/\\/g, "/").trim().replace(/^\/+/, "").replace(/\/+/g, "/");
  if (!normalized || normalized.includes("\0") || normalized.includes(":")) return null;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "..")) return null;
  return parts.filter((part) => part !== ".").join("/");
};

const addAlias = (aliases: Set<string>, value: string | null | undefined): void => {
  if (!value || aliases.size >= WORKSPACE_TRANSFER_PARAMS.maxAssetAliases) return;
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

export const buildWorkspaceTransferMeshAssetUploads = async (
  meshFiles: Record<string, Blob>,
  packageRoots?: Record<string, string[]>
): Promise<WorkspaceTransferMeshAssetUpload[]> => {
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
        aliases: aliases.slice(0, WORKSPACE_TRANSFER_PARAMS.maxAssetAliases),
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

export const openWorkspaceTransferTarget = async ({
  targetId,
  worldPackage,
  urdfAssetPath,
  meshFiles,
  packageRoots,
  iluSessionId,
  targetLabel,
}: OpenWorkspaceTransferTargetParams): Promise<WorkspaceOpenResponse> => {
  const meshAssets = await buildWorkspaceTransferMeshAssetUploads(meshFiles, packageRoots);
  const transferWorldPackage = await refreshWorkspaceWorldPackageDigest(worldPackage);
  const response = await guardedFetch(
    `${API_BASE_URL}${workspaceTransferTargetPath(targetId, "/open")}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        world_package: transferWorldPackage,
        urdf_asset_path: urdfAssetPath || undefined,
        mesh_assets: meshAssets,
        package_roots: packageRoots ?? {},
        ilu_session_id: iluSessionId || undefined,
      }),
    },
    {
      requiredBackends: ["core-api"],
      context: `Open ${formatTargetName(targetId, targetLabel)}`,
    }
  );
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `${targetId} workspace open failed (${response.status})`);
  }
  return (await response.json()) as WorkspaceOpenResponse;
};

export const applyWorkspaceTransferTargetChangeSet = async (
  targetId: WorkspaceTransferTargetId,
  worldPackage: WorldScenePackageManifest,
  changeSet: unknown
): Promise<WorkspaceChangeSetApplyResponse> => {
  const transferWorldPackage = await refreshWorkspaceWorldPackageDigest(worldPackage);
  const response = await guardedFetch(
    `${API_BASE_URL}${workspaceTransferTargetPath(targetId, "/change-set/apply")}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        world_package: transferWorldPackage,
        change_set: changeSet,
      }),
    },
    {
      requiredBackends: ["core-api"],
      context: `Import ${formatTargetName(targetId)} workspace changes`,
    }
  );
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `${targetId} workspace change import failed (${response.status})`);
  }
  return (await response.json()) as WorkspaceChangeSetApplyResponse;
};

export const applyWorkspaceChangeSet = async (
  worldPackage: WorldScenePackageManifest,
  changeSet: unknown
): Promise<WorkspaceChangeSetApplyResponse> => {
  const transferWorldPackage = await refreshWorkspaceWorldPackageDigest(worldPackage);
  const response = await guardedFetch(
    `${API_BASE_URL}${workspaceTransferBasePath()}/change-set/apply`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        world_package: transferWorldPackage,
        change_set: changeSet,
      }),
    },
    {
      requiredBackends: ["core-api"],
      context: "Import workspace changes",
    }
  );
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Workspace change import failed (${response.status})`);
  }
  return (await response.json()) as WorkspaceChangeSetApplyResponse;
};

export const fetchWorkspaceTransferTargetStatus = async (
  targetId: WorkspaceTransferTargetId
): Promise<WorkspaceTransferTargetStatus> => {
  const response = await guardedFetch(
    `${API_BASE_URL}${workspaceTransferTargetPath(targetId, "/status")}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
    {
      requiredBackends: ["core-api"],
      context: `Check ${formatTargetName(targetId)} availability`,
    }
  );
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `${targetId} availability check failed (${response.status})`);
  }
  return (await response.json()) as WorkspaceTransferTargetStatus;
};

export const fetchWorkspaceTransferTargets = async (): Promise<
  WorkspaceTransferTargetDescriptor[]
> => {
  const response = await guardedFetch(
    `${API_BASE_URL}${workspaceTransferBasePath()}/targets`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
    {
      requiredBackends: ["core-api"],
      context: "List workspace transfer targets",
    }
  );
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Workspace transfer target list failed (${response.status})`);
  }
  const payload = (await response.json()) as WorkspaceTransferTargetListResponse;
  return payload.targets;
};
