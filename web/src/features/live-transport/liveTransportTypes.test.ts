import { describe, expect, it } from "vitest";

import {
  findLiveTracksByKind,
  findLiveTracksForCamera,
  type LiveTransportDescriptor,
} from "@/features/live-transport/liveTransportTypes";

describe("liveTransportTypes", () => {
  it("selects live tracks by kind and camera provenance", () => {
    const liveTransport: LiveTransportDescriptor = {
      type: "moq",
      relayUrl: "https://relay.test",
      namespace: "robot/openarm",
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
      ],
    };

    expect(findLiveTracksByKind(liveTransport, "pointCloud")).toEqual([
      liveTransport.tracks[1],
    ]);
    expect(findLiveTracksForCamera(liveTransport, "camera-1")).toEqual([
      liveTransport.tracks[0],
      liveTransport.tracks[1],
    ]);
  });
});
