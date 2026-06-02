import { OpenArmHfLiveDepthDecoder } from "@/features/teleop/perception/openArmHfLiveDepthDecoder";
import { OpenArmHfMseVideoTrack } from "@/features/teleop/perception/openArmHfLiveMse";
import * as openArmHfLiveConnectModule from "@/features/teleop/perception/vendor/openarm-connect-C3lO3qk6.js";
import {
  decodeOpenArmHfLiveJointTelemetry,
} from "@/features/teleop/perception/openArmHfLiveCan";
import {
  normalizeOpenArmHfLiveObservePath,
  OPENARM_HF_LIVE_BROWSER_DIRECT_ORIGIN_ENABLED,
  OPENARM_HF_LIVE_BLUE_CHANNEL_OFFSET,
  OPENARM_HF_LIVE_CAN_SOURCES,
  OPENARM_HF_LIVE_CAN_STATE_PATH_SUFFIX,
  OPENARM_HF_LIVE_CAN_TRACK_NAME,
  OPENARM_HF_LIVE_CANVAS_CONTEXT_OPTIONS,
  OPENARM_HF_LIVE_COLOR_CANVAS_FRAME_INTERVAL_MS,
  OPENARM_HF_LIVE_COLOR_CANVAS_STREAM_FPS,
  OPENARM_HF_LIVE_COLOR_MAX,
  OPENARM_HF_LIVE_DEFAULT_INTRINSICS,
  OPENARM_HF_LIVE_DEFAULT_WEBSOCKET_FALLBACK_ENABLED,
  OPENARM_HF_LIVE_DEPTH_MIN_VALID_RAW,
  OPENARM_HF_LIVE_DEPTH_TRACK_NAME,
  OPENARM_HF_LIVE_GREEN_CHANNEL_OFFSET,
  OPENARM_HF_LIVE_METADATA_TRACK_NAME,
  OPENARM_HF_LIVE_POINT_CLOUD_FRAME_INTERVAL_MS,
  OPENARM_HF_LIVE_POINT_CLOUD_PIXEL_STRIDE,
  OPENARM_HF_LIVE_POINT_COMPONENTS,
  OPENARM_HF_LIVE_REALSENSE_SOURCES,
  OPENARM_HF_LIVE_RECONNECT_DELAY_MS,
  OPENARM_HF_LIVE_RED_CHANNEL_OFFSET,
  OPENARM_HF_LIVE_RELAY_URL,
  OPENARM_HF_LIVE_RGBA_COMPONENTS,
  OPENARM_HF_LIVE_STATUS_CONNECTED,
  OPENARM_HF_LIVE_STATUS_CONNECTING,
  OPENARM_HF_LIVE_STATUS_PRIVATE_PROXY_REQUIRED,
  OPENARM_HF_LIVE_STATUS_WAITING_FOR_VIDEO,
  OPENARM_HF_LIVE_TRACK_NAMESPACE,
  OPENARM_HF_LIVE_TRACK_PRIORITY,
  OPENARM_HF_LIVE_VIDEO_TRACK_NAME,
  OPENARM_HF_LIVE_WEBSOCKET_FALLBACK_DELAY_MS,
  type OpenArmHfLiveCanSource,
  type OpenArmHfLiveRealSenseSource,
} from "@/features/teleop/perception/openArmHfLiveParams";
import { useOperatorPerceptionStore } from "@/features/teleop/perception/operatorPerceptionStore";
import type {
  OperatorCameraIntrinsics,
  OperatorPointCloudFrame,
} from "@/features/teleop/transport/operatorHelperApi";

type OpenArmHfLiveFramePayload =
  | ArrayBuffer
  | ArrayBufferView
  | Uint8Array;

type OpenArmHfLiveGroup = {
  readFrame: () => Promise<OpenArmHfLiveFramePayload | undefined>;
  close?: (error?: unknown) => void;
};

