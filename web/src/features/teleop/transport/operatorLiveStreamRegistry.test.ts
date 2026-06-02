import { describe, expect, it } from "vitest";

import { buildOperatorLiveStreamRegistrySnapshot } from "@/features/teleop/transport/operatorLiveStreamRegistry";
import type { OperatorProviderManifest } from "@/features/teleop/transport/operatorHelperApi";

describe("operatorLiveStreamRegistry", () => {
  it("associates live tracks with cameras and telemetry provenance", () => {
    const manifest = {
      cameraStreams: [
        {
          id: "camera-1",
          label: "Camera 1",
          kind: "rgbd",
          frameId: "camera-1",
          coordinateFrame: "robot_world",
          intrinsics: { width: 1, height: 1, fx: 1, fy: 1, ppx: 0, ppy: 0 },
          capabilities: { color: true, depth: true, pointCloud: true },
        },
      ],
      liveTransport: {
        type: "moq",
        relayUrl: "https://relay.test",
        namespace: "robot/test",
        tracks: [
          {
            id: "camera-1-video",
            kind: "video",
            trackName: "camera/camera-1/video",
            encoding: "h264",
            cameraId: "camera-1",
          },
          {
            id: "camera-1-cloud",
            kind: "pointCloud",
            trackName: "camera/camera-1/point-cloud",
            encoding: "pointcloud-f32-rgb-f32",
            cameraId: "camera-1",
          },
          {
            id: "joints",
            kind: "jointTelemetry",
            trackName: "telemetry/joints",
            encoding: "json",
          },
          {
            id: "can",
            kind: "canTelemetry",
            trackName: "telemetry/can",
            encoding: "socketcan-batch",
          },
        ],
      },
    } as OperatorProviderManifest;

    const registry = buildOperatorLiveStreamRegistrySnapshot(manifest);

    expect(registry.cameras[0]?.videoTrack?.trackName).toBe(
      "camera/camera-1/video",
    );
    expect(registry.cameras[0]?.pointCloudTrack?.trackName).toBe(
      "camera/camera-1/point-cloud",
    );
    expect(registry.liveTrackCount).toBe(4);
    expect(registry.telemetryTrackCount).toBe(2);
  });
});
