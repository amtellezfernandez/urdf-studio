import {
  OPENARM_HF_LIVE_CAN_BYTE_SHIFT,
  OPENARM_HF_LIVE_CAN_DATA_LENGTH_OFFSET,
  OPENARM_HF_LIVE_CAN_EXTENDED_ID_FLAG,
  OPENARM_HF_LIVE_CAN_EXTENDED_ID_MASK,
  OPENARM_HF_LIVE_CAN_FIRST_JOINT_ID_NIBBLE,
  OPENARM_HF_LIVE_CAN_FRAME_BYTES,
  OPENARM_HF_LIVE_CAN_JOINT_ID_NIBBLE_MASK,
  OPENARM_HF_LIVE_CAN_JOINT_SUFFIXES,
  OPENARM_HF_LIVE_CAN_LAST_JOINT_ID_NIBBLE,
  OPENARM_HF_LIVE_CAN_LOW_NIBBLE_MASK,
  OPENARM_HF_LIVE_CAN_MAX_PAYLOAD_BYTES,
  OPENARM_HF_LIVE_CAN_MOTOR_PACKET_BYTES,
  OPENARM_HF_LIVE_CAN_NIBBLE_SHIFT,
  OPENARM_HF_LIVE_CAN_PAYLOAD_OFFSET,
  OPENARM_HF_LIVE_CAN_POSITION_LIMIT_RAD,
  OPENARM_HF_LIVE_CAN_STANDARD_ID_MASK,
  OPENARM_HF_LIVE_CAN_TORQUE_LIMIT_NM,
  OPENARM_HF_LIVE_CAN_UINT12_MAX,
  OPENARM_HF_LIVE_CAN_UINT16_MAX,
  OPENARM_HF_LIVE_CAN_VELOCITY_LIMIT_RAD_PER_SEC,
} from "@/features/teleop/perception/openArmHfLiveParams";

export type OpenArmHfLiveCanStateFrame = {
  canId: number;
  data: Uint8Array;
};

export type OpenArmHfLiveCanMotorState = {
  positionRad: number;
  velocityRadPerSec: number;
  torqueNm: number;
  tempMos: number;
  tempRotor: number;
};

const buildOpenArmHfLiveNaNMotorState = (): OpenArmHfLiveCanMotorState => ({
  positionRad: Number.NaN,
  velocityRadPerSec: Number.NaN,
  torqueNm: Number.NaN,
  tempMos: Number.NaN,
  tempRotor: Number.NaN,
});

export const parseOpenArmHfLiveCanFrames = (data: Uint8Array): OpenArmHfLiveCanStateFrame[] => {
  const frames: OpenArmHfLiveCanStateFrame[] = [];
  for (
    let offset = 0;
    offset + OPENARM_HF_LIVE_CAN_FRAME_BYTES <= data.length;
    offset += OPENARM_HF_LIVE_CAN_FRAME_BYTES
  ) {
    const frame = data.subarray(offset, offset + OPENARM_HF_LIVE_CAN_FRAME_BYTES);
    const rawCanId = new DataView(
      frame.buffer,
      frame.byteOffset,
      OPENARM_HF_LIVE_CAN_FRAME_BYTES
    ).getUint32(0, true);
    const dataLength = Math.min(
      frame[OPENARM_HF_LIVE_CAN_DATA_LENGTH_OFFSET],
      OPENARM_HF_LIVE_CAN_MAX_PAYLOAD_BYTES
    );
    const canId =
      (rawCanId & OPENARM_HF_LIVE_CAN_EXTENDED_ID_FLAG) !== 0
        ? rawCanId & OPENARM_HF_LIVE_CAN_EXTENDED_ID_MASK
        : rawCanId & OPENARM_HF_LIVE_CAN_STANDARD_ID_MASK;
    frames.push({
      canId,
      data: frame.slice(
        OPENARM_HF_LIVE_CAN_PAYLOAD_OFFSET,
        OPENARM_HF_LIVE_CAN_PAYLOAD_OFFSET + dataLength
      ),
    });
  }
  return frames;
};

