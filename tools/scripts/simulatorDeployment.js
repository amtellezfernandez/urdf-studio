export const DEPLOYMENT_MODES = Object.freeze({
  python: 'python',
  native: 'native',
  container: 'container',
  external: 'external',
  planned: 'planned',
});

export const DEPLOYMENT_GPU = Object.freeze({
  none: 'none',
  cpu: 'cpu',
  cuda: 'cuda',
  nvidia: 'nvidia',
  metal: 'metal',
  amdgpu: 'amdgpu',
  vulkan: 'vulkan',
  opengl: 'opengl',
  auto: 'auto',
});

export const DEPLOYMENT_DISPLAY = Object.freeze({
  none: 'none',
  x11: 'x11',
  wayland: 'wayland',
  desktop: 'desktop',
  egl: 'egl',
  osmesa: 'osmesa',
  vulkan: 'vulkan',
  novnc: 'novnc',
  webrtc: 'webrtc',
  external: 'external',
});

export const CONTAINER_KINDS = Object.freeze({
  managed: 'managed',
  official: 'official',
  external: 'external',
});

export function nvidiaDriverCapabilities({
  graphics = false,
  compute = true,
  display = false,
  video = false,
} = {}) {
  return [
    graphics ? 'graphics' : null,
    'utility',
    compute ? 'compute' : null,
    display ? 'display' : null,
    video ? 'video' : null,
  ].filter(Boolean).join(',');
}

export function buildDeploymentSpec({
  mode,
  accelerator,
  profile,
  env = {},
  notes = [],
  gpu = DEPLOYMENT_GPU.none,
  display = DEPLOYMENT_DISPLAY.none,
  image = null,
  container = null,
} = {}) {
  return {
    mode,
    accelerator,
    profile,
    gpu,
    display,
    env,
    notes,
    ...(image ? { image } : {}),
    ...(container ? { container } : {}),
  };
}

export function buildPythonDeployment(options = {}) {
  return buildDeploymentSpec({
    mode: DEPLOYMENT_MODES.python,
    ...options,
  });
}

export function buildNativeDeployment(options = {}) {
  return buildDeploymentSpec({
    mode: DEPLOYMENT_MODES.native,
    ...options,
  });
}

export function buildExternalDeployment(options = {}) {
  return buildDeploymentSpec({
    mode: DEPLOYMENT_MODES.external,
    ...options,
  });
}

export function buildContainerDeployment({
  image,
  containerKind = CONTAINER_KINDS.managed,
  runtime = 'docker',
  gpu = DEPLOYMENT_GPU.none,
  display = DEPLOYMENT_DISPLAY.none,
  network = null,
  ports = [],
  volumes = [],
  build = null,
  ...options
} = {}) {
  return buildDeploymentSpec({
    mode: DEPLOYMENT_MODES.container,
    image,
    gpu,
    display,
    container: {
      kind: containerKind,
      runtime,
      image,
      gpu,
      display,
      ...(network ? { network } : {}),
      ports,
      volumes,
      ...(build ? { build } : {}),
    },
    ...options,
  });
}

export function buildPlannedDeployment({
  accelerator = 'cpu',
  profile = 'planned',
  env = {},
  notes = [],
  gpu = null,
  display = DEPLOYMENT_DISPLAY.none,
} = {}) {
  return buildDeploymentSpec({
    mode: DEPLOYMENT_MODES.planned,
    accelerator,
    profile,
    gpu: gpu || (accelerator.includes('cuda')
      ? DEPLOYMENT_GPU.cuda
      : accelerator.includes('vulkan')
        ? DEPLOYMENT_GPU.vulkan
        : DEPLOYMENT_GPU.cpu),
    display,
    env,
    notes,
  });
}

export function summarizeDeployment(deployment = {}) {
  return `${deployment.mode || 'unknown'}/${deployment.accelerator || 'unknown'}`;
}

function assertContainerDeployment(deployment) {
  if (!deployment || deployment.mode !== DEPLOYMENT_MODES.container) {
    throw new TypeError('Docker launch planning requires a container deployment.');
  }
  const image = deployment.container?.image || deployment.image;
  if (!image) {
    throw new TypeError('Container deployment is missing an image.');
  }
  return image;
}

function deploymentNeedsNvidiaGpu(deployment) {
  const env = deployment.env || {};
  const gpu = deployment.container?.gpu || deployment.gpu;
  const accelerator = String(deployment.accelerator || '').toLowerCase();
  return (
    gpu === DEPLOYMENT_GPU.cuda ||
    gpu === DEPLOYMENT_GPU.nvidia ||
    accelerator.includes('cuda') ||
    accelerator.includes('rtx') ||
    Boolean(env.NVIDIA_DRIVER_CAPABILITIES)
  );
}

