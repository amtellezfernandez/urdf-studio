#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPrivateEnvFiles } from '../../config/privateEnv.js';
import {
  OPENARM_BROWSER_TELEOP_ENV,
  OPENARM_HARDWARE_DEFAULT_FPS,
  OPENARM_HARDWARE_DEFAULT_MAX_RELATIVE_TARGET_DEG,
  OPENARM_HARDWARE_DEFAULT_PYTHON,
  OPENARM_HARDWARE_DEFAULT_ROBOT_ID,
  OPENARM_HARDWARE_DEFAULT_TELEOP_ID,
  OPENARM_HARDWARE_ENV,
  OPENARM_HARDWARE_LEFT_SIDE,
  OPENARM_HARDWARE_PIP_DEPENDENCIES,
  OPENARM_HARDWARE_PIP_INSTALL_FLAGS,
  OPENARM_HARDWARE_REQUIRED_ENV,
  OPENARM_HARDWARE_RIGHT_SIDE,
  OPENARM_HARDWARE_ROBOT_TYPE,
  OPENARM_HARDWARE_RUN_ACK_ENV,
  OPENARM_HARDWARE_RUN_ACK_VALUE,
  OPENARM_HARDWARE_TELEOP_TYPE,
  OPENARM_SINGLE_MINI_MOTORS,
} from './openArmHardwareParams.js';
import { buildOpenArmHardwareDoctorScript } from './openArmHardwareRuntime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..', '..');

loadPrivateEnvFiles({ rootDir });

const USAGE = `Usage:
  npm run openarm:doctor
  npm run openarm:install
  npm run openarm:print-command
  npm run openarm:single-mini-snapshot
  npm run openarm:teleoperate

Required environment:
  ${OPENARM_HARDWARE_REQUIRED_ENV.join('\n  ')}

Optional environment:
  ${OPENARM_HARDWARE_ENV.python}=${OPENARM_HARDWARE_DEFAULT_PYTHON}
  ${OPENARM_HARDWARE_ENV.robotId}=${OPENARM_HARDWARE_DEFAULT_ROBOT_ID}
  ${OPENARM_HARDWARE_ENV.teleopId}=${OPENARM_HARDWARE_DEFAULT_TELEOP_ID}
  ${OPENARM_HARDWARE_ENV.fps}=${OPENARM_HARDWARE_DEFAULT_FPS}
  ${OPENARM_HARDWARE_ENV.maxRelativeTargetDeg}=${OPENARM_HARDWARE_DEFAULT_MAX_RELATIVE_TARGET_DEG}
  ${OPENARM_HARDWARE_ENV.singleMiniPort}=/dev/serial/by-id/<one-openarm-mini-leader>

Hardware run guard:
  ${OPENARM_HARDWARE_RUN_ACK_ENV}=${OPENARM_HARDWARE_RUN_ACK_VALUE}`;

export const readOpenArmHardwareConfig = (env = process.env) => {
  const missingEnv = OPENARM_HARDWARE_REQUIRED_ENV.filter((name) => !env[name]?.trim());
  return {
    python: env[OPENARM_HARDWARE_ENV.python]?.trim() || OPENARM_HARDWARE_DEFAULT_PYTHON,
    leftFollowerPort: env[OPENARM_HARDWARE_ENV.leftFollowerPort]?.trim() || '',
    rightFollowerPort: env[OPENARM_HARDWARE_ENV.rightFollowerPort]?.trim() || '',
    miniRightPort: env[OPENARM_HARDWARE_ENV.miniRightPort]?.trim() || '',
    miniLeftPort: env[OPENARM_HARDWARE_ENV.miniLeftPort]?.trim() || '',
    singleMiniPort: env[OPENARM_HARDWARE_ENV.singleMiniPort]?.trim() || '',
    robotId: env[OPENARM_HARDWARE_ENV.robotId]?.trim() || OPENARM_HARDWARE_DEFAULT_ROBOT_ID,
    teleopId: env[OPENARM_HARDWARE_ENV.teleopId]?.trim() || OPENARM_HARDWARE_DEFAULT_TELEOP_ID,
    fps: env[OPENARM_HARDWARE_ENV.fps]?.trim() || OPENARM_HARDWARE_DEFAULT_FPS,
    maxRelativeTargetDeg:
      env[OPENARM_HARDWARE_ENV.maxRelativeTargetDeg]?.trim() ||
      OPENARM_HARDWARE_DEFAULT_MAX_RELATIVE_TARGET_DEG,
    missingEnv,
  };
};

