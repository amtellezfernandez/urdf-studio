// genesis-world 1.1.0 imports torch at module load and branches on the torch
// version (treats < 2.8 as "old"), but its wheel does not declare torch as a
// dependency. Pin a compatible floor so the adapter installs and verifies
// instead of failing on a missing or too-old torch. A floor (not an exact pin)
// keeps the platform-correct torch build resolvable across CPU/CUDA/MPS.
const buildGenesisSetup = (torchMinVersion) => ({
  skipAutoInstallEnv: 'URDF_STUDIO_SKIP_GENESIS_AUTO_INSTALL',
  forceInstallEnv: 'URDF_STUDIO_INSTALL_GENESIS',
  torchMinVersion,
  packages: {
    torch: `torch>=${torchMinVersion}`,
    world: 'genesis-world==1.1.0',
    renderer: 'imgui-bundle==1.92.801',
  },
  verifyImportScript: [
    'import importlib.metadata as metadata',
    `expected_torch = "${torchMinVersion}"`,
    'min_torch = tuple(int(part) for part in expected_torch.split("."))',
    'installed_torch = metadata.version("torch")',
    'torch_version = tuple(int(part) for part in installed_torch.split(".")[: len(min_torch)])',
    'assert torch_version >= min_torch, f"torch=={installed_torch}, expected >= {expected_torch}"',
    'import torch',
    'import genesis',
    'import imgui_bundle',
    'print("genesis workspace adapter runtime ok")',
  ].join('\n'),
});

export const GENESIS_SETUP = buildGenesisSetup('2.8');

export const GENESIS_SKIP_AUTO_INSTALL_ENV = GENESIS_SETUP.skipAutoInstallEnv;
export const GENESIS_FORCE_INSTALL_ENV = GENESIS_SETUP.forceInstallEnv;
export const GENESIS_TORCH_MIN_VERSION = GENESIS_SETUP.torchMinVersion;
export const GENESIS_TORCH_PACKAGE = GENESIS_SETUP.packages.torch;
export const GENESIS_WORLD_PACKAGE = GENESIS_SETUP.packages.world;
export const GENESIS_RENDER_PACKAGE = GENESIS_SETUP.packages.renderer;
export const GENESIS_PYTHON_DEPENDENCIES = Object.values(GENESIS_SETUP.packages);
export const GENESIS_VERIFY_IMPORT_SCRIPT = GENESIS_SETUP.verifyImportScript;
