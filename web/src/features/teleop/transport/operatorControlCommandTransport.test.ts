import { afterEach, describe, expect, it, vi } from "vitest";

import type { OperatorControlDatagramClient } from "@/features/teleop/transport/operatorControlDatagramClient";
import {
  createOperatorControlCommandTransport,
  createOperatorDatagramControlCommandTransport,
  createOperatorRestControlCommandTransport,
} from "@/features/teleop/transport/operatorControlCommandTransport";
import type { OperatorControlTransportDescriptor } from "@/features/teleop/transport/operatorControlTransport";
import { OPERATOR_CONTROL_TRANSPORT_MESSAGES } from "@/features/teleop/params/operatorTeleopParams";

const TEST_CONTROL_DESCRIPTOR: OperatorControlTransportDescriptor = {
  type: "teleop_sidecar",
  manifestPath: "/teleop/manifest",
  statsPath: "/teleop/stats",
  webtransportUrl: "https://127.0.0.1:8092/teleop",
  nativeQuicAddress: "127.0.0.1:8093",
  nativeQuicAlpn: "urdf-teleop-quic-v1",
  sidecarReady: true,
  requiresLease: true,
  requiresTeleopCapability: true,
  teleopCapabilityVerifyPath:
    "/collaboration/sessions/{sessionId}/capabilities/verify",
  teleopCapabilityRequiredRole: "teleop_operator",
  teleopCapabilityTransport: "moq",
};
const TEST_COMMAND_METADATA = {
  command_kind: "twist",
  sequence: 7,
  source_ts_ms: 123,
} as const;
const TEST_AUTHORIZATION = {
  sessionId: "collab-session-a",
  teleopCapabilityToken: "teleop-capability-a",
} as const;
const TEST_OWNER_AUTHORIZATION = {
  sessionId: "collab-session-a",
  ownerToken: "owner-token-a",
} as const;
const TEST_REST_CONFIG = {
  baseUrl: "http://127.0.0.1:8000/robot-gateway",
} as const;

