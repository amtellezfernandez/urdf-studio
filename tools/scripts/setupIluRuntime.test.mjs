import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertIluRuntimeContract,
  verifyIluRuntimeContract,
} from './setupIluRuntime.js';

function validIluRuntimeModules() {
  return {
    urdfCore: {
      convertURDFToMJCF: () => ({ mjcfContent: '<mujoco model="demo"/>' }),
      convertURDFToUSD: () => ({ usdContent: '#usda 1.0' }),
    },
    urdfCoreBundleMeshAssetsNode: {
      bundleMeshAssetsForUrdfFile: () => ({}),
    },
    urdfCoreNodeDomRuntime: {
      installNodeDomGlobals: () => {},
    },
  };
}

function domRuntimeGlobals() {
  return {
    DOMParser: function DOMParser() {},
    XMLSerializer: function XMLSerializer() {},
  };
}

test('setup validates the i-love-urdf simulator transfer contract', () => {
  assert.doesNotThrow(() =>
    assertIluRuntimeContract(validIluRuntimeModules(), domRuntimeGlobals())
  );
});

test('setup reports i-love-urdf runtime as ready when imports validate', async () => {
  const arrows = [];
  const success = [];
  const result = await verifyIluRuntimeContract({
    importRuntimeModules: async () => ({
      urdfCore: {
        convertURDFToMJCF: () => ({ mjcfContent: '<mujoco />' }),
        convertURDFToUSD: () => ({ usdContent: '#usda 1.0' }),
      },
      urdfCoreBundleMeshAssetsNode: {
        bundleMeshAssetsForUrdfFile: () => {},
      },
      urdfCoreNodeDomRuntime: {
        installNodeDomGlobals: () => {},
      },
    }),
    domGlobals: {
      DOMParser: function DOMParser() {},
      XMLSerializer: function XMLSerializer() {},
    },
    logArrow: (message) => arrows.push(message),
    logSuccess: (message) => success.push(message),
  });

  assert.deepEqual(result, { ok: true, changed: false });
  assert.deepEqual(arrows, ['Checking i-love-urdf runtime']);
  assert.deepEqual(success, ['i-love-urdf runtime ready']);
});

test('setup rejects an incomplete i-love-urdf simulator transfer contract', () => {
  assert.throws(
    () =>
      assertIluRuntimeContract(
        {
          urdfCore: {},
          urdfCoreBundleMeshAssetsNode: {},
          urdfCoreNodeDomRuntime: {},
        },
        {}
      ),
    /convertURDFToMJCF/
  );
});

test('setup rejects broken i-love-urdf conversion output', () => {
  const modules = validIluRuntimeModules();
  modules.urdfCore.convertURDFToMJCF = () => ({ mjcfContent: '<robot />' });

  assert.throws(
    () => assertIluRuntimeContract(modules, domRuntimeGlobals()),
    /MJCF conversion check failed/
  );
});

test('setup i-love-urdf verifier returns ready result when runtime contract passes', async () => {
  const result = await verifyIluRuntimeContract({
    importRuntimeModules: async () => validIluRuntimeModules(),
    domGlobals: domRuntimeGlobals(),
  });

  assert.deepEqual(result, { ok: true, changed: false });
});

test('setup i-love-urdf verifier reports clear failure without throwing', async () => {
  const warnings = [];
  const info = [];
  const result = await verifyIluRuntimeContract({
    importRuntimeModules: async () => ({
      urdfCore: {},
      urdfCoreBundleMeshAssetsNode: {},
      urdfCoreNodeDomRuntime: {},
    }),
    logWarning: (message) => warnings.push(message),
    logInfo: (message) => info.push(message),
  });

  assert.deepEqual(result, { ok: false, changed: false });
  assert.deepEqual(warnings, ['✗ i-love-urdf runtime check failed']);
  assert.match(info.join('\n'), /convertURDFToMJCF/);
  assert.match(info.join('\n'), /npm run setup/);
});
