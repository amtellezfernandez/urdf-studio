import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";
import {
  RUNTIME_VIDEO_REF_INSECURE_QUERY_KEYS,
  RUNTIME_VIDEO_REF_INSECURE_TOKEN_SCHEME,
  RUNTIME_VIDEO_REF_QUERY_AUTH_WARNING,
  RUNTIME_VIDEO_REF_SECURITY_WARNING_KEY,
  RUNTIME_VIDEO_REF_STREAM_BASE_URL_KEY,
  RUNTIME_VIDEO_REF_TOKEN_SCHEME_KEY,
} from "@/runtime_engine/runtimeContractParams";

export const RUNTIME_SESSION_TOKEN_HEADER = "X-Runtime-Session-Token";
const RUNTIME_SESSIONS_ENDPOINT = `${API_BASE_URL}/runtime/sessions`;
const RUNTIME_TELEMETRY_CHANNELS_ENDPOINT = "telemetry/channels";
const RUNTIME_VIDEO_REFS_ENDPOINT = "video_refs";
const RUNTIME_STATS_ENDPOINT = "stats";
const RUNTIME_PROVIDER_ENDPOINT = "provider";
const RUNTIME_PROVIDER_APPROVE_ENDPOINT = `${RUNTIME_PROVIDER_ENDPOINT}/approve`;
const RUNTIME_PROVIDER_CLAIM_ENDPOINT = `${RUNTIME_PROVIDER_ENDPOINT}/claim`;
const RUNTIME_PROVIDER_ROBOT_ENDPOINT = `${RUNTIME_PROVIDER_ENDPOINT}/robot`;
const RUNTIME_PROVIDER_RECORDING_START_ENDPOINT = `${RUNTIME_PROVIDER_ENDPOINT}/recording/start`;
const RUNTIME_PROVIDER_RECORDING_STOP_ENDPOINT = `${RUNTIME_PROVIDER_ENDPOINT}/recording/stop`;
const CORE_API_OPTIONS = {
  requiredBackends: ["core-api"] as const,
};

export enum TelemetryStreamKind {
  TF_EDGE_BATCH = 1,
  POSE = 2,
  MARKER_DELTA_BATCH = 3,
  JOINT_STATE_BATCH = 5,
  DIAGNOSTIC_EVENT = 7,
}

export type TelemetryChannelSnapshot = {
  channel_id: number | string;
  name: string;
  source_id: string;
  stream_kind: TelemetryStreamKind;
  drop_policy: string | null;
};

export type VideoRefSnapshot = {
  stream_id: string;
  channel_name: string;
  source_id: string;
  codec: string;
  width: number;
  height: number;
  nominal_fps: number;
  metadata: Record<string, unknown>;
};

export type RuntimeSessionStatsResponse = {
  active_transport: string | null;
  total_ingested: number;
  total_dropped: number;
  drop_reasons: Record<string, number>;
  total_buffered_bytes: number;
  total_buffered_messages: number;
  command_total: number;
  ack_total: number;
  channels: number;
};

export type RuntimeProviderCapability =
  | "observe"
  | "record"
  | "replay"
  | "video"
  | "logs"
  | "frames"
  | "commands";

export type RuntimeProviderStreamFormat = "json" | "arrow_ipc";
export type RuntimeProviderSessionState = "pending" | "approved" | "connected" | "disconnected";
export type RuntimeProviderRecordingState = "idle" | "recording";

export type RuntimeProviderAuditEvent = {
  sequence: number;
  occurred_at: string;
  event_type: string;
  actor: "operator" | "connector" | "system";
  message: string;
  metadata: Record<string, unknown>;
};

export type RuntimeProviderRobotSource = {
  source_type: "inline_urdf" | "github" | "url";
  uri: string | null;
  urdf_xml: string | null;
  sha256: string | null;
  metadata: Record<string, unknown>;
};

export type RuntimeProviderRobotDescription = {
  robot_id: string;
  robot_display_name: string;
  source: RuntimeProviderRobotSource;
  joint_names: string[];
  frame_names: string[];
  metadata: Record<string, unknown>;
};

