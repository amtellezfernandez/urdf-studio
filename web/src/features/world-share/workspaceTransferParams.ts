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

type WorkspaceTransferTargetRow = readonly [
  targetId: string,
  label: string,
  targetKind: WorkspaceTransferTargetKind,
  robotAssetFormat: WorkspaceTransferAssetFormat,
  transferStrategy: WorkspaceTransferStrategy,
  workspaceTarget?: boolean,
  motionValidation?: boolean,
  layoutRoundTrip?: boolean,
];

const WORKSPACE_TRANSFER_TARGET_ROWS = [
  ["genesis", "Genesis", "physics_simulator", "urdf", "direct", true],
  ["mjlab", "MJLab", "physics_simulator", "mjcf", "convert", true, true],
  ["mujoco", "MuJoCo", "physics_simulator", "mjcf", "convert", true],
  ["mjx", "MJX", "physics_simulator", "mjx_mjcf", "planned"],
  ["pybullet", "PyBullet", "physics_simulator", "urdf", "direct", true],
  ["sapien2", "SAPIEN 2", "physics_simulator", "urdf", "planned"],
  ["sapien3", "SAPIEN 3", "physics_simulator", "urdf", "planned"],
  ["isaacsim", "Isaac Sim", "physics_simulator", "usd", "planned"],
  ["isaacgym", "Isaac Gym", "physics_simulator", "urdf", "planned"],
  ["newton", "Newton", "physics_simulator", "mjcf", "planned"],
  ["blender", "Blender", "authoring_tool", "native", "direct", true, false, true],
  ["robosplatter", "RoboSplatter", "renderer", "native", "planned"],
] as const satisfies readonly WorkspaceTransferTargetRow[];

export type WorkspaceTransferTargetId = (typeof WORKSPACE_TRANSFER_TARGET_ROWS)[number][0];

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
