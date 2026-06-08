export const NATIVE_SIM_SETUP = {
  skipAutoInstallEnv: 'URDF_STUDIO_SKIP_NATIVE_SIM_AUTO_INSTALL',
  forceInstallEnv: 'URDF_STUDIO_INSTALL_NATIVE_SIM',
  jaxDependencies: [
    'jax==0.6.2',
    'jaxlib==0.6.2',
    'jax_dataclasses',
    'jaxlie',
    'jaxls @ git+https://github.com/brentyi/jaxls.git@5f766d3b09364a96d83497de2325a835d0e23dc4',
  ],
  mjxSystemIdDependencies: ['mujoco-mjx==3.9.0', 'optax==0.2.8', 'mujoco-sysid==0.2.1'],
  verifyImportScript: [
    'import importlib',
    'import importlib.metadata as metadata',
    'expected_versions = {"jax": "0.6.2", "jaxlib": "0.6.2"}',
    'for package_name, expected_version in expected_versions.items():',
    '    actual_version = metadata.version(package_name)',
    '    assert actual_version == expected_version, f"{package_name}=={actual_version}, expected {expected_version}"',
    'for module_name in ("jax_dataclasses", "jaxlie", "jaxls", "mujoco", "mujoco.mjx", "optax", "mujoco_sysid", "mujoco_sysid.mjx"):',
    '    importlib.import_module(module_name)',
    'print("backend python native simulation runtime ok")',
  ].join('\n'),
};

export const BACKEND_NATIVE_SIM_SKIP_ENV = NATIVE_SIM_SETUP.skipAutoInstallEnv;
export const BACKEND_NATIVE_SIM_FORCE_ENV = NATIVE_SIM_SETUP.forceInstallEnv;
export const BACKEND_PYTHON_JAX_DEPENDENCIES = NATIVE_SIM_SETUP.jaxDependencies;
export const MJX_SYSTEM_ID_DEPENDENCIES = NATIVE_SIM_SETUP.mjxSystemIdDependencies;
export const BACKEND_PYTHON_NATIVE_SIM_VERIFY_IMPORT_SCRIPT =
  NATIVE_SIM_SETUP.verifyImportScript;
