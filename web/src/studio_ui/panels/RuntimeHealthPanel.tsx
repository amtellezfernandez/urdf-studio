import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import { useRuntimeHealthStore } from "@/runtime_engine/rosviz/state/runtimeHealthStore";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { readUnknownErrorMessage } from "@/shared/lib/errorMessages";
import { cn } from "@/shared/lib/utils";
import {
  allowAttestationConnection,
  fetchAttestationStatuses,
  type AttestationStatusPayload,
} from "@/studio_ui/attestation/attestationApi";

const formatNsToSec = (value: bigint | null): string => {
  if (value === null) return "-";
  return (Number(value) / 1_000_000_000).toFixed(3);
};

const shortHash = (value: string | null): string => {
  if (!value) return "-";
  return value.length <= 16 ? value : `${value.slice(0, 8)}...${value.slice(-6)}`;
};

export const RuntimeHealthPanel = () => {
  const isOpen = useWorkspaceStore((state) => state.panels.runtime_health);
  const closePanel = useWorkspaceStore((state) => state.closePanel);

  const status = useRuntimeHealthStore((state) => state.status);
  const sessionId = useRuntimeHealthStore((state) => state.sessionId);
  const fixedFrame = useRuntimeHealthStore((state) => state.fixedFrame);
  const deterministicMode = useRuntimeHealthStore((state) => state.deterministicMode);
  const framesReceived = useRuntimeHealthStore((state) => state.framesReceived);
  const sequenceGapCount = useRuntimeHealthStore((state) => state.sequenceGapCount);
  const lastSequence = useRuntimeHealthStore((state) => state.lastSequence);
  const lastClockNs = useRuntimeHealthStore((state) => state.lastClockNs);
  const lastFrameType = useRuntimeHealthStore((state) => state.lastFrameType);
  const lastPoseHash = useRuntimeHealthStore((state) => state.lastPoseHash);
  const sessionHash = useRuntimeHealthStore((state) => state.sessionHash);
  const determinismMismatchCount = useRuntimeHealthStore((state) => state.determinismMismatchCount);
  const lastDeterminismMismatchNs = useRuntimeHealthStore((state) => state.lastDeterminismMismatchNs);
  const lastDiagnostic = useRuntimeHealthStore((state) => state.lastDiagnostic);
  const lastError = useRuntimeHealthStore((state) => state.lastError);
  const [attestationStatuses, setAttestationStatuses] = useState<AttestationStatusPayload[]>([]);
  const [attestationError, setAttestationError] = useState<string | null>(null);
  const fleetOverview = useMemo(() => {
    const verifiedCount = attestationStatuses.filter(
      (status) => status.effective_trust_state === "verified"
    ).length;
    const alertCount = attestationStatuses.reduce((count, status) => {
      return (
        count +
        status.findings.filter((finding) => finding.severity === "alert").length
      );
    }, 0);
    return {
      verifiedCount,
      totalCount: attestationStatuses.length,
      alertCount,
    };
  }, [attestationStatuses]);

  const loadAttestation = async (cancelled = false): Promise<void> => {
    try {
      const statusPayload = await fetchAttestationStatuses();
      if (cancelled) return;
      setAttestationStatuses(statusPayload);
      setAttestationError(null);
    } catch (error) {
      if (cancelled) return;
      setAttestationStatuses([]);
      setAttestationError(
        readUnknownErrorMessage(error, "Failed to load attestation status.")
      );
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setAttestationStatuses([]);
      setAttestationError(null);
      return;
    }

    let cancelled = false;

    void loadAttestation();
    const intervalId = window.setInterval(() => {
      void loadAttestation(cancelled);
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isOpen]);

  const handleAllowConnection = async (robotId: string): Promise<void> => {
    try {
      await allowAttestationConnection(robotId);
      await loadAttestation();
    } catch (error) {
      setAttestationError(
        readUnknownErrorMessage(error, "Failed to allow connection.")
      );
    }
  };

  if (!isOpen) return null;

  return (
    <aside
      className="fixed right-4 top-[360px] z-50 w-[320px] rounded-md border border-border/40 bg-background/95 shadow-lg backdrop-blur-sm"
      aria-label="Runtime health panel"
    >
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
        <div>
          <div className="text-xs font-semibold text-foreground">Runtime Health</div>
          <div className="text-[10px] text-muted-foreground">
            Stream/session telemetry and diagnostics.
          </div>
        </div>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => closePanel("runtime_health")}
          aria-label="Close runtime health panel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 px-3 py-2 text-[10px]">
        <div className="text-muted-foreground">Status</div>
        <div>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 uppercase tracking-wide",
              status === "connected" && "bg-emerald-500/20 text-emerald-400",
              status === "connecting" && "bg-amber-500/20 text-amber-400",
              status === "error" && "bg-red-500/20 text-red-400",
              status === "idle" && "bg-muted text-muted-foreground"
            )}
          >
            {status}
          </span>
        </div>

        <div className="text-muted-foreground">Session</div>
        <div className="truncate font-mono text-foreground">{sessionId ?? "-"}</div>

        <div className="text-muted-foreground">Fixed frame</div>
        <div className="font-mono text-foreground">{fixedFrame}</div>

        <div className="text-muted-foreground">Determinism</div>
        <div className="font-mono text-foreground">{deterministicMode}</div>

        <div className="text-muted-foreground">Frames</div>
        <div className="font-mono text-foreground">{framesReceived}</div>

        <div className="text-muted-foreground">Sequence gaps</div>
        <div className="font-mono text-foreground">{sequenceGapCount}</div>

        <div className="text-muted-foreground">Last sequence</div>
        <div className="font-mono text-foreground">{lastSequence ? String(lastSequence) : "-"}</div>

        <div className="text-muted-foreground">Last clock (s)</div>
        <div className="font-mono text-foreground">{formatNsToSec(lastClockNs)}</div>

        <div className="text-muted-foreground">Last frame type</div>
        <div className="font-mono text-foreground">{lastFrameType ?? "-"}</div>

        <div className="text-muted-foreground">Pose hash</div>
        <div className="font-mono text-foreground" title={lastPoseHash ?? undefined}>
          {shortHash(lastPoseHash)}
        </div>

        <div className="text-muted-foreground">Session hash</div>
        <div className="font-mono text-foreground" title={sessionHash ?? undefined}>
          {shortHash(sessionHash)}
        </div>

        <div className="text-muted-foreground">Hash mismatches</div>
        <div className="font-mono text-foreground">{determinismMismatchCount}</div>

        <div className="text-muted-foreground">Last mismatch (s)</div>
        <div className="font-mono text-foreground">{formatNsToSec(lastDeterminismMismatchNs)}</div>
      </div>

      <div className="border-t border-border/40 px-3 py-2 text-[10px]">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-semibold text-foreground">Hardware Attestation</div>
          <div className="text-right text-muted-foreground">
            <div>{fleetOverview.verifiedCount}/{fleetOverview.totalCount || 0} verified</div>
            <div>{fleetOverview.alertCount} alerts</div>
          </div>
        </div>
        <div className="mb-2 text-muted-foreground">
          {attestationError ??
            (attestationStatuses.length > 0
              ? "Sensors and hardware must match the enrolled baseline. Unexpected USB or missing sensors raise alerts and block control."
              : "No attestation published yet. Push a verifier status to populate this panel.")}
        </div>
        {attestationStatuses.length > 0 && (
          <div className="space-y-1">
            {attestationStatuses.slice(0, 3).map((status) => (
              <div key={status.robot_id} className="rounded border border-border/40 px-2 py-1">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{status.robot_id}</span>
                  <span
                    className={cn(
                      "uppercase tracking-wide",
                      status.effective_trust_state === "verified" && "text-emerald-400",
                      status.effective_trust_state === "stale" && "text-amber-400",
                      status.effective_trust_state === "failed" && "text-red-400",
                      status.effective_trust_state === "inactive" && "text-slate-300"
                    )}
                  >
                    {status.effective_trust_state}
                  </span>
                </div>
                <div className="text-muted-foreground">
                  {status.status_explanation}
                </div>
                <div className="mt-1 text-muted-foreground">
                  {status.control_explanation}
                </div>
                {!status.control_allowed && (
                  <div className="mt-2">
                    <button
                      type="button"
                      className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300 hover:bg-emerald-500/20"
                      onClick={() => {
                        void handleAllowConnection(status.robot_id);
                      }}
                    >
                      Allow connection
                    </button>
                  </div>
                )}
                {status.override_active && (
                  <div className="mt-1 text-emerald-300">
                    Override active{status.override_reason ? `: ${status.override_reason}` : "."}
                  </div>
                )}
                {status.findings.slice(0, 2).map((finding, index) => (
                  <div key={`${status.robot_id}-${finding.finding_type}-${index}`} className="mt-1 text-muted-foreground">
                    <span
                      className={cn(
                        "mr-1 uppercase tracking-wide",
                        finding.severity === "info" && "text-sky-400",
                        finding.severity === "warn" && "text-amber-400",
                        finding.severity === "alert" && "text-red-400"
                      )}
                    >
                      {finding.severity}
                    </span>
                    {finding.message}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border/40 px-3 py-2 text-[10px]">
        <div className="truncate text-muted-foreground">
          {lastError ? `ERROR: ${lastError}` : lastDiagnostic || "No diagnostics yet."}
        </div>
      </div>
    </aside>
  );
};
