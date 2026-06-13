export type WorkspaceTransferCapabilities = {
  workspaceTarget: boolean;
  motionValidation: boolean;
  layoutRoundTrip: boolean;
};

export type WorkspaceTransferAssetFormat = "urdf" | "mjcf" | "mjx_mjcf" | "usd" | "native";
export type WorkspaceTransferStrategy = "direct" | "convert" | "planned";
export type WorkspaceTransferTargetKind = "physics_simulator" | "authoring_tool" | "renderer";

export type WorkspaceTransferPolicy = {
  robotAssetFormat: WorkspaceTransferAssetFormat;
  sceneAssetFormat: WorkspaceTransferAssetFormat;
  frameConvention: string;
  transferStrategy: WorkspaceTransferStrategy;
};

export type WorkspaceTransferTargetId = string;

export type WorkspaceTransferTargetDescriptor = {
  targetId: WorkspaceTransferTargetId;
  label: string;
  targetKind: WorkspaceTransferTargetKind;
  capabilities: WorkspaceTransferCapabilities;
  transferPolicy: WorkspaceTransferPolicy;
};

export const canOpenWorkspaceTarget = (
  descriptor: Pick<WorkspaceTransferTargetDescriptor, "capabilities">
): boolean => descriptor.capabilities.workspaceTarget;

export const WORKSPACE_TRANSFER_PARAMS = {
  maxAssetAliases: 64,
} as const;
