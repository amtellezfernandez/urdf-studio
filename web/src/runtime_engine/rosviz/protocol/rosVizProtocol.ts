export enum RosVizStreamFrameType {
  TF_EDGE_BATCH = 1,
  RESOLVED_FRAME_POSE_BATCH = 2,
  MARKER_DELTA_BATCH = 3,
  POINTCLOUD_CHUNK = 4,
  JOINT_STATE_BATCH = 5,
  CLOCK_TICK = 6,
  DIAGNOSTIC_EVENT = 7,
}

export const ROSVIZ_STREAM_HEADER_BYTES = 32;
export const ROSVIZ_STREAM_SEQUENCE_STEP = 1;
export const ROSVIZ_STREAM_WS_SUBPROTOCOL = "urdf-studio.rosviz.v1";
export const ROSVIZ_STREAM_TICKET_SUBPROTOCOL_PREFIX = "ticket.";

export const ROSVIZ_STREAM_FLAG_PAYLOAD_JSON = 1 << 0;
export const ROSVIZ_STREAM_FLAG_PAYLOAD_FLATBUFFER = 1 << 1;

const TYPE_OFFSET = 0;
const FLAGS_OFFSET = 4;
const SEQUENCE_OFFSET = 8;
const TIMESTAMP_OFFSET = 16;
const TOPIC_OFFSET = 24;
const PAYLOAD_LENGTH_OFFSET = 28;

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

export type RosVizStreamFrame = {
  type: RosVizStreamFrameType;
  flags: number;
  sequence: bigint;
  timestampNs: bigint;
  topicId: number;
  payload: Uint8Array;
};

export type RosVizWsConnectionTarget = {
  url: string;
  protocols: [string, string];
};

export const encodeRosVizFrame = (
  frame: Omit<RosVizStreamFrame, "payload"> & { payload: Uint8Array | string }
): Uint8Array => {
  const payloadBytes =
    typeof frame.payload === "string" ? TEXT_ENCODER.encode(frame.payload) : frame.payload;
  const output = new Uint8Array(ROSVIZ_STREAM_HEADER_BYTES + payloadBytes.byteLength);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);

  view.setUint32(TYPE_OFFSET, frame.type, true);
  view.setUint32(FLAGS_OFFSET, frame.flags, true);
  view.setBigUint64(SEQUENCE_OFFSET, frame.sequence, true);
  view.setBigUint64(TIMESTAMP_OFFSET, frame.timestampNs, true);
  view.setUint32(TOPIC_OFFSET, frame.topicId, true);
  view.setUint32(PAYLOAD_LENGTH_OFFSET, payloadBytes.byteLength, true);
  output.set(payloadBytes, ROSVIZ_STREAM_HEADER_BYTES);

  return output;
};

export const parseRosVizFrame = (buffer: ArrayBufferLike): RosVizStreamFrame => {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < ROSVIZ_STREAM_HEADER_BYTES) {
    throw new Error(
      `ROS viz frame too short: expected at least ${ROSVIZ_STREAM_HEADER_BYTES} bytes, got ${bytes.byteLength}.`
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const typeRaw = view.getUint32(TYPE_OFFSET, true);
  const type = typeRaw as RosVizStreamFrameType;
  if (!(type in RosVizStreamFrameType)) {
    throw new Error(`Unknown ROS viz frame type: ${typeRaw}`);
  }

  const flags = view.getUint32(FLAGS_OFFSET, true);
  const sequence = view.getBigUint64(SEQUENCE_OFFSET, true);
  const timestampNs = view.getBigUint64(TIMESTAMP_OFFSET, true);
  const topicId = view.getUint32(TOPIC_OFFSET, true);
  const payloadLength = view.getUint32(PAYLOAD_LENGTH_OFFSET, true);

  const expectedLength = ROSVIZ_STREAM_HEADER_BYTES + payloadLength;
  if (bytes.byteLength !== expectedLength) {
    throw new Error(
      `ROS viz frame length mismatch: expected ${expectedLength} bytes, got ${bytes.byteLength}.`
    );
  }

  const payload = bytes.subarray(ROSVIZ_STREAM_HEADER_BYTES, expectedLength);

  return {
    type,
    flags,
    sequence,
    timestampNs,
    topicId,
    payload,
  };
};

export const decodeRosVizJsonPayload = <T>(frame: RosVizStreamFrame): T => {
  if ((frame.flags & ROSVIZ_STREAM_FLAG_PAYLOAD_JSON) === 0) {
    throw new Error("ROS viz frame payload is not flagged as JSON.");
  }
  const text = TEXT_DECODER.decode(frame.payload);
  return JSON.parse(text) as T;
};

const buildRosVizWsUrl = (apiBaseUrl: string, sessionId: string): string => {
  const normalized = apiBaseUrl.trim();
  if (!normalized) {
    throw new Error("API base URL is required for ROS viz websocket connection.");
  }

  const parsed = new URL(normalized);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = `/ws/ros-viz/${encodeURIComponent(sessionId)}`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
};

const buildRosVizStreamTicketSubprotocol = (ticket: string): string => {
  const normalizedTicket = ticket.trim();
  if (!normalizedTicket) {
    throw new Error("ROS viz stream ticket is required for websocket connection.");
  }
  return `${ROSVIZ_STREAM_TICKET_SUBPROTOCOL_PREFIX}${normalizedTicket}`;
};

export const buildRosVizWsConnectionTarget = (
  apiBaseUrl: string,
  sessionId: string,
  ticket: string
): RosVizWsConnectionTarget => ({
  url: buildRosVizWsUrl(apiBaseUrl, sessionId),
  protocols: [
    ROSVIZ_STREAM_WS_SUBPROTOCOL,
    buildRosVizStreamTicketSubprotocol(ticket),
  ],
});
