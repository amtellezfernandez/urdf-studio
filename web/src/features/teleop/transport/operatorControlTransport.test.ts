import { describe, expect, it } from "vitest";

import { normalizeOperatorControlTransportDescriptor } from "@/features/teleop/transport/operatorControlTransport";

describe("operatorControlTransport", () => {
  it("rejects sidecar control descriptors until the sidecar is ready", () => {
    expect(
      normalizeOperatorControlTransportDescriptor({
        type: "teleop_sidecar",
        manifest_path: "/teleop/manifest",
        stats_path: "/teleop/stats",
        webtransport_url: "https://127.0.0.1:8092/teleop",
        native_quic_address: "127.0.0.1:8093",
        native_quic_alpn: "urdf-teleop-quic-v1",
        teleop_capability_verify_path:
          "/collaboration/sessions/{sessionId}/capabilities/verify",
        teleop_capability_required_role: "teleop_operator",
        teleop_capability_transport: "moq",
      }),
    ).toBeNull();
  });

  it("normalizes ready sidecar control transport descriptors", () => {
    expect(
      normalizeOperatorControlTransportDescriptor({
        type: "teleop_sidecar",
        manifest_path: "/teleop/manifest",
        stats_path: "/teleop/stats",
        webtransport_url: "https://127.0.0.1:8092/teleop",
        native_quic_address: "127.0.0.1:8093",
        native_quic_alpn: "urdf-teleop-quic-v1",
        sidecar_ready: true,
        requires_lease: true,
        requires_teleop_capability: true,
      }),
    ).toMatchObject({
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
    });
  });
});
