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
export const BACKEND_NATIVE_SIM_SKIP_ENV = 'URDF_STUDIO_SKIP_NATIVE_SIM_AUTO_INSTALL';
export const BACKEND_NATIVE_SIM_FORCE_ENV = 'URDF_STUDIO_INSTALL_NATIVE_SIM';
export const MJLAB_SKIP_AUTO_INSTALL_ENV = 'URDF_STUDIO_SKIP_MJLAB_AUTO_INSTALL';
export const MJLAB_FORCE_INSTALL_ENV = 'URDF_STUDIO_INSTALL_MJLAB';
export const MJLAB_MUJOCO_WARP_PACKAGE = 'mujoco-warp==3.9.0.1';
export const MJX_SYSTEM_ID_DEPENDENCIES = ['mujoco-mjx==3.9.0', 'optax==0.2.8', 'mujoco-sysid==0.2.1'];
export const GENESIS_SKIP_AUTO_INSTALL_ENV = 'URDF_STUDIO_SKIP_GENESIS_AUTO_INSTALL';
export const GENESIS_FORCE_INSTALL_ENV = 'URDF_STUDIO_INSTALL_GENESIS';
export const GENESIS_WORLD_PACKAGE = 'genesis-world==1.1.0';
export const GENESIS_RENDER_PACKAGE = 'imgui-bundle==1.92.801';
export const GENESIS_PYTHON_DEPENDENCIES = [GENESIS_WORLD_PACKAGE, GENESIS_RENDER_PACKAGE];
export const BACKEND_PYTHON_PORTABLE_DEPENDENCIES = [
  'fastapi',
  'python-multipart',
  'uvicorn',
  'pydantic',
  'huggingface_hub',
  'numpy==2.2.6',
  'pytest',
  'yourdfpy',
];
export const BACKEND_PYTHON_JAX_DEPENDENCIES = [
  'jax==0.6.2',
  'jaxlib==0.6.2',
  'jax_dataclasses',
  'jaxlie',
  'jaxls @ git+https://github.com/brentyi/jaxls.git@5f766d3b09364a96d83497de2325a835d0e23dc4',
];
export const BACKEND_PYTHON_PLACO_DEPENDENCIES = [
  'cmeel-urdfdom==4.0.1',
  'coal==3.0.1',
  'placo==0.9.16',
];
export const BACKEND_PYTHON_DEPENDENCIES = [
  ...BACKEND_PYTHON_PORTABLE_DEPENDENCIES,
  ...BACKEND_PYTHON_JAX_DEPENDENCIES,
  ...MJX_SYSTEM_ID_DEPENDENCIES,
  ...BACKEND_PYTHON_PLACO_DEPENDENCIES,
];
export const BACKEND_PYTHON_STALE_DEPENDENCIES = ['libcoal', 'libpinocchio'];
export const BACKEND_PYTHON_PORTABLE_VERIFY_IMPORT_SCRIPT = [
  'import importlib',
  'import importlib.metadata as metadata',
  'expected_versions = {"numpy": "2.2.6"}',
  'for package_name, expected_version in expected_versions.items():',
  '    actual_version = metadata.version(package_name)',
  '    assert actual_version == expected_version, f"{package_name}=={actual_version}, expected {expected_version}"',
  'for module_name in ("fastapi", "multipart", "uvicorn", "pytest", "yourdfpy", "hppfcl", "pinocchio", "placo"):',
  '    importlib.import_module(module_name)',
  'print("backend python portable runtime ok")',
].join('\n');
export const BACKEND_PYTHON_NATIVE_SIM_VERIFY_IMPORT_SCRIPT = [
  'import importlib',
  'import importlib.metadata as metadata',
  'expected_versions = {"jax": "0.6.2", "jaxlib": "0.6.2"}',
  'for package_name, expected_version in expected_versions.items():',
  '    actual_version = metadata.version(package_name)',
  '    assert actual_version == expected_version, f"{package_name}=={actual_version}, expected {expected_version}"',
  'for module_name in ("jax_dataclasses", "jaxlie", "jaxls", "mujoco", "mujoco.mjx", "optax", "mujoco_sysid", "mujoco_sysid.mjx"):',
  '    importlib.import_module(module_name)',
  'print("backend python native simulation runtime ok")',
].join('\n');
export const BACKEND_PYTHON_VERIFY_IMPORT_SCRIPT = [
  BACKEND_PYTHON_PORTABLE_VERIFY_IMPORT_SCRIPT,
  BACKEND_PYTHON_NATIVE_SIM_VERIFY_IMPORT_SCRIPT,
].join('\n');
export const GENESIS_VERIFY_IMPORT_SCRIPT = 'import genesis; import imgui_bundle; print("genesis static world viewer runtime ok")';
export const LEROBOT_TRAINING_DEPENDENCIES = ['lerobot', 'torch', 'safetensors'];
export const LEROBOT_TRAINING_VERIFY_IMPORT_SCRIPT = 'import torch; import lerobot; import safetensors; print("lerobot training runtime ok")';
export const MJLAB_DEPENDENCIES = ['mjlab', 'mujoco', MJLAB_MUJOCO_WARP_PACKAGE];
export const MJLAB_VERIFY_IMPORT_SCRIPT = 'import mjlab; import mujoco; import mujoco_warp; print("mjlab runtime ok")';
