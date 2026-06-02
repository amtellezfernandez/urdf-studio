export type OperatorCommandKind =
  | "twist"
  | "stop"
  | "estop"
  | "joint_jog"
  | "openarm_calibration_jog";

export type OperatorTwistCommand = {
  x: number;
  y: number;
  omega: number;
};

export type OperatorJointJogCommand = {
  joint_name: string;
  current_position_rad?: number;
  delta_rad: number;
};

export type OperatorOpenArmCalibrationJogCommand = {
  joint_name: string;
  delta_rad: number;
};

export type OperatorCommandMetadata = {
  command_kind: OperatorCommandKind;
  sequence: number;
  source_ts_ms: number;
};

export type OperatorTwistCommandPayload = OperatorTwistCommand &
  OperatorCommandMetadata & {
    ack_requested: true;
  };

export type OperatorJointJogCommandPayload = OperatorJointJogCommand &
  OperatorCommandMetadata & {
    command_kind: "joint_jog";
    operator_id?: string;
    ack_requested: true;
  };

export type OperatorOpenArmCalibrationJogCommandPayload =
  OperatorOpenArmCalibrationJogCommand &
    OperatorCommandMetadata & {
      command_kind: "openarm_calibration_jog";
      operator_id?: string;
      ack_requested: true;
    };
