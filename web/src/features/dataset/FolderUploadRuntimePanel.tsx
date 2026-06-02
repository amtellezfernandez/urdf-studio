import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { RuntimeRobotPreview } from "@/studio_ui/runtimeviz/RuntimeRobotPreview";
import type { RuntimeDemoSpeedMode } from "@/studio_ui/runtimeviz/runtimeRobotPreviewParams";
import type { VerifiableRoboticsProofResponse } from "@/studio_ui/runtimeviz/verifiableRoboticsApi";
import type { AttestationStatusPayload } from "@/studio_ui/attestation/attestationApi";
import type {
  RuntimeProviderSessionSnapshot,
  RuntimeSessionStatsResponse,
  TelemetryChannelSnapshot,
} from "@/runtime_engine/runtime_contract";

type RuntimeConnectionTargets = {
  telemetryChannelsUrl: string;
  telemetryIngestUrl: string;
  telemetryFramesUrl: string;
  commandsUrl: string;
  statsUrl: string;
};

type RuntimeControlSummary = {
  headline: string;
  detail: string;
};

type RuntimeReceiverSummary = {
  label: string;
  detail: string;
};

type RuntimeFleetSummary = {
  total: number;
  verified: number;
  failed: number;
  inactive: number;
  stale: number;
  alerts: AttestationStatusPayload[];
};

type RuntimeAdapterStatusItem = {
  id: string;
  label: string;
  active: boolean;
};

type RuntimeAdapterFamilyItem = {
  id: string;
  label: string;
  count: number;
};

type RuntimeLayerCountItem = {
  id: string;
  label: string;
  count: number;
};

type RuntimeProofSample = {
  x: number;
  y: number;
  t_ms: number;
};

type RuntimePanelProps = {
  currentRuntimeAttestation: AttestationStatusPayload | null;
  handleAllowRuntimeConnection: () => Promise<void>;
  handleApproveRuntimeProvider: () => Promise<void>;
  handleDumpRuntimeStats: () => Promise<void>;
  handleProveRuntimeSafety: () => Promise<void>;
  handleSendRuntimeCommand: () => Promise<void>;
  handleSetRuntimeDemoSpeedMode: (speedMode: RuntimeDemoSpeedMode) => void;
  handleToggleRuntimeProviderRecording: () => Promise<void>;
  isApprovingRuntimeProvider: boolean;
  isProvingRuntimeSafety: boolean;
  isSendingRuntimeCommand: boolean;
  isTogglingRuntimeProviderRecording: boolean;
  normalizedRuntimeRobotId: string;
  runtimeAdapterFamilies: RuntimeAdapterFamilyItem[];
  runtimeAdapterStatus: RuntimeAdapterStatusItem[];
  runtimeBackendDropReasonSummary: string;
  runtimeBackendStats: RuntimeSessionStatsResponse | null;
  runtimeCommandError: string | null;
  runtimeCommandMessages: string[];
  runtimeCommandText: string;
  runtimeConnectionTargets: RuntimeConnectionTargets;
  runtimeControlSummary: RuntimeControlSummary;
  runtimeFleetSummary: RuntimeFleetSummary;
  runtimeLastTrajectoryTarget: string | null;
  runtimeLayerCounts: RuntimeLayerCountItem[];
  runtimeProofElapsedMs: number;
  runtimeProofError: string | null;
  runtimeProofPhase: string | null;
  runtimeProofProgressPercent: number;
  runtimeProofResult: VerifiableRoboticsProofResponse | null;
  runtimeProviderError: string | null;
  runtimeProviderSession: RuntimeProviderSessionSnapshot | null;
  runtimeReceiverSummary: RuntimeReceiverSummary;
  runtimeRobotId: string;
  runtimeRestrictedAreaIds: string[];
  runtimeSessionId: string;
  runtimeSessionToken: string;
  runtimeTelemetryChannels: TelemetryChannelSnapshot[];
  runtimeTraceSamples: RuntimeProofSample[];
  runtimeDemoSpeedMode: RuntimeDemoSpeedMode;
  runtimeDemoObjectLabels: string[];
  setRuntimeCommandText: (value: string) => void;
  setRuntimeRobotId: (value: string) => void;
  setRuntimeSessionId: (value: string) => void;
  setRuntimeSessionToken: (value: string) => void;
  autocompleteRuntimeCommand: (text: string) => string | null;
  runtimeAttestationError: string | null;
  runtimeDemoEnabled: boolean;
};

