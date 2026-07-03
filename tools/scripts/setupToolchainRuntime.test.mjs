import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import {
  checkIkd,
  ensureCargoPathInShellRc,
  findCargo,
  findUv,
  shouldAutoInstallRust,
} from './setupToolchainRuntime.js';

test('toolchain lookup prefers managed uv locations before PATH', () => {
  const cargoUvPath = join('/home/dev', '.cargo', 'bin', 'uv');

  assert.equal(
    findUv({
      env: { HOME: '/home/dev', PATH: '/usr/bin' },
      existsSyncImpl: (candidatePath) => candidatePath === cargoUvPath,
    }),
    cargoUvPath
  );
});

test('toolchain lookup respects the host PATH delimiter', () => {
  const cargoPath = join('D:\\tools', 'cargo');

  assert.equal(
    findCargo({
      env: { HOME: '', PATH: 'C:\\bin;D:\\tools' },
      existsSyncImpl: (candidatePath) => candidatePath === cargoPath,
      pathDelimiter: ';',
    }),
    cargoPath
  );
});

test('cargo shell path setup appends once and updates the current process PATH', () => {
  const env = { HOME: '/home/dev', PATH: '/usr/bin' };
  const bashRc = join('/home/dev', '.bashrc');
  const writes = [];

  const changed = ensureCargoPathInShellRc({
    env,
    existsSyncImpl: (candidatePath) => candidatePath === bashRc,
    readFileSyncImpl: () => '# existing shell config\n',
    appendFileSyncImpl: (candidatePath, content, encoding) => {
      writes.push({ candidatePath, content, encoding });
    },
  });

  assert.equal(changed, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].candidatePath, bashRc);
  assert.match(writes[0].content, /URDF Studio setup/);
  assert.equal(env.PATH, `${join('/home/dev', '.cargo', 'bin')}:/usr/bin`);
});

test('cargo shell path setup does not append duplicate profile entries', () => {
  const env = { HOME: '/home/dev', PATH: `${join('/home/dev', '.cargo', 'bin')}:/usr/bin` };
  let appendCalled = false;

  const changed = ensureCargoPathInShellRc({
    env,
    existsSyncImpl: () => true,
    readFileSyncImpl: () => 'export PATH="$HOME/.cargo/bin:$PATH"\n',
    appendFileSyncImpl: () => {
      appendCalled = true;
    },
  });

  assert.equal(changed, false);
  assert.equal(appendCalled, false);
  assert.equal(env.PATH, `${join('/home/dev', '.cargo', 'bin')}:/usr/bin`);
});

test('Rust auto-install policy supports skip, explicit false, force, and default', () => {
  assert.equal(shouldAutoInstallRust({ env: { URDF_STUDIO_SKIP_RUST_AUTO_INSTALL: '1' } }), false);
  assert.equal(shouldAutoInstallRust({ env: { URDF_STUDIO_AUTO_INSTALL_RUST: 'false' } }), false);
  assert.equal(shouldAutoInstallRust({ env: { URDF_STUDIO_AUTO_INSTALL_RUST: 'yes' } }), true);
  assert.equal(shouldAutoInstallRust({ env: {} }), true);
});

test('IKD check is a no-op when IKD is disabled and absent', async () => {
  const result = await checkIkd({
    rootDir: '/repo',
    loadAppConfig: () => ({ ikd: { enabled: false } }),
    existsSyncImpl: () => false,
  });

  assert.deepEqual(result, { ok: true, changed: false });
});

test('IKD check installs Rust when cargo is missing and auto-install is enabled', async () => {
  let cargoAvailable = false;
  const cargoPath = join('/home/dev', '.cargo', 'bin', 'cargo');
  const calls = [];

  const result = await checkIkd({
    rootDir: '/repo',
    env: { HOME: '/home/dev', PATH: '/usr/bin' },
    loadAppConfig: () => ({ ikd: { enabled: true } }),
    existsSyncImpl: (candidatePath) => candidatePath === join('/repo', 'ikd', 'Cargo.toml'),
    findCargoImpl: () => (cargoAvailable ? cargoPath : null),
    installRustToolchainImpl: () => {
      calls.push('installRust');
      cargoAvailable = true;
    },
    ensureCargoPathInShellRcImpl: () => {
      calls.push('ensureCargoPath');
      return true;
    },
    spawnSyncImpl: (command, args) => {
      calls.push(['spawn', command, args]);
      return { status: 0, signal: null };
    },
  });

  assert.deepEqual(result, { ok: true, changed: true });
  assert.deepEqual(calls, [
    'installRust',
    'ensureCargoPath',
    'ensureCargoPath',
    ['spawn', cargoPath, ['--version']],
  ]);
});

test('IKD check reports a clear failure when cargo auto-install is disabled', async () => {
  let installAttempted = false;

  const result = await checkIkd({
    rootDir: '/repo',
    env: { URDF_STUDIO_AUTO_INSTALL_RUST: '0' },
    loadAppConfig: () => ({ ikd: { enabled: true } }),
    existsSyncImpl: (candidatePath) => candidatePath === join('/repo', 'ikd', 'Cargo.toml'),
    findCargoImpl: () => null,
    installRustToolchainImpl: () => {
      installAttempted = true;
    },
    shouldAutoInstallRustImpl: () => false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(installAttempted, false);
});

test('IKD check reports cargo execution failures', async () => {
  let outputPrinted = false;
  const result = await checkIkd({
    rootDir: '/repo',
    loadAppConfig: () => ({ ikd: { enabled: true } }),
    existsSyncImpl: (candidatePath) => candidatePath === join('/repo', 'ikd', 'Cargo.toml'),
    findCargoImpl: () => '/usr/bin/cargo',
    ensureCargoPathInShellRcImpl: () => false,
    spawnSyncImpl: () => ({ status: 1, signal: null, stderr: 'cargo failed' }),
    printCapturedCommandOutputImpl: () => {
      outputPrinted = true;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(outputPrinted, true);
});

test('IKD check fails when enabled but the manifest is missing', async () => {
  const result = await checkIkd({
    rootDir: '/repo',
    loadAppConfig: () => ({ ikd: { enabled: true } }),
    existsSyncImpl: () => false,
    findCargoImpl: () => '/usr/bin/cargo',
    ensureCargoPathInShellRcImpl: () => false,
    spawnSyncImpl: () => ({ status: 0, signal: null }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
});
