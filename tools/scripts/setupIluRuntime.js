import { buildSetupResult } from './setupCommandResults.js';

export function assertIluRuntimeContract(
  {
    urdfCore,
    urdfCoreBundleMeshAssetsNode,
    urdfCoreNodeDomRuntime,
  },
  domGlobals = globalThis
) {
  const missingApis = [];
  if (typeof urdfCore?.convertURDFToMJCF !== 'function') {
    missingApis.push('convertURDFToMJCF');
  }
  if (typeof urdfCore?.convertURDFToUSD !== 'function') {
    missingApis.push('convertURDFToUSD');
  }
  if (typeof urdfCoreBundleMeshAssetsNode?.bundleMeshAssetsForUrdfFile !== 'function') {
    missingApis.push('bundleMeshAssetsForUrdfFile');
  }
  if (typeof urdfCoreNodeDomRuntime?.installNodeDomGlobals !== 'function') {
    missingApis.push('installNodeDomGlobals');
  }
  if (typeof domGlobals.DOMParser !== 'function') {
    missingApis.push('DOMParser');
  }
  if (typeof domGlobals.XMLSerializer !== 'function') {
    missingApis.push('XMLSerializer');
  }
  if (missingApis.length > 0) {
    throw new Error(`i-love-urdf runtime is missing required API(s): ${missingApis.join(', ')}`);
  }

  const conversion = urdfCore.convertURDFToMJCF(
    '<robot name="setup_check"><link name="base"/></robot>'
  );
  if (typeof conversion?.mjcfContent !== 'string' || !conversion.mjcfContent.includes('<mujoco')) {
    throw new Error('i-love-urdf MJCF conversion check failed.');
  }

  const usdConversion = urdfCore.convertURDFToUSD(
    '<robot name="setup_check"><link name="base"/></robot>'
  );
  if (typeof usdConversion?.usdContent !== 'string' || !usdConversion.usdContent.includes('#usda')) {
    throw new Error('i-love-urdf USD conversion check failed.');
  }
}

export async function verifyIluRuntimeContract({
  importRuntimeModules = () => import('./urdfCoreModules.js'),
  domGlobals = globalThis,
  logArrow = () => {},
  logSuccess = () => {},
  logWarning = () => {},
  logInfo = () => {},
} = {}) {
  logArrow('Checking i-love-urdf runtime');
  try {
    const modules = await importRuntimeModules();
    assertIluRuntimeContract(modules, domGlobals);
    logSuccess('i-love-urdf runtime ready');
    return buildSetupResult();
  } catch (error) {
    logWarning('✗ i-love-urdf runtime check failed');
    logInfo(error?.message || String(error));
    logInfo('Run npm install, then rerun npm run setup.');
    return buildSetupResult({ ok: false });
  }
}
