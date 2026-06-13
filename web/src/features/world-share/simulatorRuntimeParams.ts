export type SimulatorRuntimeCapabilities = {
  workspaceTarget: boolean;
  motionValidation: boolean;
  layoutRoundTrip: boolean;
};

export type SimulatorAssetFormat = "urdf" | "mjcf" | "mjx_mjcf" | "usd" | "native";
export type SimulatorTransferStrategy = "direct" | "convert" | "planned";
export type SimulatorTargetKind = "physics_simulator" | "authoring_tool" | "renderer";

export type SimulatorRuntimeTransferPolicy = {
  robotAssetFormat: SimulatorAssetFormat;
  sceneAssetFormat: SimulatorAssetFormat;
  frameConvention: string;
  transferStrategy: SimulatorTransferStrategy;
};

type SimulatorRuntimeSpecRow = readonly [
  simulatorId: string,
  label: string,
  targetKind: SimulatorTargetKind,
  robotAssetFormat: SimulatorAssetFormat,
  transferStrategy: SimulatorTransferStrategy,
  workspaceTarget?: boolean,
  motionValidation?: boolean,
  layoutRoundTrip?: boolean,
];

const transfer = (
  robotAssetFormat: SimulatorAssetFormat,
  transferStrategy: SimulatorTransferStrategy
): SimulatorRuntimeTransferPolicy => ({
  robotAssetFormat,
  sceneAssetFormat: robotAssetFormat,
  frameConvention: "ros-rep-103",
  transferStrategy,
});

const SIMULATOR_RUNTIME_ROWS = [
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
] as const satisfies readonly SimulatorRuntimeSpecRow[];

export type SimulatorId = (typeof SIMULATOR_RUNTIME_ROWS)[number][0];

type SimulatorRuntimeSpecShape = {
  simulatorId: SimulatorId;
  label: string;
  targetKind: SimulatorTargetKind;
  capabilities: SimulatorRuntimeCapabilities;
  transferPolicy: SimulatorRuntimeTransferPolicy;
};

const SIMULATOR_RUNTIME_SPECS = SIMULATOR_RUNTIME_ROWS.map(
  ([
    simulatorId,
    label,
    targetKind,
    robotAssetFormat,
    transferStrategy,
    workspaceTarget = false,
    motionValidation = false,
    layoutRoundTrip = false,
  ]): SimulatorRuntimeSpecShape => ({
    simulatorId,
    label,
    targetKind,
    capabilities: {
      workspaceTarget,
      motionValidation,
      layoutRoundTrip,
    },
    transferPolicy: transfer(robotAssetFormat, transferStrategy),
  })
);
export type SimulatorRuntimeDescriptor = {
  simulatorId: SimulatorId;
  label: string;
  targetKind: SimulatorTargetKind;
  capabilities: SimulatorRuntimeCapabilities;
  transferPolicy: SimulatorRuntimeTransferPolicy;
};

export const canOpenWorkspaceTarget = (
  descriptor: Pick<SimulatorRuntimeDescriptor, "capabilities">
): boolean => descriptor.capabilities.workspaceTarget;

export const SIMULATOR_GENESIS_ID: SimulatorId = SIMULATOR_RUNTIME_SPECS[0].simulatorId;
export const SIMULATOR_MJLAB_ID: SimulatorId = SIMULATOR_RUNTIME_SPECS[1].simulatorId;

export const MAX_SIMULATOR_ASSET_ALIASES = 64;
