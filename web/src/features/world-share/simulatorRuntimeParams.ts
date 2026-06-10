export const SIMULATOR_API_BASE_PATH = "/simulators";

export type SimulatorRuntimeCapabilities = {
  worldViewer: boolean;
  motionValidation: boolean;
};

export type SimulatorAssetFormat = "urdf" | "mjcf" | "mjx_mjcf" | "usd" | "native";
export type SimulatorLaunchStrategy = "direct" | "convert" | "planned";

export type SimulatorRuntimeTransferPolicy = {
  robotAssetFormat: SimulatorAssetFormat;
  sceneAssetFormat: SimulatorAssetFormat;
  frameConvention: string;
  launchStrategy: SimulatorLaunchStrategy;
};

type SimulatorRuntimeSpecRow = readonly [
  simulatorId: string,
  label: string,
  robotAssetFormat: SimulatorAssetFormat,
  launchStrategy: SimulatorLaunchStrategy,
  worldViewer?: boolean,
  motionValidation?: boolean,
];

const transfer = (
  robotAssetFormat: SimulatorAssetFormat,
  launchStrategy: SimulatorLaunchStrategy
): SimulatorRuntimeTransferPolicy => ({
  robotAssetFormat,
  sceneAssetFormat: robotAssetFormat,
  frameConvention: "ros-rep-103",
  launchStrategy,
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
  ["blender", "Blender", "usd", "planned"],
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
    launchStrategy,
    worldViewer = false,
    motionValidation = false,
  ]): SimulatorRuntimeSpecShape => ({
    simulatorId,
    label,
    capabilities: {
      worldViewer,
      motionValidation,
    },
    transferPolicy: transfer(robotAssetFormat, launchStrategy),
  })
);
export type SimulatorRuntimeDescriptor = {
  simulatorId: SimulatorId;
  label: string;
  capabilities: SimulatorRuntimeCapabilities;
  transferPolicy: SimulatorRuntimeTransferPolicy;
};

export const SIMULATOR_GENESIS_ID: SimulatorId = SIMULATOR_RUNTIME_SPECS[0].simulatorId;
export const SIMULATOR_MJLAB_ID: SimulatorId = SIMULATOR_RUNTIME_SPECS[1].simulatorId;
export const DEFAULT_SIMULATOR_RUNTIME_DESCRIPTORS: readonly SimulatorRuntimeDescriptor[] =
  SIMULATOR_RUNTIME_SPECS.map(({ simulatorId, label, capabilities, transferPolicy }) => ({
    simulatorId,
    label,
    capabilities,
    transferPolicy,
  }));

export const MAX_SIMULATOR_ASSET_ALIASES = 64;
