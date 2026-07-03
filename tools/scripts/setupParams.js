export * from './setupParams/common.js';
export * from './setupParams/backendPythonCore.js';
export * from './setupParams/collisionStack.js';
export * from './setupParams/nativeSim.js';
export * from './setupParams/mjlab.js';
export * from './setupParams/genesis.js';
export * from './setupParams/pybullet.js';
export * from './setupParams/blender.js';

import { BACKEND_PYTHON_CORE_SETUP } from './setupParams/backendPythonCore.js';
import {
  BACKEND_PYTHON_COLLISION_STACK_VERIFY_IMPORT_SCRIPT,
  BACKEND_PYTHON_PLACO_DEPENDENCIES,
} from './setupParams/collisionStack.js';
import {
  BACKEND_PYTHON_JAX_DEPENDENCIES,
  BACKEND_PYTHON_NATIVE_SIM_VERIFY_IMPORT_SCRIPT,
  MJX_DEPENDENCIES,
} from './setupParams/nativeSim.js';

export const BACKEND_PYTHON_PORTABLE_DEPENDENCIES = BACKEND_PYTHON_CORE_SETUP.dependencies;
export const BACKEND_PYTHON_CORE_VERIFY_IMPORT_SCRIPT = BACKEND_PYTHON_CORE_SETUP.verifyImportScript;
export const BACKEND_PYTHON_DEPENDENCIES = [
  ...BACKEND_PYTHON_PORTABLE_DEPENDENCIES,
  ...BACKEND_PYTHON_JAX_DEPENDENCIES,
  ...MJX_DEPENDENCIES,
  ...BACKEND_PYTHON_PLACO_DEPENDENCIES,
];
export const BACKEND_PYTHON_PORTABLE_VERIFY_IMPORT_SCRIPT = [
  BACKEND_PYTHON_CORE_VERIFY_IMPORT_SCRIPT,
  BACKEND_PYTHON_COLLISION_STACK_VERIFY_IMPORT_SCRIPT,
  'print("backend python portable runtime ok")',
].join('\n');
export const BACKEND_PYTHON_VERIFY_IMPORT_SCRIPT = [
  BACKEND_PYTHON_PORTABLE_VERIFY_IMPORT_SCRIPT,
  BACKEND_PYTHON_NATIVE_SIM_VERIFY_IMPORT_SCRIPT,
].join('\n');