type OpenArmHfLiveTrack = {
  nextGroup?: () => Promise<OpenArmHfLiveGroup | undefined>;
  readFrame?: () => Promise<OpenArmHfLiveFramePayload | undefined>;
  close?: (error?: unknown) => void;
};

type OpenArmHfLiveConsumer = {
  subscribe: (trackName: string, priority: number) => OpenArmHfLiveTrack;
};

type OpenArmHfLiveSession = {
  consume: (namespace: string) => OpenArmHfLiveConsumer;
  close: () => void;
  closed?: Promise<void>;
};

type OpenArmHfLiveConnectOptions = {
  websocket: {
    enabled: boolean;
    delay: number;
  };
};

type OpenArmHfLiveConnectModule = {
  c: (
    url: URL,
    options: OpenArmHfLiveConnectOptions,
  ) => Promise<OpenArmHfLiveSession>;
  f?: (...pathSegments: string[]) => string;
};

type OpenArmHfLivePointCloudBuildInput = {
  source: OpenArmHfLiveRealSenseSource;
  sequence: number;
  sourceTsMs: number;
  intrinsics: OperatorCameraIntrinsics;
  depthSamples: Uint8Array | Uint16Array;
  depthWidth: number;
  depthHeight: number;
  depthIs10Bit: boolean;
  colorRgba: Uint8ClampedArray;
  gravity?: [number, number, number];
};

export type OpenArmHfLiveObserveOptions = {
  relayUrl?: string;
  realSenseSources?: readonly OpenArmHfLiveRealSenseSource[];
  canSources?: readonly OpenArmHfLiveCanSource[];
};

type OpenArmHfLiveRealSenseRuntime = {
  colorVideo: HTMLVideoElement;
  colorPlayer: OpenArmHfMseVideoTrack;
  colorPreviewCanvas: HTMLCanvasElement;
  colorPreviewCanvasContext: CanvasRenderingContext2D | null;
  colorPreviewCanvasStream: MediaStream | null;
  colorSampleCanvas: HTMLCanvasElement;
  colorSampleCanvasContext: CanvasRenderingContext2D | null;
  depthDecoder: OpenArmHfLiveDepthDecoder;
  intrinsics: OperatorCameraIntrinsics;
  gravity?: [number, number, number];
  sequence: number;
  videoPublished: boolean;
  cleanup: () => void;
};

type CapturableCanvasElement = HTMLCanvasElement & {
  captureStream?: (frameRate?: number) => MediaStream;
};

let activeRuntime: OpenArmHfLiveObserveRuntime | null = null;
let connectModuleLoaderForTest:
  | (() => Promise<OpenArmHfLiveConnectModule>)
  | null = null;

const cloneDefaultIntrinsics = (): OperatorCameraIntrinsics => ({
  fx: OPENARM_HF_LIVE_DEFAULT_INTRINSICS.fx,
  fy: OPENARM_HF_LIVE_DEFAULT_INTRINSICS.fy,
  ppx: OPENARM_HF_LIVE_DEFAULT_INTRINSICS.ppx,
  ppy: OPENARM_HF_LIVE_DEFAULT_INTRINSICS.ppy,
  width: OPENARM_HF_LIVE_DEFAULT_INTRINSICS.width,
  height: OPENARM_HF_LIVE_DEFAULT_INTRINSICS.height,
});

const toUint8Array = (payload: OpenArmHfLiveFramePayload): Uint8Array => {
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
};

const sleepOpenArmHfLive = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });

const buildOpenArmHfLiveRelayUrl = (
  relayUrl: string,
  path: string,
  shouldNormalizePath = true,
): URL => {
  const normalizedRelayUrl = relayUrl.replace(/\/+$/, "");
  const normalizedPath = shouldNormalizePath
    ? normalizeOpenArmHfLiveObservePath(path)
    : path.replace(/^\/+/, "");
  return new URL(
    normalizedPath
      ? `${normalizedRelayUrl}/${normalizedPath}`
      : `${normalizedRelayUrl}/`,
  );
};

