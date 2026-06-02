import { findLiveTracksByKind } from "@/features/live-transport/liveTransportTypes";
import type { LiveTrackDescriptor } from "@/features/live-transport/liveTransportTypes";
import type {
  OperatorCameraStream,
  OperatorProviderManifest,
} from "@/features/teleop/transport/operatorHelperApi";

export type OperatorCameraLiveStreamSource = {
  camera: OperatorCameraStream;
  tracks: LiveTrackDescriptor[];
  videoTrack: LiveTrackDescriptor | null;
  depthTrack: LiveTrackDescriptor | null;
  metadataTrack: LiveTrackDescriptor | null;
  pointCloudTrack: LiveTrackDescriptor | null;
};

export type OperatorLiveStreamRegistrySnapshot = {
  cameras: OperatorCameraLiveStreamSource[];
  jointTelemetryTracks: LiveTrackDescriptor[];
  canTelemetryTracks: LiveTrackDescriptor[];
  robotStateTracks: LiveTrackDescriptor[];
  liveTrackCount: number;
  telemetryTrackCount: number;
};

const trackMatchesCamera = (
  track: LiveTrackDescriptor,
  camera: OperatorCameraStream,
): boolean => track.cameraId === camera.id || track.sourceId === camera.id;

const findCameraTrack = (
  tracks: LiveTrackDescriptor[],
  kind: LiveTrackDescriptor["kind"],
): LiveTrackDescriptor | null =>
  tracks.find((track) => track.kind === kind) ?? null;

export const buildOperatorLiveStreamRegistrySnapshot = (
  manifest: OperatorProviderManifest | null,
): OperatorLiveStreamRegistrySnapshot => {
  const liveTransport = manifest?.liveTransport ?? null;
  const liveTracks = liveTransport?.tracks ?? [];
  const cameras =
    manifest?.cameraStreams.map((camera) => {
      const tracks = liveTracks.filter((track) =>
        trackMatchesCamera(track, camera),
      );
      return {
        camera,
        tracks,
        videoTrack: findCameraTrack(tracks, "video"),
        depthTrack: findCameraTrack(tracks, "depth"),
        metadataTrack: findCameraTrack(tracks, "metadata"),
        pointCloudTrack: findCameraTrack(tracks, "pointCloud"),
      };
    }) ?? [];
  const jointTelemetryTracks = findLiveTracksByKind(
    liveTransport,
    "jointTelemetry",
  );
  const canTelemetryTracks = findLiveTracksByKind(
    liveTransport,
    "canTelemetry",
  );
  const robotStateTracks = findLiveTracksByKind(liveTransport, "robotState");
  return {
    cameras,
    jointTelemetryTracks,
    canTelemetryTracks,
    robotStateTracks,
    liveTrackCount: liveTracks.length,
    telemetryTrackCount:
      jointTelemetryTracks.length +
      canTelemetryTracks.length +
      robotStateTracks.length,
  };
};
