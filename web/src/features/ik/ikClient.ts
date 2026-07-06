import type { IkResponsePayload } from "@/features/viewer/ik-types";
import { ikBroker } from "./ikBroker";
import {
  DEFAULT_IK_SOLVER_CHAIN,
  buildIkStrategies,
  getSolverChain,
  type OrientationMode,
} from "./registry";
import { solveWithIkfast } from "./ikfastSolver";
import { solveWithIkJs } from "./ikJsSolver";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import { readUnknownErrorMessage } from "@/shared/lib/errorMessages";
import { requestIkRemoteSolve } from "./ikRemoteSolve";
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

const solveWithBackend = async (
  apiBaseUrl: string,
  payload: IkSolvePayload,
  solverChain: IkSolveStrategy["solverId"][],
  orientationMode: OrientationMode,
  timeoutMs: number
): Promise<IkSolveResponse> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await requestIkRemoteSolve({
      apiBaseUrl,
      payload,
      solverChain,
      orientationMode,
      signal: controller.signal,
      context: "IK remote solve",
    });

    if (result.ok === true) {
      return { requestId: "local", ok: true, result: result.result };
    }

    return { requestId: "local", ok: false, error: result.error, status: result.status };
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
      error: readUnknownErrorMessage(error, "IK solve failed"),
      status: "solver_error",
    };
  } finally {
    clearTimeout(timeout);
  }
};

const LOCAL_SOLVER_IDS = new Set<IkSolveStrategy["solverId"]>([
  "ikfast-wasm",
  "ik-js",
]);

const solveWithLocalStrategy = async (
  payload: IkSolvePayload,
  strategy: IkSolveStrategy,
  remainingMs: number
) => {
  if (strategy.solverId === "ikfast-wasm") {
    return solveWithIkfast(payload, strategy, remainingMs);
  }

  if (strategy.solverId === "ik-js") {
    return solveWithIkJs(payload, strategy, remainingMs);
  }

  return { ok: false, error: `Unknown solver: ${strategy.solverId}`, status: "solver_error" as const };
};

const solveWithLocalStrategies = async (
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

    const result = await solveWithLocalStrategy(payload, strategy, remaining);
    if (result.ok && result.result) {
      return { ok: true, result: result.result };
    }
    lastError = result.error ?? lastError;
    lastStatus = result.status;
  }

  return { ok: false, error: lastError, status: lastStatus };
};

const solveInMainThread = async (
  apiBaseUrl: string,
  payload: IkSolvePayload,
  solverChain: IkSolveStrategy["solverId"][],
  orientationMode: OrientationMode,
  timeoutMs: number
): Promise<IkClientResult> => {
  const start = performance.now();
  const localStrategies = buildIkStrategies(
    solverChain.filter((solverId) => LOCAL_SOLVER_IDS.has(solverId)),
    orientationMode,
    Boolean(payload.targetRotation || payload.targetWxyz)
  );

  if (localStrategies.length > 0) {
    const localResult = await solveWithLocalStrategies(payload, localStrategies, timeoutMs);
    if (localResult.ok) {
      return localResult;
    }
  }

  const elapsed = performance.now() - start;
  const remaining = timeoutMs - elapsed;
  const remoteChain = solverChain.filter((solverId) => !LOCAL_SOLVER_IDS.has(solverId));
  if (remaining <= 0 || remoteChain.length === 0) {
    return { ok: false, error: "IK solve timed out", status: "timeout" };
  }

  const result = await solveWithBackend(apiBaseUrl, payload, remoteChain, orientationMode, remaining);
  if (result.ok && result.result) {
    return { ok: true, result: result.result };
  }
  return { ok: false, error: result.error ?? "IK solve failed", status: result.status };
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

  const resolvedChain = solverChain ?? DEFAULT_IK_SOLVER_CHAIN;
  const timeoutMs = request.timeoutMs ?? 1000;

  const shouldBypassWorker =
    !FEATURE_GATES.ikRemoteSolve.enabled || resolvedChain.some((solverId) => solverId === "ik-js");

  if (typeof Worker === "undefined" || shouldBypassWorker) {
    return solveInMainThread(request.apiBaseUrl, payload, resolvedChain, orientationMode, timeoutMs);
  }

  const brokerResponse = await ikBroker.solve({
    requestId: request.requestId ?? buildRequestId(),
    apiBaseUrl: request.apiBaseUrl,
    timeoutMs,
    payload,
    solverChain: resolvedChain,
    orientationMode,
  });

  if (brokerResponse.ok && brokerResponse.result) {
    return { ok: true, result: brokerResponse.result };
  }

  if (brokerResponse.status === "worker_error") {
    return solveInMainThread(
      request.apiBaseUrl,
      payload,
      resolvedChain,
      orientationMode,
      timeoutMs
    );
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