const resolveOpenArmHfLiveTrackNamespace = (
  connectModule: OpenArmHfLiveConnectModule,
  namespace: string,
): string =>
  connectModule.f ? connectModule.f(namespace) : namespace;

const loadOpenArmHfLiveConnectModule =
  async (): Promise<OpenArmHfLiveConnectModule> => {
    if (connectModuleLoaderForTest) return connectModuleLoaderForTest();
    return openArmHfLiveConnectModule as unknown as OpenArmHfLiveConnectModule;
  };

const parseOpenArmHfLiveMetadata = (
  data: Uint8Array,
  currentIntrinsics: OperatorCameraIntrinsics,
): {
  intrinsics: OperatorCameraIntrinsics;
  gravity?: [number, number, number];
} => {
  const decoded = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
  const nextIntrinsics: OperatorCameraIntrinsics = { ...currentIntrinsics };
  const maybeNumber = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  const fx = maybeNumber(decoded.fx);
  const fy = maybeNumber(decoded.fy);
  const ppx = maybeNumber(decoded.ppx);
  const ppy = maybeNumber(decoded.ppy);
  const width = maybeNumber(decoded.width);
  const height = maybeNumber(decoded.height);
  if (fx !== null) nextIntrinsics.fx = fx;
  if (fy !== null) nextIntrinsics.fy = fy;
  if (ppx !== null) nextIntrinsics.ppx = ppx;
  if (ppy !== null) nextIntrinsics.ppy = ppy;
  if (width !== null) nextIntrinsics.width = width;
  if (height !== null) nextIntrinsics.height = height;

  const gravity = Array.isArray(decoded.gravity)
    ? decoded.gravity
        .slice(0, OPENARM_HF_LIVE_POINT_COMPONENTS)
        .map((entry) => maybeNumber(entry))
    : null;
  return {
    intrinsics: nextIntrinsics,
    gravity:
      gravity?.every((entry): entry is number => entry !== null) &&
      gravity.length === OPENARM_HF_LIVE_POINT_COMPONENTS
        ? [gravity[0], gravity[1], gravity[2]]
        : undefined,
  };
};

export const hasCompleteOpenArmHfLiveColorFrame = (
  colorRgba: Uint8ClampedArray | undefined,
  depthWidth: number,
  depthHeight: number,
): colorRgba is Uint8ClampedArray =>
  Boolean(colorRgba) &&
  colorRgba.length >= depthWidth * depthHeight * OPENARM_HF_LIVE_RGBA_COMPONENTS;

