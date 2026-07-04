import type { WorkspaceTransferTargetState } from "@/features/layout/page/workspaceTransferState";
import {
  canOpenWorkspaceTarget,
  type WorkspaceTransferAssetFormat,
  type WorkspaceTransferTargetId,
} from "@/features/world-share/workspaceTransferParams";
import type {
  WorkspaceTransferTargetDescriptor,
  WorkspaceTransferTargetStatus,
} from "@/features/world-share/workspaceTransferApi";
import type { WorldScenePackageManifest } from "@/features/world-share/worldScenePackageTypes";

type BuildWorkspaceTransferTargetStateParams = {
  descriptor: WorkspaceTransferTargetDescriptor;
  lastOpenedTargetId: WorkspaceTransferTargetId | null;
  loadingTargetId: WorkspaceTransferTargetId | null;
  sceneSummary: string;
  status?: WorkspaceTransferTargetStatus;
  onCancelTarget: (targetId: WorkspaceTransferTargetId) => void;
  onOpenTarget: (descriptor: WorkspaceTransferTargetDescriptor) => Promise<void>;
};

const WORKSPACE_TRANSFER_ASSET_FORMAT_LABELS = new Map<string, string>([
  ["urdf", "URDF"],
  ["mjcf", "MJCF"],
  ["mjx_mjcf", "MJX MJCF"],
  ["usd", "USD"],
  ["native", "native"],
]);

const formatWorkspaceAssetFormat = (format: string): string =>
  WORKSPACE_TRANSFER_ASSET_FORMAT_LABELS.get(format) ?? format.toUpperCase();

const describeWorkspaceAssetFormats = (
  robotAssetFormat: WorkspaceTransferAssetFormat,
  sceneAssetFormat: WorkspaceTransferAssetFormat,
): string => {
  const robotFormat = formatWorkspaceAssetFormat(robotAssetFormat);
  const sceneFormat = formatWorkspaceAssetFormat(sceneAssetFormat);
  return robotFormat === sceneFormat ? robotFormat : `${robotFormat} + ${sceneFormat}`;
};

export const formatSceneTransferSummary = (
  objectCount: number,
  cameraCount: number,
): string => `${objectCount} obj · ${cameraCount} cam`;

const resolveWorkspaceTransferTargetTransferDescription = (
  descriptor: WorkspaceTransferTargetDescriptor,
): string => {
  const assetFormats = describeWorkspaceAssetFormats(
    descriptor.transferPolicy.robotAssetFormat,
    descriptor.transferPolicy.sceneAssetFormat,
  );
  switch (descriptor.transferPolicy.transferStrategy) {
    case "direct":
      if (
        descriptor.transferPolicy.robotAssetFormat === "urdf" &&
        descriptor.transferPolicy.sceneAssetFormat === "urdf"
      ) {
        return "Uses the loaded URDF directly; no simulator-specific robot file is generated.";
      }
      return `Uses a ${assetFormats} workspace package for ${descriptor.label}.`;
    case "convert":
      return `URDF Studio writes a new ${assetFormats} simulator asset before opening ${descriptor.label}.`;
    case "planned":
      return `${descriptor.label} compatibility is listed, but opening is not enabled yet; it will require a ${assetFormats} simulator asset.`;
    default:
      return `${descriptor.label} uses ${assetFormats}.`;
  }
};

const createsWorkspaceTransferAsset = (
  descriptor: WorkspaceTransferTargetDescriptor,
): boolean =>
  descriptor.transferPolicy.transferStrategy !== "direct" ||
  descriptor.transferPolicy.robotAssetFormat !== "urdf" ||
  descriptor.transferPolicy.sceneAssetFormat !== "urdf";

export const resolveWorkspaceTransferTargetStatusLabel = (
  descriptor: WorkspaceTransferTargetDescriptor,
  status?: WorkspaceTransferTargetStatus,
): string => {
  if (!canOpenWorkspaceTarget(descriptor)) return "planned";
  if (status?.available === false) return status.status || "unavailable";
  if (status?.available === true) return status.status || "ready";
  return "checking";
};