export type RuntimeProviderSessionSnapshot = {
  session_id: string;
  state: RuntimeProviderSessionState;
  provider_id: string;
  provider_display_name: string;
  requested_capabilities: RuntimeProviderCapability[];
  approved_capabilities: RuntimeProviderCapability[];
  preferred_formats: RuntimeProviderStreamFormat[];
  granted_formats: RuntimeProviderStreamFormat[];
  connector_origin: string;
  connector_version: string;
  requested_at: string;
  approved_at: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  recording_state: RuntimeProviderRecordingState;
  recording_started_at: string | null;
  recording_label: string | null;
  requires_session_token: boolean;
  robot_id: string | null;
  robot_display_name: string | null;
  robot_description_available: boolean;
  audit_events: RuntimeProviderAuditEvent[];
};

export type RuntimeProviderApprovalResponse = RuntimeProviderSessionSnapshot & {
  session_token: string;
};

export type RuntimeProviderSessionRequestResponse = RuntimeProviderSessionSnapshot & {
  connector_claim_token: string;
};

export type RuntimeProviderClaimResponse = {
  state: RuntimeProviderSessionState;
  session_token: string | null;
};

type RuntimeSessionAuthOptions = {
  sessionToken?: string;
};

type RuntimeSessionRequestInit = RuntimeSessionAuthOptions & {
  method?: string;
  body?: string;
  headers?: HeadersInit;
};

type TelemetryChannelsResponse = {
  channels: TelemetryChannelSnapshot[];
};

type VideoRefsResponse = {
  video_refs: VideoRefSnapshot[];
};

const telemetryStreamKindNameMap: Record<string, TelemetryStreamKind> = {
  TF_EDGE_BATCH: TelemetryStreamKind.TF_EDGE_BATCH,
  RESOLVED_FRAME_POSE_BATCH: TelemetryStreamKind.POSE,
  POSE: TelemetryStreamKind.POSE,
  MARKER_DELTA_BATCH: TelemetryStreamKind.MARKER_DELTA_BATCH,
  JOINT_STATE_BATCH: TelemetryStreamKind.JOINT_STATE_BATCH,
  DIAGNOSTIC_EVENT: TelemetryStreamKind.DIAGNOSTIC_EVENT,
};