export const buildOpenArmHfLivePointCloudFrame = ({
  source,
  sequence,
  sourceTsMs,
  intrinsics,
  depthSamples,
  depthWidth,
  depthHeight,
  depthIs10Bit,
  colorRgba,
  gravity,
}: OpenArmHfLivePointCloudBuildInput): OperatorPointCloudFrame => {
  const stride = OPENARM_HF_LIVE_POINT_CLOUD_PIXEL_STRIDE;
  const maxPointCount =
    Math.ceil(depthWidth / stride) * Math.ceil(depthHeight / stride);
  const pointsXyzFlat = new Float32Array(
    maxPointCount * OPENARM_HF_LIVE_POINT_COMPONENTS,
  );
  const colorsRgbFlat = new Float32Array(
    maxPointCount * OPENARM_HF_LIVE_POINT_COMPONENTS,
  );
  const scaledFx = (intrinsics.fx * depthWidth) / intrinsics.width;
  const scaledFy = (intrinsics.fy * depthHeight) / intrinsics.height;
  const scaledPpx = (intrinsics.ppx * depthWidth) / intrinsics.width;
  const scaledPpy = (intrinsics.ppy * depthHeight) / intrinsics.height;
  const depthIntrinsics: OperatorCameraIntrinsics = {
    width: depthWidth,
    height: depthHeight,
    fx: scaledFx,
    fy: scaledFy,
    ppx: scaledPpx,
    ppy: scaledPpy,
  };
  let pointCount = 0;

  for (let row = 0; row < depthHeight; row += stride) {
    for (let column = 0; column < depthWidth; column += stride) {
      const sampleIndex = row * depthWidth + column;
      const rawDepth = depthSamples[sampleIndex];
      if (rawDepth < OPENARM_HF_LIVE_DEPTH_MIN_VALID_RAW) continue;
      const pointDepth = depthIs10Bit ? rawDepth : rawDepth << 4;
      const pointOffset = pointCount * OPENARM_HF_LIVE_POINT_COMPONENTS;
      pointsXyzFlat[pointOffset] =
        -((column - scaledPpx) * pointDepth) / scaledFx;
      pointsXyzFlat[pointOffset + 1] =
        -((row - scaledPpy) * pointDepth) / scaledFy;
      pointsXyzFlat[pointOffset + 2] = pointDepth;

      const colorOffset = sampleIndex * OPENARM_HF_LIVE_RGBA_COMPONENTS;
      colorsRgbFlat[pointOffset] =
        colorRgba[colorOffset + OPENARM_HF_LIVE_RED_CHANNEL_OFFSET] /
        OPENARM_HF_LIVE_COLOR_MAX;
      colorsRgbFlat[pointOffset + 1] =
        colorRgba[colorOffset + OPENARM_HF_LIVE_GREEN_CHANNEL_OFFSET] /
        OPENARM_HF_LIVE_COLOR_MAX;
      colorsRgbFlat[pointOffset + 2] =
        colorRgba[colorOffset + OPENARM_HF_LIVE_BLUE_CHANNEL_OFFSET] /
        OPENARM_HF_LIVE_COLOR_MAX;
      pointCount += 1;
    }
  }

  return {
    cameraId: source.cameraId,
    frameId: source.cameraId,
    coordinateFrame: "camera",
    sequence,
    sourceTsMs,
    intrinsics: depthIntrinsics,
    pointsXyz: [],
    colorsRgb: [],
    pointsXyzFlat: pointsXyzFlat.subarray(
      0,
      pointCount * OPENARM_HF_LIVE_POINT_COMPONENTS,
    ),
    colorsRgbFlat: colorsRgbFlat.subarray(
      0,
      pointCount * OPENARM_HF_LIVE_POINT_COMPONENTS,
    ),
    pointCount,
    cameraPose: {
      position: [...source.pose.position],
      rotationRpyDeg: [...source.pose.rotationRpyDeg],
      scale: source.pose.scale,
      worldFrame: source.pose.worldFrame,
      gravity,
      useGravityOrientation: source.pose.useGravityOrientation,
    },
  };
};

class OpenArmHfLiveObserveRuntime {
  private readonly sessions = new Set<OpenArmHfLiveSession>();
  private readonly cleanupCallbacks: Array<() => void> = [];
  private readonly relayUrl: string;
  private readonly realSenseSources: readonly OpenArmHfLiveRealSenseSource[];
  private readonly canSources: readonly OpenArmHfLiveCanSource[];
  private stopped = false;

  constructor(options: OpenArmHfLiveObserveOptions = {}) {
    this.relayUrl = options.relayUrl?.trim() || OPENARM_HF_LIVE_RELAY_URL;
    this.realSenseSources =
      options.realSenseSources && options.realSenseSources.length > 0
        ? options.realSenseSources
        : OPENARM_HF_LIVE_REALSENSE_SOURCES;
    this.canSources = options.canSources ?? OPENARM_HF_LIVE_CAN_SOURCES;
  }

  start(): void {
    void this.run().catch((error) => {
      if (this.stopped) return;
      this.setStatus(
        error instanceof Error
          ? `OpenArm live observe failed: ${error.message}`
          : "OpenArm live observe failed.",
      );
    });
  }

