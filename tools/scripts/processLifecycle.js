import { readFileSync, readdirSync, readlinkSync } from 'fs';
import { resolve } from 'path';

export function shouldUseManagedProcessGroup(platform = process.platform) {
  return platform !== 'win32';
}

export function buildManagedSpawnOptions(options = {}, { platform = process.platform } = {}) {
  if (!shouldUseManagedProcessGroup(platform)) {
    return { ...options };
  }

  return {
    ...options,
    detached: true,
  };
}

export function terminateManagedProcess(
  childProcess,
  signal = 'SIGTERM',
  { platform = process.platform, killProcess = process.kill } = {}
) {
  if (!childProcess) {
    return false;
  }

  if (shouldUseManagedProcessGroup(platform) && typeof childProcess.pid === 'number') {
    try {
      killProcess(-childProcess.pid, signal);
      return true;
    } catch (error) {
      if (error?.code === 'ESRCH') {
        return false;
      }
    }
  }

  if (typeof childProcess.kill !== 'function') {
    return false;
  }

  return childProcess.kill(signal) !== false;
}

function readNullSeparatedFile(path) {
  try {
    return readFileSync(path, 'utf8').split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

function readProcessCwd(pid, procDir = '/proc') {
  try {
    return readlinkSync(`${procDir}/${pid}/cwd`);
  } catch {
    return '';
  }
}

function readProcessGroupId(pid, procDir = '/proc') {
  try {
    const stat = readFileSync(`${procDir}/${pid}/stat`, 'utf8');
    const commandEnd = stat.lastIndexOf(')');
    if (commandEnd < 0) return null;
    const fields = stat.slice(commandEnd + 2).trim().split(/\s+/);
    const processGroupId = Number(fields[2]);
    return Number.isInteger(processGroupId) && processGroupId > 0 ? processGroupId : null;
  } catch {
    return null;
  }
}

function listProcessIds(procDir = '/proc') {
  try {
    return readdirSync(procDir)
      .map((entry) => Number(entry))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

function isSameOrNestedPath(candidatePath, rootDir) {
  if (!candidatePath) return false;
  const normalizedCandidate = resolve(candidatePath);
  const normalizedRoot = resolve(rootDir);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

function isUrdfStudioDevCommand(argv) {
  const joined = argv.join(' ');
  return (
    joined.includes('tools/scripts/run.js') ||
    joined.includes('config/vite.config.ts') ||
    (joined.includes('uvicorn') && joined.includes('backend.server:app')) ||
    (joined.includes('cargo') && joined.includes('ikd/Cargo.toml'))
  );
}

export function findStaleUrdfStudioProcessGroups({
  currentPid = process.pid,
  platform = process.platform,
  procDir = '/proc',
  rootDir,
} = {}) {
  if (!rootDir || platform === 'win32') {
    return [];
  }

  const currentProcessGroupId = readProcessGroupId(currentPid, procDir);
  const processGroups = new Map();
  for (const pid of listProcessIds(procDir)) {
    if (pid === currentPid) continue;

    const argv = readNullSeparatedFile(`${procDir}/${pid}/cmdline`);
    if (argv.length === 0 || !isUrdfStudioDevCommand(argv)) continue;
    if (!isSameOrNestedPath(readProcessCwd(pid, procDir), rootDir)) continue;

    const processGroupId = readProcessGroupId(pid, procDir);
    if (!processGroupId || processGroupId === currentProcessGroupId) continue;
    if (!processGroups.has(processGroupId)) {
      processGroups.set(processGroupId, []);
    }
    processGroups.get(processGroupId).push({ pid, command: argv.join(' ') });
  }

  return Array.from(processGroups.entries()).map(([processGroupId, processes]) => ({
    processGroupId,
    processes,
  }));
}

export function terminateStaleUrdfStudioProcessGroups({
  currentPid = process.pid,
  killProcess = process.kill,
  platform = process.platform,
  procDir = '/proc',
  rootDir,
  signal = 'SIGTERM',
} = {}) {
  const groups = findStaleUrdfStudioProcessGroups({ currentPid, platform, procDir, rootDir });
  const terminated = [];
  for (const group of groups) {
    try {
      killProcess(-group.processGroupId, signal);
      terminated.push(group);
    } catch (error) {
      if (error?.code !== 'ESRCH') {
        throw error;
      }
    }
  }
  return terminated;
}
