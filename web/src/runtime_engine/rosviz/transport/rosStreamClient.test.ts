import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ROSVIZ_STREAM_TICKET_SUBPROTOCOL_PREFIX,
  ROSVIZ_STREAM_WS_SUBPROTOCOL,
} from "@/runtime_engine/rosviz/protocol/rosVizProtocol";
import { RosVizStreamClient } from "@/runtime_engine/rosviz/transport/rosStreamClient";

const TEST_API_BASE_URL = "https://studio.example.dev/api";
const TEST_SESSION_ID = "session-1";
const TEST_STREAM_TICKET = "ticket-123";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return {
    promise,
    resolve,
  };
};

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readonly protocols: string[];
  readyState = MockWebSocket.CONNECTING;
  binaryType = "blob";
  onopen: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string | URL, protocols?: string | string[]) {
    this.url = String(url);
    this.protocols = Array.isArray(protocols) ? protocols : protocols ? [protocols] : [];
    MockWebSocket.instances.push(this);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1000 } as CloseEvent);
  }
}

describe("RosVizStreamClient", () => {
  const originalWebSocket = globalThis.WebSocket;

  afterEach(() => {
    MockWebSocket.instances = [];
    vi.restoreAllMocks();
    globalThis.WebSocket = originalWebSocket;
  });

  it("uses a fetched ticket to open the websocket with the expected subprotocols", async () => {
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    const resolveTicket = vi.fn(async () => TEST_STREAM_TICKET);
    const client = new RosVizStreamClient({
      apiBaseUrl: TEST_API_BASE_URL,
      sessionId: TEST_SESSION_ID,
      resolveTicket,
      onFrame: vi.fn(),
    });

    await client.connect();

    expect(resolveTicket).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]?.url).toBe(
      "wss://studio.example.dev/ws/ros-viz/session-1"
    );
    expect(MockWebSocket.instances[0]?.protocols).toEqual([
      ROSVIZ_STREAM_WS_SUBPROTOCOL,
      `${ROSVIZ_STREAM_TICKET_SUBPROTOCOL_PREFIX}${TEST_STREAM_TICKET}`,
    ]);
  });

  it("deduplicates concurrent connection attempts while a ticket request is pending", async () => {
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    const deferredTicket = createDeferred<string>();
    const resolveTicket = vi.fn(() => deferredTicket.promise);
    const client = new RosVizStreamClient({
      apiBaseUrl: TEST_API_BASE_URL,
      sessionId: TEST_SESSION_ID,
      resolveTicket,
      onFrame: vi.fn(),
    });

    const firstConnect = client.connect();
    const secondConnect = client.connect();
    deferredTicket.resolve(TEST_STREAM_TICKET);
    await Promise.all([firstConnect, secondConnect]);

    expect(resolveTicket).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("does not open a websocket after disconnecting a pending connection attempt", async () => {
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    const deferredTicket = createDeferred<string>();
    const client = new RosVizStreamClient({
      apiBaseUrl: TEST_API_BASE_URL,
      sessionId: TEST_SESSION_ID,
      resolveTicket: () => deferredTicket.promise,
      onFrame: vi.fn(),
    });

    const connectPromise = client.connect();
    client.disconnect();
    deferredTicket.resolve(TEST_STREAM_TICKET);
    await connectPromise;

    expect(MockWebSocket.instances).toHaveLength(0);
  });
});