  stop(): void {
    this.stopped = true;
    for (const cleanup of this.cleanupCallbacks.splice(0)) cleanup();
    for (const session of this.sessions) session.close();
    this.sessions.clear();
  }

  private async run(): Promise<void> {
    const store = useOperatorPerceptionStore.getState();
    store.requestOpenArmHfLiveObserve();
    store.setOpenArmHfLiveObserveStatus(OPENARM_HF_LIVE_STATUS_CONNECTING);

    if (
      !OPENARM_HF_LIVE_BROWSER_DIRECT_ORIGIN_ENABLED ||
      this.realSenseSources.length === 0
    ) {
      store.setOpenArmHfLiveObserveStatus(
        OPENARM_HF_LIVE_STATUS_PRIVATE_PROXY_REQUIRED,
      );
      return;
    }

    const connectModule = await loadOpenArmHfLiveConnectModule();
    if (this.stopped) return;
    const tasks = [
      ...this.realSenseSources.map((source) =>
        this.observeRealSenseSource(connectModule, source),
      ),
      ...this.canSources.map((source) =>
        this.observeCanSource(connectModule, source),
      ),
    ];
    await Promise.allSettled(tasks);
  }

  private async observeRealSenseSource(
    connectModule: OpenArmHfLiveConnectModule,
    source: OpenArmHfLiveRealSenseSource,
  ): Promise<void> {
    let lastErrorMessage = "";
    while (!this.stopped) {
      try {
        await this.observeRealSenseConnection(connectModule, source);
        lastErrorMessage = "";
      } catch (error) {
        if (this.stopped) return;
        const message =
          error instanceof Error ? error.message : "unknown stream error";
        if (message !== lastErrorMessage) {
          this.setStatus(`${source.label}: ${message}`);
          lastErrorMessage = message;
        }
      }
      if (!this.stopped) await sleepOpenArmHfLive(OPENARM_HF_LIVE_RECONNECT_DELAY_MS);
    }
  }

  private async observeRealSenseConnection(
    connectModule: OpenArmHfLiveConnectModule,
    source: OpenArmHfLiveRealSenseSource,
  ): Promise<void> {
    const session = await this.connect(connectModule, source.path);
    const consumer = session.consume(
      resolveOpenArmHfLiveTrackNamespace(
        connectModule,
        source.namespace ?? OPENARM_HF_LIVE_TRACK_NAMESPACE,
      ),
    );
    const trackNames = source.trackNames ?? {
      video: OPENARM_HF_LIVE_VIDEO_TRACK_NAME,
      depth: OPENARM_HF_LIVE_DEPTH_TRACK_NAME,
      metadata: OPENARM_HF_LIVE_METADATA_TRACK_NAME,
    };
    const runtime = this.createRealSenseRuntime(source);
    const colorTrack = consumer.subscribe(
      trackNames.video,
      OPENARM_HF_LIVE_TRACK_PRIORITY,
    );
    const depthTrack = consumer.subscribe(
      trackNames.depth,
      OPENARM_HF_LIVE_TRACK_PRIORITY,
    );
    const metadataTrack = consumer.subscribe(
      trackNames.metadata,
      OPENARM_HF_LIVE_TRACK_PRIORITY,
    );
    const stopPointCloudPublishing = this.startPointCloudPublishing(source, runtime);
    const stopColorCanvasPublishing = this.startColorCanvasPublishing(source, runtime);
    const cleanupConnection = this.once(() => {
      stopPointCloudPublishing();
      stopColorCanvasPublishing();
      runtime.cleanup();
      session.close();
      this.sessions.delete(session);
    });
    const unregisterCleanup = this.addCleanup(cleanupConnection);
    this.setStatus(OPENARM_HF_LIVE_STATUS_WAITING_FOR_VIDEO);

    try {
      await Promise.all([
        this.readTrackLoop(colorTrack, (data) => {
          try {
            runtime.colorPlayer.onData(data);
            this.publishVideoFrame(source, runtime);
            this.setStatus(OPENARM_HF_LIVE_STATUS_CONNECTED);
          } catch (error) {
            this.setStatus(
              error instanceof Error
                ? error.message
                : "OpenArm live video failed.",
            );
          }
        }),
        this.readTrackLoop(depthTrack, (data) => {
          runtime.depthDecoder.onData(data);
        }),
        this.readTrackLoop(metadataTrack, (data) => {
          try {
            const metadata = parseOpenArmHfLiveMetadata(data, runtime.intrinsics);
            runtime.intrinsics = metadata.intrinsics;
            runtime.gravity = metadata.gravity ?? runtime.gravity;
          } catch {
            // Metadata is optional for point-cloud display; keep defaults on malformed frames.
          }
        }),
      ]);
    } finally {
      unregisterCleanup();
      cleanupConnection();
    }
  }

