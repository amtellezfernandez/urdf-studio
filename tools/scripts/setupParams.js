export const HUGGING_FACE_TOKEN_URL = 'https://huggingface.co/settings/tokens';
export const GITHUB_FINE_GRAINED_TOKEN_URL = 'https://github.com/settings/tokens?type=beta';
export const GITHUB_CLI_LOGIN_COMMAND = 'gh auth login';
export const LOCAL_ILU_COMMAND = 'npx ilu';
export const GLOBAL_ILU_INSTALL_FLAG = '--install-global-ilu';
export const GLOBAL_ILU_INSTALL_ENV = 'URDF_STUDIO_INSTALL_GLOBAL_ILU';
export const GLOBAL_ILU_INSTALL_COMMAND = 'npm run setup -- --install-global-ilu';
export const SETUP_NPM_INSTALL_FLAGS = ['--no-fund', '--audit=false', '--loglevel=error'];
export const LEROBOT_TOOLCHAIN_DIRNAME = '.venv-lerobot';
export const PYTHON_ENV_DIRNAME = LEROBOT_TOOLCHAIN_DIRNAME;
export const MJLAB_SKIP_AUTO_INSTALL_ENV = 'URDF_STUDIO_SKIP_MJLAB_AUTO_INSTALL';
export const MJLAB_MUJOCO_WARP_PACKAGE = 'mujoco-warp==3.9.0.1';
export const MJX_SYSTEM_ID_DEPENDENCIES = ['mujoco-mjx==3.9.0', 'optax==0.2.8', 'mujoco-sysid==0.2.1'];
export const BACKEND_PYTHON_DEPENDENCIES = [
  'fastapi',
  'uvicorn',
  'pydantic',
  'huggingface_hub',
  'numpy==2.2.6',
  'pytest',
  'yourdfpy',
  'jax==0.6.2',
  'jaxlib==0.6.2',
  'jax_dataclasses',
  'jaxlie',
  'jaxls @ git+https://github.com/brentyi/jaxls.git@5f766d3b09364a96d83497de2325a835d0e23dc4',
  ...MJX_SYSTEM_ID_DEPENDENCIES,
  'coal==3.0.1',
  'placo',
];
export const BACKEND_PYTHON_STALE_DEPENDENCIES = ['libcoal', 'libpinocchio'];
export const BACKEND_PYTHON_VERIFY_IMPORT_SCRIPT = [
  'import importlib',
  'import importlib.metadata as metadata',
  'expected_versions = {"numpy": "2.2.6", "jax": "0.6.2", "jaxlib": "0.6.2"}',
  'for package_name, expected_version in expected_versions.items():',
  '    actual_version = metadata.version(package_name)',
  '    assert actual_version == expected_version, f"{package_name}=={actual_version}, expected {expected_version}"',
  'for module_name in ("fastapi", "uvicorn", "pytest", "yourdfpy", "jax_dataclasses", "jaxlie", "jaxls", "mujoco", "mujoco.mjx", "optax", "mujoco_sysid", "mujoco_sysid.mjx", "hppfcl", "pinocchio", "placo"):',
  '    importlib.import_module(module_name)',
  'print("backend python runtime ok")',
].join('\n');
export const LEROBOT_TRAINING_DEPENDENCIES = ['lerobot', 'torch', 'safetensors'];
export const LEROBOT_TRAINING_VERIFY_IMPORT_SCRIPT = 'import torch; import lerobot; import safetensors; print("lerobot training runtime ok")';
export const MJLAB_DEPENDENCIES = ['mjlab', 'mujoco', MJLAB_MUJOCO_WARP_PACKAGE];
export const MJLAB_VERIFY_IMPORT_SCRIPT = 'import mjlab; import mujoco; import mujoco_warp; print("mjlab runtime ok")';
