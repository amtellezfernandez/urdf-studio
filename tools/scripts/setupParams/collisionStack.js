export const COLLISION_STACK_SETUP = {
  skipAutoInstallEnv: 'URDF_STUDIO_SKIP_COLLISION_STACK_AUTO_INSTALL',
  forceInstallEnv: 'URDF_STUDIO_INSTALL_COLLISION_STACK',
  dependencies: [
    'cmeel-urdfdom==4.0.1',
    'coal==3.0.1',
    'placo==0.9.16',
  ],
  supersededDependencies: ['libcoal', 'libpinocchio'],
  verifyImportScript: [
    'import importlib',
    'for module_name in ("hppfcl", "pinocchio", "placo"):',
    '    importlib.import_module(module_name)',
    'print("backend python collision stack runtime ok")',
  ].join('\n'),
};

export const BACKEND_COLLISION_STACK_SKIP_ENV = COLLISION_STACK_SETUP.skipAutoInstallEnv;
export const BACKEND_COLLISION_STACK_FORCE_ENV = COLLISION_STACK_SETUP.forceInstallEnv;
export const BACKEND_PYTHON_PLACO_DEPENDENCIES = COLLISION_STACK_SETUP.dependencies;
export const BACKEND_PYTHON_SUPERSEDED_DEPENDENCIES = COLLISION_STACK_SETUP.supersededDependencies;
export const BACKEND_PYTHON_COLLISION_STACK_VERIFY_IMPORT_SCRIPT =
  COLLISION_STACK_SETUP.verifyImportScript;
