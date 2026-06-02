import type { OperatorCommandMetadata } from "@/features/teleop/contracts/operatorControlTypes";
import {
  OPERATOR_CONTROL_DATAGRAM_DEFAULT_ACK_TIMEOUT_MS,
  OPERATOR_CONTROL_DATAGRAM_MONOTONIC_NS_PER_MS,
} from "@/features/teleop/params/operatorTeleopParams";
import type { OperatorControlTransportDescriptor } from "@/features/teleop/transport/operatorControlTransport";

export type OperatorControlDatagramRole = "operator" | "robot" | "observer";

export type OperatorControlDatagramAuthorization = {
  collaboration_session_id: string;
  teleop_capability_token: string;
};

export type OperatorControlDatagramPacket = {
  session_id: string;
  peer_id: string;
  role: OperatorControlDatagramRole;
  sequence: number;
  source_ts_ms: number;
  monotonic_timestamp_ns: number;
  command_kind: string;
  ack_requested: boolean;
  authorization: OperatorControlDatagramAuthorization | null;
  payload: Record<string, unknown>;
};

export type OperatorControlDatagramAck = {
  session_id: string;
  peer_id: string;
  sequence: number;
  server_sequence: number;
  accepted: boolean;
  reason: string;
  server_received_unix_ms: number;
};

type OperatorWebTransportDatagrams = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
};

export type OperatorWebTransportConnection = {
  ready: Promise<void>;
  closed?: Promise<unknown>;
  datagrams: OperatorWebTransportDatagrams;
  close?: () => void;
};

export type OperatorWebTransportFactory = (
  url: string,
) => OperatorWebTransportConnection;

export type OperatorControlDatagramClientConfig = {
  descriptor: OperatorControlTransportDescriptor;
  sessionId: string;
  peerId: string;
  role?: OperatorControlDatagramRole;
  webTransportFactory?: OperatorWebTransportFactory;
  monotonicNowMs?: () => number;
  ackTimeoutMs?: number;
};

export type OperatorControlDatagramSendOptions = {
  ackRequested?: boolean;
  authorization?: OperatorControlDatagramAuthorization | null;
  priority?: boolean;
};

export type OperatorControlDatagramClient = {
  connect: () => Promise<void>;
  send: (
    metadata: OperatorCommandMetadata,
    payload: Record<string, unknown>,
    options?: OperatorControlDatagramSendOptions,
  ) => Promise<OperatorControlDatagramAck | null>;
  close: () => void;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const buildAckKey = ({
  session_id,
  peer_id,
  sequence,
}: {
  session_id: string;
  peer_id: string;
  sequence: number;
}): string => `${session_id}:${peer_id}:${sequence}`;

const getDefaultWebTransportFactory = (): OperatorWebTransportFactory => {
  const webTransportConstructor = (
    globalThis as typeof globalThis & {
      WebTransport?: new (url: string) => OperatorWebTransportConnection;
    }
  ).WebTransport;
  if (!webTransportConstructor) {
    throw new Error("WebTransport is unavailable in this browser.");
  }
  return (url: string) => new webTransportConstructor(url);
};

export const buildOperatorControlDatagramPacket = ({
  sessionId,
  peerId,
  role = "operator",
  metadata,
  payload,
  ackRequested = true,
  authorization = null,
  monotonicNowMs = performance.now.bind(performance),
}: {
  sessionId: string;
  peerId: string;
  role?: OperatorControlDatagramRole;
  metadata: OperatorCommandMetadata;
  payload: Record<string, unknown>;
  ackRequested?: boolean;
  authorization?: OperatorControlDatagramAuthorization | null;
  monotonicNowMs?: () => number;
}): OperatorControlDatagramPacket => ({
  session_id: sessionId,
  peer_id: peerId,
  role,
  sequence: metadata.sequence,
  source_ts_ms: metadata.source_ts_ms,
  monotonic_timestamp_ns: Math.round(
    monotonicNowMs() * OPERATOR_CONTROL_DATAGRAM_MONOTONIC_NS_PER_MS,
  ),
  command_kind: metadata.command_kind,
  ack_requested: ackRequested,
  authorization,
  payload,
});

const encodeOperatorControlDatagramPacket = (
  packet: OperatorControlDatagramPacket,
): Uint8Array => encoder.encode(JSON.stringify(packet));

const decodeOperatorControlDatagramAck = (
  data: Uint8Array,
): OperatorControlDatagramAck | null => {
  try {
    const value: unknown = JSON.parse(decoder.decode(data));
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.session_id !== "string" ||
      typeof candidate.peer_id !== "string" ||
      !isFiniteNumber(candidate.sequence) ||
      !isFiniteNumber(candidate.server_sequence) ||
      typeof candidate.accepted !== "boolean" ||
      typeof candidate.reason !== "string" ||
      !isFiniteNumber(candidate.server_received_unix_ms)
    ) {
      return null;
    }
    return {
      session_id: candidate.session_id,
      peer_id: candidate.peer_id,
      sequence: candidate.sequence,
      server_sequence: candidate.server_sequence,
      accepted: candidate.accepted,
      reason: candidate.reason,
      server_received_unix_ms: candidate.server_received_unix_ms,
    };
  } catch {
    return null;
  }
};

export const isMatchingOperatorControlDatagramAck = (
  ack: OperatorControlDatagramAck,
  packet: OperatorControlDatagramPacket,
): boolean =>
  ack.session_id === packet.session_id &&
  ack.peer_id === packet.peer_id &&
  ack.sequence === packet.sequence;

