import { describe, expect, it } from "vitest";

import {
  ROSVIZ_STREAM_TICKET_SUBPROTOCOL_PREFIX,
  ROSVIZ_STREAM_WS_SUBPROTOCOL,
  ROSVIZ_STREAM_FLAG_PAYLOAD_JSON,
  RosVizStreamFrameType,
  buildRosVizWsConnectionTarget,
  decodeRosVizJsonPayload,
  encodeRosVizFrame,
  parseRosVizFrame,
} from "./rosVizProtocol";

describe("rosVizProtocol", () => {
  it("encodes and parses a frame losslessly", () => {
    const encoded = encodeRosVizFrame({
      type: RosVizStreamFrameType.CLOCK_TICK,
      flags: ROSVIZ_STREAM_FLAG_PAYLOAD_JSON,
      sequence: 11n,
      timestampNs: 1234n,
      topicId: 6,
      payload: '{"mode":"live","t_ns":1234}',
    });

    const parsed = parseRosVizFrame(encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength));
    const decoded = decodeRosVizJsonPayload<{ mode: string; t_ns: number }>(parsed);

    expect(parsed.type).toBe(RosVizStreamFrameType.CLOCK_TICK);
    expect(parsed.sequence).toBe(11n);
    expect(parsed.timestampNs).toBe(1234n);
    expect(parsed.topicId).toBe(6);
    expect(decoded.mode).toBe("live");
    expect(decoded.t_ns).toBe(1234);
  });

  it("rejects unknown frame types", () => {
    const encoded = encodeRosVizFrame({
      type: RosVizStreamFrameType.CLOCK_TICK,
      flags: 0,
      sequence: 1n,
      timestampNs: 1n,
      topicId: 1,
      payload: new Uint8Array(),
    });

    const view = new DataView(encoded.buffer);
    view.setUint32(0, 9999, true);

    expect(() => parseRosVizFrame(encoded.buffer)).toThrowError("Unknown ROS viz frame type");
  });

  it("builds websocket targets with ticket subprotocols", () => {
    const target = buildRosVizWsConnectionTarget(
      "https://studio.example.dev/api",
      "session 1",
      "ticket-123"
    );

    expect(target.url).toBe("wss://studio.example.dev/ws/ros-viz/session%201");
    expect(target.protocols).toEqual([
      ROSVIZ_STREAM_WS_SUBPROTOCOL,
      `${ROSVIZ_STREAM_TICKET_SUBPROTOCOL_PREFIX}ticket-123`,
    ]);
  });
});
