import { describe, expect, it, vi } from "vitest";

import {
  buildOperatorControlDatagramPacket,
  createOperatorControlDatagramClient,
  isMatchingOperatorControlDatagramAck,
  type OperatorControlDatagramAck,
  type OperatorWebTransportConnection,
} from "@/features/teleop/transport/operatorControlDatagramClient";
import type { OperatorControlTransportDescriptor } from "@/features/teleop/transport/operatorControlTransport";

const TEST_CONTROL_DESCRIPTOR: OperatorControlTransportDescriptor = {
  type: "teleop_sidecar",
  manifestPath: "/teleop/manifest",
  statsPath: "/teleop/stats",
  webtransportUrl: "https://127.0.0.1:8092/teleop",
  nativeQuicAddress: "127.0.0.1:8093",
  nativeQuicAlpn: "urdf-teleop-quic-v1",
  sidecarReady: true,
  requiresLease: true,
  requiresTeleopCapability: true,
  teleopCapabilityVerifyPath:
    "/collaboration/sessions/{sessionId}/capabilities/verify",
  teleopCapabilityRequiredRole: "teleop_operator",
  teleopCapabilityTransport: "moq",
};

const TEST_COMMAND_METADATA = {
  command_kind: "twist",
  sequence: 7,
  source_ts_ms: 123,
} as const;
const TEST_NEXT_COMMAND_METADATA = {
  command_kind: "stop",
  sequence: 8,
  source_ts_ms: 124,
} as const;
const TEST_DATAGRAM_TIMING_FIXTURE = {
  monotonicMs: 42,
  monotonicNs: 42_000_000,
  serverReceivedUnixMs: 456,
  ackTimeoutMs: 5,
} as const;