function normalizeDockerEnv(env = {}) {
  return Object.entries(env)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => [key, String(value)])
    .sort(([left], [right]) => left.localeCompare(right));
}

function appendDockerEnv(args, env = {}) {
  for (const [key, value] of normalizeDockerEnv(env)) {
    args.push('--env', `${key}=${value}`);
  }
}

function normalizeDockerCommand(command) {
  if (command === null || command === undefined) return [];
  return Array.isArray(command) ? command.map(String) : [String(command)];
}

function normalizeDockerMount(mount) {
  if (!mount) return null;
  if (typeof mount === 'string') {
    const [source, target, mode = 'rw'] = mount.split(':');
    if (!source || !target) {
      throw new TypeError(`Docker mount string must include source and target: ${mount}`);
    }
    return { type: source.startsWith('/') ? 'bind' : 'volume', source, target, mode };
  }
  const source = mount.source || mount.name;
  const target = mount.target || mount.destination;
  if (!source || !target) {
    throw new TypeError('Docker mount must include source and target.');
  }
  return {
    type: mount.type || (String(source).startsWith('/') ? 'bind' : 'volume'),
    source: String(source),
    target: String(target),
    mode: mount.readonly || mount.mode === 'ro' ? 'ro' : 'rw',
  };
}

function formatDockerMount(mount) {
  const normalized = normalizeDockerMount(mount);
  if (!normalized) return null;
  const parts = [
    `type=${normalized.type}`,
    `source=${normalized.source}`,
    `target=${normalized.target}`,
  ];
  if (normalized.mode === 'ro') {
    parts.push('readonly');
  }
  return parts.join(',');
}

function normalizeDockerPort(port) {
  if (!port) return null;
  if (typeof port === 'number') {
    return { host: port, container: port, protocol: 'tcp' };
  }
  if (typeof port === 'string') {
    const [portPair, protocol = 'tcp'] = port.split('/');
    const [hostPort, containerPort = hostPort] = portPair.split(':');
    return { host: hostPort, container: containerPort, protocol };
  }
  return {
    host: port.host || port.hostPort || port.container || port.containerPort,
    container: port.container || port.containerPort || port.host || port.hostPort,
    protocol: port.protocol || 'tcp',
  };
}

function formatDockerPort(port) {
  const normalized = normalizeDockerPort(port);
  if (!normalized?.host || !normalized?.container) return null;
  return `${normalized.host}:${normalized.container}/${normalized.protocol}`;
}

function collectDockerDisplayResources({
  deployment,
  hostEnv = {},
  platform = process.platform,
  x11Socket = '/tmp/.X11-unix',
  enableDesktopDisplay = true,
} = {}) {
  if (!enableDesktopDisplay) {
    return { env: {}, mounts: [] };
  }
  const display = deployment.container?.display || deployment.display;
  if (![DEPLOYMENT_DISPLAY.desktop, DEPLOYMENT_DISPLAY.x11, DEPLOYMENT_DISPLAY.wayland].includes(display)) {
    return { env: {}, mounts: [] };
  }
  if (hostEnv.WAYLAND_DISPLAY && hostEnv.XDG_RUNTIME_DIR && display === DEPLOYMENT_DISPLAY.wayland) {
    const waylandSocket = `${hostEnv.XDG_RUNTIME_DIR}/${hostEnv.WAYLAND_DISPLAY}`;
    return {
      env: {
        WAYLAND_DISPLAY: hostEnv.WAYLAND_DISPLAY,
        XDG_RUNTIME_DIR: hostEnv.XDG_RUNTIME_DIR,
      },
      mounts: [{ type: 'bind', source: waylandSocket, target: waylandSocket, mode: 'rw' }],
    };
  }
  if (hostEnv.DISPLAY && platform === 'linux') {
    return {
      env: {
        DISPLAY: hostEnv.DISPLAY,
        QT_X11_NO_MITSHM: '1',
      },
      mounts: [{ type: 'bind', source: x11Socket, target: x11Socket, mode: 'rw' }],
    };
  }
  return { env: {}, mounts: [] };
}

function collectDockerGpuArgs(deployment, { gpus = null } = {}) {
  if (gpus) return ['--gpus', String(gpus)];
  if (deploymentNeedsNvidiaGpu(deployment)) return ['--gpus', 'all'];
  return [];
}

