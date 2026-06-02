// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __setOpenArmHfLiveConnectModuleLoaderForTest,
  buildOpenArmHfLivePointCloudFrame,
  hasCompleteOpenArmHfLiveColorFrame,
  startOpenArmHfLiveObserve,
  stopOpenArmHfLiveObserve,
} from "@/features/teleop/perception/openArmHfLiveObserveClient";
import {
  OPENARM_HF_LIVE_BAGUETTE_REALSENSE_PATH,
  OPENARM_HF_LIVE_CAMERA_ID,
  OPENARM_HF_LIVE_REAL_SENSE_POSE,
  OPENARM_HF_LIVE_REALSENSE_SOURCES,
  OPENARM_HF_LIVE_RGBA_COMPONENTS,
  OPENARM_HF_LIVE_STATUS_IDLE,
  OPENARM_HF_LIVE_STATUS_WAITING_FOR_VIDEO,
  OPENARM_HF_LIVE_TRACK_PRIORITY,
} from "@/features/teleop/perception/openArmHfLiveParams";
import { useOperatorPerceptionStore } from "@/features/teleop/perception/operatorPerceptionStore";

const TEST_INTRINSICS = {
  width: 2,
  height: 2,
  fx: 2,
  fy: 2,
  ppx: 1,
  ppy: 1,
} as const;

const TEST_SOURCE_TS_MS = 12_345;
const TEST_SEQUENCE = 7;
const TEST_RAW_DEPTH = 16;
const TEST_EXPECTED_VERTICAL_POINT = 8;
const TEST_COLOR_MAX = 255;
const TEST_COLOR_PATTERN_OFFSET = 1;
const TEST_INCOMPLETE_COLOR_FRAME_MISSING_BYTE_COUNT = 1;
const TEST_SCALED_DEPTH_INTRINSICS = {
  width: 4,
  height: 2,
  fx: 4,
  fy: 2,
  ppx: 2,
  ppy: 1,
} as const;

const buildTestColorRgba = (width: number, height: number): Uint8ClampedArray =>
  new Uint8ClampedArray(
    Array.from(
      { length: width * height * OPENARM_HF_LIVE_RGBA_COMPONENTS },
      (_entry, index) =>
        (index + TEST_COLOR_PATTERN_OFFSET) %
        (TEST_COLOR_MAX + TEST_COLOR_PATTERN_OFFSET),
    ),
  );

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

