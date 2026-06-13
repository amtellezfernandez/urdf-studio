export const SIMULATOR_API_BASE_PATH = "/simulators";

export type SimulatorRuntimeCapabilities = {
  workspaceTarget: boolean;
  motionValidation: boolean;
  layoutRoundTrip: boolean;
};

export type SimulatorAssetFormat = "urdf" | "mjcf" | "mjx_mjcf" | "usd" | "native";
export type SimulatorTransferStrategy = "direct" | "convert" | "planned";

export type SimulatorRuntimeTransferPolicy = {
  robotAssetFormat: SimulatorAssetFormat;
  sceneAssetFormat: SimulatorAssetFormat;
  frameConvention: string;
  transferStrategy: SimulatorTransferStrategy;
};

type SimulatorRuntimeSpecRow = readonly [
  simulatorId: string,
  label: string,
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
  ["genesis", "Genesis", "urdf", "direct", true],
  ["mjlab", "MJLab", "mjcf", "convert", true, true],
  ["mujoco", "MuJoCo", "mjcf", "convert", true],
  ["mjx", "MJX", "mjx_mjcf", "planned"],
  ["pybullet", "PyBullet", "urdf", "direct", true],
  ["sapien2", "SAPIEN 2", "urdf", "planned"],
  ["sapien3", "SAPIEN 3", "urdf", "planned"],
  ["isaacsim", "Isaac Sim", "usd", "planned"],
  ["isaacgym", "Isaac Gym", "urdf", "planned"],
  ["newton", "Newton", "mjcf", "planned"],
  ["blender", "Blender", "native", "direct", true, false, true],
  ["robosplatter", "RoboSplatter", "native", "planned"],
] as const satisfies readonly SimulatorRuntimeSpecRow[];

export type SimulatorId = (typeof SIMULATOR_RUNTIME_ROWS)[number][0];

type SimulatorRuntimeSpecShape = {
  simulatorId: SimulatorId;
  label: string;
  capabilities: SimulatorRuntimeCapabilities;
  transferPolicy: SimulatorRuntimeTransferPolicy;
};

const SIMULATOR_RUNTIME_SPECS = SIMULATOR_RUNTIME_ROWS.map(
  ([
    simulatorId,
    label,
    robotAssetFormat,
    transferStrategy,
    workspaceTarget = false,
    motionValidation = false,
    layoutRoundTrip = false,
  ]): SimulatorRuntimeSpecShape => ({
    simulatorId,
    label,
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
  capabilities: SimulatorRuntimeCapabilities;
  transferPolicy: SimulatorRuntimeTransferPolicy;
};

export const canOpenSimulatorWorkspace = (
  descriptor: Pick<SimulatorRuntimeDescriptor, "capabilities">
): boolean => descriptor.capabilities.workspaceTarget;

export const SIMULATOR_GENESIS_ID: SimulatorId = SIMULATOR_RUNTIME_SPECS[0].simulatorId;
export const SIMULATOR_MJLAB_ID: SimulatorId = SIMULATOR_RUNTIME_SPECS[1].simulatorId;

export const MAX_SIMULATOR_ASSET_ALIASES = 64;
