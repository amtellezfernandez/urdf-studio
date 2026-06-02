import { describe, expect, it } from "vitest";

import { normalizeLiveTransportDescriptor } from "@/features/live-transport/liveTransportCodec";

describe("liveTransportCodec", () => {
  it("accepts private MoQ live transport descriptors and drops unsupported tracks", () => {
    expect(
      normalizeLiveTransportDescriptor({
        type: "moq",
        relay_url: "https://relay.test",
        namespace: "robot/openarm",
        connect_module_path: "/robot-gateway/connect-module.js",
        tracks: [
          {
            id: "camera-1-cloud",
            kind: "point_cloud",
            track_name: "camera/camera-1/point-cloud",
            encoding: "pointcloud-f32-rgb-f32",
            camera_id: "camera-1",
          },
          {
            id: "unknown-track",
            kind: "unsupported",
            track_name: "camera/camera-1/unsupported",
            encoding: "json",
          },
        ],
      }),
    ).toEqual({
      type: "moq",
      relayUrl: "https://relay.test",
      namespace: "robot/openarm",
      connectModulePath: "/robot-gateway/connect-module.js",
      tracks: [
        {
          id: "camera-1-cloud",
          kind: "pointCloud",
          trackName: "camera/camera-1/point-cloud",
          encoding: "pointcloud-f32-rgb-f32",
          sourceId: null,
          cameraId: "camera-1",
          busId: null,
        },
      ],
    });
  });

  it("rejects anonymous public live transport namespaces", () => {
    expect(
      normalizeLiveTransportDescriptor({
        type: "moq",
        relay_url: "https://relay.test",
        namespace: "anon/openarm",
        tracks: [],
      }),
    ).toBeNull();
  });

  it("rejects anonymous public live transport relay paths", () => {
    expect(
      normalizeLiveTransportDescriptor({
        type: "moq",
        relay_url: "https://relay.test/anon",
        namespace: "robot/openarm",
        tracks: [],
      }),
    ).toBeNull();
  });
});
