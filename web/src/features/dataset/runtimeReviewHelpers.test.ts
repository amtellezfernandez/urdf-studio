import { describe, expect, it } from "vitest";

import type { RuntimeSessionStatsResponse, TelemetryChannelSnapshot } from "@/runtime_engine/runtime_contract";

import {
  buildRuntimeAdapterFamilies,
  buildRuntimeAdapterStatus,
  buildRuntimeStatsAuditSnapshot,
  inferRuntimeAdapterFamily,
} from "./runtimeReviewHelpers";

const TEST_CHANNELS: TelemetryChannelSnapshot[] = [
  {
    channel_id: "joints",
    name: "Joint State",
    source_id: "robot-rust-adapter",
    stream_kind: 5,
    drop_policy: "latest",
  },
  {
    channel_id: "camera",
    name: "Camera",
    source_id: "video-gateway",
    stream_kind: 7,
    drop_policy: null,
  },
];

const TEST_BACKEND_STATS: RuntimeSessionStatsResponse = {
  active_transport: "http_json_poll",
  total_ingested: 12,
  total_dropped: 2,
  drop_reasons: {
    frame_too_large: 1,
    buffer_budget: 1,
  },
  total_buffered_bytes: 2048,
  total_buffered_messages: 5,
  command_total: 3,
  ack_total: 3,
  channels: 2,
};

describe("runtimeReviewHelpers", () => {
  it("classifies adapter families from source ids", () => {
    expect(inferRuntimeAdapterFamily("robot-rust-adapter")).toBe("rust_adapter");
    expect(inferRuntimeAdapterFamily("shared-memory-camera")).toBe("shared_memory_adapter");
    expect(inferRuntimeAdapterFamily("camera-gateway")).toBe("video_gateway");
    expect(inferRuntimeAdapterFamily("ros-bridge")).toBe("legacy_bridge");
    expect(inferRuntimeAdapterFamily("custom-uplink")).toBe("custom");
  });

  it("derives backend-truthful adapter status and family counts", () => {
    expect(buildRuntimeAdapterStatus(TEST_CHANNELS, TEST_BACKEND_STATS)).toEqual([
      { id: "src", label: "Adapter Sources (2)", active: true },
      { id: "channels", label: "Envelope Lanes", active: true },
      { id: "ingest", label: "Backend Ingest", active: true },
    ]);

    expect(buildRuntimeAdapterFamilies(TEST_CHANNELS)).toEqual([
      { id: "custom", label: "Custom", count: 0 },
      { id: "rust", label: "Rust Adapters", count: 1 },
      { id: "shm", label: "Shared Memory", count: 0 },
      { id: "video", label: "Video Gateways", count: 1 },
      { id: "bridge", label: "Legacy Bridges", count: 0 },
    ]);
  });

  it("builds audit snapshots without legacy websocket-only transport fields", () => {
    const snapshot = buildRuntimeStatsAuditSnapshot({
      capturedAtIso: "2026-03-23T00:00:00Z",
      sessionId: "demo-session",
      tokenConfigured: true,
      backendStats: TEST_BACKEND_STATS,
      channels: TEST_CHANNELS,
    });

    expect(snapshot).toEqual(
      expect.objectContaining({
        captured_at_iso: "2026-03-23T00:00:00Z",
        session_id: "demo-session",
        auth: {
          token_configured: true,
        },
        backend: TEST_BACKEND_STATS,
      })
    );
    expect("ws_status" in snapshot).toBe(false);
    expect("fallback_chain" in snapshot).toBe(false);
    expect(snapshot.adapters.statuses[2]?.active).toBe(true);
  });
});
