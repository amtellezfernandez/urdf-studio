import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKEND_PYTHON_DEPENDENCIES,
  BACKEND_PYTHON_STALE_DEPENDENCIES,
  BACKEND_PYTHON_VERIFY_IMPORT_SCRIPT,
  MJX_SYSTEM_ID_DEPENDENCIES,
  MJLAB_DEPENDENCIES,
  MJLAB_MUJOCO_WARP_PACKAGE,
  MJLAB_VERIFY_IMPORT_SCRIPT,
  SETUP_NPM_INSTALL_FLAGS,
} from './setupParams.js';

test('backend Python setup includes compatible Placo collision runtime', () => {
  assert.ok(BACKEND_PYTHON_DEPENDENCIES.includes('cmeel-urdfdom==4.0.1'));
  assert.ok(BACKEND_PYTHON_DEPENDENCIES.includes('coal==3.0.1'));
  assert.ok(BACKEND_PYTHON_DEPENDENCIES.includes('placo==0.9.16'));
  assert.ok(BACKEND_PYTHON_STALE_DEPENDENCIES.includes('libcoal'));
  assert.ok(BACKEND_PYTHON_STALE_DEPENDENCIES.includes('libpinocchio'));
  assert.match(BACKEND_PYTHON_VERIFY_IMPORT_SCRIPT, /"hppfcl"/);
  assert.match(BACKEND_PYTHON_VERIFY_IMPORT_SCRIPT, /"pinocchio"/);
  assert.match(BACKEND_PYTHON_VERIFY_IMPORT_SCRIPT, /"placo"/);
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
  assert.equal(MJLAB_MUJOCO_WARP_PACKAGE, 'mujoco-warp==3.9.0.1');
  assert.ok(MJLAB_DEPENDENCIES.includes(MJLAB_MUJOCO_WARP_PACKAGE));
  assert.match(MJLAB_VERIFY_IMPORT_SCRIPT, /import mjlab/);
  assert.match(MJLAB_VERIFY_IMPORT_SCRIPT, /import mujoco/);
  assert.match(MJLAB_VERIFY_IMPORT_SCRIPT, /import mujoco_warp/);
});

test('setup npm installs suppress funding and audit noise', () => {
  assert.deepEqual(SETUP_NPM_INSTALL_FLAGS, ['--no-fund', '--audit=false', '--loglevel=error']);
});
