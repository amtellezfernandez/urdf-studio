import type { IkResponsePayload } from "@/features/viewer/ik-types";
import { isMetricsEnabled } from "@/shared/lib/metrics";
import { guardedFetch } from "@/shared/lib/backendGuard";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import { buildIkStrategies, type OrientationMode } from "./registry";
import type { IkSolveRequest, IkSolveResponse, IkSolveStrategy } from "./types";
import { solveWithIkfast } from "./ikfastSolver";

type SolveMessage = {
  type: "solve";
  request: IkSolveRequest;
};

type CancelMessage = {
  type: "cancel";
  requestId: string;
};

type WorkerMessage = SolveMessage | CancelMessage;

const inFlightControllers = new Map<string, AbortController>();
const cancelledRequests = new Set<string>();
const queue: IkSolveRequest[] = [];
const inFlight = new Set<string>();
const MAX_CONCURRENT = 2;
const metricsEnabled =
  typeof performance !== "undefined" && isMetricsEnabled(self, import.meta.env);

const logMetric = (name: string, payload: Record<string, unknown>) => {
  if (!metricsEnabled) return;
  console.debug(`[metrics] ${name}`, { t_ms: performance.now(), ...payload });
};

const postResult = (response: IkSolveResponse) => {
  self.postMessage(response);
};

const parseErrorMessage = async (response: Response) => {
  try {
    const data = await response.json();
    return data?.detail || data?.error || response.statusText;
  } catch {
    return response.statusText;
  }
};

const solveWithBackend = async (
  request: IkSolveRequest,
  solverChain: IkSolveStrategy["solverId"][],
  orientationMode: OrientationMode,
  remainingMs: number,
): Promise<{
  ok: boolean;
  result?: IkResponsePayload;
  error?: string;
  status?: IkSolveResponse["status"];
}> => {
  const start = metricsEnabled ? performance.now() : 0;
  const controller = new AbortController();
  inFlightControllers.set(request.requestId, controller);
  const timeout = setTimeout(() => controller.abort(), remainingMs);
  let status: IkSolveResponse["status"] | undefined;
  let okFlag = false;

  try {
    const payload = {
      urdf: request.payload.urdf,
      joint_values: request.payload.jointValues,
      target_link: request.payload.targetLink,
      target_position: request.payload.targetPosition,
      target_rotation: request.payload.targetRotation ?? null,
      target_wxyz: request.payload.targetWxyz ?? null,
      solver_chain: solverChain,
      orientation_mode: orientationMode,
    };

    const response = await guardedFetch(`${request.apiBaseUrl}/ik/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }, {
      requiredBackends: FEATURE_GATES.ikRemoteSolve.requiredBackends,
      context: "IK worker remote solve",
    });

    if (!response.ok) {
      status = "solver_error";
      return { ok: false, error: await parseErrorMessage(response), status };
    }

    const data = (await response.json()) as IkResponsePayload;
    if (!data?.solution) {
      status = "solver_error";
      return { ok: false, error: "IK solve returned no solution", status };
    }

    okFlag = true;
    return { ok: true, result: data };
  } catch (error) {
    if (controller.signal.aborted) {
      status = cancelledRequests.has(request.requestId) ? "cancelled" : "timeout";
      return { ok: false, error: "IK solve aborted", status };
    }
    status = "solver_error";
    return {
      ok: false,
      error: error instanceof Error ? error.message : "IK solve failed",
      status,
    };
  } finally {
    clearTimeout(timeout);
    if (inFlightControllers.get(request.requestId) === controller) {
      inFlightControllers.delete(request.requestId);
    }
    if (metricsEnabled) {
      logMetric("ik.backend", {
        solverChain,
        ok: okFlag,
        status,
        durationMs: performance.now() - start,
        remainingBudgetMs: remainingMs,
      });
    }
  }
};

const solveWithLocalStrategies = async (
  request: IkSolveRequest,
  strategy: IkSolveStrategy,
  remainingMs: number
) => {
  if (strategy.solverId === "ikfast-wasm") {
    return solveWithIkfast(request.payload, strategy, remainingMs);
  }

  return { ok: false, error: `Unknown solver: ${strategy.solverId}`, status: "solver_error" as const };
};

const runRequest = async (request: IkSolveRequest) => {
  const startTime = performance.now();
  const hasOrientation = Boolean(
    request.payload.targetRotation || request.payload.targetWxyz
  );
  const orientationMode = (request.orientationMode ?? "prefer") as OrientationMode;
  const solverChain = request.solverChain ?? [];
  const localChain = solverChain.filter((solverId) => solverId === "ikfast-wasm");
  const remoteChain = solverChain.filter((solverId) => solverId !== "ikfast-wasm");

  let lastError: string | undefined;
  let lastStatus: IkSolveResponse["status"];

  const localStrategies = buildIkStrategies(localChain, orientationMode, hasOrientation);
  for (const strategy of localStrategies) {
    if (cancelledRequests.has(request.requestId)) {
      postResult({
        requestId: request.requestId,
        ok: false,
        error: "IK solve cancelled",
        status: "cancelled",
      });
      return;
    }

    const elapsed = performance.now() - startTime;
    const remainingMs = request.timeoutMs - elapsed;
    if (remainingMs <= 0) {
      postResult({
        requestId: request.requestId,
        ok: false,
        error: "IK solve timed out",
        status: "timeout",
      });
      return;
    }

    const attempt = await solveWithLocalStrategies(request, strategy, remainingMs);
    if (attempt.ok && attempt.result) {
      postResult({ requestId: request.requestId, ok: true, result: attempt.result });
      return;
    }

    lastError = attempt.error;
    lastStatus = attempt.status;
  }

  const elapsed = performance.now() - startTime;
  const remainingMs = request.timeoutMs - elapsed;
  if (remainingMs <= 0 || remoteChain.length === 0) {
    postResult({
      requestId: request.requestId,
      ok: false,
      error: lastError ?? "IK solve timed out",
      status: lastStatus ?? "timeout",
    });
    return;
  }

  const backendAttempt = await solveWithBackend(
    request,
    remoteChain,
    orientationMode,
    remainingMs
  );
  if (backendAttempt.ok && backendAttempt.result) {
    postResult({ requestId: request.requestId, ok: true, result: backendAttempt.result });
    return;
  }

  lastError = backendAttempt.error ?? lastError;
  lastStatus = backendAttempt.status ?? lastStatus;

  postResult({
    requestId: request.requestId,
    ok: false,
    error: lastError ?? "IK solve failed",
    status: lastStatus ?? "solver_error",
  });
};

const pump = () => {
  while (inFlight.size < MAX_CONCURRENT && queue.length > 0) {
    const request = queue.shift();
    if (!request) break;
    inFlight.add(request.requestId);
    runRequest(request)
      .catch(() => {
        postResult({
          requestId: request.requestId,
          ok: false,
          error: "IK worker failed",
          status: "worker_error",
        });
      })
      .finally(() => {
        inFlight.delete(request.requestId);
        cancelledRequests.delete(request.requestId);
        pump();
      });
  }
};

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  if (message.type === "cancel") {
    cancelledRequests.add(message.requestId);
    const controller = inFlightControllers.get(message.requestId);
    if (controller) {
      controller.abort();
    }
    const queuedIndex = queue.findIndex((req) => req.requestId === message.requestId);
    if (queuedIndex >= 0) {
      queue.splice(queuedIndex, 1);
    }
    return;
  }

  queue.push(message.request);
  pump();
};
