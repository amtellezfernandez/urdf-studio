import type { IkResponsePayload } from "@/features/viewer/ik-types";
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
  typeof performance !== "undefined" &&
  Boolean((self as any).__URDF_METRICS__ || (import.meta as any).env?.VITE_ENABLE_METRICS === "1");

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
  strategy: IkSolveStrategy,
  remainingMs: number,
  endpoint: "pyroki" | "lerobot"
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
      target_rotation: strategy.ignoreOrientation ? null : request.payload.targetRotation ?? null,
      target_wxyz: strategy.ignoreOrientation ? null : request.payload.targetWxyz ?? null,
      ignore_orientation: strategy.ignoreOrientation,
    };

    const response = await fetch(`${request.apiBaseUrl}/${endpoint}/ik`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
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
        endpoint,
        solver: strategy.solverId,
        ok: okFlag,
        status,
        durationMs: performance.now() - start,
        remainingBudgetMs: remainingMs,
      });
    }
  }
};

const solveWithStrategy = async (
  request: IkSolveRequest,
  strategy: IkSolveStrategy,
  remainingMs: number
) => {
  if (strategy.solverId === "pyroki-http") {
    return solveWithBackend(request, strategy, remainingMs, "pyroki");
  }
  if (strategy.solverId === "lerobot-placo") {
    return solveWithBackend(request, strategy, remainingMs, "lerobot");
  }
  if (strategy.solverId === "ikfast-wasm") {
    return solveWithIkfast(request.payload, strategy, remainingMs);
  }

  return { ok: false, error: `Unknown solver: ${strategy.solverId}`, status: "solver_error" as const };
};

const runRequest = async (request: IkSolveRequest) => {
  const startTime = performance.now();
  let lastError: string | undefined;
  let lastStatus: IkSolveResponse["status"];

  for (const strategy of request.strategies) {
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

    const attempt = await solveWithStrategy(request, strategy, remainingMs);
    if (attempt.ok && attempt.result) {
      postResult({ requestId: request.requestId, ok: true, result: attempt.result });
      return;
    }

    lastError = attempt.error;
    lastStatus = attempt.status;
  }

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
