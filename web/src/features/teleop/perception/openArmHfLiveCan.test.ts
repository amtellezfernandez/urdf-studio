import { describe, expect, it } from "vitest";

import {
  buildOpenArmHfLiveNaNJointTelemetry,
  decodeOpenArmHfLiveCanMotorState,
  decodeOpenArmHfLiveJointTelemetry,
  decodeOpenArmHfLiveJointPositions,
  parseOpenArmHfLiveCanFrames,
  resolveOpenArmHfLiveCanJointName,
} from "@/features/teleop/perception/openArmHfLiveCan";
import {
  OPENARM_HF_LIVE_CAN_BYTE_SHIFT,
  OPENARM_HF_LIVE_CAN_DATA_LENGTH_OFFSET,
  OPENARM_HF_LIVE_CAN_FRAME_BYTES,
  OPENARM_HF_LIVE_CAN_LOW_NIBBLE_MASK,
  OPENARM_HF_LIVE_CAN_PAYLOAD_OFFSET,
  OPENARM_HF_LIVE_CAN_POSITION_LIMIT_RAD,
  OPENARM_HF_LIVE_CAN_TORQUE_LIMIT_NM,
  OPENARM_HF_LIVE_CAN_UINT12_MAX,
  OPENARM_HF_LIVE_CAN_UINT16_MAX,
} from "@/features/teleop/perception/openArmHfLiveParams";

const TEST_OPENARM_HF_LIVE_CAN = {
  leftJointPrefix: "openarm_left_",
  firstJointRecvCanId: 0x11,
  firstJointName: "openarm_left_joint1",
  payloadBytes: [0, 0x80, 0, 0x7f, 0xf8, 0, 0x21, 0x22],
  expectedVelocityRadPerSec: -0.01098901098901106,
} as const;

const buildCanBatch = (canId: number, payload: readonly number[]): Uint8Array => {
  const batch = new Uint8Array(OPENARM_HF_LIVE_CAN_FRAME_BYTES);
  new DataView(batch.buffer).setUint32(0, canId, true);
  batch[OPENARM_HF_LIVE_CAN_DATA_LENGTH_OFFSET] = payload.length;
  batch.set(payload, OPENARM_HF_LIVE_CAN_PAYLOAD_OFFSET);
  return batch;
};

