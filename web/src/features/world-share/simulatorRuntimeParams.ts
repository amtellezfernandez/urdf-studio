export const SIMULATOR_API_BASE_PATH = "/simulators";

export type SimulatorRuntimeCapabilities = {
  worldViewer: boolean;
  motionValidation: boolean;
};

type SimulatorRuntimeSpecShape = {
  simulatorId: string;
  label: string;
  capabilities: SimulatorRuntimeCapabilities;
};

const SIMULATOR_RUNTIME_SPECS = [
  {
    simulatorId: "genesis",
    label: "Genesis",
    capabilities: {
      worldViewer: true,
      motionValidation: false,
    },
  },
  {
    simulatorId: "mjlab",
    label: "MJLab",
    capabilities: {
      worldViewer: true,
      motionValidation: true,
    },
  },
  {
    simulatorId: "mujoco",
    label: "MuJoCo",
    capabilities: {
      worldViewer: true,
      motionValidation: false,
    },
  },
  {
    simulatorId: "mjx",
    label: "MJX",
    capabilities: {
      worldViewer: false,
      motionValidation: false,
    },
  },
  {
    simulatorId: "pybullet",
    label: "PyBullet",
    capabilities: {
      worldViewer: false,
      motionValidation: false,
    },
  },
  {
    simulatorId: "sapien2",
    label: "SAPIEN 2",
    capabilities: {
      worldViewer: false,
      motionValidation: false,
    },
  },
  {
    simulatorId: "sapien3",
    label: "SAPIEN 3",
    capabilities: {
      worldViewer: false,
      motionValidation: false,
    },
  },
  {
    simulatorId: "isaacsim",
    label: "Isaac Sim",
    capabilities: {
      worldViewer: false,
      motionValidation: false,
    },
  },
  {
    simulatorId: "isaacgym",
    label: "Isaac Gym",
    capabilities: {
      worldViewer: false,
      motionValidation: false,
    },
  },
  {
    simulatorId: "newton",
    label: "Newton",
    capabilities: {
      worldViewer: false,
      motionValidation: false,
    },
  },
  {
    simulatorId: "blender",
    label: "Blender",
    capabilities: {
      worldViewer: false,
      motionValidation: false,
    },
  },
  {
    simulatorId: "robosplatter",
    label: "RoboSplatter",
    capabilities: {
      worldViewer: false,
      motionValidation: false,
    },
  },
] as const satisfies readonly SimulatorRuntimeSpecShape[];
export type SimulatorId = (typeof SIMULATOR_RUNTIME_SPECS)[number]["simulatorId"];
export type SimulatorRuntimeDescriptor = {
  simulatorId: SimulatorId;
  label: string;
  capabilities: SimulatorRuntimeCapabilities;
};

export const SIMULATOR_GENESIS_ID: SimulatorId = SIMULATOR_RUNTIME_SPECS[0].simulatorId;
export const SIMULATOR_MJLAB_ID: SimulatorId = SIMULATOR_RUNTIME_SPECS[1].simulatorId;
export const DEFAULT_SIMULATOR_RUNTIME_DESCRIPTORS: readonly SimulatorRuntimeDescriptor[] =
  SIMULATOR_RUNTIME_SPECS.map(({ simulatorId, label, capabilities }) => ({
    simulatorId,
    label,
    capabilities,
  }));

export const MAX_SIMULATOR_ASSET_ALIASES = 64;