const PROVIDER_CAPABILITIES = new Set<RuntimeProviderCapability>([
  "observe",
  "record",
  "replay",
  "video",
  "logs",
  "frames",
  "commands",
]);
const PROVIDER_STREAM_FORMATS = new Set<RuntimeProviderStreamFormat>(["json", "arrow_ipc"]);
const PROVIDER_SESSION_STATES = new Set<RuntimeProviderSessionState>([
  "pending",
  "approved",
  "connected",
  "disconnected",
]);
const PROVIDER_RECORDING_STATES = new Set<RuntimeProviderRecordingState>(["idle", "recording"]);
const PROVIDER_AUDIT_ACTORS = new Set<RuntimeProviderAuditEvent["actor"]>([
  "operator",
  "connector",
  "system",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isTelemetryStreamKind = (value: unknown): value is TelemetryStreamKind =>
  value === TelemetryStreamKind.TF_EDGE_BATCH ||
  value === TelemetryStreamKind.POSE ||
  value === TelemetryStreamKind.MARKER_DELTA_BATCH ||
  value === TelemetryStreamKind.JOINT_STATE_BATCH ||
  value === TelemetryStreamKind.DIAGNOSTIC_EVENT;

const toFiniteNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const toTrimmedString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value.trim() : fallback;

const normalizeStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];

const sanitizeVideoRefMetadata = (metadata: Record<string, unknown>): Record<string, unknown> => {
  const sanitized = { ...metadata };
  const warnings = new Set<string>();

  const tokenScheme = sanitized[RUNTIME_VIDEO_REF_TOKEN_SCHEME_KEY];
  if (
    typeof tokenScheme === "string" &&
    tokenScheme.trim().toLowerCase() === RUNTIME_VIDEO_REF_INSECURE_TOKEN_SCHEME
  ) {
    delete sanitized[RUNTIME_VIDEO_REF_TOKEN_SCHEME_KEY];
    warnings.add(RUNTIME_VIDEO_REF_QUERY_AUTH_WARNING);
  }

  const streamBaseUrl = sanitized[RUNTIME_VIDEO_REF_STREAM_BASE_URL_KEY];
  if (typeof streamBaseUrl === "string" && streamBaseUrl.trim().length > 0) {
    try {
      const parsed = new URL(streamBaseUrl);
      for (const key of Array.from(parsed.searchParams.keys())) {
        if (RUNTIME_VIDEO_REF_INSECURE_QUERY_KEYS.has(key.trim().toLowerCase())) {
          parsed.searchParams.delete(key);
          warnings.add(RUNTIME_VIDEO_REF_QUERY_AUTH_WARNING);
        }
      }
      sanitized[RUNTIME_VIDEO_REF_STREAM_BASE_URL_KEY] = parsed.toString();
    } catch {
      // Preserve non-URL metadata values as-is.
    }
  }

  if (warnings.size > 0) {
    sanitized[RUNTIME_VIDEO_REF_SECURITY_WARNING_KEY] = Array.from(warnings).join(",");
  }

  return sanitized;
};

const normalizeStreamKind = (value: unknown): TelemetryStreamKind => {
  if (isTelemetryStreamKind(value)) return value;
  if (typeof value === "string") {
    const normalized = telemetryStreamKindNameMap[value.trim().toUpperCase()];
    if (normalized !== undefined) return normalized;
  }
  throw new Error(`Unknown telemetry stream kind: ${String(value)}`);
};

const normalizeProviderCapabilities = (value: unknown): RuntimeProviderCapability[] =>
  normalizeStringArray(value).map((capability) => {
    if (!PROVIDER_CAPABILITIES.has(capability as RuntimeProviderCapability)) {
      throw new Error(`Unknown provider capability: ${capability}`);
    }
    return capability as RuntimeProviderCapability;
  });

const normalizeProviderStreamFormats = (value: unknown): RuntimeProviderStreamFormat[] =>
  normalizeStringArray(value).map((format) => {
    if (!PROVIDER_STREAM_FORMATS.has(format as RuntimeProviderStreamFormat)) {
      throw new Error(`Unknown provider stream format: ${format}`);
    }
    return format as RuntimeProviderStreamFormat;
  });

const normalizeProviderSessionState = (value: unknown): RuntimeProviderSessionState => {
  if (typeof value === "string" && PROVIDER_SESSION_STATES.has(value as RuntimeProviderSessionState)) {
    return value as RuntimeProviderSessionState;
  }
  throw new Error(`Unknown provider session state: ${String(value)}`);
};

const normalizeProviderRecordingState = (value: unknown): RuntimeProviderRecordingState => {
  if (
    typeof value === "string" &&
    PROVIDER_RECORDING_STATES.has(value as RuntimeProviderRecordingState)
  ) {
    return value as RuntimeProviderRecordingState;
  }
  throw new Error(`Unknown provider recording state: ${String(value)}`);
};

const normalizeProviderAuditEvent = (value: unknown): RuntimeProviderAuditEvent => {
  if (!isRecord(value)) {
    throw new Error("Runtime provider audit payload must be an object.");
  }
  const actor = toTrimmedString(value.actor);
  if (!PROVIDER_AUDIT_ACTORS.has(actor as RuntimeProviderAuditEvent["actor"])) {
    throw new Error(`Unknown provider audit actor: ${actor}`);
  }
  return {
    sequence: toFiniteNumber(value.sequence, 0),
    occurred_at: toTrimmedString(value.occurred_at),
    event_type: toTrimmedString(value.event_type),
    actor: actor as RuntimeProviderAuditEvent["actor"],
    message: toTrimmedString(value.message),
    metadata: isRecord(value.metadata) ? value.metadata : {},
  };
};

const normalizeProviderRobotSource = (value: unknown): RuntimeProviderRobotSource => {
  if (!isRecord(value)) {
    throw new Error("Runtime provider robot source payload must be an object.");
  }
  const sourceType = toTrimmedString(value.source_type);
  if (sourceType !== "inline_urdf" && sourceType !== "github" && sourceType !== "url") {
    throw new Error(`Unknown provider robot source type: ${sourceType}`);
  }
  return {
    source_type: sourceType,
    uri: typeof value.uri === "string" ? value.uri.trim() : null,
    urdf_xml: typeof value.urdf_xml === "string" ? value.urdf_xml : null,
    sha256: typeof value.sha256 === "string" ? value.sha256.trim() : null,
    metadata: isRecord(value.metadata) ? value.metadata : {},
  };
};

const normalizeProviderRobotDescription = (value: unknown): RuntimeProviderRobotDescription => {
  if (!isRecord(value)) {
    throw new Error("Runtime provider robot payload must be an object.");
  }
  return {
    robot_id: toTrimmedString(value.robot_id),
    robot_display_name: toTrimmedString(value.robot_display_name),
    source: normalizeProviderRobotSource(value.source),
    joint_names: normalizeStringArray(value.joint_names),
    frame_names: normalizeStringArray(value.frame_names),
    metadata: isRecord(value.metadata) ? value.metadata : {},
  };
};

const normalizeProviderSessionSnapshot = (value: unknown): RuntimeProviderSessionSnapshot => {
  if (!isRecord(value)) {
    throw new Error("Runtime provider session payload must be an object.");
  }
  return {
    session_id: toTrimmedString(value.session_id),
    state: normalizeProviderSessionState(value.state),
    provider_id: toTrimmedString(value.provider_id),
    provider_display_name: toTrimmedString(value.provider_display_name),
    requested_capabilities: normalizeProviderCapabilities(value.requested_capabilities),
    approved_capabilities: normalizeProviderCapabilities(value.approved_capabilities),
    preferred_formats: normalizeProviderStreamFormats(value.preferred_formats),
    granted_formats: normalizeProviderStreamFormats(value.granted_formats),
    connector_origin: toTrimmedString(value.connector_origin),
    connector_version: toTrimmedString(value.connector_version),
    requested_at: toTrimmedString(value.requested_at),
    approved_at: typeof value.approved_at === "string" ? value.approved_at.trim() : null,
    connected_at: typeof value.connected_at === "string" ? value.connected_at.trim() : null,
    disconnected_at: typeof value.disconnected_at === "string" ? value.disconnected_at.trim() : null,
    recording_state: normalizeProviderRecordingState(value.recording_state),
    recording_started_at:
      typeof value.recording_started_at === "string" ? value.recording_started_at.trim() : null,
    recording_label: typeof value.recording_label === "string" ? value.recording_label.trim() : null,
    requires_session_token: value.requires_session_token === true,
    robot_id: typeof value.robot_id === "string" ? value.robot_id.trim() : null,
    robot_display_name:
      typeof value.robot_display_name === "string" ? value.robot_display_name.trim() : null,
    robot_description_available: value.robot_description_available === true,
    audit_events: Array.isArray(value.audit_events)
      ? value.audit_events.map(normalizeProviderAuditEvent)
      : [],
  };
};

const buildRuntimeSessionUrl = (sessionId: string, endpoint: string): string =>
  `${RUNTIME_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}/${endpoint}`;

const buildAuthHeaders = (options?: RuntimeSessionAuthOptions): HeadersInit => {
  const sessionToken = options?.sessionToken?.trim();
  if (!sessionToken) return {};
  return {
    [RUNTIME_SESSION_TOKEN_HEADER]: sessionToken,
  };
};

const fetchRuntimeSession = (
  sessionId: string,
  endpoint: string,
  options?: RuntimeSessionRequestInit,
  context = "Runtime session request"
) => {
  const authHeaders = buildAuthHeaders(options);
  const extraHeaders = new Headers(options?.headers);
  Object.entries(authHeaders).forEach(([key, value]) => {
    if (value) {
      extraHeaders.set(key, String(value));
    }
  });
  return guardedFetch(
    buildRuntimeSessionUrl(sessionId, endpoint),
    {
      method: options?.method,
      body: options?.body,
      headers: extraHeaders,
    },
    {
      ...CORE_API_OPTIONS,
      context,
    }
  );
};

const parseJsonResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Runtime session request failed (${response.status}): ${detail || response.statusText}`
    );
  }
  return (await response.json()) as T;
};

const fetchRuntimeSessionJson = async <T>(
  sessionId: string,
  endpoint: string,
  payload: unknown,
  options?: RuntimeSessionAuthOptions,
  context = "Runtime session request"
): Promise<T> => {
  const response = await fetchRuntimeSession(
    sessionId,
    endpoint,
    {
      ...options,
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    },
    context
  );
  return parseJsonResponse<T>(response);
};

const normalizeTelemetryChannelSnapshot = (value: unknown): TelemetryChannelSnapshot => {
  if (!isRecord(value)) {
    throw new Error("Runtime telemetry channel payload must be an object.");
  }
  return {
    channel_id:
      typeof value.channel_id === "number" || typeof value.channel_id === "string"
        ? value.channel_id
        : "",
    name: toTrimmedString(value.name),
    source_id: toTrimmedString(value.source_id),
    stream_kind: normalizeStreamKind(value.stream_kind),
    drop_policy: typeof value.drop_policy === "string" ? value.drop_policy : null,
  };
};

const normalizeVideoRefSnapshot = (value: unknown): VideoRefSnapshot => {
  if (!isRecord(value)) {
    throw new Error("Runtime video ref payload must be an object.");
  }
  const metadata = sanitizeVideoRefMetadata(isRecord(value.metadata) ? value.metadata : {});
  return {
    stream_id: toTrimmedString(value.stream_id),
    channel_name: toTrimmedString(value.channel_name),
    source_id: toTrimmedString(value.source_id),
    codec: toTrimmedString(value.codec),
    width: toFiniteNumber(value.width, 0),
    height: toFiniteNumber(value.height, 0),
    nominal_fps: toFiniteNumber(value.nominal_fps, 0),
    metadata,
  };
};

const normalizeStatsResponse = (value: unknown): RuntimeSessionStatsResponse => {
  if (!isRecord(value)) {
    throw new Error("Runtime session stats payload must be an object.");
  }
  const rawDropReasons = isRecord(value.drop_reasons) ? value.drop_reasons : {};
  const drop_reasons = Object.fromEntries(
    Object.entries(rawDropReasons).map(([key, reasonCount]) => [key, toFiniteNumber(reasonCount, 0)])
  );
  return {
    active_transport: typeof value.active_transport === "string" ? value.active_transport : null,
    total_ingested: toFiniteNumber(value.total_ingested, 0),
    total_dropped: toFiniteNumber(value.total_dropped, 0),
    drop_reasons,
    total_buffered_bytes: toFiniteNumber(value.total_buffered_bytes, 0),
    total_buffered_messages: toFiniteNumber(value.total_buffered_messages, 0),
    command_total: toFiniteNumber(value.command_total, 0),
    ack_total: toFiniteNumber(value.ack_total, 0),
    channels: toFiniteNumber(value.channels, 0),
  };
};

export const listRuntimeTelemetryChannels = async (
  sessionId: string,
  options?: RuntimeSessionAuthOptions
): Promise<TelemetryChannelsResponse> => {
  const response = await fetchRuntimeSession(
    sessionId,
    RUNTIME_TELEMETRY_CHANNELS_ENDPOINT,
    options,
    "Runtime telemetry channels"
  );
  const payload = await parseJsonResponse<{ channels?: unknown }>(response);
  return {
    channels: Array.isArray(payload.channels)
      ? payload.channels.map(normalizeTelemetryChannelSnapshot)
      : [],
  };
};

export const listRuntimeVideoRefs = async (
  sessionId: string,
  options?: RuntimeSessionAuthOptions
): Promise<VideoRefsResponse> => {
  const response = await fetchRuntimeSession(
    sessionId,
    RUNTIME_VIDEO_REFS_ENDPOINT,
    options,
    "Runtime video refs"
  );
  const payload = await parseJsonResponse<{ video_refs?: unknown }>(response);
  return {
    video_refs: Array.isArray(payload.video_refs) ? payload.video_refs.map(normalizeVideoRefSnapshot) : [],
  };
};

export const getRuntimeSessionStats = async (
  sessionId: string,
  options?: RuntimeSessionAuthOptions
): Promise<RuntimeSessionStatsResponse> => {
  const response = await fetchRuntimeSession(
    sessionId,
    RUNTIME_STATS_ENDPOINT,
    options,
    "Runtime session stats"
  );
  const payload = await parseJsonResponse<unknown>(response);
  return normalizeStatsResponse(payload);
};

export const requestRuntimeProviderSession = async (
  sessionId: string,
  payload: {
    provider_id: string;
    provider_display_name?: string;
    requested_capabilities: RuntimeProviderCapability[];
    preferred_formats?: RuntimeProviderStreamFormat[];
    connector_origin?: string;
    connector_version?: string;
  },
  options?: RuntimeSessionAuthOptions
): Promise<RuntimeProviderSessionRequestResponse> => {
  const response = await fetchRuntimeSessionJson<unknown>(
    sessionId,
    RUNTIME_PROVIDER_ENDPOINT,
    {
      provider_id: payload.provider_id,
      provider_display_name: payload.provider_display_name ?? "",
      requested_capabilities: payload.requested_capabilities,
      preferred_formats: payload.preferred_formats ?? ["json"],
      connector_origin: payload.connector_origin ?? "",
      connector_version: payload.connector_version ?? "",
    },
    options,
    "Runtime provider session request"
  );
  const snapshot = normalizeProviderSessionSnapshot(response);
  if (
    !isRecord(response) ||
    typeof response.connector_claim_token !== "string" ||
    !response.connector_claim_token.trim()
  ) {
    throw new Error("Runtime provider request payload must include a connector claim token.");
  }
  return {
    ...snapshot,
    connector_claim_token: response.connector_claim_token.trim(),
  };
};

export const getRuntimeProviderSession = async (
  sessionId: string,
  options?: RuntimeSessionAuthOptions
): Promise<RuntimeProviderSessionSnapshot> => {
  const response = await fetchRuntimeSession(
    sessionId,
    RUNTIME_PROVIDER_ENDPOINT,
    options,
    "Runtime provider session"
  );
  const payload = await parseJsonResponse<unknown>(response);
  return normalizeProviderSessionSnapshot(payload);
};

export const approveRuntimeProviderSession = async (
  sessionId: string,
  payload: {
    approved_capabilities?: RuntimeProviderCapability[];
    granted_formats?: RuntimeProviderStreamFormat[];
  } = {},
  options?: RuntimeSessionAuthOptions
): Promise<RuntimeProviderApprovalResponse> => {
  const response = await fetchRuntimeSessionJson<unknown>(
    sessionId,
    RUNTIME_PROVIDER_APPROVE_ENDPOINT,
    payload,
    options,
    "Runtime provider approval"
  );
  const snapshot = normalizeProviderSessionSnapshot(response);
  if (!isRecord(response) || typeof response.session_token !== "string" || !response.session_token.trim()) {
    throw new Error("Runtime provider approval payload must include a session token.");
  }
  return {
    ...snapshot,
    session_token: response.session_token.trim(),
  };
};

export const claimRuntimeProviderSessionToken = async (
  sessionId: string,
  connectorClaimToken: string,
  options?: RuntimeSessionAuthOptions
): Promise<RuntimeProviderClaimResponse> => {
  const response = await fetchRuntimeSessionJson<unknown>(
    sessionId,
    RUNTIME_PROVIDER_CLAIM_ENDPOINT,
    { connector_claim_token: connectorClaimToken },
    options,
    "Runtime provider claim"
  );
  if (!isRecord(response)) {
    throw new Error("Runtime provider claim payload must be an object.");
  }
  return {
    state: normalizeProviderSessionState(response.state),
    session_token: typeof response.session_token === "string" ? response.session_token.trim() : null,
  };
};

export const getRuntimeProviderRobotDescription = async (
  sessionId: string,
  options?: RuntimeSessionAuthOptions
): Promise<RuntimeProviderRobotDescription> => {
  const response = await fetchRuntimeSession(
    sessionId,
    RUNTIME_PROVIDER_ROBOT_ENDPOINT,
    options,
    "Runtime provider robot description"
  );
  const payload = await parseJsonResponse<unknown>(response);
  return normalizeProviderRobotDescription(payload);
};

export const startRuntimeProviderRecording = async (
  sessionId: string,
  label = "",
  options?: RuntimeSessionAuthOptions
): Promise<RuntimeProviderSessionSnapshot> => {
  const response = await fetchRuntimeSessionJson<unknown>(
    sessionId,
    RUNTIME_PROVIDER_RECORDING_START_ENDPOINT,
    { label },
    options,
    "Runtime provider recording start"
  );
  return normalizeProviderSessionSnapshot(response);
};

export const stopRuntimeProviderRecording = async (
  sessionId: string,
  options?: RuntimeSessionAuthOptions
): Promise<RuntimeProviderSessionSnapshot> => {
  const response = await fetchRuntimeSessionJson<unknown>(
    sessionId,
    RUNTIME_PROVIDER_RECORDING_STOP_ENDPOINT,
    {},
    options,
    "Runtime provider recording stop"
  );
  return normalizeProviderSessionSnapshot(response);
};