describe("openArmHfLiveCan", () => {
  it("parses Hugging Face 72-byte CAN batches into CAN frames", () => {
    const batch = buildCanBatch(
      TEST_OPENARM_HF_LIVE_CAN.firstJointRecvCanId,
      TEST_OPENARM_HF_LIVE_CAN.payloadBytes
    );

    const frames = parseOpenArmHfLiveCanFrames(batch);

    expect(frames).toHaveLength(1);
    expect(frames[0]?.canId).toBe(TEST_OPENARM_HF_LIVE_CAN.firstJointRecvCanId);
    expect(Array.from(frames[0]?.data ?? [])).toEqual(TEST_OPENARM_HF_LIVE_CAN.payloadBytes);
  });

  it("maps HF CAN ids onto OpenArm URDF joint names", () => {
    expect(
      resolveOpenArmHfLiveCanJointName(
        TEST_OPENARM_HF_LIVE_CAN.firstJointRecvCanId,
        TEST_OPENARM_HF_LIVE_CAN.leftJointPrefix
      )
    ).toBe(TEST_OPENARM_HF_LIVE_CAN.firstJointName);
  });

  it("decodes live MIT motor state packets into joint positions", () => {
    const batch = buildCanBatch(
      TEST_OPENARM_HF_LIVE_CAN.firstJointRecvCanId,
      TEST_OPENARM_HF_LIVE_CAN.payloadBytes
    );
    const decoded = decodeOpenArmHfLiveCanMotorState(
      new Uint8Array(TEST_OPENARM_HF_LIVE_CAN.payloadBytes)
    );
    const expectedPosition =
      (((TEST_OPENARM_HF_LIVE_CAN.payloadBytes[1] << OPENARM_HF_LIVE_CAN_BYTE_SHIFT) |
        TEST_OPENARM_HF_LIVE_CAN.payloadBytes[2]) /
        OPENARM_HF_LIVE_CAN_UINT16_MAX) *
        (OPENARM_HF_LIVE_CAN_POSITION_LIMIT_RAD * 2) -
      OPENARM_HF_LIVE_CAN_POSITION_LIMIT_RAD;
    const expectedTorque =
      ((((TEST_OPENARM_HF_LIVE_CAN.payloadBytes[4] & OPENARM_HF_LIVE_CAN_LOW_NIBBLE_MASK) <<
        OPENARM_HF_LIVE_CAN_BYTE_SHIFT) |
        TEST_OPENARM_HF_LIVE_CAN.payloadBytes[5]) /
        OPENARM_HF_LIVE_CAN_UINT12_MAX) *
        (OPENARM_HF_LIVE_CAN_TORQUE_LIMIT_NM * 2) -
      OPENARM_HF_LIVE_CAN_TORQUE_LIMIT_NM;

    expect(decoded?.positionRad).toBeCloseTo(expectedPosition);
    expect(decoded?.velocityRadPerSec).toBeCloseTo(
      TEST_OPENARM_HF_LIVE_CAN.expectedVelocityRadPerSec
    );
    expect(decoded?.torqueNm).toBeCloseTo(expectedTorque);
    const jointTelemetry = decodeOpenArmHfLiveJointTelemetry(
      batch,
      TEST_OPENARM_HF_LIVE_CAN.leftJointPrefix
    );
    expect(jointTelemetry[TEST_OPENARM_HF_LIVE_CAN.firstJointName]?.positionRad).toBeCloseTo(
      expectedPosition
    );
    expect(jointTelemetry[TEST_OPENARM_HF_LIVE_CAN.firstJointName]?.velocityRadPerSec).toBeCloseTo(
      TEST_OPENARM_HF_LIVE_CAN.expectedVelocityRadPerSec
    );
    expect(jointTelemetry[TEST_OPENARM_HF_LIVE_CAN.firstJointName]?.torqueNm).toBeCloseTo(
      expectedTorque
    );
    expect(jointTelemetry[TEST_OPENARM_HF_LIVE_CAN.firstJointName]?.tempMos).toBe(
      TEST_OPENARM_HF_LIVE_CAN.payloadBytes[6]
    );
    expect(jointTelemetry[TEST_OPENARM_HF_LIVE_CAN.firstJointName]?.tempRotor).toBe(
      TEST_OPENARM_HF_LIVE_CAN.payloadBytes[7]
    );
    expect(
      decodeOpenArmHfLiveJointPositions(batch, TEST_OPENARM_HF_LIVE_CAN.leftJointPrefix)
    ).toEqual({
      [TEST_OPENARM_HF_LIVE_CAN.firstJointName]: expectedPosition,
    });
  });

  it("builds NaN joint telemetry for invalid live CAN reads", () => {
    const invalidTelemetry = buildOpenArmHfLiveNaNJointTelemetry(
      TEST_OPENARM_HF_LIVE_CAN.leftJointPrefix
    );
    const firstJointTelemetry = invalidTelemetry[TEST_OPENARM_HF_LIVE_CAN.firstJointName];

    expect(Object.keys(invalidTelemetry)).toContain(TEST_OPENARM_HF_LIVE_CAN.firstJointName);
    expect(Number.isNaN(firstJointTelemetry?.positionRad)).toBe(true);
    expect(Number.isNaN(firstJointTelemetry?.velocityRadPerSec)).toBe(true);
    expect(Number.isNaN(firstJointTelemetry?.torqueNm)).toBe(true);
  });

  it("keeps valid joint ids but marks malformed motor packets as NaN", () => {
    const malformedBatch = buildCanBatch(
      TEST_OPENARM_HF_LIVE_CAN.firstJointRecvCanId,
      TEST_OPENARM_HF_LIVE_CAN.payloadBytes.slice(0, 2)
    );
    const telemetry = decodeOpenArmHfLiveJointTelemetry(
      malformedBatch,
      TEST_OPENARM_HF_LIVE_CAN.leftJointPrefix
    );
    const firstJointTelemetry = telemetry[TEST_OPENARM_HF_LIVE_CAN.firstJointName];

    expect(Object.keys(telemetry)).toEqual([TEST_OPENARM_HF_LIVE_CAN.firstJointName]);
    expect(Number.isNaN(firstJointTelemetry?.positionRad)).toBe(true);
    expect(Number.isNaN(firstJointTelemetry?.velocityRadPerSec)).toBe(true);
    expect(Number.isNaN(firstJointTelemetry?.torqueNm)).toBe(true);
  });
});
