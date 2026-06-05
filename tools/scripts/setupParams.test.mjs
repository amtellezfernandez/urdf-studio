import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKEND_NATIVE_SIM_FORCE_ENV,
  BACKEND_NATIVE_SIM_SKIP_ENV,
  BACKEND_PYTHON_DEPENDENCIES,
  BACKEND_PYTHON_JAX_DEPENDENCIES,
  BACKEND_PYTHON_NATIVE_SIM_VERIFY_IMPORT_SCRIPT,
  BACKEND_PYTHON_PLACO_DEPENDENCIES,
  BACKEND_PYTHON_PORTABLE_DEPENDENCIES,
  BACKEND_PYTHON_PORTABLE_VERIFY_IMPORT_SCRIPT,
  BACKEND_PYTHON_STALE_DEPENDENCIES,
  BACKEND_PYTHON_VERIFY_IMPORT_SCRIPT,
  GENESIS_FORCE_INSTALL_ENV,
  GENESIS_PYTHON_DEPENDENCIES,
  GENESIS_RENDER_PACKAGE,
  GENESIS_SKIP_AUTO_INSTALL_ENV,
  GENESIS_VERIFY_IMPORT_SCRIPT,
  GENESIS_WORLD_PACKAGE,
  MJX_SYSTEM_ID_DEPENDENCIES,
  MJLAB_DEPENDENCIES,
  MJLAB_FORCE_INSTALL_ENV,
  MJLAB_MUJOCO_WARP_PACKAGE,
  MJLAB_SKIP_AUTO_INSTALL_ENV,
  MJLAB_VERIFY_IMPORT_SCRIPT,
  SETUP_NPM_INSTALL_FLAGS,
} from './setupParams.js';

test('backend Python setup separates portable and native simulation runtimes', () => {
  assert.equal(BACKEND_NATIVE_SIM_SKIP_ENV, 'URDF_STUDIO_SKIP_NATIVE_SIM_AUTO_INSTALL');
  assert.equal(BACKEND_NATIVE_SIM_FORCE_ENV, 'URDF_STUDIO_INSTALL_NATIVE_SIM');
  assert.ok(BACKEND_PYTHON_PORTABLE_DEPENDENCIES.includes('fastapi'));
  assert.ok(BACKEND_PYTHON_PORTABLE_DEPENDENCIES.includes('python-multipart'));
  assert.ok(BACKEND_PYTHON_PORTABLE_DEPENDENCIES.includes('yourdfpy'));
  assert.ok(!BACKEND_PYTHON_PORTABLE_DEPENDENCIES.includes('jaxlib==0.6.2'));
  assert.ok(BACKEND_PYTHON_JAX_DEPENDENCIES.includes('jax==0.6.2'));
  assert.ok(BACKEND_PYTHON_JAX_DEPENDENCIES.includes('jaxlib==0.6.2'));
  assert.ok(BACKEND_PYTHON_PLACO_DEPENDENCIES.includes('cmeel-urdfdom==4.0.1'));
  assert.ok(BACKEND_PYTHON_PLACO_DEPENDENCIES.includes('coal==3.0.1'));
  assert.ok(BACKEND_PYTHON_PLACO_DEPENDENCIES.includes('placo==0.9.16'));
  assert.ok(BACKEND_PYTHON_STALE_DEPENDENCIES.includes('libcoal'));
  assert.ok(BACKEND_PYTHON_STALE_DEPENDENCIES.includes('libpinocchio'));
  assert.match(BACKEND_PYTHON_PORTABLE_VERIFY_IMPORT_SCRIPT, /"hppfcl"/);
  assert.match(BACKEND_PYTHON_PORTABLE_VERIFY_IMPORT_SCRIPT, /"multipart"/);
  assert.match(BACKEND_PYTHON_PORTABLE_VERIFY_IMPORT_SCRIPT, /"pinocchio"/);
  assert.match(BACKEND_PYTHON_PORTABLE_VERIFY_IMPORT_SCRIPT, /"placo"/);
  assert.match(BACKEND_PYTHON_NATIVE_SIM_VERIFY_IMPORT_SCRIPT, /"mujoco\.mjx"/);
  assert.match(BACKEND_PYTHON_VERIFY_IMPORT_SCRIPT, /backend python portable runtime ok/);
  assert.match(BACKEND_PYTHON_VERIFY_IMPORT_SCRIPT, /backend python native simulation runtime ok/);
});

