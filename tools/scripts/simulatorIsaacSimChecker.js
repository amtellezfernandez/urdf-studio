import path from 'path';
import { existsSync } from 'fs';
import { spawnSync } from 'child_process';

import { ISAAC_SIM_COMPATIBILITY_CHECK_EXPERIENCE } from './simulatorCompatibilityParams.js';
import {
  asString,
  commandUnavailable,
  runCommand,
  splitCommandLine,
  summarizeCommandOutput,
} from './simulatorHostProbeUtils.js';

function officialIsaacSimCheckerPassed(result) {
  const output = `${result.stdout}\n${result.stderr}`;
  const hasFailureMarker =
    /\b(failed|not compatible|requirements? not met)\b/i.test(output) &&
    !/\b0\s+failed\b/i.test(output);
  return result.ok && !hasFailureMarker;
}

function officialIsaacSimCheckerCandidates({ env, platform, existsSyncImpl }) {
  const candidates = [];
  const explicitCommand = splitCommandLine(
    env.URDF_STUDIO_ISAACSIM_COMPATIBILITY_CHECKER ||
      env.URDF_STUDIO_ISAAC_SIM_COMPATIBILITY_CHECKER ||
      ''
  );
  if (explicitCommand.length > 0) {
    candidates.push({
      command: explicitCommand[0],
      args: explicitCommand.slice(1),
      source: 'configured command',
      required: true,
    });
  }

  const scriptNames =
    platform === 'win32'
      ? ['isaac-sim.compatibility_check.bat', 'omni.isaac.sim.compatibility_check.bat']
      : ['isaac-sim.compatibility_check.sh', 'omni.isaac.sim.compatibility_check.sh'];
  const rootCandidates = [
    env.ISAACSIM_ROOT,
    env.ISAAC_SIM_ROOT,
    env.OMNI_ISAACSIM_ROOT,
    env.OMNI_ISAAC_SIM_ROOT,
  ]
    .map((root) => asString(root).trim())
    .filter(Boolean);
  for (const root of rootCandidates) {
    for (const scriptName of scriptNames) {
      const scriptPath = path.join(root, scriptName);
      if (!existsSyncImpl(scriptPath)) continue;
      candidates.push({
        command: scriptPath,
        args: ['--/app/quitAfter=10', '--no-window'],
        source: 'Isaac Sim workstation script',
        required: true,
      });
    }
  }

  candidates.push({
    command: 'isaacsim',
    args: [ISAAC_SIM_COMPATIBILITY_CHECK_EXPERIENCE, '--/app/quitAfter=10', '--no-window'],
    source: 'Isaac Sim Python package',
    required: false,
  });

  for (const scriptName of scriptNames) {
    candidates.push({
      command: scriptName,
      args: ['--/app/quitAfter=10', '--no-window'],
      source: 'Isaac Sim compatibility script',
      required: false,
    });
  }

  return candidates;
}

export function detectOfficialIsaacSimCompatibilityChecker({
  env = process.env,
  platform = process.platform,
  spawnSyncImpl = spawnSync,
  existsSyncImpl = existsSync,
} = {}) {
  if (env.URDF_STUDIO_SKIP_ISAACSIM_COMPATIBILITY_CHECKER === '1') {
    return null;
  }

  for (const candidate of officialIsaacSimCheckerCandidates({ env, platform, existsSyncImpl })) {
    const isWindowsBatch = platform === 'win32' && /\.bat$/i.test(candidate.command);
    const command = isWindowsBatch ? 'cmd.exe' : candidate.command;
    const args = isWindowsBatch
      ? ['/c', candidate.command, ...candidate.args]
      : candidate.args;
    const result = runCommand(command, args, {
      spawnSyncImpl,
      env,
      timeout: 90_000,
    });
    if (!candidate.required && commandUnavailable(result)) continue;
    return {
      available: true,
      ok: officialIsaacSimCheckerPassed(result),
      source: candidate.source,
      command: [candidate.command, ...candidate.args].join(' '),
      status: result.status,
      summary: summarizeCommandOutput(result),
    };
  }

  return null;
}