export const buildOpenArmInstallCommand = (python = OPENARM_HARDWARE_DEFAULT_PYTHON) => [
  python,
  '-m',
  'pip',
  'install',
  ...OPENARM_HARDWARE_PIP_INSTALL_FLAGS,
  ...OPENARM_HARDWARE_PIP_DEPENDENCIES,
];

export const buildOpenArmTeleoperateCommand = (config) => [
  config.python,
  '-m',
  'lerobot.scripts.lerobot_teleoperate',
  `--robot.type=${OPENARM_HARDWARE_ROBOT_TYPE}`,
  `--robot.left_arm_config.port=${config.leftFollowerPort}`,
  `--robot.left_arm_config.side=${OPENARM_HARDWARE_LEFT_SIDE}`,
  `--robot.left_arm_config.max_relative_target=${config.maxRelativeTargetDeg}`,
  `--robot.right_arm_config.port=${config.rightFollowerPort}`,
  `--robot.right_arm_config.side=${OPENARM_HARDWARE_RIGHT_SIDE}`,
  `--robot.right_arm_config.max_relative_target=${config.maxRelativeTargetDeg}`,
  `--robot.id=${config.robotId}`,
  `--teleop.type=${OPENARM_HARDWARE_TELEOP_TYPE}`,
  `--teleop.id=${config.teleopId}`,
  `--teleop.port_right=${config.miniRightPort}`,
  `--teleop.port_left=${config.miniLeftPort}`,
  `--fps=${config.fps}`,
];

export const buildSingleMiniSnapshotScript = (port) => `
import json
from lerobot.motors import Motor, MotorNormMode
from lerobot.motors.feetech import FeetechMotorsBus

motor_specs = ${JSON.stringify(OPENARM_SINGLE_MINI_MOTORS)}
norm_modes = {
    "degrees": MotorNormMode.DEGREES,
    "range_0_100": MotorNormMode.RANGE_0_100,
}
motors = {
    name: Motor(motor_id, model, norm_modes[norm_mode])
    for name, motor_id, model, norm_mode in motor_specs
}
bus = FeetechMotorsBus(port=${JSON.stringify(port)}, motors=motors)
try:
    bus.connect(handshake=True)
    raw_positions = bus.sync_read("Present_Position", normalize=False)
finally:
    if getattr(bus, "is_connected", False):
        bus.disconnect()

print(json.dumps({
    "port": ${JSON.stringify(port)},
    "source": "single_openarm_mini_leader",
    "mode": "virtual_bimanual_mirror",
    "rawPositions": raw_positions,
    "virtualRightRawPositions": {f"right_{name}.pos": value for name, value in raw_positions.items()},
    "virtualLeftRawPositions": {f"left_{name}.pos": value for name, value in raw_positions.items()},
}, sort_keys=True))
`;

