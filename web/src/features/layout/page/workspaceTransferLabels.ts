import type {
  WorkspaceTransferAssetFormat,
} from "@/features/world-share/workspaceTransferParams";

type WorkspaceTransferAssetShape = {
  robotAssetFormat: WorkspaceTransferAssetFormat;
  sceneAssetFormat: WorkspaceTransferAssetFormat;
};

const ASSET_FORMAT_LABELS: Record<WorkspaceTransferAssetFormat, string> = {
  urdf: "URDF",
  mjcf: "MJCF",
  mjx_mjcf: "MJX",
  usd: "USD",
  native: "Native",
};

export const formatWorkspaceTransferAssetLabel = (
  target: WorkspaceTransferAssetShape
): string => {
  const robotFormat = ASSET_FORMAT_LABELS[target.robotAssetFormat];
  const sceneFormat = ASSET_FORMAT_LABELS[target.sceneAssetFormat];
  return robotFormat === sceneFormat ? robotFormat : `${robotFormat} + ${sceneFormat}`;
};
