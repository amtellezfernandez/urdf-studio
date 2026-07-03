export const SIMULATOR_COMPATIBILITY_IDS = Object.freeze([
  'genesis',
  'mujoco',
  'mjlab',
  'mjx',
  'pybullet',
  'sapien2',
  'sapien3',
  'isaacsim',
  'newton',
  'blender',
  'robosplatter',
]);

export const SIMULATOR_TARGET_LABELS = Object.freeze({
  genesis: 'Genesis',
  mujoco: 'MuJoCo',
  mjlab: 'MJLab',
  mjx: 'MJX',
  pybullet: 'PyBullet',
  sapien2: 'SAPIEN 2',
  sapien3: 'SAPIEN 3',
  isaacsim: 'Isaac Sim',
  newton: 'Newton',
  blender: 'Blender',
  robosplatter: 'RoboSplatter',
});

export const SIMULATOR_SETUP_MODES = Object.freeze({
  managed: 'managed',
  external: 'external',
  planned: 'planned',
});

export const MIN_ISAAC_DRIVER_VERSION = Object.freeze({
  linux: '580.65.06',
  win32: '580.88',
});
export const MIN_JAX_CUDA13_DRIVER_VERSION = '580';
export const ISAAC_SIM_REFERENCE_VERSION = '6.0.0';
export const ISAAC_SIM_COMPATIBILITY_CHECK_EXPERIENCE = 'isaacsim.exp.compatibility_check';
export const ISAAC_SIM_COMPATIBILITY_CHECK_MINIMAL_PACKAGE = 'isaacsim[compatibility-check]';

export const WSL_D3D12_DRI_DRIVER_PATH = '/usr/lib/x86_64-linux-gnu/dri/d3d12_dri.so';
export const WSL_D3D12_LIBRARY_DIR = '/usr/lib/wsl/lib';
export const WSL_DXG_DEVICE_PATH = '/dev/dxg';