const buildAck = (
  overrides: Partial<OperatorControlDatagramAck> = {},
): OperatorControlDatagramAck => ({
  session_id: "session-a",
  peer_id: "operator-a",
  sequence: TEST_COMMAND_METADATA.sequence,
  server_sequence: 1,
  accepted: true,
  reason: "accepted",
  server_received_unix_ms: TEST_DATAGRAM_TIMING_FIXTURE.serverReceivedUnixMs,
  ...overrides,
});

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("operatorControlDatagramClient", () => {
  it("builds sidecar-compatible control packets", () => {
    const monotonicFixture = {
      ms: TEST_DATAGRAM_TIMING_FIXTURE.monotonicMs,
      ns: TEST_DATAGRAM_TIMING_FIXTURE.monotonicNs,
    };

    expect(
      buildOperatorControlDatagramPacket({
        sessionId: "session-a",
        peerId: "operator-a",
        metadata: TEST_COMMAND_METADATA,
        payload: { x: 0.1 },
        monotonicNowMs: () => monotonicFixture.ms,
      }),
    ).toEqual({
      session_id: "session-a",
      peer_id: "operator-a",
      role: "operator",
      sequence: TEST_COMMAND_METADATA.sequence,
      source_ts_ms: TEST_COMMAND_METADATA.source_ts_ms,
      monotonic_timestamp_ns: monotonicFixture.ns,
      command_kind: TEST_COMMAND_METADATA.command_kind,
      ack_requested: true,
      authorization: null,
      payload: { x: 0.1 },
    });
  });

  it("marks latest control packets as unacked when requested", () => {
    expect(
      buildOperatorControlDatagramPacket({
        sessionId: "session-a",
        peerId: "operator-a",
        metadata: TEST_COMMAND_METADATA,
        payload: { x: 0.1 },
        ackRequested: false,
        monotonicNowMs: () => TEST_DATAGRAM_TIMING_FIXTURE.monotonicMs,
      }),
    ).toMatchObject({
      ack_requested: false,
      authorization: null,
      command_kind: "twist",
      payload: { x: 0.1 },
    });
  });

  it("sends one WebTransport datagram and resolves the matching sidecar ack", async () => {
    let readableController: ReadableStreamDefaultController<Uint8Array> | null =
      null;
    const writtenFrames: Uint8Array[] = [];
    const ack = buildAck();
    const connection: OperatorWebTransportConnection = {
      ready: Promise.resolve(),
      datagrams: {
        writable: new WritableStream<Uint8Array>({
          write: (frame) => {
            writtenFrames.push(frame);
          },
        }),
        readable: new ReadableStream<Uint8Array>({
          start: (controller) => {
            readableController = controller;
          },
        }),
      },
      close: vi.fn(),
    };
    const webTransportFactory = vi.fn(() => connection);
    const client = createOperatorControlDatagramClient({
      descriptor: TEST_CONTROL_DESCRIPTOR,
      sessionId: "session-a",
      peerId: "operator-a",
      monotonicNowMs: () => TEST_DATAGRAM_TIMING_FIXTURE.monotonicMs,
      webTransportFactory,
    });

    const sendPromise = client.send(TEST_COMMAND_METADATA, { x: 0.1 });
    await flushMicrotasks();
    readableController?.enqueue(
      new TextEncoder().encode(JSON.stringify(ack)),
    );

    await expect(sendPromise).resolves.toEqual(ack);

    expect(webTransportFactory).toHaveBeenCalledWith(
      TEST_CONTROL_DESCRIPTOR.webtransportUrl,
    );
    expect(writtenFrames).toHaveLength(1);
    expect(
      JSON.parse(new TextDecoder().decode(writtenFrames[0])),
    ).toMatchObject({
      session_id: "session-a",
      peer_id: "operator-a",
      command_kind: "twist",
      source_ts_ms: TEST_COMMAND_METADATA.source_ts_ms,
      authorization: null,
      payload: { x: 0.1 },
    });
  });

  it("sends unacked datagrams without waiting for sidecar acks", async () => {
    const writtenFrames: Uint8Array[] = [];
    const connection: OperatorWebTransportConnection = {
      ready: Promise.resolve(),
      datagrams: {
        writable: new WritableStream<Uint8Array>({
          write: (frame) => {
            writtenFrames.push(frame);
          },
        }),
        readable: new ReadableStream<Uint8Array>({
          start: () => undefined,
        }),
      },
    };
    const client = createOperatorControlDatagramClient({
      descriptor: TEST_CONTROL_DESCRIPTOR,
      sessionId: "session-a",
      peerId: "operator-a",
      monotonicNowMs: () => TEST_DATAGRAM_TIMING_FIXTURE.monotonicMs,
      webTransportFactory: () => connection,
    });

    await expect(
      client.send(TEST_COMMAND_METADATA, { x: 0.1 }, { ackRequested: false }),
    ).resolves.toBeNull();

    expect(
      JSON.parse(new TextDecoder().decode(writtenFrames[0])),
    ).toMatchObject({
      ack_requested: false,
      authorization: null,
      command_kind: "twist",
    });
  });

  it("ignores stale datagram acks until the matching command ack arrives", async () => {
    let readableController: ReadableStreamDefaultController<Uint8Array> | null =
      null;
    const writtenFrames: Uint8Array[] = [];
    const matchingAck = buildAck();
    const staleAck = buildAck({
      sequence: TEST_COMMAND_METADATA.sequence - 1,
      server_sequence: 99,
    });
    const connection: OperatorWebTransportConnection = {
      ready: Promise.resolve(),
      datagrams: {
        writable: new WritableStream<Uint8Array>({
          write: (frame) => {
            writtenFrames.push(frame);
          },
        }),
        readable: new ReadableStream<Uint8Array>({
          start: (controller) => {
            readableController = controller;
          },
        }),
      },
    };
    const client = createOperatorControlDatagramClient({
      descriptor: TEST_CONTROL_DESCRIPTOR,
      sessionId: "session-a",
      peerId: "operator-a",
      monotonicNowMs: () => TEST_DATAGRAM_TIMING_FIXTURE.monotonicMs,
      webTransportFactory: () => connection,
    });

    const sendPromise = client.send(TEST_COMMAND_METADATA, { x: 0.1 });
    await flushMicrotasks();
    readableController?.enqueue(
      new TextEncoder().encode(JSON.stringify(staleAck)),
    );
    readableController?.enqueue(
      new TextEncoder().encode(JSON.stringify(matchingAck)),
    );

    await expect(sendPromise).resolves.toEqual(matchingAck);
    expect(writtenFrames).toHaveLength(1);
  });

  it("ignores malformed datagram acks until a matching valid ack arrives", async () => {
    let readableController: ReadableStreamDefaultController<Uint8Array> | null =
      null;
    const matchingAck = buildAck();
    const connection: OperatorWebTransportConnection = {
      ready: Promise.resolve(),
      datagrams: {
        writable: new WritableStream<Uint8Array>({
          write: () => undefined,
        }),
        readable: new ReadableStream<Uint8Array>({
          start: (controller) => {
            readableController = controller;
          },
        }),
      },
    };
    const client = createOperatorControlDatagramClient({
      descriptor: TEST_CONTROL_DESCRIPTOR,
      sessionId: "session-a",
      peerId: "operator-a",
      monotonicNowMs: () => TEST_DATAGRAM_TIMING_FIXTURE.monotonicMs,
      webTransportFactory: () => connection,
    });

    const sendPromise = client.send(TEST_COMMAND_METADATA, { x: 0.1 });
    await flushMicrotasks();
    readableController?.enqueue(new TextEncoder().encode("not json"));
    readableController?.enqueue(
      new TextEncoder().encode(
        JSON.stringify({
          ...matchingAck,
          accepted: "true",
        }),
      ),
    );
    readableController?.enqueue(
      new TextEncoder().encode(JSON.stringify(matchingAck)),
    );

    await expect(sendPromise).resolves.toEqual(matchingAck);
  });

  it("serializes overlapping datagram sends on one connection", async () => {
    let readableController: ReadableStreamDefaultController<Uint8Array> | null =
      null;
    const writtenFrames: Uint8Array[] = [];
    const connection: OperatorWebTransportConnection = {
      ready: Promise.resolve(),
      datagrams: {
        writable: new WritableStream<Uint8Array>({
          write: (frame) => {
            writtenFrames.push(frame);
          },
        }),
        readable: new ReadableStream<Uint8Array>({
          start: (controller) => {
            readableController = controller;
          },
        }),
      },
    };
    const client = createOperatorControlDatagramClient({
      descriptor: TEST_CONTROL_DESCRIPTOR,
      sessionId: "session-a",
      peerId: "operator-a",
      monotonicNowMs: () => TEST_DATAGRAM_TIMING_FIXTURE.monotonicMs,
      webTransportFactory: () => connection,
    });

    const firstSend = client.send(TEST_COMMAND_METADATA, { x: 0.1 });
    const secondSend = client.send(TEST_NEXT_COMMAND_METADATA, {});
    await flushMicrotasks();
    await flushMicrotasks();

    expect(writtenFrames).toHaveLength(1);
    readableController?.enqueue(
      new TextEncoder().encode(JSON.stringify(buildAck())),
    );
    await expect(firstSend).resolves.toMatchObject({
      sequence: TEST_COMMAND_METADATA.sequence,
    });
    await flushMicrotasks();

    expect(writtenFrames).toHaveLength(2);
    readableController?.enqueue(
      new TextEncoder().encode(
        JSON.stringify(
          buildAck({
            sequence: TEST_NEXT_COMMAND_METADATA.sequence,
            server_sequence: 2,
          }),
        ),
      ),
    );
    await expect(secondSend).resolves.toMatchObject({
      sequence: TEST_NEXT_COMMAND_METADATA.sequence,
    });
  });

  it("resolves later commands after an earlier ack timeout", async () => {
    vi.useFakeTimers();
    let readableController: ReadableStreamDefaultController<Uint8Array> | null =
      null;
    const connection: OperatorWebTransportConnection = {
      ready: Promise.resolve(),
      datagrams: {
        writable: new WritableStream<Uint8Array>({
          write: () => undefined,
        }),
        readable: new ReadableStream<Uint8Array>({
          start: (controller) => {
            readableController = controller;
          },
        }),
      },
    };
    const client = createOperatorControlDatagramClient({
      descriptor: TEST_CONTROL_DESCRIPTOR,
      sessionId: "session-a",
      peerId: "operator-a",
      ackTimeoutMs: TEST_DATAGRAM_TIMING_FIXTURE.ackTimeoutMs,
      monotonicNowMs: () => TEST_DATAGRAM_TIMING_FIXTURE.monotonicMs,
      webTransportFactory: () => connection,
    });

    try {
      const timedOutExpectation = expect(
        client.send(TEST_COMMAND_METADATA, { x: 0.1 }),
      ).rejects.toThrow("timed out");
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(TEST_DATAGRAM_TIMING_FIXTURE.ackTimeoutMs);
      await timedOutExpectation;

      const nextSend = client.send(TEST_NEXT_COMMAND_METADATA, {});
      await flushMicrotasks();
      readableController?.enqueue(
        new TextEncoder().encode(
          JSON.stringify(
            buildAck({
              sequence: TEST_NEXT_COMMAND_METADATA.sequence,
              server_sequence: 2,
            }),
          ),
        ),
      );

      await expect(nextSend).resolves.toMatchObject({
        sequence: TEST_NEXT_COMMAND_METADATA.sequence,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets priority stop bypass an earlier acked command wait", async () => {
    let readableController: ReadableStreamDefaultController<Uint8Array> | null =
      null;
    const writtenFrames: Uint8Array[] = [];
    const connection: OperatorWebTransportConnection = {
      ready: Promise.resolve(),
      datagrams: {
        writable: new WritableStream<Uint8Array>({
          write: (frame) => {
            writtenFrames.push(frame);
          },
        }),
        readable: new ReadableStream<Uint8Array>({
          start: (controller) => {
            readableController = controller;
          },
        }),
      },
    };
    const client = createOperatorControlDatagramClient({
      descriptor: TEST_CONTROL_DESCRIPTOR,
      sessionId: "session-a",
      peerId: "operator-a",
      monotonicNowMs: () => TEST_DATAGRAM_TIMING_FIXTURE.monotonicMs,
      webTransportFactory: () => connection,
    });

    const firstSend = client.send(TEST_COMMAND_METADATA, { x: 0.1 });
    await flushMicrotasks();
    const stopSend = client.send(TEST_NEXT_COMMAND_METADATA, {}, { priority: true });
    await flushMicrotasks();

    expect(writtenFrames).toHaveLength(2);
    readableController?.enqueue(
      new TextEncoder().encode(
        JSON.stringify(
          buildAck({
            sequence: TEST_NEXT_COMMAND_METADATA.sequence,
            server_sequence: 2,
          }),
        ),
      ),
    );
    await expect(stopSend).resolves.toMatchObject({
      sequence: TEST_NEXT_COMMAND_METADATA.sequence,
    });

    readableController?.enqueue(new TextEncoder().encode(JSON.stringify(buildAck())));
    await expect(firstSend).resolves.toMatchObject({
      sequence: TEST_COMMAND_METADATA.sequence,
    });
  });

  it("matches acks by session, peer, and sequence", () => {
    const packet = buildOperatorControlDatagramPacket({
      sessionId: "session-a",
      peerId: "operator-a",
      metadata: TEST_COMMAND_METADATA,
      payload: { x: 0.1 },
      monotonicNowMs: () => TEST_DATAGRAM_TIMING_FIXTURE.monotonicMs,
    });

    expect(isMatchingOperatorControlDatagramAck(buildAck(), packet)).toBe(true);
    expect(
      isMatchingOperatorControlDatagramAck(
        buildAck({ peer_id: "operator-b" }),
        packet,
      ),
    ).toBe(false);
  });
});
