import { describe, expect, it } from "vitest";

import {
  detectOpenArmHfMp4Codec,
  stripOpenArmHfTimestampPrefix,
} from "@/features/teleop/perception/openArmHfLiveMse";
import {
  OPENARM_HF_LIVE_BOX_HEADER_BYTES,
  OPENARM_HF_LIVE_BOX_TYPE_OFFSET,
  OPENARM_HF_LIVE_TIMESTAMP_PREFIX_BYTES,
} from "@/features/teleop/perception/openArmHfLiveParams";

const TEST_OPENARM_HF_MSE_FIXTURE = {
  mp4BoxSizeOffset: 3,
  avcPayloadOffset: OPENARM_HF_LIVE_BOX_HEADER_BYTES,
  avcProfileByte: 0x64,
  avcCompatByte: 0x00,
  avcLevelByte: 0x1f,
} as const;

const buildBox = (type: string, payload: number[] = []): Uint8Array => {
  const box = new Uint8Array(OPENARM_HF_LIVE_BOX_HEADER_BYTES + payload.length);
  box[TEST_OPENARM_HF_MSE_FIXTURE.mp4BoxSizeOffset] = box.length;
  for (let index = 0; index < type.length; index += 1) {
    box[OPENARM_HF_LIVE_BOX_TYPE_OFFSET + index] = type.charCodeAt(index);
  }
  box.set(payload, TEST_OPENARM_HF_MSE_FIXTURE.avcPayloadOffset);
  return box;
};

describe("openArmHfLiveMse", () => {
  it("strips the OpenArm MoQ timestamp prefix before appending fMP4 media", () => {
    const mediaSegment = buildBox("moof");
    const prefixedSegment = new Uint8Array(
      OPENARM_HF_LIVE_TIMESTAMP_PREFIX_BYTES + mediaSegment.length
    );
    prefixedSegment.set(mediaSegment, OPENARM_HF_LIVE_TIMESTAMP_PREFIX_BYTES);

    expect(stripOpenArmHfTimestampPrefix(prefixedSegment)).toEqual(mediaSegment);
  });

  it("detects the AVC codec string from an fMP4 init segment", () => {
    const avcConfig = buildBox("avcC", [
      0,
      TEST_OPENARM_HF_MSE_FIXTURE.avcProfileByte,
      TEST_OPENARM_HF_MSE_FIXTURE.avcCompatByte,
      TEST_OPENARM_HF_MSE_FIXTURE.avcLevelByte,
    ]);

    expect(detectOpenArmHfMp4Codec(avcConfig)).toBe("avc1.64001F");
  });
});