describe("openArmHfLiveObserveClient", () => {
  afterEach(() => {
    stopOpenArmHfLiveObserve();
    __setOpenArmHfLiveConnectModuleLoaderForTest(null);
    vi.restoreAllMocks();
  });

  it("connects to the public OpenArm RealSense video, depth, and metadata tracks", async () => {
    const subscriptions: Array<{ trackName: string; priority: number }> = [];
    const pendingTrackReads: Array<Deferred<undefined>> = [];
    const closeSession = vi.fn(() => {
      pendingTrackReads.splice(0).forEach((pending) => pending.resolve(undefined));
    });
    const connect = vi.fn(async () => ({
      consume: () => ({
        subscribe: (trackName: string, priority: number) => {
          subscriptions.push({ trackName, priority });
          return {
            nextGroup: () => {
              const pending = createDeferred<undefined>();
              pendingTrackReads.push(pending);
              return pending.promise;
            },
          };
        },
      }),
      close: closeSession,
    }));

    __setOpenArmHfLiveConnectModuleLoaderForTest(async () => ({
      c: connect,
      f: (...pathSegments: string[]) => pathSegments.join("/"),
    }));

    startOpenArmHfLiveObserve();

    await vi.waitFor(() => {
      expect(connect).toHaveBeenCalledOnce();
      expect(subscriptions.map((subscription) => subscription.trackName)).toEqual([
        "video",
        "depth",
        "metadata",
      ]);
    });

    const [connectUrl, connectOptions] = connect.mock.calls[0] as unknown as [
      URL,
      unknown,
    ];
    expect(connectUrl.toString()).toBe(
      `https://cdn.1ms.ai/${OPENARM_HF_LIVE_BAGUETTE_REALSENSE_PATH}`,
    );
    expect(connectOptions).toEqual({
      websocket: { enabled: true, delay: 2_000 },
    });
    expect(
      subscriptions.every(
        (subscription) => subscription.priority === OPENARM_HF_LIVE_TRACK_PRIORITY,
      ),
    ).toBe(true);
    expect(useOperatorPerceptionStore.getState().openArmHfLiveObserveStatus).toBe(
      OPENARM_HF_LIVE_STATUS_WAITING_FOR_VIDEO,
    );

    stopOpenArmHfLiveObserve();

    expect(closeSession).toHaveBeenCalledOnce();
    expect(useOperatorPerceptionStore.getState().openArmHfLiveObserveStatus).toBe(
      OPENARM_HF_LIVE_STATUS_IDLE,
    );
  });

  it("uses provider supplied relay, namespace, and track names when provided", async () => {
    const subscriptions: Array<{ trackName: string; priority: number }> = [];
    const consumedNamespaces: string[] = [];
    const pendingTrackReads: Array<Deferred<undefined>> = [];
    const closeSession = vi.fn(() => {
      pendingTrackReads.splice(0).forEach((pending) => pending.resolve(undefined));
    });
    const connect = vi.fn(async () => ({
      consume: (namespace: string) => {
        consumedNamespaces.push(namespace);
        return {
          subscribe: (trackName: string, priority: number) => {
            subscriptions.push({ trackName, priority });
            return {
              nextGroup: () => {
                const pending = createDeferred<undefined>();
                pendingTrackReads.push(pending);
                return pending.promise;
              },
            };
          },
        };
      },
      close: closeSession,
    }));

    __setOpenArmHfLiveConnectModuleLoaderForTest(async () => ({
      c: connect,
      f: (namespace: string) => `formatted:${namespace}`,
    }));

    startOpenArmHfLiveObserve({
      relayUrl: "https://relay.test",
      realSenseSources: [
        {
          id: "provider-realsense",
          cameraId: "provider-camera",
          label: "Provider camera",
          path: "",
          namespace: "robot/openarm",
          trackNames: {
            video: "camera/provider-camera/video",
            depth: "camera/provider-camera/depth",
            metadata: "camera/provider-camera/metadata",
          },
          pose: OPENARM_HF_LIVE_REAL_SENSE_POSE,
        },
      ],
    });

    await vi.waitFor(() => {
      expect(connect).toHaveBeenCalledOnce();
      expect(subscriptions.map((subscription) => subscription.trackName)).toEqual([
        "camera/provider-camera/video",
        "camera/provider-camera/depth",
        "camera/provider-camera/metadata",
      ]);
    });

    const [connectUrl] = connect.mock.calls[0] as unknown as [URL, unknown];
    expect(connectUrl.toString()).toBe("https://relay.test/");
    expect(consumedNamespaces).toEqual(["formatted:robot/openarm"]);

    stopOpenArmHfLiveObserve();

    expect(closeSession).toHaveBeenCalledOnce();
  });

  it("waits for complete color frames before publishing live point clouds", () => {
    expect(
      hasCompleteOpenArmHfLiveColorFrame(
        undefined,
        TEST_INTRINSICS.width,
        TEST_INTRINSICS.height,
      ),
    ).toBe(false);
    expect(
      hasCompleteOpenArmHfLiveColorFrame(
        new Uint8ClampedArray(
            TEST_INTRINSICS.width *
            TEST_INTRINSICS.height *
            OPENARM_HF_LIVE_RGBA_COMPONENTS -
            TEST_INCOMPLETE_COLOR_FRAME_MISSING_BYTE_COUNT,
        ),
        TEST_INTRINSICS.width,
        TEST_INTRINSICS.height,
      ),
    ).toBe(false);
    expect(
      hasCompleteOpenArmHfLiveColorFrame(
        buildTestColorRgba(TEST_INTRINSICS.width, TEST_INTRINSICS.height),
        TEST_INTRINSICS.width,
        TEST_INTRINSICS.height,
      ),
    ).toBe(true);
  });

  it("builds OpenArm point-cloud frames from decoded depth and camera color", () => {
    const frame = buildOpenArmHfLivePointCloudFrame({
      source: OPENARM_HF_LIVE_REALSENSE_SOURCES[0],
      sequence: TEST_SEQUENCE,
      sourceTsMs: TEST_SOURCE_TS_MS,
      intrinsics: TEST_INTRINSICS,
      depthSamples: new Uint16Array([
        0,
        TEST_RAW_DEPTH,
        TEST_RAW_DEPTH,
        TEST_RAW_DEPTH,
      ]),
      depthWidth: TEST_INTRINSICS.width,
      depthHeight: TEST_INTRINSICS.height,
      depthIs10Bit: true,
      colorRgba: new Uint8ClampedArray([
        0,
        0,
        0,
        TEST_COLOR_MAX,
        TEST_COLOR_MAX,
        0,
        0,
        TEST_COLOR_MAX,
        0,
        TEST_COLOR_MAX,
        0,
        TEST_COLOR_MAX,
        0,
        0,
        TEST_COLOR_MAX,
        TEST_COLOR_MAX,
      ]),
      gravity: [0, 1, 0],
    });

    expect(frame.cameraId).toBe(OPENARM_HF_LIVE_CAMERA_ID);
    expect(frame.coordinateFrame).toBe("camera");
    expect(frame.sequence).toBe(TEST_SEQUENCE);
    expect(frame.sourceTsMs).toBe(TEST_SOURCE_TS_MS);
    expect(frame.intrinsics).toEqual(TEST_INTRINSICS);
    expect(frame.pointCount).toBe(3);
    expect(Array.from(frame.pointsXyzFlat ?? [])).toEqual([
      expect.closeTo(0),
      expect.closeTo(TEST_EXPECTED_VERTICAL_POINT),
      expect.closeTo(TEST_RAW_DEPTH),
      expect.closeTo(TEST_EXPECTED_VERTICAL_POINT),
      expect.closeTo(0),
      expect.closeTo(TEST_RAW_DEPTH),
      expect.closeTo(0),
      expect.closeTo(0),
      expect.closeTo(TEST_RAW_DEPTH),
    ]);
    expect(Array.from(frame.colorsRgbFlat ?? [])).toEqual([
      expect.closeTo(1),
      expect.closeTo(0),
      expect.closeTo(0),
      expect.closeTo(0),
      expect.closeTo(1),
      expect.closeTo(0),
      expect.closeTo(0),
      expect.closeTo(0),
      expect.closeTo(1),
    ]);
    expect(frame.cameraPose?.gravity).toEqual([0, 1, 0]);
    expect(frame.cameraPose?.position).toEqual(OPENARM_HF_LIVE_REAL_SENSE_POSE.position);
    expect(frame.cameraPose?.rotationRpyDeg).toEqual(
      OPENARM_HF_LIVE_REAL_SENSE_POSE.rotationRpyDeg,
    );
    expect(frame.cameraPose?.worldFrame).toBe(OPENARM_HF_LIVE_REAL_SENSE_POSE.worldFrame);
  });

  it("publishes the effective depth intrinsics used to unproject point clouds", () => {
    const frame = buildOpenArmHfLivePointCloudFrame({
      source: OPENARM_HF_LIVE_REALSENSE_SOURCES[0],
      sequence: TEST_SEQUENCE,
      sourceTsMs: TEST_SOURCE_TS_MS,
      intrinsics: TEST_INTRINSICS,
      depthSamples: new Uint16Array([
        TEST_RAW_DEPTH,
        TEST_RAW_DEPTH,
        TEST_RAW_DEPTH,
        TEST_RAW_DEPTH,
        TEST_RAW_DEPTH,
        TEST_RAW_DEPTH,
        TEST_RAW_DEPTH,
        TEST_RAW_DEPTH,
      ]),
      depthWidth: TEST_SCALED_DEPTH_INTRINSICS.width,
      depthHeight: TEST_SCALED_DEPTH_INTRINSICS.height,
      depthIs10Bit: true,
      colorRgba: buildTestColorRgba(
        TEST_SCALED_DEPTH_INTRINSICS.width,
        TEST_SCALED_DEPTH_INTRINSICS.height,
      ),
    });

    expect(frame.intrinsics).toEqual(TEST_SCALED_DEPTH_INTRINSICS);
  });
});