const workspaceTransferTargetNeedsAttention = (
  status?: WorkspaceTransferTargetStatus,
): boolean => {
  if (status?.available !== true) return false;
  const normalizedStatus = status.status.trim().toLowerCase();
  return normalizedStatus !== "" && normalizedStatus !== "ready";
};

export const canLaunchWorkspaceTransferTarget = (
  descriptor: WorkspaceTransferTargetDescriptor,
  status?: WorkspaceTransferTargetStatus,
): boolean => canOpenWorkspaceTarget(descriptor) && status?.available !== false;

export const assertWorkspacePackageCarriesSceneObjects = (
  worldPackage: WorldScenePackageManifest,
  studioWorldObjectCount: number,
): void => {
  if (studioWorldObjectCount <= 0 || worldPackage.world_snapshot.objects.length > 0) return;
  throw new Error(
    "Workspace transfer blocked: Studio has world objects, but the generated scene package is empty.",
  );
};

const resolveWorkspaceTransferTargetDetail = (
  descriptor: WorkspaceTransferTargetDescriptor,
  sceneSummary: string,
  status?: WorkspaceTransferTargetStatus,
): string => {
  const assetFormat = formatWorkspaceAssetFormat(descriptor.transferPolicy.robotAssetFormat);
  const baseDetail = (() => {
    if (!canOpenWorkspaceTarget(descriptor)) return `${assetFormat} soon`;
    if (status && !status.available) return `${assetFormat} soon`;
    if (descriptor.capabilities.layoutRoundTrip) return `${assetFormat} layout round trip`;
    if (descriptor.capabilities.motionValidation) return `${assetFormat} validation workspace`;
    if (descriptor.targetKind === "physics_simulator") return `${assetFormat} simulation workspace`;
    if (descriptor.targetKind === "renderer") return `${assetFormat} visual workspace`;
    return `${assetFormat} open`;
  })();
  return `${baseDetail} · ${sceneSummary}`;
};

export const buildWorkspaceTransferTargetState = ({
  descriptor,
  lastOpenedTargetId,
  loadingTargetId,
  onCancelTarget,
  onOpenTarget,
  sceneSummary,
  status,
}: BuildWorkspaceTransferTargetStateParams): WorkspaceTransferTargetState => {
  const canOpen = canLaunchWorkspaceTransferTarget(descriptor, status);
  const disabledLabel = !canOpenWorkspaceTarget(descriptor)
    ? `${descriptor.label} planned`
    : `${descriptor.label}: ${status?.status || "unavailable"}`;
  return {
    id: descriptor.targetId,
    label: descriptor.label,
    targetKind: descriptor.targetKind,
    detail: resolveWorkspaceTransferTargetDetail(descriptor, sceneSummary, status),
    robotAssetFormat: descriptor.transferPolicy.robotAssetFormat,
    sceneAssetFormat: descriptor.transferPolicy.sceneAssetFormat,
    transferStrategy: descriptor.transferPolicy.transferStrategy,
    transferDescription: resolveWorkspaceTransferTargetTransferDescription(descriptor),
    createsTransferAsset: createsWorkspaceTransferAsset(descriptor),
    statusLabel: resolveWorkspaceTransferTargetStatusLabel(descriptor, status),
    openLabel: `Open in ${descriptor.label}`,
    openingLabel: `Opening ${descriptor.label}`,
    cancelLabel: `Stop opening ${descriptor.label}`,
    isBusy: loadingTargetId === descriptor.targetId,
    isActive: lastOpenedTargetId === descriptor.targetId,
    needsAttention: workspaceTransferTargetNeedsAttention(status),
    canOpen,
    disabledLabel,
    onAction: () => onOpenTarget(descriptor),
    onCancel: () => onCancelTarget(descriptor.targetId),
  };
};
