import type {
  LiveTrackDescriptor,
  LiveTrackKind,
  LiveTransportDescriptor,
} from "@/features/live-transport/liveTransportTypes";

const LIVE_TRANSPORT_TYPE_MOQ = "moq";
const LIVE_TRANSPORT_PUBLIC_ANON_PATH_PREFIX = "anon";
const LIVE_TRANSPORT_PUBLIC_ANON_RELAY_HOSTS = new Set([
  "cdn.1ms.ai",
  "cdn.moq.dev",
]);
const LIVE_TRACK_KIND_BY_WIRE_KIND: Record<string, LiveTrackKind> = {
  video: "video",
  depth: "depth",
  metadata: "metadata",
  pointCloud: "pointCloud",
  point_cloud: "pointCloud",
  jointTelemetry: "jointTelemetry",
  joint_telemetry: "jointTelemetry",
  canTelemetry: "canTelemetry",
  can_telemetry: "canTelemetry",
  robotState: "robotState",
  robot_state: "robotState",
  presence: "presence",
  cursor: "cursor",
  viewport: "viewport",
  sceneDelta: "sceneDelta",
  scene_delta: "sceneDelta",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readField = (
  value: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
): unknown => value[camelKey] ?? value[snakeKey];

const toTrimmedString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const toOptionalTrimmedString = (value: unknown): string | null => {
  const trimmed = toTrimmedString(value);
  return trimmed || null;
};

const normalizePathSegments = (path: string): string[] =>
  path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

const parseLiveTransportRelayHostAndPath = (
  relayUrl: string,
): { host: string; pathSegments: string[] } => {
  try {
    const parsed = new URL(relayUrl);
    return {
      host: parsed.hostname.trim().toLowerCase(),
      pathSegments: normalizePathSegments(parsed.pathname),
    };
  } catch {
    const [hostCandidate, ...pathSegments] = normalizePathSegments(relayUrl);
    return {
      host: hostCandidate?.split(":")[0]?.trim().toLowerCase() ?? "",
      pathSegments,
    };
  }
};

const isPublicAnonymousLiveTransportRelayUrl = (relayUrl: string): boolean => {
  const { host, pathSegments } = parseLiveTransportRelayHostAndPath(relayUrl);
  return (
    LIVE_TRANSPORT_PUBLIC_ANON_RELAY_HOSTS.has(host) ||
    pathSegments[0]?.toLowerCase() === LIVE_TRANSPORT_PUBLIC_ANON_PATH_PREFIX
  );
};

const isPublicAnonymousLiveTransportNamespace = (namespace: string): boolean =>
  normalizePathSegments(namespace)[0]?.toLowerCase() ===
  LIVE_TRANSPORT_PUBLIC_ANON_PATH_PREFIX;

const normalizeLiveTrackDescriptor = (
  value: unknown,
): LiveTrackDescriptor | null => {
  if (!isRecord(value)) return null;
  const kind =
    LIVE_TRACK_KIND_BY_WIRE_KIND[toTrimmedString(value.kind)] ?? null;
  const id = toTrimmedString(value.id);
  const trackName = toTrimmedString(readField(value, "trackName", "track_name"));
  const encoding = toTrimmedString(value.encoding);
  if (!kind || !id || !trackName || !encoding) return null;
  return {
    id,
    kind,
    trackName,
    encoding,
    sourceId: toOptionalTrimmedString(readField(value, "sourceId", "source_id")),
    cameraId: toOptionalTrimmedString(readField(value, "cameraId", "camera_id")),
    busId: toOptionalTrimmedString(readField(value, "busId", "bus_id")),
  };
};

export const normalizeLiveTransportDescriptor = (
  value: unknown,
): LiveTransportDescriptor | null => {
  if (!isRecord(value)) return null;
  if (toTrimmedString(value.type) !== LIVE_TRANSPORT_TYPE_MOQ) return null;

  const relayUrl = toTrimmedString(readField(value, "relayUrl", "relay_url"));
  const namespace = toTrimmedString(value.namespace);
  if (!relayUrl || !namespace) return null;
  if (
    isPublicAnonymousLiveTransportRelayUrl(relayUrl) ||
    isPublicAnonymousLiveTransportNamespace(namespace)
  ) {
    return null;
  }

  const tracks = Array.isArray(value.tracks)
    ? value.tracks.flatMap((track) => {
        const normalizedTrack = normalizeLiveTrackDescriptor(track);
        return normalizedTrack ? [normalizedTrack] : [];
      })
    : [];
  return {
    type: LIVE_TRANSPORT_TYPE_MOQ,
    relayUrl,
    namespace,
    connectModulePath: toOptionalTrimmedString(
      readField(value, "connectModulePath", "connect_module_path"),
    ),
    tracks,
  };
};