  private async observeCanSource(
    connectModule: OpenArmHfLiveConnectModule,
    source: OpenArmHfLiveCanSource,
  ): Promise<void> {
    while (!this.stopped) {
      try {
        const session = await this.connect(
          connectModule,
          `${normalizeOpenArmHfLiveObservePath(source.path)}${OPENARM_HF_LIVE_CAN_STATE_PATH_SUFFIX}`,
          false,
        );
        const track = session
          .consume(
            resolveOpenArmHfLiveTrackNamespace(
              connectModule,
              OPENARM_HF_LIVE_TRACK_NAMESPACE,
            ),
          )
          .subscribe(OPENARM_HF_LIVE_CAN_TRACK_NAME, OPENARM_HF_LIVE_TRACK_PRIORITY);
        await this.readTrackLoop(track, (data) => {
          const telemetry = decodeOpenArmHfLiveJointTelemetry(
            data,
            source.jointPrefix,
          );
          const sourceTsMs = Date.now();
          useOperatorPerceptionStore.getState().upsertActiveJointTelemetry(
            Object.fromEntries(
              Object.entries(telemetry).map(([jointName, state]) => [
                jointName,
                {
                  ...state,
                  sourceId: source.id,
                  sourceLabel: source.label,
                  sourceTsMs,
                },
              ]),
            ),
          );
        });
      } catch (error) {
        if (this.stopped) return;
        this.setStatus(
          error instanceof Error
            ? `${source.label}: ${error.message}`
            : `${source.label}: CAN stream failed.`,
        );
      }
      if (!this.stopped) await sleepOpenArmHfLive(OPENARM_HF_LIVE_RECONNECT_DELAY_MS);
    }
  }

  private async connect(
    connectModule: OpenArmHfLiveConnectModule,
    path: string,
    shouldNormalizePath = true,
  ): Promise<OpenArmHfLiveSession> {
    const session = await connectModule.c(
      buildOpenArmHfLiveRelayUrl(this.relayUrl, path, shouldNormalizePath),
      {
        websocket: {
          enabled: OPENARM_HF_LIVE_DEFAULT_WEBSOCKET_FALLBACK_ENABLED,
          delay: OPENARM_HF_LIVE_WEBSOCKET_FALLBACK_DELAY_MS,
        },
      },
    );
    this.sessions.add(session);
    return session;
  }

  private async readTrackLoop(
    track: OpenArmHfLiveTrack,
    onFrame: (data: Uint8Array) => void,
  ): Promise<void> {
    if (track.readFrame) {
      while (!this.stopped) {
        const frame = await track.readFrame();
        if (!frame) break;
        onFrame(toUint8Array(frame));
      }
      return;
    }

    while (!this.stopped) {
      const group = await track.nextGroup?.();
      if (!group) break;
      try {
        while (!this.stopped) {
          const frame = await group.readFrame();
          if (!frame) break;
          onFrame(toUint8Array(frame));
        }
      } finally {
        group.close?.();
      }
    }
  }

