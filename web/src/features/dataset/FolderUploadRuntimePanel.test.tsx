/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeProviderSessionSnapshot } from "@/runtime_engine/runtime_contract";
import { FolderUploadRuntimePanel } from "./FolderUploadRuntimePanel";

vi.mock("@/studio_ui/runtimeviz/RuntimeRobotPreview", () => ({
  RuntimeRobotPreview: () => createElement("div", { "data-testid": "runtime-preview" }),
}));

const createProps = () => ({
  autocompleteRuntimeCommand: vi.fn(() => null),
  currentRuntimeAttestation: null,
  handleAllowRuntimeConnection: vi.fn(async () => {}),
  handleApproveRuntimeProvider: vi.fn(async () => {}),
  handleDumpRuntimeStats: vi.fn(async () => {}),
  handleProveRuntimeSafety: vi.fn(async () => {}),
  handleSendRuntimeCommand: vi.fn(async () => {}),
  handleSetRuntimeDemoSpeedMode: vi.fn(),
  handleToggleRuntimeProviderRecording: vi.fn(async () => {}),
  isApprovingRuntimeProvider: false,
  isProvingRuntimeSafety: false,
  isSendingRuntimeCommand: false,
  isTogglingRuntimeProviderRecording: false,
  normalizedRuntimeRobotId: "sim-robot",
  runtimeAdapterFamilies: [],
  runtimeAdapterStatus: [],
  runtimeAttestationError: null,
  runtimeBackendDropReasonSummary: "none",
  runtimeBackendStats: null,
  runtimeCommandError: null,
  runtimeCommandMessages: [],
  runtimeCommandText: "",
  runtimeConnectionTargets: {
    telemetryChannelsUrl: "",
    telemetryIngestUrl: "",
    telemetryFramesUrl: "",
    commandsUrl: "",
    statsUrl: "",
  },
  runtimeControlSummary: {
    headline: "Simulation control is open on this machine.",
    detail:
      "Commands execute against the local runtime demo and do not require Raspberry Pi attestation.",
  },
  runtimeDemoEnabled: true,
  runtimeDemoObjectLabels: ["red_bull_can", "mug", "bowl"],
  runtimeDemoSpeedMode: "normal" as const,
  runtimeFleetSummary: {
    total: 0,
    verified: 0,
    failed: 0,
    inactive: 0,
    stale: 0,
    alerts: [],
  },
  runtimeLastTrajectoryTarget: null,
  runtimeLayerCounts: [],
  runtimeProofElapsedMs: 0,
  runtimeProofError: null,
  runtimeProofPhase: null,
  runtimeProofProgressPercent: 0,
  runtimeProofResult: null,
  runtimeProviderError: null,
  runtimeProviderSession: null,
  runtimeReceiverSummary: {
    label: "Local simulation",
    detail:
      "This workstation is running the simulation-backed runtime access demo without Raspberry Pi hardware.",
  },
  runtimeRestrictedAreaIds: [],
  runtimeRobotId: "sim-robot",
  runtimeSessionId: "",
  runtimeSessionToken: "",
  runtimeTelemetryChannels: [],
  runtimeTraceSamples: [],
  setRuntimeCommandText: vi.fn(),
  setRuntimeRobotId: vi.fn(),
  setRuntimeSessionId: vi.fn(),
  setRuntimeSessionToken: vi.fn(),
});

describe("FolderUploadRuntimePanel", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("renders simulation-first runtime access copy in demo mode", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(FolderUploadRuntimePanel, createProps()));
    });

    expect(container.textContent).toContain("Runtime Access");
    expect(container.textContent).toContain("Simulation-backed runtime access demo.");
    expect(container.textContent).toContain("Simulation runtime");
    expect(container.textContent).toContain("Local simulation");
    expect(container.textContent).toContain("Objects · red_bull_can, mug, bowl");
    expect(container.textContent).not.toContain("Temporary override");
    expect(container.textContent).toContain("Run command");
    expect(container.textContent).toContain("Live provider");
    expect(container.textContent).toContain("Connector · No connector");
    expect(container.textContent).not.toContain("Remote attestation decides whether this machine should be allowed to operate the robot.");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders provider approval and recording controls", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const runtimeProviderSession: RuntimeProviderSessionSnapshot = {
      session_id: "openarm-session",
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
      robot_id: "openarm/baguette",
      robot_display_name: "Baguette Arm",
      robot_description_available: true,
      audit_events: [],
    };
    const props = {
      ...createProps(),
      runtimeProviderSession,
    };

    await act(async () => {
      root.render(createElement(FolderUploadRuntimePanel, props));
    });

    expect(container.textContent).toContain("Connector · Dora Local");
    expect(container.textContent).toContain("Robot · Baguette Arm");
    expect(container.textContent).toContain("Capabilities · observe, record, video");

    const approveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Approve connector"
    );
    expect(approveButton?.hasAttribute("disabled")).toBe(false);

    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(props.handleApproveRuntimeProvider).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });
});