function collectDockerDeviceArgs(deployment, { includeDriDevice = true } = {}) {
  const gpu = deployment.container?.gpu || deployment.gpu;
  const display = deployment.container?.display || deployment.display;
  if (includeDriDevice && (gpu === DEPLOYMENT_GPU.vulkan || display === DEPLOYMENT_DISPLAY.vulkan)) {
    return ['--device', '/dev/dri'];
  }
  return [];
}

export function buildDockerRunPlan(
  deployment,
  {
    name = null,
    detach = false,
    interactive = false,
    remove = true,
    workspaceDir = null,
    workspaceTarget = '/workspace',
    projectRoot = null,
    projectTarget = '/workspace/urdf-studio',
    env = {},
    mounts = [],
    network = null,
    ports = null,
    gpus = null,
    entrypoint = null,
    command = [],
    extraArgs = [],
    hostEnv = process.env,
    platform = process.platform,
    enableDesktopDisplay = true,
    includeDriDevice = true,
  } = {}
) {
  const image = assertContainerDeployment(deployment);
  const container = deployment.container || {};
  const args = ['run'];
  if (remove) args.push('--rm');
  if (detach) args.push('--detach');
  if (interactive) args.push('--interactive', '--tty');
  if (name) args.push('--name', String(name));
  args.push(...collectDockerGpuArgs(deployment, { gpus }));
  args.push(...collectDockerDeviceArgs(deployment, { includeDriDevice }));

  const displayResources = collectDockerDisplayResources({
    deployment,
    hostEnv,
    platform,
    enableDesktopDisplay,
  });
  appendDockerEnv(args, {
    ...(deployment.env || {}),
    ...displayResources.env,
    ...env,
  });

  const networkMode = network || container.network || null;
  if (networkMode) {
    args.push('--network', String(networkMode));
  }
  if (networkMode !== 'host') {
    const publishedPorts = ports || container.ports || [];
    for (const port of publishedPorts.map(formatDockerPort).filter(Boolean)) {
      args.push('--publish', port);
    }
  }

  const normalizedMounts = [
    ...(container.volumes || []),
    ...(workspaceDir ? [{ type: 'bind', source: workspaceDir, target: workspaceTarget, mode: 'rw' }] : []),
    ...(projectRoot ? [{ type: 'bind', source: projectRoot, target: projectTarget, mode: 'ro' }] : []),
    ...displayResources.mounts,
    ...mounts,
  ];
  for (const mount of normalizedMounts.map(formatDockerMount).filter(Boolean)) {
    args.push('--mount', mount);
  }

  if (entrypoint) {
    args.push('--entrypoint', String(entrypoint));
  }
  args.push(...extraArgs.map(String), image, ...normalizeDockerCommand(command));
  return {
    command: 'docker',
    args,
    image,
    env: Object.fromEntries(normalizeDockerEnv({ ...(deployment.env || {}), ...displayResources.env, ...env })),
    network: networkMode,
  };
}

export function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

export function formatDockerRunCommand(plan) {
  const command = typeof plan?.command === 'string' ? plan.command : 'docker';
  const args = Array.isArray(plan) ? plan : plan?.args || [];
  return [command, ...args].map(shellQuote).join(' ');
}

function normalizeDockerBuildArgs(buildArgs = {}) {
  return Object.entries(buildArgs)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)])
    .sort(([left], [right]) => left.localeCompare(right));
}

export function buildDockerBuildPlan(
  deployment,
  {
    tag = null,
    pull = true,
    noCache = false,
    platform = null,
    buildArgs = {},
    progress = null,
  } = {}
) {
  const image = assertContainerDeployment(deployment);
  const build = deployment.container?.build;
  if (!build) {
    throw new TypeError('Container deployment does not include a managed build recipe.');
  }
  const context = build.context || '.';
  const dockerfile = build.dockerfile;
  if (!dockerfile) {
    throw new TypeError('Container build recipe is missing a Dockerfile.');
  }
  const args = ['build'];
  if (pull) args.push('--pull');
  if (noCache) args.push('--no-cache');
  if (platform) args.push('--platform', String(platform));
  if (progress) args.push('--progress', String(progress));
  args.push('--tag', String(tag || image), '--file', String(dockerfile));
  for (const [key, value] of normalizeDockerBuildArgs({ ...(build.args || {}), ...buildArgs })) {
    args.push('--build-arg', `${key}=${value}`);
  }
  args.push(String(context));
  return {
    command: 'docker',
    args,
    image: String(tag || image),
    dockerfile: String(dockerfile),
    context: String(context),
  };
}
