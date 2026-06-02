import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";

export type AttestationFindingPayload = {
  finding_type: string;
  severity: "info" | "warn" | "alert";
  message: string;
};

export type AttestationStatusPayload = {
  robot_id: string;
  effective_trust_state: "verified" | "stale" | "failed" | "inactive";
  control_allowed: boolean;
  status_explanation: string;
  control_explanation: string;
  updated_at?: string;
  last_verified_at?: string | null;
  override_active: boolean;
  override_reason: string | null;
  override_expires_at?: string | null;
  expires_at?: string | null;
  reason: string | null;
  verifier?: string;
  metadata?: Record<string, string>;
  findings: AttestationFindingPayload[];
};

const CORE_API_OPTIONS = {
  requiredBackends: ["core-api"] as const,
};

export const fetchAttestationStatuses = async (): Promise<AttestationStatusPayload[]> => {
  const response = await guardedFetch(`${API_BASE_URL}/attestation/status`, undefined, {
    ...CORE_API_OPTIONS,
    context: "Attestation status",
  });
  if (!response.ok) {
    throw new Error(`Attestation status request failed (${response.status}).`);
  }
  return (await response.json()) as AttestationStatusPayload[];
};

export const allowAttestationConnection = async (robotId: string): Promise<void> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/attestation/status/${encodeURIComponent(robotId)}/allow`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ttl_seconds: 300,
        reason: "Operator approved demo connection.",
      }),
    },
    {
      ...CORE_API_OPTIONS,
      context: "Attestation allow override",
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to allow connection (${response.status}).`);
  }
};

const pullZraGatewayAttestation = async (robotId: string): Promise<void> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/attestation/pull/zra-gateway`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        robot_id: robotId,
      }),
    },
    {
      ...CORE_API_OPTIONS,
      context: "Pull zRA attestation",
    }
  );
  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { detail?: string };
      detail = payload.detail ?? "";
    } catch {
      detail = await response.text();
    }
    throw new Error(detail || `Failed to pull zRA attestation (${response.status}).`);
  }
};
