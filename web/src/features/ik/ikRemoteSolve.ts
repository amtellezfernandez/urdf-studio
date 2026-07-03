import type { IkResponsePayload } from "@/features/viewer/ik-types";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import { guardedFetch } from "@/shared/lib/backendGuard";
import type { OrientationMode } from "./registry";
import type { IkSolvePayload, IkSolveResponse, IkSolveStrategy } from "./types";

type IkRemoteSolveResult =
  | { ok: true; result: IkResponsePayload }
  | { ok: false; error: string; status: IkSolveResponse["status"] };

const parseIkRemoteErrorMessage = async (response: Response) => {
  try {
    const data = await response.json();
    return data?.detail || data?.error || response.statusText;
  } catch {
    return response.statusText;
  }
};

const buildIkRemoteSolveBody = (
  payload: IkSolvePayload,
  solverChain: IkSolveStrategy["solverId"][],
  orientationMode: OrientationMode
) => ({
  urdf: payload.urdf,
  joint_values: payload.jointValues,
  target_link: payload.targetLink,
  target_position: payload.targetPosition,
  target_rotation: payload.targetRotation ?? null,
  target_wxyz: payload.targetWxyz ?? null,
  solver_chain: solverChain,
  orientation_mode: orientationMode,
});

export const requestIkRemoteSolve = async ({
  apiBaseUrl,
  payload,
  solverChain,
  orientationMode,
  signal,
  context,
}: {
  apiBaseUrl: string;
  payload: IkSolvePayload;
  solverChain: IkSolveStrategy["solverId"][];
  orientationMode: OrientationMode;
  signal: AbortSignal;
  context: string;
}): Promise<IkRemoteSolveResult> => {
  const response = await guardedFetch(`${apiBaseUrl}/ik/solve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildIkRemoteSolveBody(payload, solverChain, orientationMode)),
    signal,
  }, {
    requiredBackends: FEATURE_GATES.ikRemoteSolve.requiredBackends,
    context,
  });

  if (!response.ok) {
    return {
      ok: false,
      error: await parseIkRemoteErrorMessage(response),
      status: "solver_error",
    };
  }

  const data = (await response.json()) as IkResponsePayload;
  if (!data?.solution) {
    return {
      ok: false,
      error: "IK solve returned no solution",
      status: "solver_error",
    };
  }

  return { ok: true, result: data };
};
