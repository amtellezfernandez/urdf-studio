import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";

export type VerifiableRoboticsPositionSample = {
  x: number;
  y: number;
  t_ms: number;
};

export type VerifiableRoboticsRestrictedRegion = {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
};

export type VerifiableRoboticsProofResponse = {
  accepted: boolean;
  mode: string;
  trace_length: number;
  policy_satisfied: boolean | null;
  trace_digest_hex: string | null;
  execution_millis: number | null;
  proving_millis: number | null;
  trace_path: string | null;
  policy_path: string | null;
  report_path: string | null;
  messages: string[];
};

const CORE_API_OPTIONS = {
  requiredBackends: ["core-api"] as const,
};

export const proveVerifiableRoboticsExecution = async (payload: {
  robot_id: string;
  session_id: string;
  mode?: "execute" | "prove";
  samples: VerifiableRoboticsPositionSample[];
  workspace: {
    min_x: number;
    max_x: number;
    min_y: number;
    max_y: number;
  };
  forbidden_regions: VerifiableRoboticsRestrictedRegion[];
  max_step_l1_distance: number;
  max_step_delta_l1_distance?: number | null;
  quantization_scale?: number;
}): Promise<VerifiableRoboticsProofResponse> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/runtime/sessions/integrations/verifiable-robotics/prove`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    {
      ...CORE_API_OPTIONS,
      context: "Verifiable robotics proof",
    }
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Verifiable robotics proof failed (${response.status})`);
  }
  return (await response.json()) as VerifiableRoboticsProofResponse;
};
