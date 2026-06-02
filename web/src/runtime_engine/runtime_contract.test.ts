import { afterEach, describe, expect, it, vi } from "vitest";

import { BACKEND_REQUEST_ID_HEADER } from "@/shared/lib/backendRequest";
import {
  RUNTIME_VIDEO_REF_QUERY_AUTH_WARNING,
  RUNTIME_VIDEO_REF_SECURITY_WARNING_KEY,
  RUNTIME_VIDEO_REF_STREAM_BASE_URL_KEY,
  RUNTIME_VIDEO_REF_TOKEN_SCHEME_KEY,
} from "@/runtime_engine/runtimeContractParams";
import {
  approveRuntimeProviderSession,
  claimRuntimeProviderSessionToken,
  getRuntimeProviderRobotDescription,
  getRuntimeProviderSession,
  RUNTIME_SESSION_TOKEN_HEADER,
  TelemetryStreamKind,
  getRuntimeSessionStats,
  listRuntimeTelemetryChannels,
  listRuntimeVideoRefs,
  requestRuntimeProviderSession,
  startRuntimeProviderRecording,
  stopRuntimeProviderRecording,
} from "./runtime_contract";

describe("runtime_contract", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", originalFetch);
  });

  it("normalizes runtime telemetry payloads and forwards the session token header", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            channels: [
              {
                channel_id: "channel-1",
                name: "tf",
                source_id: "rust_adapter",
                stream_kind: "TF_EDGE_BATCH",
                drop_policy: "latest",
              },
              {
                channel_id: 2,
                name: "pose",
                source_id: "bridge",
                stream_kind: "RESOLVED_FRAME_POSE_BATCH",
              },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            video_refs: [
              {
                stream_id: "cam-main",
                channel_name: "front-camera",
                source_id: "video_gateway",
                codec: "h264",
                width: 1920,
                height: 1080,
                nominal_fps: 30,
              },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            active_transport: "websocket",
            total_ingested: 42,
            total_dropped: 3,
            drop_reasons: {
              backpressure: 2,
              invalid_frame: 1,
            },
            total_buffered_bytes: 4096,
            total_buffered_messages: 12,
            command_total: 4,
            ack_total: 4,
            channels: 2,
          }),
          { status: 200 }
        )
      );

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const sessionToken = "runtime-token";
    const [channelsResponse, videoRefsResponse, statsResponse] = await Promise.all([
      listRuntimeTelemetryChannels("demo session", { sessionToken }),
      listRuntimeVideoRefs("demo session", { sessionToken }),
      getRuntimeSessionStats("demo session", { sessionToken }),
    ]);

    expect(channelsResponse.channels).toEqual([
      expect.objectContaining({
        channel_id: "channel-1",
        stream_kind: TelemetryStreamKind.TF_EDGE_BATCH,
      }),
      expect.objectContaining({
        channel_id: 2,
        stream_kind: TelemetryStreamKind.POSE,
      }),
    ]);
    expect(videoRefsResponse.video_refs[0]).toEqual(
      expect.objectContaining({
        stream_id: "cam-main",
        nominal_fps: 30,
        metadata: {},
      })
    );
    expect(statsResponse).toEqual(
      expect.objectContaining({
        active_transport: "websocket",
        total_ingested: 42,
        total_dropped: 3,
        channels: 2,
      })
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      const headers = new Headers(call[1]?.headers as HeadersInit);
      expect(headers.get(RUNTIME_SESSION_TOKEN_HEADER)).toBe(sessionToken);
      expect(headers.get(BACKEND_REQUEST_ID_HEADER)).toBeTruthy();
    }
  });

  it("throws a descriptive error when the server returns an unknown stream kind", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            channels: [
              {
                channel_id: "bad-channel",
                name: "mystery",
                source_id: "custom",
                stream_kind: "NOT_A_REAL_KIND",
              },
            ],
          }),
          { status: 200 }
        )
      ) as unknown as typeof fetch
    );

    await expect(listRuntimeTelemetryChannels("demo-session")).rejects.toThrowError(
      "Unknown telemetry stream kind: NOT_A_REAL_KIND"
    );
  });

  it("sanitizes insecure query-auth runtime video metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            video_refs: [
              {
                stream_id: "cam-main",
                channel_name: "front-camera",
                source_id: "video_gateway",
                codec: "jpeg",
                width: 1280,
                height: 720,
                nominal_fps: 15,
                metadata: {
                  stream_base_url: "http://robot.local:8090/camera.jpg?token=secret&view=front",
                  token_scheme: "query",
                },
              },
            ],
          }),
          { status: 200 }
        )
      ) as unknown as typeof fetch
    );

    const response = await listRuntimeVideoRefs("demo-session");
    expect(response.video_refs[0]).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          [RUNTIME_VIDEO_REF_STREAM_BASE_URL_KEY]: "http://robot.local:8090/camera.jpg?view=front",
          [RUNTIME_VIDEO_REF_SECURITY_WARNING_KEY]: RUNTIME_VIDEO_REF_QUERY_AUTH_WARNING,
        }),
      })
    );
    expect(response.video_refs[0]?.metadata[RUNTIME_VIDEO_REF_TOKEN_SCHEME_KEY]).toBeUndefined();
  });

  it("normalizes runtime provider session flows", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            session_id: "provider-demo",
            state: "pending",
            provider_id: "dora.local",
            provider_display_name: "Dora Local",
            requested_capabilities: ["observe", "record", "video"],
            approved_capabilities: [],
            preferred_formats: ["json", "arrow_ipc"],
            granted_formats: [],
            connector_origin: "localhost",
            connector_version: "1.2.3",
            requested_at: "2026-04-10T09:00:00Z",
            approved_at: null,
            connected_at: null,
            disconnected_at: null,
            recording_state: "idle",
            recording_started_at: null,
            recording_label: null,
            requires_session_token: false,
            robot_id: null,
            robot_display_name: null,
            robot_description_available: false,
            audit_events: [
              {
                sequence: 1,
                occurred_at: "2026-04-10T09:00:00Z",
                event_type: "requested",
                actor: "connector",
                message: "Provider session requested approval.",
                metadata: {},
              },
            ],
            connector_claim_token: "claim-token",
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            session_id: "provider-demo",
            state: "approved",
            provider_id: "dora.local",
            provider_display_name: "Dora Local",
            requested_capabilities: ["observe", "record", "video"],
            approved_capabilities: ["observe", "record"],
            preferred_formats: ["json", "arrow_ipc"],
            granted_formats: ["json"],
            connector_origin: "localhost",
            connector_version: "1.2.3",
            requested_at: "2026-04-10T09:00:00Z",
            approved_at: "2026-04-10T09:01:00Z",
            connected_at: null,
            disconnected_at: null,
            recording_state: "idle",
            recording_started_at: null,
            recording_label: null,
            requires_session_token: true,
            robot_id: null,
            robot_display_name: null,
            robot_description_available: false,
            audit_events: [],
            session_token: "provider-token",
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            state: "approved",
            session_token: "provider-token",
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            session_id: "provider-demo",
            state: "connected",
            provider_id: "dora.local",
            provider_display_name: "Dora Local",
            requested_capabilities: ["observe", "record", "video"],
            approved_capabilities: ["observe", "record"],
            preferred_formats: ["json", "arrow_ipc"],
            granted_formats: ["json"],
            connector_origin: "localhost",
            connector_version: "1.2.3",
            requested_at: "2026-04-10T09:00:00Z",
            approved_at: "2026-04-10T09:01:00Z",
            connected_at: "2026-04-10T09:02:00Z",
            disconnected_at: null,
            recording_state: "idle",
            recording_started_at: null,
            recording_label: null,
            requires_session_token: true,
            robot_id: "openarm/baguette",
            robot_display_name: "Baguette Arm",
            robot_description_available: true,
            audit_events: [],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            robot_id: "openarm/baguette",
            robot_display_name: "Baguette Arm",
            source: {
              source_type: "github",
              uri: "https://github.com/enactic/openarm_description",
              urdf_xml: null,
              sha256: null,
              metadata: {},
            },
            joint_names: ["joint_1", "joint_2"],
            frame_names: ["base_link", "tool0"],
            metadata: {},
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            session_id: "provider-demo",
            state: "connected",
            provider_id: "dora.local",
            provider_display_name: "Dora Local",
            requested_capabilities: ["observe", "record", "video"],
            approved_capabilities: ["observe", "record"],
            preferred_formats: ["json", "arrow_ipc"],
            granted_formats: ["json"],
            connector_origin: "localhost",
            connector_version: "1.2.3",
            requested_at: "2026-04-10T09:00:00Z",
            approved_at: "2026-04-10T09:01:00Z",
            connected_at: "2026-04-10T09:02:00Z",
            disconnected_at: null,
            recording_state: "recording",
            recording_started_at: "2026-04-10T09:03:00Z",
            recording_label: "Live Observe",
            requires_session_token: true,
            robot_id: "openarm/baguette",
            robot_display_name: "Baguette Arm",
            robot_description_available: true,
            audit_events: [],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            session_id: "provider-demo",
            state: "connected",
            provider_id: "dora.local",
            provider_display_name: "Dora Local",
            requested_capabilities: ["observe", "record", "video"],
            approved_capabilities: ["observe", "record"],
            preferred_formats: ["json", "arrow_ipc"],
            granted_formats: ["json"],
            connector_origin: "localhost",
            connector_version: "1.2.3",
            requested_at: "2026-04-10T09:00:00Z",
            approved_at: "2026-04-10T09:01:00Z",
            connected_at: "2026-04-10T09:02:00Z",
            disconnected_at: null,
            recording_state: "idle",
            recording_started_at: null,
            recording_label: null,
            requires_session_token: true,
            robot_id: "openarm/baguette",
            robot_display_name: "Baguette Arm",
            robot_description_available: true,
            audit_events: [],
          }),
          { status: 200 }
        )
      );

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const requested = await requestRuntimeProviderSession("provider-demo", {
      provider_id: "dora.local",
      provider_display_name: "Dora Local",
      requested_capabilities: ["observe", "record", "video"],
      preferred_formats: ["json", "arrow_ipc"],
      connector_origin: "localhost",
      connector_version: "1.2.3",
    });
    const approved = await approveRuntimeProviderSession("provider-demo", {
      approved_capabilities: ["observe", "record"],
      granted_formats: ["json"],
    });
    const claimed = await claimRuntimeProviderSessionToken(
      "provider-demo",
      requested.connector_claim_token
    );
    const connected = await getRuntimeProviderSession("provider-demo", {
      sessionToken: approved.session_token,
    });
    const robot = await getRuntimeProviderRobotDescription("provider-demo", {
      sessionToken: approved.session_token,
    });
    const started = await startRuntimeProviderRecording("provider-demo", "Live Observe");
    const stopped = await stopRuntimeProviderRecording("provider-demo");

    expect(requested.state).toBe("pending");
    expect(requested.connector_claim_token).toBe("claim-token");
    expect(approved.session_token).toBe("provider-token");
    expect(claimed.session_token).toBe("provider-token");
    expect(connected.robot_id).toBe("openarm/baguette");
    expect(robot.source.source_type).toBe("github");
    expect(started.recording_state).toBe("recording");
    expect(stopped.recording_state).toBe("idle");

    expect(fetchMock).toHaveBeenCalledTimes(7);
    const approveHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers as HeadersInit);
    expect(approveHeaders.get("Content-Type")).toBe("application/json");
    const providerHeaders = new Headers(fetchMock.mock.calls[3]?.[1]?.headers as HeadersInit);
    expect(providerHeaders.get(RUNTIME_SESSION_TOKEN_HEADER)).toBe("provider-token");
  });
});
