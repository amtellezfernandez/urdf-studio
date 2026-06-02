export const OPENARM_HARDWARE_DEFAULT_PYTHON = '.venv-lerobot/bin/python3';
export const OPENARM_HARDWARE_DEFAULT_FPS = '60';
export const OPENARM_HARDWARE_DEFAULT_MAX_RELATIVE_TARGET_DEG = '5.0';
export const OPENARM_HARDWARE_LEFT_SIDE = 'left';
export const OPENARM_HARDWARE_RIGHT_SIDE = 'right';
export const OPENARM_HARDWARE_ROBOT_TYPE = 'bi_openarm_follower';
export const OPENARM_HARDWARE_TELEOP_TYPE = 'openarm_mini';
export const OPENARM_HARDWARE_DEFAULT_ROBOT_ID = 'my_follower';
export const OPENARM_HARDWARE_DEFAULT_TELEOP_ID = 'my_leader';
export const OPENARM_HARDWARE_RUN_ACK_ENV = 'OPENARM_ALLOW_HARDWARE_RUN';
export const OPENARM_HARDWARE_RUN_ACK_VALUE = 'I_UNDERSTAND_THIS_MOVES_HARDWARE';

export const OPENARM_HARDWARE_ENV = {
  python: 'OPENARM_LEROBOT_PYTHON',
  leftFollowerPort: 'OPENARM_LEFT_FOLLOWER_PORT',
  rightFollowerPort: 'OPENARM_RIGHT_FOLLOWER_PORT',
  miniRightPort: 'OPENARM_MINI_RIGHT_PORT',
  miniLeftPort: 'OPENARM_MINI_LEFT_PORT',
  singleMiniPort: 'OPENARM_SINGLE_MINI_PORT',
  robotId: 'OPENARM_ROBOT_ID',
  teleopId: 'OPENARM_TELEOP_ID',
  fps: 'OPENARM_TELEOP_FPS',
  maxRelativeTargetDeg: 'OPENARM_MAX_RELATIVE_TARGET_DEG',
};

export const OPENARM_BROWSER_TELEOP_ENV = {
  runtimeMode: 'URDF_ROBOT_GATEWAY_RUNTIME_MODE',
  adapter: 'URDF_ROBOT_GATEWAY_ADAPTER',
  robotId: 'URDF_ROBOT_GATEWAY_ROBOT_ID',
  canInterface: 'URDF_ROBOT_GATEWAY_OPENARM_CAN_INTERFACE',
  leftPort: 'URDF_ROBOT_GATEWAY_OPENARM_LEFT_PORT',
  rightPort: 'URDF_ROBOT_GATEWAY_OPENARM_RIGHT_PORT',
  rotationCalibrationFile: 'URDF_ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_FILE',
  unsafeSelfCollisionBypass: 'URDF_ROBOT_GATEWAY_OPENARM_ALLOW_UNVALIDATED_SELF_COLLISION',
};

export const OPENARM_HARDWARE_REQUIRED_ENV = [
  OPENARM_HARDWARE_ENV.leftFollowerPort,
  OPENARM_HARDWARE_ENV.rightFollowerPort,
  OPENARM_HARDWARE_ENV.miniRightPort,
  OPENARM_HARDWARE_ENV.miniLeftPort,
];

export const OPENARM_HARDWARE_PIP_DEPENDENCIES = [
  'lerobot[feetech,damiao]',
  'xoq-can',
  'rerun-sdk',
];

export const OPENARM_HARDWARE_DOCTOR_IMPORTS = [
  ['lerobot', 'LeRobot core'],
  ['rerun', 'LeRobot teleoperate visualization dependency'],
  ['can', 'Damiao CAN transport'],
  ['scservo_sdk', 'OpenArm Mini Feetech transport'],
  ['lerobot.robots.bi_openarm_follower', 'bimanual OpenArm follower'],
  ['lerobot.teleoperators.openarm_mini', 'OpenArm Mini teleoperator'],
];

export const OPENARM_SINGLE_MINI_MOTORS = [
  ['joint_1', 1, 'sts3215', 'degrees'],
  ['joint_2', 2, 'sts3215', 'degrees'],
  ['joint_3', 3, 'sts3215', 'degrees'],
  ['joint_4', 4, 'sts3215', 'degrees'],
  ['joint_5', 5, 'sts3215', 'degrees'],
  ['joint_6', 6, 'sts3215', 'degrees'],
  ['joint_7', 7, 'sts3215', 'degrees'],
  ['gripper', 8, 'sts3215', 'range_0_100'],
];