export const createOperatorControlDatagramClient = ({
  descriptor,
  sessionId,
  peerId,
  role = "operator",
  webTransportFactory,
  monotonicNowMs = performance.now.bind(performance),
  ackTimeoutMs = OPERATOR_CONTROL_DATAGRAM_DEFAULT_ACK_TIMEOUT_MS,
}: OperatorControlDatagramClientConfig): OperatorControlDatagramClient => {
  let connection: OperatorWebTransportConnection | null = null;
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let connectPromise: Promise<void> | null = null;
  let sendChain = Promise.resolve();
  let closed = false;
  const pendingAcks = new Map<
    string,
    {
      reject: (error: Error) => void;
      resolve: (ack: OperatorControlDatagramAck) => void;
      timeoutId: ReturnType<typeof setTimeout>;
    }
  >();

  const rejectPendingAcks = (error: Error): void => {
    for (const pendingAck of pendingAcks.values()) {
      globalThis.clearTimeout(pendingAck.timeoutId);
      pendingAck.reject(error);
    }
    pendingAcks.clear();
  };

  const clearPendingAck = (ackKey: string): void => {
    const pendingAck = pendingAcks.get(ackKey);
    if (!pendingAck) return;
    globalThis.clearTimeout(pendingAck.timeoutId);
    pendingAcks.delete(ackKey);
  };

  const readAckLoop = async (): Promise<void> => {
    const activeReader = reader;
    if (!activeReader) return;
    try {
      while (!closed) {
        const result = await activeReader.read();
        if (result.done || !result.value) break;
        const ack = decodeOperatorControlDatagramAck(result.value);
        if (!ack) continue;
        const pendingAck = pendingAcks.get(buildAckKey(ack));
        if (!pendingAck) continue;
        clearPendingAck(buildAckKey(ack));
        pendingAck.resolve(ack);
      }
      if (!closed) {
        rejectPendingAcks(
          new Error("Control datagram connection closed before ack."),
        );
      }
    } catch (error) {
      if (!closed) {
        rejectPendingAcks(
          error instanceof Error
            ? error
            : new Error("Control datagram ack reader failed."),
        );
      }
    }
  };

  const connect = async (): Promise<void> => {
    if (connection && writer && reader) return;
    if (connectPromise) {
      await connectPromise;
      return;
    }
    closed = false;
    connectPromise = (async () => {
      connection = (webTransportFactory ?? getDefaultWebTransportFactory())(
        descriptor.webtransportUrl,
      );
      await connection.ready;
      writer = connection.datagrams.writable.getWriter();
      reader = connection.datagrams.readable.getReader();
      void readAckLoop();
    })();
    try {
      await connectPromise;
    } finally {
      connectPromise = null;
    }
  };

  const close = (): void => {
    closed = true;
    rejectPendingAcks(new Error("Control datagram client closed."));
    void reader?.cancel().catch(() => undefined);
    try {
      writer?.releaseLock();
    } catch {
      // The stream may already be closed by WebTransport.
    }
    try {
      reader?.releaseLock();
    } catch {
      // The reader loop may already have released through cancellation.
    }
    writer = null;
    reader = null;
    connection?.close?.();
    connection = null;
    connectPromise = null;
    sendChain = Promise.resolve();
  };

  const waitForMatchingAckWithTimeout = async (
    packet: OperatorControlDatagramPacket,
  ): Promise<OperatorControlDatagramAck> => {
    const ackKey = buildAckKey(packet);
    return new Promise<OperatorControlDatagramAck>((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        pendingAcks.delete(ackKey);
        reject(new Error("Control datagram ack timed out."));
      }, ackTimeoutMs);
      pendingAcks.set(ackKey, {
        resolve,
        reject,
        timeoutId,
      });
    });
  };

  const sendPacket = async (
    packet: OperatorControlDatagramPacket,
  ): Promise<OperatorControlDatagramAck | null> => {
    if (!writer) throw new Error("Control datagram client is not connected.");
    const ackPromise = packet.ack_requested
      ? waitForMatchingAckWithTimeout(packet)
      : null;
    try {
      await writer.write(encodeOperatorControlDatagramPacket(packet));
      if (!ackPromise) {
        return null;
      }
      const ack = await ackPromise;
      if (!ack.accepted) {
        throw new Error(`Control datagram rejected: ${ack.reason}`);
      }
      return ack;
    } catch (error) {
      clearPendingAck(buildAckKey(packet));
      throw error;
    }
  };

  const sendNow = async (
    metadata: OperatorCommandMetadata,
    payload: Record<string, unknown>,
    options: OperatorControlDatagramSendOptions,
  ): Promise<OperatorControlDatagramAck | null> => {
    await connect();
    if (!writer) throw new Error("Control datagram client is not connected.");
    const packet = buildOperatorControlDatagramPacket({
      sessionId,
      peerId,
      role,
      metadata,
      payload,
      ackRequested: options.ackRequested ?? true,
      authorization: options.authorization ?? null,
      monotonicNowMs,
    });
    return sendPacket(packet);
  };

  return {
    connect,
    send: async (metadata, payload, options = {}) => {
      if (options.priority) {
        return sendNow(metadata, payload, options);
      }
      const sendResult = sendChain.then(() =>
        sendNow(metadata, payload, options),
      );
      sendChain = sendResult.then(
        () => undefined,
        () => undefined,
      );
      return sendResult;
    },
    close,
  };
};
