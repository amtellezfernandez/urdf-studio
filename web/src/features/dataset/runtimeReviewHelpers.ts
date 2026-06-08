import type {
  RuntimeSessionStatsResponse,
  TelemetryChannelSnapshot,
} from "@/runtime_engine/runtime_contract";

export type RuntimeAdapterFamily =
  | "custom"
  | "rust_adapter"
  | "shared_memory_adapter"
  | "video_gateway"
  | "compatibility_bridge";

export type RuntimeAdapterStatus = {
  id: string;
  label: string;
  active: boolean;
};

export type RuntimeAdapterFamilyCount = {
  id: string;
  label: string;
  count: number;
};

export type RuntimeStatsAuditSnapshot = {
  captured_at_iso: string;
  session_id: string | null;
  auth: {
    token_configured: boolean;
  };
  backend: RuntimeSessionStatsResponse | null;
  adapters: {
    statuses: RuntimeAdapterStatus[];
    families: RuntimeAdapterFamilyCount[];
  };
  channels: Array<{
    channel_id: number | string;
    name: string;
    source_id: string;
    stream_kind: number;
    drop_policy: string | null;
  }>;
};

const RUNTIME_ADAPTER_FAMILY_LABELS: Record<RuntimeAdapterFamily, string> = {
  custom: "Custom",
  rust_adapter: "Rust Adapters",
  shared_memory_adapter: "Shared Memory",
  video_gateway: "Video Gateways",
  compatibility_bridge: "Compatibility Bridges",
};

const trimSourceId = (sourceId: string): string => sourceId.trim();

const collectSourceIds = (channels: TelemetryChannelSnapshot[]): string[] =>
  Array.from(
    new Set(
      channels
        .map((channel) => trimSourceId(channel.source_id))
        .filter((sourceId) => sourceId.length > 0)
    )
  );

export const inferRuntimeAdapterFamily = (sourceId: string): RuntimeAdapterFamily => {
  const normalized = sourceId.toLowerCase();
  if (normalized.includes("rust")) return "rust_adapter";
  if (
    normalized.includes("shared") ||
    normalized.includes("shm") ||
    normalized.includes("memory")
  ) {
    return "shared_memory_adapter";
  }
  if (
    normalized.includes("video") ||
    normalized.includes("camera") ||
    normalized.includes("webrtc")
  ) {
    return "video_gateway";
  }
  if (normalized.includes("bridge") || normalized.includes("ros")) {
    return "compatibility_bridge";
  }
  return "custom";
};

export const buildRuntimeAdapterStatus = (
  channels: TelemetryChannelSnapshot[],
  backendStats: RuntimeSessionStatsResponse | null
): RuntimeAdapterStatus[] => {
  const sourceIds = collectSourceIds(channels);
  const totalIngested = backendStats?.total_ingested ?? 0;
  const activeTransport = backendStats?.active_transport?.trim() ?? "";

  return [
    {
      id: "src",
      label: `Adapter Sources (${sourceIds.length})`,
      active: sourceIds.length > 0,
    },
    {
      id: "channels",
      label: "Envelope Lanes",
      active: channels.length > 0,
    },
    {
      id: "ingest",
      label: "Backend Ingest",
      active: totalIngested > 0 || activeTransport.length > 0,
    },
  ];
};

export const buildRuntimeAdapterFamilies = (
  channels: TelemetryChannelSnapshot[]
): RuntimeAdapterFamilyCount[] => {
  const counts: Record<RuntimeAdapterFamily, number> = {
    custom: 0,
    rust_adapter: 0,
    shared_memory_adapter: 0,
    video_gateway: 0,
    compatibility_bridge: 0,
  };

  collectSourceIds(channels).forEach((sourceId) => {
    counts[inferRuntimeAdapterFamily(sourceId)] += 1;
  });

  return [
    { id: "custom", label: RUNTIME_ADAPTER_FAMILY_LABELS.custom, count: counts.custom },
    { id: "rust", label: RUNTIME_ADAPTER_FAMILY_LABELS.rust_adapter, count: counts.rust_adapter },
    { id: "shm", label: RUNTIME_ADAPTER_FAMILY_LABELS.shared_memory_adapter, count: counts.shared_memory_adapter },
    { id: "video", label: RUNTIME_ADAPTER_FAMILY_LABELS.video_gateway, count: counts.video_gateway },
    { id: "bridge", label: RUNTIME_ADAPTER_FAMILY_LABELS.compatibility_bridge, count: counts.compatibility_bridge },
  ];
};

export const buildRuntimeStatsAuditSnapshot = ({
  capturedAtIso,
  sessionId,
  tokenConfigured,
  backendStats,
  channels,
}: {
  capturedAtIso: string;
  sessionId: string;
  tokenConfigured: boolean;
  backendStats: RuntimeSessionStatsResponse | null;
  channels: TelemetryChannelSnapshot[];
}): RuntimeStatsAuditSnapshot => ({
  captured_at_iso: capturedAtIso,
  session_id: sessionId.trim() || null,
  auth: {
    token_configured: tokenConfigured,
  },
  backend: backendStats,
  adapters: {
    statuses: buildRuntimeAdapterStatus(channels, backendStats),
    families: buildRuntimeAdapterFamilies(channels),
  },
  channels: channels.map((channel) => ({
    channel_id: channel.channel_id,
    name: channel.name,
    source_id: channel.source_id,
    stream_kind: channel.stream_kind,
    drop_policy: channel.drop_policy,
  })),
});
