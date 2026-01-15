import type { IkResponsePayload } from "@/features/viewer/ik-types";
import { ikBroker } from "./ikBroker";
import {
  DEFAULT_IK_SOLVER_CHAIN,
  buildIkStrategies,
  getSolverChain,
  type OrientationMode,
} from "./registry";
import { solveWithIkfast } from "./ikfastSolver";
import type {
  IkOrientationPayload,
  IkSolvePayload,
  IkSolveResponse,
  IkSolveStrategy,
} from "./types";

type IkClientRequest = {
  requestId?: string;
  apiBaseUrl: string;
  urdf: string;
  jointValues: Record<string, number>;
  targetLink: string;
  targetPosition: [number, number, number];
  orientation?: IkOrientationPayload | null;
  orientationMode?: OrientationMode;
  timeoutMs?: number;
  solverChain?: IkSolveStrategy["solverId"][];
};

type IkClientResult =
  | { ok: true; result: IkResponsePayload }
  | { ok: false; error: string; status?: IkSolveResponse["status"] };

export const isIkFailure = (
  result: IkClientResult
): result is { ok: false; error: string; status?: IkSolveResponse["status"] } =>
  result.ok === false;

const buildRequestId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ik-${Date.now()}-${Math.round(Math.random() * 100000)}`;
};

const parseErrorMessage = async (response: Response) => {
  try {
    const data = await response.json();
    return data?.detail || data?.error || response.statusText;
  } catch {
    return response.statusText;
  }
};

const solveWithHttp = async (
  apiBaseUrl: string,
  payload: IkSolvePayload,
  strategy: IkSolveStrategy,
  timeoutMs: number
): Promise<IkSolveResponse> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${apiBaseUrl}/pyroki/ik`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        urdf: payload.urdf,
        joint_values: payload.jointValues,
        target_link: payload.targetLink,
        target_position: payload.targetPosition,
        target_rotation: strategy.ignoreOrientation ? null : payload.targetRotation ?? null,
        target_wxyz: strategy.ignoreOrientation ? null : payload.targetWxyz ?? null,
        ignore_orientation: strategy.ignoreOrientation,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        requestId: "local",
        ok: false,
        error: await parseErrorMessage(response),
        status: "solver_error",
      };
    }

    const data = (await response.json()) as IkResponsePayload;
    if (!data?.solution) {
      return {
        requestId: "local",
        ok: false,
        error: "IK solve returned no solution",
        status: "solver_error",
      };
    }

    return { requestId: "local", ok: true, result: data };
  } catch (error) {
    if (controller.signal.aborted) {
      return {
        requestId: "local",
        ok: false,
        error: "IK solve timed out",
        status: "timeout",
      };
    }
    return {
      requestId: "local",
      ok: false,
      error: error instanceof Error ? error.message : "IK solve failed",
      status: "solver_error",
    };
  } finally {
    clearTimeout(timeout);
  }
};

const solveWithStrategy = async (
  apiBaseUrl: string,
  payload: IkSolvePayload,
  strategy: IkSolveStrategy,
  timeoutMs: number
): Promise<IkSolveResponse> => {
  if (strategy.solverId === "pyroki-http") {
    return solveWithHttp(apiBaseUrl, payload, strategy, timeoutMs);
  }
  if (strategy.solverId === "ikfast-wasm") {
    const result = await solveWithIkfast(payload, strategy, timeoutMs);
    return { requestId: "local", ...result };
  }
  return {
    requestId: "local",
    ok: false,
    error: `Unknown solver: ${strategy.solverId}`,
    status: "solver_error",
  };
};

const solveInMainThread = async (
  apiBaseUrl: string,
  payload: IkSolvePayload,
  strategies: IkSolveStrategy[],
  timeoutMs: number
): Promise<IkClientResult> => {
  const start = performance.now();
  let lastError = "IK solve failed";
  let lastStatus: IkSolveResponse["status"];

  for (const strategy of strategies) {
    const elapsed = performance.now() - start;
    const remaining = timeoutMs - elapsed;
    if (remaining <= 0) {
      return { ok: false, error: "IK solve timed out", status: "timeout" };
    }

    const result = await solveWithStrategy(apiBaseUrl, payload, strategy, remaining);
    if (result.ok && result.result) {
      return { ok: true, result: result.result };
    }
    lastError = result.error ?? lastError;
    lastStatus = result.status;
  }

  return { ok: false, error: lastError, status: lastStatus };
};

export const solveIk = async (request: IkClientRequest): Promise<IkClientResult> => {
  const orientationMode = request.orientationMode ?? "prefer";
  const hasOrientation = Boolean(request.orientation?.rotation || request.orientation?.wxyz);
  if (orientationMode === "required" && !hasOrientation) {
    return { ok: false, error: "Orientation required but not provided" };
  }

  const payload: IkSolvePayload = {
    urdf: request.urdf,
    jointValues: request.jointValues,
    targetLink: request.targetLink,
    targetPosition: request.targetPosition,
    targetRotation: request.orientation?.rotation ?? null,
    targetWxyz: request.orientation?.wxyz ?? null,
  };

  const solverChain = request.solverChain ?? getSolverChain(request.apiBaseUrl);

  const strategies = buildIkStrategies(
    solverChain ?? DEFAULT_IK_SOLVER_CHAIN,
    orientationMode,
    hasOrientation
  );
  const timeoutMs = request.timeoutMs ?? 1000;

  if (typeof Worker === "undefined") {
    return solveInMainThread(request.apiBaseUrl, payload, strategies, timeoutMs);
  }

  const brokerResponse = await ikBroker.solve({
    requestId: request.requestId ?? buildRequestId(),
    apiBaseUrl: request.apiBaseUrl,
    timeoutMs,
    payload,
    strategies,
  });

  if (brokerResponse.ok && brokerResponse.result) {
    return { ok: true, result: brokerResponse.result };
  }

  if (brokerResponse.status === "worker_error") {
    return solveInMainThread(request.apiBaseUrl, payload, strategies, timeoutMs);
  }

  return {
    ok: false,
    error: brokerResponse.error ?? "IK solve failed",
    status: brokerResponse.status,
  };
};

export const cancelIk = (requestId: string) => {
  ikBroker.cancel(requestId);
};