export function FolderUploadRuntimePanel({
  currentRuntimeAttestation,
  handleAllowRuntimeConnection,
  handleApproveRuntimeProvider,
  handleDumpRuntimeStats,
  handleProveRuntimeSafety,
  handleSendRuntimeCommand,
  handleSetRuntimeDemoSpeedMode,
  handleToggleRuntimeProviderRecording,
  isApprovingRuntimeProvider,
  isProvingRuntimeSafety,
  isSendingRuntimeCommand,
  isTogglingRuntimeProviderRecording,
  normalizedRuntimeRobotId,
  runtimeAdapterFamilies,
  runtimeAdapterStatus,
  runtimeBackendDropReasonSummary,
  runtimeBackendStats,
  runtimeCommandError,
  runtimeCommandMessages,
  runtimeCommandText,
  runtimeConnectionTargets,
  runtimeControlSummary,
  runtimeFleetSummary,
  runtimeLastTrajectoryTarget,
  runtimeLayerCounts,
  runtimeProofElapsedMs,
  runtimeProofError,
  runtimeProofPhase,
  runtimeProofProgressPercent,
  runtimeProofResult,
  runtimeProviderError,
  runtimeProviderSession,
  runtimeReceiverSummary,
  runtimeRobotId,
  runtimeRestrictedAreaIds,
  runtimeSessionId,
  runtimeSessionToken,
  runtimeTelemetryChannels,
  runtimeTraceSamples,
  runtimeDemoSpeedMode,
  runtimeDemoObjectLabels,
  setRuntimeCommandText,
  setRuntimeRobotId,
  setRuntimeSessionId,
  setRuntimeSessionToken,
  autocompleteRuntimeCommand,
  runtimeAttestationError,
  runtimeDemoEnabled,
}: RuntimePanelProps) {
  const runtimeCommandsAllowed = runtimeDemoEnabled || currentRuntimeAttestation?.control_allowed === true;
  const runtimeStatusLabel = runtimeDemoEnabled
    ? "Simulation runtime"
    : currentRuntimeAttestation?.control_allowed
      ? "Allowed"
      : "Blocked";
  const providerDisplayName =
    runtimeProviderSession?.provider_display_name ||
    runtimeProviderSession?.provider_id ||
    "No connector";
  const providerRobotName =
    runtimeProviderSession?.robot_display_name || runtimeProviderSession?.robot_id || "Waiting for robot model";
  const providerCapabilities = runtimeProviderSession?.approved_capabilities.length
    ? runtimeProviderSession.approved_capabilities.join(", ")
    : runtimeProviderSession?.requested_capabilities.join(", ") || "none";
  const canApproveProvider = runtimeProviderSession?.state === "pending";
  const canRecordProvider =
    runtimeProviderSession !== null && runtimeProviderSession.state !== "pending";

  return (
    <div className="mx-auto h-full w-full max-w-6xl space-y-2 rounded-md border border-border/70 bg-background/40 p-2.5">
      <div className="space-y-1">
        <p className="truncate text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          {runtimeDemoEnabled ? "Runtime Access" : "Trusted Runtime"}
        </p>
        <p className="text-xs text-foreground">
          {runtimeDemoEnabled
            ? "Simulation-backed runtime access demo. Commands and proof flow stay local to this workstation."
            : "Remote attestation decides whether this machine should be allowed to operate the robot."}
        </p>
      </div>

      <div className="space-y-2">
        <div className="rounded-xl border border-border/50 bg-background/25 px-3 py-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-0.5">
              <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                {runtimeDemoEnabled ? "Simulation Control" : "Remote Attestation"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {runtimeDemoEnabled
                  ? "Local simulation state for runtime access."
                  : "Published trust state for runtime access."}
              </p>
            </div>
            <div className="flex flex-col gap-1 text-right">
              <Input
                type="text"
                placeholder="robot-id"
                value={runtimeRobotId}
                onChange={(event) => setRuntimeRobotId(event.target.value)}
                className="h-7 w-full min-w-[180px] border-border/60 bg-background/60 text-[11px] sm:w-[220px]"
              />
              <p className="text-[10px] text-muted-foreground">
                Auto-updated by the robot publisher
              </p>
            </div>
          </div>

          <div className="mt-2 grid gap-2 lg:grid-cols-[180px_minmax(0,1fr)_220px_220px]">
            <div className="rounded-lg border border-border/40 bg-background/35 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Verdict</p>
              <span
                className={`mt-1.5 inline-flex rounded px-2.5 py-1 text-sm font-semibold uppercase tracking-[0.12em] ${
                  currentRuntimeAttestation?.metadata?.scan_state === "triggered"
                    ? "bg-orange-500/20 text-orange-300"
                    : currentRuntimeAttestation?.effective_trust_state === "verified"
                      ? "bg-emerald-500/20 text-emerald-400"
                      : currentRuntimeAttestation?.effective_trust_state === "stale"
                        ? "bg-amber-500/20 text-amber-300"
                        : currentRuntimeAttestation?.effective_trust_state === "failed"
                          ? "bg-rose-500/20 text-rose-300"
                          : "bg-muted/40 text-muted-foreground"
                }`}
              >
                {currentRuntimeAttestation?.metadata?.scan_state === "triggered"
                  ? "Alert detected"
                  : currentRuntimeAttestation?.effective_trust_state === "verified"
                    ? "Validated"
                    : currentRuntimeAttestation?.effective_trust_state === "stale"
                      ? "Stale"
                      : currentRuntimeAttestation?.effective_trust_state === "failed"
                        ? "Non validated"
                        : currentRuntimeAttestation?.effective_trust_state ?? "Unknown"}
              </span>
            </div>

            <div className="rounded-lg border border-border/40 bg-background/35 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Integrity</p>
              <p className="mt-1.5 text-[12px] text-foreground">
                {runtimeAttestationError ??
                  (currentRuntimeAttestation?.metadata?.scan_state === "triggered"
                    ? currentRuntimeAttestation?.metadata?.scan_reason ??
                      "Attestation scan triggered. Waiting for updated verdict."
                    : null) ??
                  currentRuntimeAttestation?.status_explanation ??
                  "No attestation published yet. Wait for the robot publisher to report status."}
              </p>
            </div>

            <div className="rounded-lg border border-border/40 bg-background/35 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Access</p>
              <p className="mt-1.5 text-[12px] text-foreground">
                {runtimeStatusLabel}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {currentRuntimeAttestation?.control_explanation ?? runtimeControlSummary.detail}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {`Console · ${runtimeReceiverSummary.label}`}
              </p>
            </div>

            <div className="rounded-lg border border-border/40 bg-background/35 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Freshness</p>
              <div className="mt-1.5 grid gap-0.5 text-[10px] text-muted-foreground">
                <p>{`Verifier · ${runtimeDemoEnabled ? "local-simulation" : currentRuntimeAttestation?.verifier ?? "n/a"}`}</p>
                <p>{`Expires · ${runtimeDemoEnabled ? "session-local" : currentRuntimeAttestation?.expires_at ?? "n/a"}`}</p>
                <p>{`Updated · ${runtimeDemoEnabled ? "live" : currentRuntimeAttestation?.updated_at ?? "n/a"}`}</p>
              </div>
              {!runtimeDemoEnabled && !currentRuntimeAttestation?.control_allowed && normalizedRuntimeRobotId ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    void handleAllowRuntimeConnection();
                  }}
                  className="mt-2 h-6 border border-border/50 bg-background/40 px-2.5 text-[10px] text-muted-foreground hover:bg-background/60 hover:text-foreground"
                >
                  Temporary override
                </Button>
              ) : null}
            </div>
          </div>

          <details className="mt-2 rounded-lg border border-border/40 bg-background/30 px-3 py-2">
            <summary className="cursor-pointer text-[10px] text-muted-foreground">
              Technical evidence
            </summary>
            <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div className="grid gap-0.5 text-[10px] text-muted-foreground">
                {runtimeDemoEnabled ? (
                  <>
                    <p>Preview iframe is driving the runtime pose and trajectory locally.</p>
                    <p>Demo object scans, restricted areas, and speed changes stay in-browser.</p>
                    <p>Proof generation still uses the captured local trace and public policy.</p>
                  </>
                ) : currentRuntimeAttestation?.findings?.length ? (
                  currentRuntimeAttestation.findings.slice(0, 4).map((finding, index) => (
                    <p key={`${finding.finding_type}-${index}`}>{finding.message}</p>
                  ))
                ) : (
                  <p>No detailed evidence published yet.</p>
                )}
              </div>
              <div className="grid gap-0.5 text-[10px] text-muted-foreground">
                <p>{`Gateway status: ${runtimeDemoEnabled ? "not-used" : currentRuntimeAttestation?.metadata?.gateway_decision_status ?? "n/a"}`}</p>
                <p>{`Gateway reason: ${runtimeDemoEnabled ? "simulation mode" : currentRuntimeAttestation?.metadata?.gateway_decision_reason ?? "n/a"}`}</p>
                <p>{`Sensor summary: ${runtimeDemoEnabled ? "local preview bridge" : currentRuntimeAttestation?.metadata?.sensor_summary ?? "n/a"}`}</p>
                <p>{`Network devices tracked: ${runtimeFleetSummary.total}`}</p>
                <p>{`Alerts: ${runtimeFleetSummary.failed + runtimeFleetSummary.inactive}`}</p>
              </div>
            </div>
          </details>
        </div>

        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="h-[56vh] min-h-[420px] overflow-hidden rounded-xl border border-border/60 bg-background/55">
            <RuntimeRobotPreview />
          </div>

          <div className="space-y-2">
            <div className="rounded-xl border border-border/50 bg-background/25 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Runtime Access</p>
              <div className="mt-2 space-y-2">
                <div className="rounded-lg border border-border/40 bg-background/30 px-2 py-1.5">
                  <p className="text-[10px] text-muted-foreground">Workstation trust</p>
                  <div className="mt-1 grid gap-0.5 text-[10px] text-muted-foreground">
                    <p>{runtimeReceiverSummary.label}</p>
                    <p>{runtimeReceiverSummary.detail}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/30 px-2 py-1.5">
                  <p className="text-[10px] text-muted-foreground">Scene inventory</p>
                  <div className="mt-1 grid gap-0.5 text-[10px] text-muted-foreground">
                    <p>
                      {runtimeDemoObjectLabels.length > 0
                        ? `Objects · ${runtimeDemoObjectLabels.join(", ")}`
                        : "Objects · none"}
                    </p>
                    <p>
                      {runtimeRestrictedAreaIds.length > 0
                        ? `Forbidden zones · ${runtimeRestrictedAreaIds.join(", ")}`
                        : "Forbidden zones · none"}
                    </p>
                  </div>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/30 px-2 py-1.5">
                  <p className="text-[10px] text-muted-foreground">Robot commands</p>
                  <div className="mt-1 grid gap-0.5 text-[10px] text-muted-foreground">
                    <p>{runtimeStatusLabel}</p>
                    <p>{runtimeControlSummary.detail}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/30 px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] text-muted-foreground">Live provider</p>
                    <span
                      className={`rounded px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] ${
                        runtimeProviderSession?.state === "connected"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : runtimeProviderSession?.state === "approved"
                            ? "bg-sky-500/15 text-sky-300"
                            : runtimeProviderSession?.state === "pending"
                              ? "bg-amber-500/15 text-amber-300"
                              : "bg-muted/40 text-muted-foreground"
                      }`}
                    >
                      {runtimeProviderSession?.state ?? "idle"}
                    </span>
                  </div>
                  <div className="mt-1 grid gap-0.5 text-[10px] text-muted-foreground">
                    <p>{`Connector · ${providerDisplayName}`}</p>
                    <p>{`Robot · ${providerRobotName}`}</p>
                    <p>{`Capabilities · ${providerCapabilities}`}</p>
                    {runtimeProviderError ? <p>{runtimeProviderError}</p> : null}
                  </div>
                  <div className="mt-2 grid gap-1 sm:grid-cols-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        void handleApproveRuntimeProvider();
                      }}
                      disabled={!canApproveProvider || isApprovingRuntimeProvider}
                      className="h-6 px-2 text-[10px]"
                    >
                      {isApprovingRuntimeProvider ? "Approving..." : "Approve connector"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        void handleToggleRuntimeProviderRecording();
                      }}
                      disabled={!canRecordProvider || isTogglingRuntimeProviderRecording}
                      className="h-6 border border-border/50 bg-background/40 px-2 text-[10px] text-muted-foreground hover:bg-background/60 hover:text-foreground"
                    >
                      {isTogglingRuntimeProviderRecording
                        ? "Updating..."
                        : runtimeProviderSession?.recording_state === "recording"
                          ? "Stop recording"
                          : "Record live"}
                    </Button>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Connectors run out-of-process. Studio approves, mirrors, and records the live session.
                  </p>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/30 px-2 py-1.5">
                  <p className="text-[10px] text-muted-foreground">
                    {runtimeDemoEnabled ? "Runtime commands" : "ButterClaw chat"}
                  </p>
                  <div className="mt-1 space-y-1.5">
                    <Input
                      type="text"
                      placeholder="e.g. /scan, /trajectory mug bowl, /rotate 90, or move towards the mug"
                      value={runtimeCommandText}
                      onChange={(event) => setRuntimeCommandText(event.target.value)}
                      disabled={isSendingRuntimeCommand}
                      className="h-7 border-border/60 bg-background/60 text-[11px]"
                      onKeyDown={(event) => {
                        if (event.key === "Tab") {
                          const nextValue = autocompleteRuntimeCommand(runtimeCommandText);
                          if (nextValue) {
                            event.preventDefault();
                            setRuntimeCommandText(nextValue);
                          }
                          return;
                        }
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleSendRuntimeCommand();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        void handleSendRuntimeCommand();
                      }}
                      disabled={
                        isSendingRuntimeCommand ||
                        runtimeCommandText.trim().length === 0 ||
                        !runtimeCommandsAllowed
                      }
                      className="h-6 w-full px-2.5 text-[10px]"
                    >
                      {isSendingRuntimeCommand
                        ? "Sending..."
                        : runtimeDemoEnabled
                          ? "Run command"
                          : "Send to ButterClaw"}
                    </Button>
                    <div className="rounded-md border border-border/30 bg-background/40 px-2 py-1.5 text-[10px] text-muted-foreground">
                      {runtimeCommandError ? (
                        <p>{runtimeCommandError}</p>
                      ) : runtimeCommandMessages.length > 0 ? (
                        runtimeCommandMessages.slice(-3).map((message, index) => (
                          <p key={`${message}-${index}`}>{message}</p>
                        ))
                      ) : (
                        <p>Use `/scan`, `/restricted-area`, `/speed fast`, `/trajectory mug`, or `/prove-safety`.</p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/30 px-2 py-1.5">
                  <p className="text-[10px] text-muted-foreground">Challenge 4 proof</p>
                  <div className="mt-1 space-y-1.5">
                    <div className="rounded-md border border-border/30 bg-background/35 px-2 py-1.5 text-[10px] text-muted-foreground">
                      <p className="font-medium text-foreground">Public safety policy</p>
                      <p>{`Workspace · x:[-0.5, 3.2], y:[-2.0, 2.0]`}</p>
                      <p>{`Restricted areas · ${runtimeRestrictedAreaIds.length}`}</p>
                      <p>
                        {runtimeRestrictedAreaIds.length > 0
                          ? `Active zones · ${runtimeRestrictedAreaIds.join(", ")}`
                          : "Active zones · none"}
                      </p>
                      <p>{`Demo speed · ${runtimeDemoSpeedMode}`}</p>
                      <p>{`Max step L1 · 0.14 m`}</p>
                      <p>{`Max step-delta L1 · 0.09 m`}</p>
                      <div className="pt-1">
                        <p className="mb-1 text-[10px] text-muted-foreground">Motion profile</p>
                        <div className="flex gap-1">
                          {(["slow", "normal", "fast"] as const).map((speedMode) => {
                            const isActive = runtimeDemoSpeedMode === speedMode;
                            return (
                              <Button
                                key={speedMode}
                                type="button"
                                size="sm"
                                onClick={() => handleSetRuntimeDemoSpeedMode(speedMode)}
                                className={
                                  isActive
                                    ? "h-6 flex-1 px-2 text-[10px]"
                                    : "h-6 flex-1 border border-border/50 bg-background/40 px-2 text-[10px] text-muted-foreground hover:bg-background/60 hover:text-foreground"
                                }
                              >
                                {speedMode}
                              </Button>
                            );
                          })}
                        </div>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Use `fast` to create a non-permitted motion trace against the step bounds.
                        </p>
                      </div>
                    </div>
                    <div className="rounded-md border border-border/30 bg-background/35 px-2 py-1.5 text-[10px] text-muted-foreground">
                      <p className="font-medium text-foreground">Execution under proof</p>
                      <p>{`Trace samples · ${runtimeTraceSamples.length}`}</p>
                      <p>{`Last target · ${runtimeLastTrajectoryTarget ?? "none"}`}</p>
                      <p>{`Witness privacy · full trajectory stays private`}</p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        void handleProveRuntimeSafety();
                      }}
                      disabled={isProvingRuntimeSafety || runtimeTraceSamples.length === 0}
                      className="h-6 w-full px-2.5 text-[10px]"
                    >
                      {isProvingRuntimeSafety ? "Proving..." : "Prove safety"}
                    </Button>
                    <div className="rounded-md border border-border/30 bg-background/40 px-2 py-1.5 text-[10px] text-muted-foreground">
                      {isProvingRuntimeSafety ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <p>{runtimeProofPhase}</p>
                            <p>{`${(runtimeProofElapsedMs / 1000).toFixed(1)}s`}</p>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-border/40">
                            <div
                              className="h-full rounded-full bg-emerald-400/80 transition-[width] duration-300"
                              style={{ width: `${runtimeProofProgressPercent}%` }}
                            />
                          </div>
                          <p>SP1 proving can take a while on the first run because the toolchain and prover artifacts warm up.</p>
                        </div>
                      ) : runtimeProofError ? (
                        <p>{runtimeProofError}</p>
                      ) : runtimeProofResult ? (
                        <div className="space-y-1.5">
                          <div
                            className={`inline-flex rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                              runtimeProofResult.policy_satisfied === false
                                ? "bg-rose-500/20 text-rose-300"
                                : "bg-emerald-500/20 text-emerald-400"
                            }`}
                          >
                            {runtimeProofResult.policy_satisfied === false
                              ? "Non-permitted movement proved"
                              : "Permitted execution proved"}
                          </div>
                          <p>
                            {runtimeProofResult.policy_satisfied === false
                              ? "The prover showed that the hidden execution trace violated the public movement policy."
                              : "The prover showed that the hidden execution trace satisfied the public safety policy."}
                          </p>
                          <p>{`Trace digest · ${runtimeProofResult.trace_digest_hex ?? "n/a"}`}</p>
                          <p>{`Trace length · ${runtimeProofResult.trace_length}`}</p>
                          <p>{`Proof time · ${runtimeProofResult.proving_millis ?? runtimeProofResult.execution_millis ?? "n/a"} ms`}</p>
                        </div>
                      ) : (
                        <p>Record a runtime trace, then prove that it stayed within the permitted movement policy.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <details className="rounded-xl border border-border/50 bg-background/25 px-2.5 py-2">
              <summary className="cursor-pointer text-[10px] text-muted-foreground">Device network</summary>
              <div className="mt-2 grid gap-1 text-[10px] text-muted-foreground">
                <p>{`Devices: ${runtimeFleetSummary.total}`}</p>
                <p>{`Verified: ${runtimeFleetSummary.verified}`}</p>
                <p>{`Failed: ${runtimeFleetSummary.failed}`}</p>
                <p>{`Inactive: ${runtimeFleetSummary.inactive}`}</p>
              </div>
              {runtimeFleetSummary.alerts[0] ? (
                <div className="mt-2 grid gap-1 text-[10px] text-muted-foreground">
                  {runtimeFleetSummary.alerts.slice(0, 3).map((status) => (
                    <p key={status.robot_id}>{`${status.robot_id}: ${status.status_explanation}`}</p>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[10px] text-muted-foreground">No active alerts.</p>
              )}
            </details>
            <details className="rounded-xl border border-border/50 bg-background/25 px-2.5 py-2">
              <summary className="cursor-pointer text-[10px] text-muted-foreground">Advanced</summary>
              <div className="mt-2 space-y-2">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <p>Session and runtime internals</p>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        void handleDumpRuntimeStats();
                      }}
                      className="h-6 border border-border/60 bg-background/60 px-2 text-[10px] text-foreground hover:bg-background/80"
                    >
                      Dump Stats
                    </Button>
                  </div>
                  <Input
                    type="text"
                    placeholder="runtime-session-id"
                    value={runtimeSessionId}
                    onChange={(event) => setRuntimeSessionId(event.target.value)}
                    className="h-7 border-border/60 bg-background/60 text-[11px]"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Runtime session ID for stream discovery and telemetry sync.
                  </p>
                  <Input
                    type="password"
                    placeholder="runtime-session-token (optional)"
                    value={runtimeSessionToken}
                    onChange={(event) => setRuntimeSessionToken(event.target.value)}
                    className="h-7 border-border/60 bg-background/60 text-[11px]"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Optional session token for auth-guarded telemetry sessions. It stays in memory for this tab only.
                  </p>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/30 px-2 py-2">
                  <p className="text-[10px] text-muted-foreground">Integration reference</p>
                  <div className="mt-1 grid gap-1 text-[10px] text-muted-foreground">
                    <p>1. Set a session ID above.</p>
                    <p>2. Register telemetry channels and command relays from your adapter.</p>
                    <p>3. Publish envelopes over authenticated HTTP to the session endpoints below.</p>
                    <p>4. The local 3D preview is always available; telemetry and control cards update automatically when data arrives.</p>
                    <p>5. Optional guardrail: set `X-Runtime-Session-Token` on HTTP. Do not publish query-auth transport URLs.</p>
                  </div>
                  <div className="mt-2 grid gap-1 text-[10px] text-muted-foreground">
                    <p className="text-foreground">POST telemetry channels</p>
                    <p className="break-all font-mono">{runtimeConnectionTargets.telemetryChannelsUrl}</p>
                    <p className="text-foreground">POST telemetry envelopes</p>
                    <p className="break-all font-mono">{runtimeConnectionTargets.telemetryIngestUrl}</p>
                    <p className="text-foreground">GET telemetry frames (HTTP fallback)</p>
                    <p className="break-all font-mono">{runtimeConnectionTargets.telemetryFramesUrl}</p>
                    <p className="text-foreground">POST commands</p>
                    <p className="break-all font-mono">{runtimeConnectionTargets.commandsUrl}</p>
                    <p className="text-foreground">GET session stats</p>
                    <p className="break-all font-mono">{runtimeConnectionTargets.statsUrl}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/30 px-2 py-2">
                  <p className="text-[10px] text-muted-foreground">Health</p>
                  <div className="mt-1 grid gap-1 text-[10px] text-muted-foreground">
                    <p>{`Backend transport: ${runtimeBackendStats?.active_transport ?? "n/a"}`}</p>
                    <p>{`Backend ingested: ${runtimeBackendStats?.total_ingested ?? "n/a"}`}</p>
                    <p>{`Buffered messages: ${runtimeBackendStats?.total_buffered_messages ?? "n/a"}`}</p>
                    <p>{`Backend buffer bytes: ${runtimeBackendStats ? (runtimeBackendStats.total_buffered_bytes / (1024 * 1024)).toFixed(1) : "n/a"} MB`}</p>
                    <p>{`Backend drops: ${runtimeBackendStats?.total_dropped ?? "n/a"}`}</p>
                    <p className="truncate">{`Drop reasons: ${runtimeBackendDropReasonSummary}`}</p>
                    <p>{`Commands: ${runtimeBackendStats?.command_total ?? "n/a"}`}</p>
                    <p>{`Acks: ${runtimeBackendStats?.ack_total ?? "n/a"}`}</p>
                    <p>{`Channels: ${runtimeBackendStats?.channels ?? runtimeTelemetryChannels.length}`}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/30 px-2 py-2">
                  <p className="text-[10px] text-muted-foreground">Adapter Fabric</p>
                  <div className="mt-1 grid gap-1 text-[10px] text-muted-foreground">
                    {runtimeAdapterStatus.map((adapter) => (
                      <p key={adapter.id}>{`${adapter.label}: ${adapter.active ? "active" : "idle"}`}</p>
                    ))}
                  </div>
                  <div className="mt-2 grid gap-1 text-[10px] text-muted-foreground">
                    {runtimeAdapterFamilies.map((family) => (
                      <p key={family.id}>{`${family.label}: ${family.count}`}</p>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/30 px-2 py-2">
                  <p className="text-[10px] text-muted-foreground">Viewer Layers</p>
                  <div className="mt-1 grid gap-1 text-[10px] text-muted-foreground">
                    {runtimeLayerCounts.map((layer) => (
                      <p key={layer.id}>{`${layer.label}: ${layer.count}`}</p>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/30 px-2 py-2">
                  <p className="text-[10px] text-muted-foreground">Diagnostics</p>
                  {runtimeTelemetryChannels.length > 0 ? (
                    <div className="mt-1 max-h-28 overflow-auto grid gap-1 text-[10px] text-muted-foreground">
                      {runtimeTelemetryChannels.slice(0, 10).map((channel) => (
                        <p key={channel.channel_id}>{`ch ${channel.channel_id} · ${channel.name} · ${channel.source_id}`}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-[10px] text-muted-foreground">No telemetry channels registered yet.</p>
                  )}
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}
