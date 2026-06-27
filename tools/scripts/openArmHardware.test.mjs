import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOpenArmBrowserTeleopChecklist,
  buildSingleMiniSnapshotScript,
  buildOpenArmInstallCommand,
  buildOpenArmTeleoperateCommand,
  formatCommand,
  readOpenArmHardwareConfig,
} from './openArmHardware.js';
import {
  OPENARM_HARDWARE_DEFAULT_FPS,
  OPENARM_HARDWARE_DEFAULT_MAX_RELATIVE_TARGET_DEG,
  OPENARM_HARDWARE_DEFAULT_ROBOT_ID,
  OPENARM_HARDWARE_DEFAULT_TELEOP_ID,
  OPENARM_HARDWARE_ENV,
  OPENARM_HARDWARE_PIP_INSTALL_FLAGS,
} from './openArmHardwareParams.js';
import {
  LEROBOT_OPENARM_HARDWARE_PIP_DEPENDENCY,
  LEROBOT_UPSTREAM_REF,
} from './setupParams/lerobotSource.js';
import {
  buildOpenArmHardwareDoctorScript,
  buildOpenArmHardwareVerifyImportScript,
} from './openArmHardwareRuntime.js';

const TEST_ENV = {
  [OPENARM_HARDWARE_ENV.leftFollowerPort]: 'left-can-peer',
  [OPENARM_HARDWARE_ENV.rightFollowerPort]: 'right-can-peer',
  [OPENARM_HARDWARE_ENV.miniRightPort]: '/dev/tty.usbmodem-right',
  [OPENARM_HARDWARE_ENV.miniLeftPort]: '/dev/tty.usbmodem-left',
};

test('readOpenArmHardwareConfig requires all hardware ports', () => {
  const config = readOpenArmHardwareConfig({});

  assert.deepEqual(config.missingEnv, [
    OPENARM_HARDWARE_ENV.leftFollowerPort,
    OPENARM_HARDWARE_ENV.rightFollowerPort,
    OPENARM_HARDWARE_ENV.miniRightPort,
    OPENARM_HARDWARE_ENV.miniLeftPort,
  ]);
});

test('readOpenArmHardwareConfig applies safe defaults without storing hardware ids', () => {
  const config = readOpenArmHardwareConfig(TEST_ENV);

  assert.equal(config.missingEnv.length, 0);
  assert.equal(config.robotId, OPENARM_HARDWARE_DEFAULT_ROBOT_ID);
  assert.equal(config.teleopId, OPENARM_HARDWARE_DEFAULT_TELEOP_ID);
  assert.equal(config.fps, OPENARM_HARDWARE_DEFAULT_FPS);
  assert.equal(config.maxRelativeTargetDeg, OPENARM_HARDWARE_DEFAULT_MAX_RELATIVE_TARGET_DEG);
});

test('buildOpenArmTeleoperateCommand emits bimanual follower plus OpenArm Mini args', () => {
  const command = buildOpenArmTeleoperateCommand(readOpenArmHardwareConfig(TEST_ENV));

  assert.deepEqual(command.slice(1, 4), [
    '-m',
    'lerobot.scripts.lerobot_teleoperate',
    '--robot.type=bi_openarm_follower',
  ]);
  assert.ok(command.includes('--teleop.type=bi_openarm_mini'));
  assert.ok(command.includes('--robot.left_arm_config.side=left'));
  assert.ok(command.includes('--robot.right_arm_config.side=right'));
  assert.ok(command.includes('--robot.left_arm_config.max_relative_target=5.0'));
  assert.ok(command.includes('--robot.right_arm_config.max_relative_target=5.0'));
  assert.ok(command.includes('--teleop.right_arm_config.port=/dev/tty.usbmodem-right'));
  assert.ok(command.includes('--teleop.left_arm_config.port=/dev/tty.usbmodem-left'));
  assert.ok(command.every((arg) => !arg.includes('port_right') && !arg.includes('port_left')));
});

test('buildOpenArmInstallCommand installs LeRobot OpenArm Mini and XoQ CAN dependencies', () => {
  const command = buildOpenArmInstallCommand('python3');

  assert.deepEqual(command, [
    'python3',
    '-m',
    'pip',
    'install',
    ...OPENARM_HARDWARE_PIP_INSTALL_FLAGS,
    LEROBOT_OPENARM_HARDWARE_PIP_DEPENDENCY,
    'xoq-can',
    'rerun-sdk',
  ]);
});

test('buildOpenArmBrowserTeleopChecklist gives non-coder browser follower steps', () => {
  const checklist = buildOpenArmBrowserTeleopChecklist().join('\n');

  assert.match(checklist, /URDF_ROBOT_GATEWAY_RUNTIME_MODE=control/);
  assert.match(checklist, /URDF_ROBOT_GATEWAY_ADAPTER=openarm_native/);
  assert.match(checklist, /URDF_ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_FILE/);
  assert.match(checklist, /npm run setup/);
  assert.match(checklist, /npm run openarm:doctor/);
  assert.match(checklist, /npm run start/);
  assert.match(checklist, /Motion safety ready/);
  assert.match(checklist, /IK handles are green/);
});

test('buildSingleMiniSnapshotScript reads one Mini leader and mirrors raw positions virtually', () => {
  const script = buildSingleMiniSnapshotScript('/dev/ttyACM-test');

  assert.match(script, /FeetechMotorsBus/);
  assert.match(script, /Present_Position/);
  assert.match(script, /handshake=True/);
  assert.match(script, /virtualRightRawPositions/);
  assert.match(script, /virtualLeftRawPositions/);
  assert.match(script, /\/dev\/ttyACM-test/);
});

test('buildOpenArmHardwareVerifyImportScript imports every hardware module', () => {
  const script = buildOpenArmHardwareVerifyImportScript([
    ['lerobot.robots.bi_openarm_follower', 'bimanual follower'],
    ['scservo_sdk', 'Feetech transport'],
  ]);

  assert.match(script, /importlib\.import_module\(module_name\)/);
  assert.match(script, /direct_url\.json/);
  assert.match(script, new RegExp(LEROBOT_UPSTREAM_REF));
  assert.match(script, /use_velocity_and_torque/);
  assert.match(script, /"lerobot\.robots\.bi_openarm_follower"/);
  assert.match(script, /"scservo_sdk"/);
  assert.doesNotMatch(script, /bimanual follower/);
});

test('buildOpenArmHardwareDoctorScript reports real import failures', () => {
  const script = buildOpenArmHardwareDoctorScript([
    ['lerobot.robots.bi_openarm_follower', 'bimanual follower'],
    ['scservo_sdk', 'Feetech transport'],
  ]);

  assert.match(script, /importlib\.import_module\(module_name\)/);
  assert.match(script, /"bimanual follower"/);
  assert.match(script, /"Feetech transport"/);
  assert.doesNotMatch(script, /find_spec/);
});

test('formatCommand quotes arguments that are unsafe for shell copy-paste', () => {
  const command = formatCommand(['python3', '-m', 'pkg', '--example=left peer']);

  assert.equal(command, "python3 -m pkg '--example=left peer'");
});