  private createRealSenseRuntime(
    source: OpenArmHfLiveRealSenseSource,
  ): OpenArmHfLiveRealSenseRuntime {
    const colorVideo = document.createElement("video");
    colorVideo.muted = true;
    colorVideo.playsInline = true;
    colorVideo.autoplay = true;
    colorVideo.style.cssText =
      "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;";
    document.body.appendChild(colorVideo);
    const colorPreviewCanvas = document.createElement("canvas");
    const colorSampleCanvas = document.createElement("canvas");
    const runtime: OpenArmHfLiveRealSenseRuntime = {
      colorVideo,
      colorPlayer: new OpenArmHfMseVideoTrack(colorVideo),
      colorPreviewCanvas,
      colorPreviewCanvasContext: colorPreviewCanvas.getContext(
        "2d",
        OPENARM_HF_LIVE_CANVAS_CONTEXT_OPTIONS,
      ) as CanvasRenderingContext2D | null,
      colorPreviewCanvasStream: null,
      colorSampleCanvas,
      colorSampleCanvasContext: colorSampleCanvas.getContext(
        "2d",
        OPENARM_HF_LIVE_CANVAS_CONTEXT_OPTIONS,
      ) as CanvasRenderingContext2D | null,
      depthDecoder: new OpenArmHfLiveDepthDecoder(),
      intrinsics: cloneDefaultIntrinsics(),
      sequence: 0,
      videoPublished: false,
      cleanup: () => undefined,
    };
    runtime.cleanup = this.once(() => {
      runtime.colorPlayer.destroy();
      runtime.depthDecoder.destroy();
      runtime.colorVideo.remove();
    });
    this.publishVideoFrame(source, runtime);
    return runtime;
  }

  private publishVideoFrame(
    source: OpenArmHfLiveRealSenseSource,
    runtime: OpenArmHfLiveRealSenseRuntime,
  ): void {
    if (runtime.videoPublished) return;
    const stream = this.resolveColorPreviewStream(runtime);
    if (!stream || stream.getVideoTracks().length === 0) return;
    useOperatorPerceptionStore.getState().upsertActiveCameraVideoFrame({
      sourceId: source.id,
      label: source.label,
      stream,
      mode: "live",
    });
    runtime.videoPublished = true;
  }

  private resolveColorPreviewStream(
    runtime: OpenArmHfLiveRealSenseRuntime,
  ): MediaStream | null {
    if (runtime.colorPreviewCanvasStream) return runtime.colorPreviewCanvasStream;
    const captureCanvasStream = (
      runtime.colorPreviewCanvas as CapturableCanvasElement
    ).captureStream;
    if (captureCanvasStream) {
      runtime.colorPreviewCanvasStream = captureCanvasStream.call(
        runtime.colorPreviewCanvas,
        OPENARM_HF_LIVE_COLOR_CANVAS_STREAM_FPS,
      );
      return runtime.colorPreviewCanvasStream;
    }
    const videoStream = runtime.colorPlayer.stream;
    return videoStream && videoStream.getVideoTracks().length > 0
      ? videoStream
      : null;
  }

