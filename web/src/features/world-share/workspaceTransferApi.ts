import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";
import { blobToBase64 } from "@/shared/lib/blobEncoding";
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
  launchMode?: "interactive_viewer" | "headless_check";
  logPath?: string | null;
  worldPackagePath: string;
  robotUrdfPath: string;
  targetAssetPath?: string | null;
  targetAssetFormat?: "urdf" | "mjcf" | "usd" | "native" | null;
  bundledMeshCount: number;
  unresolvedMeshRefs: string[];
  workspaceWarnings?: string[];
  worldObjectCount: number;
  cameraCount: number;
};

export type WorkspaceLaunchCancelResponse = {
  targetId: WorkspaceTransferTargetId;
  launchId: string;
  cancelled: boolean;
  processStopped: boolean;
  pid?: number | null;
};

export type WorkspaceTransferTargetStatus = {
  targetId: WorkspaceTransferTargetId;
  available: boolean;
  status: string;
  dependencies: {
    name: string;
    available: boolean;
    required?: boolean;
    scope?: "workspace" | "validation" | "runtime";
  }[];
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
  launchId?: string | null;
  worldPackage: WorldScenePackageManifest;
  urdfAssetPath?: string | null;
  meshFiles: Record<string, Blob>;
  packageRoots?: Record<string, string[]>;
  iluSessionId?: string | null;
  targetLabel?: string | null;
  signal?: AbortSignal;
};

export type CancelWorkspaceTransferTargetLaunchParams = {
  targetId: WorkspaceTransferTargetId;
  launchId: string;
  targetLabel?: string | null;
};

type WorkspaceTransferAbortOptions = {
  signal?: AbortSignal;
};

const workspaceTransferTargetPath = (
  targetId: WorkspaceTransferTargetId,
  path: string
): string => `${workspaceTransferBasePath()}/targets/${targetId}${path}`;

const workspaceTransferBasePath = (): string => "/workspace-transfer";

const HOST_ABSOLUTE_ROOT_SEGMENTS = new Set([
  "applications",
  "bin",
  "boot",
  "dev",
  "etc",
  "home",
  "library",
  "media",
  "mnt",
  "opt",
  "private",
  "proc",
  "program files",
  "root",
  "run",
  "sbin",
  "sys",
  "system",
  "tmp",
  "users",
  "usr",
  "var",
  "volumes",
]);

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

const normalizeUploadPath = (
  value: string,
  { allowRootRelativeAsset = false } = {}
): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("//")) return null;
  if (trimmed.startsWith("\\\\")) return null;
  const slashNormalized = trimmed.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (slashNormalized.startsWith("/")) {
    if (!allowRootRelativeAsset) return null;
    const rootRelative = slashNormalized.replace(/^\/+/, "");
    const [firstSegment] = rootRelative.split("/");
    if (
      !firstSegment ||
      HOST_ABSOLUTE_ROOT_SEGMENTS.has(firstSegment.toLowerCase())
    ) {
      return null;
    }
    return normalizeUploadPath(rootRelative);
  }
  const normalized = slashNormalized;
  if (normalized.startsWith("~")) return null;
  if (!normalized || normalized.includes("\0") || normalized.includes(":")) return null;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "..")) return null;
  const portablePath = parts.filter((part) => part !== ".").join("/");
  return portablePath || null;
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
  const normalizedPath = normalizeUploadPath(path, { allowRootRelativeAsset: true });
  if (!normalizedPath) {
    throw new Error(`Workspace mesh asset path must be portable relative: ${path}`);
  }
  addAlias(aliases, normalizedPath);
  if (!packageRoots) return [...aliases];

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
    if (normalizedPath.includes("/")) {
      addAlias(aliases, `${normalizedPackageName}/${normalizedPath}`);
    }
  });

  return [...aliases];
};

const createWorkspaceTransferAbortError = (): Error => {
  if (typeof DOMException !== "undefined") {
    return new DOMException("Workspace transfer cancelled.", "AbortError");
  }
  const error = new Error("Workspace transfer cancelled.");
  error.name = "AbortError";
  return error;
};

const throwIfWorkspaceTransferAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw createWorkspaceTransferAbortError();
  }
};

export const buildWorkspaceTransferMeshAssetUploads = async (
  meshFiles: Record<string, Blob>,
  packageRoots?: Record<string, string[]>,
  options: WorkspaceTransferAbortOptions = {}
): Promise<WorkspaceTransferMeshAssetUpload[]> => {
  const pathsByBlob = new Map<Blob, Set<string>>();
  const blobByAlias = new Map<string, Blob>();
  throwIfWorkspaceTransferAborted(options.signal);

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
      throwIfWorkspaceTransferAborted(options.signal);
      const sortedPaths = [...paths].sort((left, right) => left.localeCompare(right));
      const [path, ...aliases] = sortedPaths;
      const contentBase64 = await blobToBase64(blob);
      throwIfWorkspaceTransferAborted(options.signal);
      return {
        path,
        aliases: aliases.slice(0, WORKSPACE_TRANSFER_PARAMS.maxAssetAliases),
        content_base64: contentBase64,
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
  launchId,
  worldPackage,
  urdfAssetPath,
  meshFiles,
  packageRoots,
  iluSessionId,
  targetLabel,
  signal,
}: OpenWorkspaceTransferTargetParams): Promise<WorkspaceOpenResponse> => {
  const meshAssets = await buildWorkspaceTransferMeshAssetUploads(meshFiles, packageRoots, {
    signal,
  });
  throwIfWorkspaceTransferAborted(signal);
  const transferWorldPackage = await refreshWorkspaceWorldPackageDigest(worldPackage);
  throwIfWorkspaceTransferAborted(signal);
  const response = await guardedFetch(
    `${API_BASE_URL}${workspaceTransferTargetPath(targetId, "/open")}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      signal,
      body: JSON.stringify({
        world_package: transferWorldPackage,
        urdf_asset_path: urdfAssetPath || undefined,
        mesh_assets: meshAssets,
        package_roots: packageRoots ?? {},
        ilu_session_id: iluSessionId || undefined,
        launch_id: launchId || undefined,
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

export const cancelWorkspaceTransferTargetLaunch = async ({
  targetId,
  launchId,
  targetLabel,
}: CancelWorkspaceTransferTargetLaunchParams): Promise<WorkspaceLaunchCancelResponse> => {
  const response = await guardedFetch(
    `${API_BASE_URL}${workspaceTransferTargetPath(
      targetId,
      `/launches/${encodeURIComponent(launchId)}/cancel`
    )}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    },
    {
      requiredBackends: ["core-api"],
      context: `Stop opening ${formatTargetName(targetId, targetLabel)}`,
    }
  );
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `${targetId} workspace stop failed (${response.status})`);
  }
  return (await response.json()) as WorkspaceLaunchCancelResponse;
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