describe("operatorControlCommandTransport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses datagrams when a sidecar descriptor, active robot session, and teleop capability are available", () => {
    expect(
      createOperatorControlCommandTransport({
        controlTransport: TEST_CONTROL_DESCRIPTOR,
        sessionId: "robot-session-a",
        peerId: "operator-a",
        authorization: TEST_AUTHORIZATION,
      }).kind,
    ).toBe("datagram");
  });

  it("blocks commands when a sidecar requires teleop capability and no capability is available", async () => {
    const transport = createOperatorControlCommandTransport({
      controlTransport: TEST_CONTROL_DESCRIPTOR,
      sessionId: "robot-session-a",
      peerId: "operator-a",
    });

    expect(transport.kind).toBe("unavailable");
    await expect(
      transport.sendStop({ ...TEST_COMMAND_METADATA, command_kind: "stop" }),
    ).rejects.toThrow(OPERATOR_CONTROL_TRANSPORT_MESSAGES.capabilityRequired);
  });

  it("falls back to REST for owner-only collaboration authorization when datagrams require a teleop capability", async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          accepted: true,
          reason: "accepted",
          sequence: TEST_COMMAND_METADATA.sequence,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const transport = createOperatorControlCommandTransport({
      controlTransport: TEST_CONTROL_DESCRIPTOR,
      sessionId: "robot-session-a",
      peerId: "operator-a",
      authorization: TEST_OWNER_AUTHORIZATION,
      restControlAvailable: true,
      baseUrl: TEST_REST_CONFIG.baseUrl,
    });

    await transport.sendStop({
      ...TEST_COMMAND_METADATA,
      command_kind: "stop",
    });

    expect(transport.kind).toBe("rest");
    expect(fetch).toHaveBeenCalledWith(
      `${TEST_REST_CONFIG.baseUrl}/control/stop`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("blocks commands when the sidecar is not ready", async () => {
    const transport = createOperatorControlCommandTransport({
      controlTransport: { ...TEST_CONTROL_DESCRIPTOR, sidecarReady: false },
      sessionId: "robot-session-a",
      peerId: "operator-a",
      authorization: TEST_AUTHORIZATION,
    });

    expect(transport.kind).toBe("unavailable");
    await expect(
      transport.sendStop({ ...TEST_COMMAND_METADATA, command_kind: "stop" }),
    ).rejects.toThrow(OPERATOR_CONTROL_TRANSPORT_MESSAGES.mismatch);
  });

  it("blocks commands when no datagram session is available", async () => {
    const transport = createOperatorControlCommandTransport({
      controlTransport: TEST_CONTROL_DESCRIPTOR,
      sessionId: null,
      peerId: "operator-a",
      authorization: TEST_AUTHORIZATION,
    });

    expect(transport.kind).toBe("unavailable");
    await expect(
      transport.sendStop({ ...TEST_COMMAND_METADATA, command_kind: "stop" }),
    ).rejects.toThrow(OPERATOR_CONTROL_TRANSPORT_MESSAGES.sessionMissing);
  });

  it("uses REST commands when local gateway control is available and no sidecar is advertised", async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          accepted: true,
          reason: "OpenArm CAN joint jog sent.",
          sequence: TEST_COMMAND_METADATA.sequence,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const transport = createOperatorControlCommandTransport({
      controlTransport: null,
      sessionId: "robot-session-a",
      peerId: "operator-a",
      authorization: TEST_AUTHORIZATION,
      restControlAvailable: true,
      baseUrl: TEST_REST_CONFIG.baseUrl,
      browserToken: "browser-token-a",
    });

    const ack = await transport.sendJointJog(
      {
        joint_name: "openarm_right_joint3",
        current_position_rad: 0.1,
        delta_rad: 0.01,
      },
      {
        ...TEST_COMMAND_METADATA,
        command_kind: "joint_jog",
      },
    );

    expect(transport.kind).toBe("rest");
    expect(ack?.accepted).toBe(true);
    const [, requestInit] = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(fetch).toHaveBeenCalledWith(
      `${TEST_REST_CONFIG.baseUrl}/control/joint-jog`,
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      joint_name: "openarm_right_joint3",
      current_position_rad: 0.1,
      delta_rad: 0.01,
      command_kind: "joint_jog",
      sequence: TEST_COMMAND_METADATA.sequence,
      source_ts_ms: TEST_COMMAND_METADATA.source_ts_ms,
      operator_id: "operator-a",
      ack_requested: true,
    });
  });

  it("sends all command kinds through the REST fallback", async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          accepted: true,
          reason: "accepted",
          sequence: TEST_COMMAND_METADATA.sequence,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const transport = createOperatorRestControlCommandTransport({
      baseUrl: TEST_REST_CONFIG.baseUrl,
      browserToken: "browser-token-a",
      peerId: "operator-a",
      authorization: TEST_AUTHORIZATION,
    });

    await transport.sendTwist({ x: 0.1, y: 0, omega: 0 }, TEST_COMMAND_METADATA);
    await transport.sendStop({
      ...TEST_COMMAND_METADATA,
      command_kind: "stop",
    });
    await transport.sendEstop({
      ...TEST_COMMAND_METADATA,
      command_kind: "estop",
    });
    await transport.sendJointJog(
      { joint_name: "openarm_right_joint3", delta_rad: 0.01 },
      {
        ...TEST_COMMAND_METADATA,
        command_kind: "joint_jog",
      },
    );

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      `${TEST_REST_CONFIG.baseUrl}/control/twist`,
      expect.any(Object),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `${TEST_REST_CONFIG.baseUrl}/control/stop`,
      expect.any(Object),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      `${TEST_REST_CONFIG.baseUrl}/control/estop`,
      expect.any(Object),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      `${TEST_REST_CONFIG.baseUrl}/control/joint-jog`,
      expect.any(Object),
    );
  });

  it("sends twist as latest datagram and keeps stop, e-stop, and joint-jog acked", async () => {
    const send = vi.fn(async () => ({
      session_id: "robot-session-a",
      peer_id: "operator-a",
      sequence: TEST_COMMAND_METADATA.sequence,
      server_sequence: 1,
      accepted: true,
      reason: "accepted",
      server_received_unix_ms: 456,
    }));
    const datagramClient: OperatorControlDatagramClient = {
      connect: vi.fn(async () => undefined),
      send,
      close: vi.fn(),
    };
    const transport = createOperatorDatagramControlCommandTransport({
      controlTransport: TEST_CONTROL_DESCRIPTOR,
      sessionId: "robot-session-a",
      peerId: "operator-a",
      authorization: TEST_AUTHORIZATION,
      datagramClient,
    });

    await transport.sendTwist({ x: 0.1, y: 0, omega: 0 }, TEST_COMMAND_METADATA);
    await transport.sendStop({
      ...TEST_COMMAND_METADATA,
      command_kind: "stop",
    });
    await transport.sendEstop({
      ...TEST_COMMAND_METADATA,
      command_kind: "estop",
    });
    await transport.sendJointJog(
      { joint_name: "joint1", delta_rad: 0.01 },
      {
        ...TEST_COMMAND_METADATA,
        command_kind: "joint_jog",
      },
    );

    expect(send).toHaveBeenNthCalledWith(
      1,
      TEST_COMMAND_METADATA,
      {
        x: 0.1,
        y: 0,
        omega: 0,
      },
      {
        ackRequested: false,
        authorization: {
          collaboration_session_id: TEST_AUTHORIZATION.sessionId,
          teleop_capability_token: TEST_AUTHORIZATION.teleopCapabilityToken,
        },
      },
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      {
        ...TEST_COMMAND_METADATA,
        command_kind: "stop",
      },
      {},
      {
        authorization: {
          collaboration_session_id: TEST_AUTHORIZATION.sessionId,
          teleop_capability_token: TEST_AUTHORIZATION.teleopCapabilityToken,
        },
        priority: true,
      },
    );
    expect(send).toHaveBeenNthCalledWith(
      3,
      {
        ...TEST_COMMAND_METADATA,
        command_kind: "estop",
      },
      {},
      {
        authorization: {
          collaboration_session_id: TEST_AUTHORIZATION.sessionId,
          teleop_capability_token: TEST_AUTHORIZATION.teleopCapabilityToken,
        },
        priority: true,
      },
    );
    expect(send).toHaveBeenNthCalledWith(
      4,
      {
        ...TEST_COMMAND_METADATA,
        command_kind: "joint_jog",
      },
      {
        joint_name: "joint1",
        delta_rad: 0.01,
      },
      {
        authorization: {
          collaboration_session_id: TEST_AUTHORIZATION.sessionId,
          teleop_capability_token: TEST_AUTHORIZATION.teleopCapabilityToken,
        },
      },
    );
  });
});