  private startColorCanvasPublishing(
    source: OpenArmHfLiveRealSenseSource,
    runtime: OpenArmHfLiveRealSenseRuntime,
  ): () => void {
    const intervalId = window.setInterval(() => {
      this.drawColorVideoToCanvas(
        runtime.colorPreviewCanvas,
        runtime.colorPreviewCanvasContext,
        runtime.colorVideo,
      );
      this.publishVideoFrame(source, runtime);
    }, OPENARM_HF_LIVE_COLOR_CANVAS_FRAME_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }

  private startPointCloudPublishing(
    source: OpenArmHfLiveRealSenseSource,
    runtime: OpenArmHfLiveRealSenseRuntime,
  ): () => void {
    const intervalId = window.setInterval(() => {
      this.publishPointCloudFrame(source, runtime);
    }, OPENARM_HF_LIVE_POINT_CLOUD_FRAME_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }

  private publishPointCloudFrame(
    source: OpenArmHfLiveRealSenseSource,
    runtime: OpenArmHfLiveRealSenseRuntime,
  ): void {
    if (
      !runtime.depthDecoder.latestY ||
      runtime.depthDecoder.width <= 0 ||
      runtime.depthDecoder.height <= 0
    ) {
      return;
    }
    const colorRgba = this.readColorFrameRgba(runtime);
    if (
      !hasCompleteOpenArmHfLiveColorFrame(
        colorRgba,
        runtime.depthDecoder.width,
        runtime.depthDecoder.height,
      )
    ) {
      return;
    }
    const frame = buildOpenArmHfLivePointCloudFrame({
      source,
      sequence: runtime.sequence,
      sourceTsMs: Date.now(),
      intrinsics: runtime.intrinsics,
      depthSamples: runtime.depthDecoder.latestY,
      depthWidth: runtime.depthDecoder.width,
      depthHeight: runtime.depthDecoder.height,
      depthIs10Bit: runtime.depthDecoder.is10bit,
      colorRgba,
      gravity: runtime.gravity,
    });
    runtime.sequence += 1;
    useOperatorPerceptionStore.getState().upsertActivePointCloudFrame(frame);
    this.publishVideoFrame(source, runtime);
  }

  private readColorFrameRgba(
    runtime: OpenArmHfLiveRealSenseRuntime,
  ): Uint8ClampedArray | undefined {
    const { width, height } = runtime.depthDecoder;
    if (
      !this.drawColorVideoToCanvas(
        runtime.colorSampleCanvas,
        runtime.colorSampleCanvasContext,
        runtime.colorVideo,
        width,
        height,
      )
    ) {
      return undefined;
    }
    return runtime.colorSampleCanvasContext?.getImageData(0, 0, width, height).data;
  }

  private drawColorVideoToCanvas(
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D | null,
    video: HTMLVideoElement,
    targetWidth?: number,
    targetHeight?: number,
  ): boolean {
    const width = targetWidth ?? video.videoWidth;
    const height = targetHeight ?? video.videoHeight;
    if (
      !context ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      video.videoWidth <= 0 ||
      width <= 0 ||
      height <= 0
    ) {
      return false;
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.drawImage(video, 0, 0, width, height);
    return true;
  }

  private setStatus(status: string): void {
    useOperatorPerceptionStore.getState().setOpenArmHfLiveObserveStatus(status);
  }

  private addCleanup(cleanup: () => void): () => void {
    this.cleanupCallbacks.push(cleanup);
    return () => {
      const index = this.cleanupCallbacks.indexOf(cleanup);
      if (index >= 0) this.cleanupCallbacks.splice(index, 1);
    };
  }

  private once(callback: () => void): () => void {
    let didRun = false;
    return () => {
      if (didRun) return;
      didRun = true;
      callback();
    };
  }
}

export const __setOpenArmHfLiveConnectModuleLoaderForTest = (
  loader: (() => Promise<OpenArmHfLiveConnectModule>) | null,
): void => {
  connectModuleLoaderForTest = loader;
};

export const startOpenArmHfLiveObserve = (
  options: OpenArmHfLiveObserveOptions = {},
): void => {
  if (typeof window === "undefined") return;
  if (activeRuntime) return;
  activeRuntime = new OpenArmHfLiveObserveRuntime(options);
  activeRuntime.start();
};

export const stopOpenArmHfLiveObserve = (): void => {
  activeRuntime?.stop();
  activeRuntime = null;
  useOperatorPerceptionStore.getState().clearOpenArmHfLiveObserveRequest();
};