export const resolveOpenArmHfLiveCanJointName = (
  canId: number,
  jointPrefix: string
): string | null => {
  const jointNumber = canId & OPENARM_HF_LIVE_CAN_JOINT_ID_NIBBLE_MASK;
  if (
    jointNumber < OPENARM_HF_LIVE_CAN_FIRST_JOINT_ID_NIBBLE ||
    jointNumber > OPENARM_HF_LIVE_CAN_LAST_JOINT_ID_NIBBLE
  ) {
    return null;
  }
  const suffix =
    OPENARM_HF_LIVE_CAN_JOINT_SUFFIXES[
      jointNumber - OPENARM_HF_LIVE_CAN_FIRST_JOINT_ID_NIBBLE
    ];
  return suffix ? `${jointPrefix}${suffix}` : null;
};

export const decodeOpenArmHfLiveCanMotorState = (
  data: Uint8Array
): OpenArmHfLiveCanMotorState | null => {
  if (data.length < OPENARM_HF_LIVE_CAN_MOTOR_PACKET_BYTES) return null;
  const positionRaw = (data[1] << OPENARM_HF_LIVE_CAN_BYTE_SHIFT) | data[2];
  const velocityRaw =
    (data[3] << OPENARM_HF_LIVE_CAN_NIBBLE_SHIFT) |
    (data[4] >> OPENARM_HF_LIVE_CAN_NIBBLE_SHIFT);
  const torqueRaw =
    ((data[4] & OPENARM_HF_LIVE_CAN_LOW_NIBBLE_MASK) << OPENARM_HF_LIVE_CAN_BYTE_SHIFT) |
    data[5];
  return {
    positionRad:
      (positionRaw / OPENARM_HF_LIVE_CAN_UINT16_MAX) *
        (OPENARM_HF_LIVE_CAN_POSITION_LIMIT_RAD * 2) -
      OPENARM_HF_LIVE_CAN_POSITION_LIMIT_RAD,
    velocityRadPerSec:
      (velocityRaw / OPENARM_HF_LIVE_CAN_UINT12_MAX) *
        (OPENARM_HF_LIVE_CAN_VELOCITY_LIMIT_RAD_PER_SEC * 2) -
      OPENARM_HF_LIVE_CAN_VELOCITY_LIMIT_RAD_PER_SEC,
    torqueNm:
      (torqueRaw / OPENARM_HF_LIVE_CAN_UINT12_MAX) *
        (OPENARM_HF_LIVE_CAN_TORQUE_LIMIT_NM * 2) -
      OPENARM_HF_LIVE_CAN_TORQUE_LIMIT_NM,
    tempMos: data[6],
    tempRotor: data[7],
  };
};

export const decodeOpenArmHfLiveJointTelemetry = (
  data: Uint8Array,
  jointPrefix: string
): Record<string, OpenArmHfLiveCanMotorState> => {
  const jointTelemetry: Record<string, OpenArmHfLiveCanMotorState> = {};
  parseOpenArmHfLiveCanFrames(data).forEach((frame) => {
    const jointName = resolveOpenArmHfLiveCanJointName(frame.canId, jointPrefix);
    if (!jointName) return;
    const state = decodeOpenArmHfLiveCanMotorState(frame.data);
    jointTelemetry[jointName] = state ?? buildOpenArmHfLiveNaNMotorState();
  });
  return jointTelemetry;
};

export const buildOpenArmHfLiveNaNJointTelemetry = (
  jointPrefix: string
): Record<string, OpenArmHfLiveCanMotorState> =>
  Object.fromEntries(
    OPENARM_HF_LIVE_CAN_JOINT_SUFFIXES.map((suffix) => [
      `${jointPrefix}${suffix}`,
      buildOpenArmHfLiveNaNMotorState(),
    ])
  );

export const decodeOpenArmHfLiveJointPositions = (
  data: Uint8Array,
  jointPrefix: string
): Record<string, number> => {
  const jointTelemetry = decodeOpenArmHfLiveJointTelemetry(data, jointPrefix);
  return Object.fromEntries(
    Object.entries(jointTelemetry).map(([jointName, state]) => [
      jointName,
      state.positionRad,
    ])
  );
};
