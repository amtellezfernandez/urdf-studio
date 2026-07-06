import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";
import { readResponseErrorDetail } from "@/shared/lib/responseErrorDetails";
import type {
  WorldScenePackageManifest,
  WorldSceneRegistryEnvelope,
} from "@/features/world-share/worldScenePackageTypes";
import {
  type WorkspaceTransferTargetDescriptor,
  type WorkspaceTransferTargetId,
} from "@/features/world-share/workspaceTransferParams";
import {
  buildWorkspaceTransferMeshAssetUploads,
} from "@/features/world-share/workspaceTransferMeshAssets";
import { throwIfWorkspaceTransferAborted } from "@/features/world-share/workspaceTransferAbort";
import { toWorldSceneRegistryEnvelope } from "@/features/world-share/worldScenePackageBuilder";

export { buildWorkspaceTransferMeshAssetUploads };
export type { WorkspaceTransferTargetDescriptor, WorkspaceTransferTargetId };

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
  worldPackage: WorldScenePackageManifest | WorldSceneRegistryEnvelope;
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

const workspaceTransferTargetPath = (
  targetId: WorkspaceTransferTargetId,
  path: string
): string => `${workspaceTransferBasePath()}/targets/${targetId}${path}`;

const workspaceTransferBasePath = (): string => "/workspace-transfer";

const loadWorldScenePackageBuilderModule = () =>
  import("@/features/world-share/worldScenePackageBuilder");

const refreshWorkspaceWorldPackageDigest = async (
  worldPackage: WorldScenePackageManifest | WorldSceneRegistryEnvelope
): Promise<WorldSceneRegistryEnvelope> => {
  const {
    refreshWorldScenePackageSnapshotDigest,
    refreshWorldSceneRegistryEnvelopeSnapshotDigest,
  } =
    await loadWorldScenePackageBuilderModule();
  if ("world" in worldPackage) {
    return refreshWorldSceneRegistryEnvelopeSnapshotDigest(worldPackage);
  }
  return toWorldSceneRegistryEnvelope(
    await refreshWorldScenePackageSnapshotDigest(worldPackage)
  );
};

const formatTargetName = (
  targetId: WorkspaceTransferTargetId,
  targetLabel?: string | null
): string => targetLabel?.trim() || targetId;


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
    const detail = await readResponseErrorDetail(response, { fallback: "" });
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
    const detail = await readResponseErrorDetail(response, { fallback: "" });
    throw new Error(detail || `${targetId} workspace stop failed (${response.status})`);
  }
  return (await response.json()) as WorkspaceLaunchCancelResponse;
};

export const applyWorkspaceTransferTargetChangeSet = async (
  targetId: WorkspaceTransferTargetId,
  worldPackage: WorldScenePackageManifest | WorldSceneRegistryEnvelope,
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
    const detail = await readResponseErrorDetail(response, { fallback: "" });
    throw new Error(detail || `${targetId} workspace change import failed (${response.status})`);
  }
  return (await response.json()) as WorkspaceChangeSetApplyResponse;
};

export const applyWorkspaceChangeSet = async (
  worldPackage: WorldScenePackageManifest | WorldSceneRegistryEnvelope,
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
    const detail = await readResponseErrorDetail(response, { fallback: "" });
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
    const detail = await readResponseErrorDetail(response, { fallback: "" });
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
    const detail = await readResponseErrorDetail(response, { fallback: "" });
    throw new Error(detail || `Workspace transfer target list failed (${response.status})`);
  }
  const payload = (await response.json()) as WorkspaceTransferTargetListResponse;
  return payload.targets;
};
