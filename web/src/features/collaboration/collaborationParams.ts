export const COLLABORATION_CLIENT_ID_STORAGE_KEY =
  "urdf-studio-collaboration-client-id";
export const COLLABORATION_CLIENT_ID_PREFIX = "urdf-web";
export const COLLABORATION_CLIENT_SEQUENCE_INITIAL = 0;
export const COLLABORATION_CLIENT_SEQUENCE_INCREMENT = 1;
export const COLLABORATION_URDF_REVISION_INITIAL = 0;
export const COLLABORATION_FALLBACK_RANDOM_RADIX = 36;
export const COLLABORATION_FALLBACK_RANDOM_PREFIX_START = 2;
export const COLLABORATION_WEBSOCKET_PROTOCOL = "urdf-collab";
export const COLLABORATION_WEBSOCKET_TOKEN_PROTOCOL_PREFIX =
  "urdf-collab-token-";
export const COLLABORATION_WEBSOCKET_UNAUTHORIZED_CLOSE_CODE = 4401;
export const COLLABORATION_LATENCY_TARGET_MS = 30;
export const COLLABORATION_LATENCY_CLOCK_SKEW_IGNORE_MS = 60_000;
export const COLLABORATION_URDF_SNAPSHOT_EVENT_TYPE = "urdf.snapshot";
export const COLLABORATION_URDF_SNAPSHOT_KIND = "urdf.snapshot.v1";
export const COLLABORATION_URDF_PATCH_EVENT_TYPE = "urdf.patch";
export const COLLABORATION_URDF_PATCH_KIND = "urdf.patch.v1";
export const COLLABORATION_URDF_SNAPSHOT_REQUEST_EVENT_TYPE =
  "urdf.snapshot.request";
export const COLLABORATION_URDF_SNAPSHOT_REQUEST_KIND =
  "urdf.snapshot.request.v1";
export const COLLABORATION_DEFAULT_URDF_FILENAME = "robot.urdf";
export const COLLABORATION_CONTENT_HASH_OFFSET = 2166136261;
export const COLLABORATION_CONTENT_HASH_PRIME = 16777619;
export const COLLABORATION_CONTENT_HASH_RADIX = 16;
export const COLLABORATION_HASH_BYTE_MASK = 0xff;
export const COLLABORATION_HASH_UNSIGNED_SHIFT = 0;
export const COLLABORATION_PATCH_MIN_BASE_BYTES = 1024;
export const COLLABORATION_PATCH_MAX_CHANGED_BYTES = 256 * 1024;
export const COLLABORATION_PATCH_MAX_SNAPSHOT_RATIO = 0.8;
export const COLLABORATION_PATCH_REVISION_INCREMENT = 1;
export const COLLABORATION_PATCH_MIN_INDEX = 0;
export const COLLABORATION_SESSION_ENDED_MESSAGE =
  "This sharing session is no longer live.";
export const COLLABORATION_URL_FALLBACK_BASE = "http://localhost";

export const COLLABORATION_TRANSPORT_PARAMS = {
  sessionTokenHeader: "X-URDF-Collaboration-Token",
  sessionFragmentParam: "collab",
  sessionTokenFragmentParam: "collabToken",
  clientIdQueryParam: "client_id",
} as const;
