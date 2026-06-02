import {
  ROSVIZ_STREAM_SEQUENCE_STEP,
  type RosVizStreamFrame,
  buildRosVizWsConnectionTarget,
  parseRosVizFrame,
} from "@/runtime_engine/rosviz/protocol/rosVizProtocol";

export type RosVizStreamClientOptions = {
  apiBaseUrl: string;
  sessionId: string;
  resolveTicket: () => Promise<string>;
  onFrame: (frame: RosVizStreamFrame) => void;
  onOpen?: () => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
  onSequenceGap?: (expected: bigint, actual: bigint) => void;
  onFrameParseError?: (error: Error) => void;
};

export class RosVizStreamClient {
  private socket: WebSocket | null = null;
  private readonly options: RosVizStreamClientOptions;
  private lastSequence: bigint | null = null;
  private connectPromise: Promise<void> | null = null;
  private connectEpoch = 0;

  constructor(options: RosVizStreamClientOptions) {
    this.options = options;
  }

  connect(): Promise<void> {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    const attemptId = this.connectEpoch + 1;
    this.connectEpoch = attemptId;
    const connectionPromise = this.openSocket(attemptId).finally(() => {
      if (this.connectPromise === connectionPromise) {
        this.connectPromise = null;
      }
    });
    this.connectPromise = connectionPromise;
    return connectionPromise;
  }

  disconnect(): void {
    this.connectEpoch += 1;
    if (!this.socket) return;
    this.socket.close();
    this.socket = null;
    this.lastSequence = null;
  }

  private async openSocket(attemptId: number): Promise<void> {
    const ticket = await this.options.resolveTicket();
    if (attemptId !== this.connectEpoch) {
      return;
    }
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const connectionTarget = buildRosVizWsConnectionTarget(
      this.options.apiBaseUrl,
      this.options.sessionId,
      ticket
    );
    const socket = new WebSocket(connectionTarget.url, connectionTarget.protocols);
    socket.binaryType = "arraybuffer";

    socket.onopen = () => {
      this.lastSequence = null;
      this.options.onOpen?.();
    };

    socket.onclose = (event) => {
      if (this.socket === socket) {
        this.socket = null;
        this.lastSequence = null;
      }
      this.options.onClose?.(event);
    };

    socket.onerror = (event) => {
      this.options.onError?.(event);
    };

    socket.onmessage = (event) => {
      void this.handleMessage(event.data);
    };

    this.socket = socket;
  }

  private async handleMessage(data: unknown): Promise<void> {
    try {
      const buffer = await this.toArrayBuffer(data);
      if (!buffer) return;

      const frame = parseRosVizFrame(buffer);
      this.detectSequenceGap(frame);
      this.options.onFrame(frame);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.options.onFrameParseError?.(normalized);
    }
  }

  private detectSequenceGap(frame: RosVizStreamFrame): void {
    if (this.lastSequence !== null) {
      const expected = this.lastSequence + BigInt(ROSVIZ_STREAM_SEQUENCE_STEP);
      if (frame.sequence > expected) {
        this.options.onSequenceGap?.(expected, frame.sequence);
      }
    }
    this.lastSequence = frame.sequence;
  }

  private async toArrayBuffer(data: unknown): Promise<ArrayBuffer | null> {
    if (data instanceof ArrayBuffer) {
      return data;
    }
    if (data instanceof Blob) {
      return data.arrayBuffer();
    }
    return null;
  }
}
