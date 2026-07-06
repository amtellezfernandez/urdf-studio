import type { IkResponsePayload } from "@/features/viewer/ik-types";
import type { IkSolvePayload, IkSolveResponse, IkSolveStrategy } from "./types";
import { IK_RUNTIME_CONFIG } from "@/shared/config/runtime";
import { readUnknownErrorMessage } from "@/shared/lib/errorMessages";

type IkfastModuleConfig = {
  moduleUrl?: string;
  factoryExport?: string;
  solveExport?: string;
  init?: Record<string, unknown>;
};

type IkfastSolver = {
  solve: (payload: IkSolvePayload) => Promise<unknown> | unknown;
};

const IKFAST_FACTORY_EXPORT = "createIkfastSolver";
const IKFAST_SOLVE_EXPORT = "solveIk";
const IKFAST_DIAGNOSTICS: IkResponsePayload["diagnostics"] = {
  termination_reason: "ikfast",
  termination_flags: [],
  iterations: 1,
  cost: 0,
  lambda_final: 0,
  validity: "unknown",
  stability: "unknown",
  degeneracy: "unknown",
  branch_maybe: false,
  branch_metric: 0,
  branch_message: "",
};

const solverCache = new Map<string, Promise<IkfastSolver>>();

const getIkfastConfig = (): IkfastModuleConfig => IK_RUNTIME_CONFIG?.ikfast ?? {};

export const isIkfastAvailable = () => {
  const config = getIkfastConfig();
  return Boolean(config?.moduleUrl) && typeof WebAssembly !== "undefined";
};

const resolveModuleUrl = (url: string) => {
  if (url.startsWith("/") && typeof location !== "undefined") {
    return new URL(url, location.origin).toString();
  }
  return url;
};

const parseRobotName = (urdf: string) => {
  const match = urdf.match(/<robot\b[^>]*\bname=["']([^"']+)["']/i);
  return match?.[1] ?? null;
};

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number) => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("IK solve timed out"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
};

const normalizeIkfastResponse = (
  payload: IkSolvePayload,
  response: unknown
): IkResponsePayload | null => {
  if (!response || typeof response !== "object") {
    return null;
  }

  if ("solution" in response) {
    const result = response as IkResponsePayload;
    return {
      ...result,
      diagnostics: result.diagnostics ?? IKFAST_DIAGNOSTICS,
      metadata: result.metadata ?? { target_link: payload.targetLink },
    };
  }

  return {
    solution: response as Record<string, number>,
    diagnostics: IKFAST_DIAGNOSTICS,
    metadata: { target_link: payload.targetLink },
  };
};

const getIkfastSolver = async (payload: IkSolvePayload): Promise<IkfastSolver> => {
  const config = getIkfastConfig();
  if (!config.moduleUrl) {
    throw new Error("IKFast module not configured");
  }

  const robotName = parseRobotName(payload.urdf) ?? "unknown";
  const resolvedUrl = resolveModuleUrl(config.moduleUrl);
  const cacheKey = `${resolvedUrl}::${robotName}`;
  const cached = solverCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const modulePromise = (async () => {
    const module = await import(/* @vite-ignore */ resolvedUrl);
    const factoryName = config.factoryExport ?? IKFAST_FACTORY_EXPORT;
    const solveName = config.solveExport ?? IKFAST_SOLVE_EXPORT;

    const factory = module?.[factoryName] ?? module?.default;
    if (typeof factory === "function") {
      const solver = await factory({
        robotName,
        urdf: payload.urdf,
        config,
        ...(config.init ?? {}),
      });
      if (solver && typeof solver.solve === "function") {
        return solver as IkfastSolver;
      }
    }

    const solverFn = module?.[solveName] ?? module?.default;
    if (typeof solverFn === "function") {
      return { solve: solverFn };
    }

    if (module?.default?.solve && typeof module.default.solve === "function") {
      return { solve: module.default.solve };
    }

    throw new Error(`IKFast module missing ${factoryName} or ${solveName}`);
  })();

  solverCache.set(cacheKey, modulePromise);
  return modulePromise;
};

export const solveWithIkfast = async (
  payload: IkSolvePayload,
  strategy: IkSolveStrategy,
  timeoutMs: number
): Promise<{
  ok: boolean;
  result?: IkResponsePayload;
  error?: string;
  status?: IkSolveResponse["status"];
}> => {
  if (!isIkfastAvailable()) {
    return { ok: false, error: "IKFast module not available", status: "solver_error" };
  }

  const effectivePayload: IkSolvePayload = {
    ...payload,
    targetRotation: strategy.ignoreOrientation ? null : payload.targetRotation ?? null,
    targetWxyz: strategy.ignoreOrientation ? null : payload.targetWxyz ?? null,
  };

  try {
    const solver = await getIkfastSolver(effectivePayload);
    const response = await withTimeout(
      Promise.resolve(solver.solve(effectivePayload)),
      timeoutMs
    );
    const normalized = normalizeIkfastResponse(effectivePayload, response);
    if (!normalized) {
      return {
        ok: false,
        error: "IKFast solve returned no solution",
        status: "solver_error",
      };
    }
    return { ok: true, result: normalized };
  } catch (error) {
    const message = readUnknownErrorMessage(error, "IKFast solve failed");
    const status = message.includes("timed out") ? "timeout" : "solver_error";
    return { ok: false, error: message, status };
  }
};