test('backend Python setup includes MJX system-id runtime', () => {
  assert.deepEqual(MJX_SYSTEM_ID_DEPENDENCIES, ['mujoco-mjx==3.9.0', 'optax==0.2.8', 'mujoco-sysid==0.2.1']);
  assert.ok(BACKEND_PYTHON_DEPENDENCIES.includes('mujoco-mjx==3.9.0'));
  assert.ok(BACKEND_PYTHON_DEPENDENCIES.includes('optax==0.2.8'));
  assert.ok(BACKEND_PYTHON_DEPENDENCIES.includes('mujoco-sysid==0.2.1'));
  assert.match(BACKEND_PYTHON_VERIFY_IMPORT_SCRIPT, /"mujoco\.mjx"/);
  assert.match(BACKEND_PYTHON_VERIFY_IMPORT_SCRIPT, /"optax"/);
  assert.match(BACKEND_PYTHON_VERIFY_IMPORT_SCRIPT, /"mujoco_sysid"/);
  assert.match(BACKEND_PYTHON_VERIFY_IMPORT_SCRIPT, /"mujoco_sysid\.mjx"/);
});

test('MJLab setup pins and verifies MuJoCo-Warp', () => {
  assert.equal(MJLAB_SKIP_AUTO_INSTALL_ENV, 'URDF_STUDIO_SKIP_MJLAB_AUTO_INSTALL');
  assert.equal(MJLAB_FORCE_INSTALL_ENV, 'URDF_STUDIO_INSTALL_MJLAB');
  assert.equal(MJLAB_MUJOCO_WARP_PACKAGE, 'mujoco-warp==3.9.0.1');
  assert.ok(MJLAB_DEPENDENCIES.includes(MJLAB_MUJOCO_WARP_PACKAGE));
  assert.match(MJLAB_VERIFY_IMPORT_SCRIPT, /import mjlab/);
  assert.match(MJLAB_VERIFY_IMPORT_SCRIPT, /import mujoco/);
  assert.match(MJLAB_VERIFY_IMPORT_SCRIPT, /import mujoco_warp/);
});

test('Genesis static world viewer runtime is pinned separately from portable backend setup', () => {
  assert.equal(GENESIS_WORLD_PACKAGE, 'genesis-world==1.1.0');
  assert.equal(GENESIS_RENDER_PACKAGE, 'imgui-bundle==1.92.801');
  assert.deepEqual(GENESIS_PYTHON_DEPENDENCIES, [GENESIS_WORLD_PACKAGE, GENESIS_RENDER_PACKAGE]);
  assert.equal(GENESIS_SKIP_AUTO_INSTALL_ENV, 'URDF_STUDIO_SKIP_GENESIS_AUTO_INSTALL');
  assert.equal(GENESIS_FORCE_INSTALL_ENV, 'URDF_STUDIO_INSTALL_GENESIS');
  assert.ok(!BACKEND_PYTHON_DEPENDENCIES.includes(GENESIS_WORLD_PACKAGE));
  assert.ok(!BACKEND_PYTHON_DEPENDENCIES.includes(GENESIS_RENDER_PACKAGE));
  assert.doesNotMatch(BACKEND_PYTHON_VERIFY_IMPORT_SCRIPT, /"genesis"/);
  assert.doesNotMatch(BACKEND_PYTHON_VERIFY_IMPORT_SCRIPT, /"imgui_bundle"/);
  assert.match(GENESIS_VERIFY_IMPORT_SCRIPT, /import genesis/);
  assert.match(GENESIS_VERIFY_IMPORT_SCRIPT, /import imgui_bundle/);
});

test('setup npm installs suppress funding and audit noise', () => {
  assert.deepEqual(SETUP_NPM_INSTALL_FLAGS, ['--no-fund', '--audit=false', '--loglevel=error']);
});