const quoteShellArg = (arg) => {
  if (/^[A-Za-z0-9_./:=,+-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
};

export const formatCommand = (command) => command.map(quoteShellArg).join(' ');

export const buildOpenArmBrowserTeleopChecklist = () => [
  'OpenArm browser follower setup:',
  '1. On the robot/CAN host, create .env.robot.local with shared defaults:',
  `   ${OPENARM_BROWSER_TELEOP_ENV.runtimeMode}=control`,
  '2. Put OpenArm hardware identity in .env.robots/openarm-a.env:',
  `   ${OPENARM_BROWSER_TELEOP_ENV.adapter}=openarm_native`,
  `   ${OPENARM_BROWSER_TELEOP_ENV.robotId}=openarm-a`,
  `   ${OPENARM_BROWSER_TELEOP_ENV.canInterface}=xoq`,
  `   ${OPENARM_BROWSER_TELEOP_ENV.leftPort}=<left-xoq-or-can-channel>`,
  `   ${OPENARM_BROWSER_TELEOP_ENV.rightPort}=<right-xoq-or-can-channel>`,
  `   ${OPENARM_BROWSER_TELEOP_ENV.rotationCalibrationFile}=<openarm-a-rotation-calibration.json>`,
  `   # leave ${OPENARM_BROWSER_TELEOP_ENV.unsafeSelfCollisionBypass} unset for real hardware`,
  '3. Run: npm run setup',
  '4. Run: npm run openarm:doctor',
  '5. Run: npm run start -- --robot openarm-a',
  '6. In the browser, open Teleop -> Follower Hardware -> Connect follower.',
  '7. Move hardware only when the panel says Motion safety ready and IK handles are green.',
];

const runCommand = (command, options = {}) =>
  spawnSync(command[0], command.slice(1), {
    stdio: 'inherit',
    shell: false,
    ...options,
  });

const runDoctor = (python) => {
  if (!existsSync(python)) {
    console.error(`Missing ${python}. Run npm run setup first, or set ${OPENARM_HARDWARE_ENV.python}.`);
    return 1;
  }

  const result = spawnSync(python, ['-c', buildOpenArmHardwareDoctorScript()], {
    encoding: 'utf8',
    shell: false,
  });
  if (result.error && result.status === null) {
    console.error(result.error.message);
    return 1;
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    return result.status ?? 1;
  }

  const checks = JSON.parse(result.stdout);
  const missing = checks.filter((check) => !check.ok);
  checks.forEach((check) => {
    const suffix = check.error ? ` (${check.error})` : '';
    console.log(`${check.ok ? 'ok' : 'missing'} ${check.module} - ${check.label}${suffix}`);
  });
  if (missing.length > 0) {
    console.log('');
    console.log(`Install missing OpenArm hardware dependencies with: ${formatCommand(buildOpenArmInstallCommand(python))}`);
    return 1;
  }
  console.log('');
  buildOpenArmBrowserTeleopChecklist().forEach((line) => {
    console.log(line);
  });
  return 0;
};

const runSingleMiniSnapshot = (config) => {
  if (!existsSync(config.python)) {
    console.error(`Missing ${config.python}. Run npm run setup first, or set ${OPENARM_HARDWARE_ENV.python}.`);
    return 1;
  }
  if (!config.singleMiniPort) {
    console.error(`Missing ${OPENARM_HARDWARE_ENV.singleMiniPort}. Set it to the one connected OpenArm Mini serial port.`);
    return 1;
  }
  const result = spawnSync(config.python, ['-c', buildSingleMiniSnapshotScript(config.singleMiniPort)], {
    encoding: 'utf8',
    shell: false,
  });
  if (result.error && result.status === null) {
    console.error(result.error.message);
    return 1;
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    return result.status ?? 1;
  }
  process.stdout.write(result.stdout);
  return 0;
};

const printMissingEnv = (missingEnv) => {
  if (missingEnv.length === 0) return;
  console.error(`Missing required OpenArm hardware environment variable(s): ${missingEnv.join(', ')}`);
  console.error('Do not commit XoQ/CAN/serial identifiers. Export them in your shell or a private env file.');
};

const main = () => {
  const args = new Set(process.argv.slice(2));
  if (args.has('--help') || args.has('-h') || args.size === 0) {
    console.log(USAGE);
    process.exit(args.size === 0 ? 1 : 0);
  }

  const config = readOpenArmHardwareConfig();

  if (args.has('--install')) {
    const installResult = runCommand(buildOpenArmInstallCommand(config.python));
    process.exit(installResult.status ?? 1);
  }

  if (args.has('--doctor')) {
    process.exit(runDoctor(config.python));
  }

  if (args.has('--print-command')) {
    printMissingEnv(config.missingEnv);
    if (config.missingEnv.length > 0) process.exit(1);
    console.log(formatCommand(buildOpenArmTeleoperateCommand(config)));
    process.exit(0);
  }

  if (args.has('--single-mini-snapshot')) {
    process.exit(runSingleMiniSnapshot(config));
  }

  if (args.has('--run')) {
    printMissingEnv(config.missingEnv);
    if (config.missingEnv.length > 0) process.exit(1);
    if (process.env[OPENARM_HARDWARE_RUN_ACK_ENV] !== OPENARM_HARDWARE_RUN_ACK_VALUE) {
      console.error(
        `Refusing to move hardware without ${OPENARM_HARDWARE_RUN_ACK_ENV}=${OPENARM_HARDWARE_RUN_ACK_VALUE}.`
      );
      process.exit(1);
    }
    const teleopResult = runCommand(buildOpenArmTeleoperateCommand(config));
    process.exit(teleopResult.status ?? 1);
  }

  console.error(USAGE);
  process.exit(1);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
