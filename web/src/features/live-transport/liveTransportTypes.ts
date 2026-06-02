export type LiveTrackKind =
  | "video"
  | "depth"
  | "metadata"
  | "pointCloud"
  | "jointTelemetry"
  | "canTelemetry"
  | "robotState"
  | "presence"
  | "cursor"
  | "viewport"
  | "sceneDelta";

export type LiveTrackDescriptor = {
  id: string;
  kind: LiveTrackKind;
  trackName: string;
  encoding: string;
  sourceId?: string | null;
  cameraId?: string | null;
  busId?: string | null;
};

export type LiveTransportDescriptor = {
  type: "moq";
  relayUrl: string;
  namespace: string;
  connectModulePath?: string | null;
  tracks: LiveTrackDescriptor[];
};

export const findLiveTracksByKind = (
  liveTransport: LiveTransportDescriptor | null | undefined,
  kind: LiveTrackKind,
): LiveTrackDescriptor[] =>
  liveTransport?.tracks.filter((track) => track.kind === kind) ?? [];

export const findLiveTracksForCamera = (
  liveTransport: LiveTransportDescriptor | null | undefined,
  cameraId: string,
): LiveTrackDescriptor[] =>
  liveTransport?.tracks.filter(
    (track) => track.cameraId === cameraId || track.sourceId === cameraId,
  ) ?? [];
