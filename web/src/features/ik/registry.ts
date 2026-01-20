import type { IkSolverId, IkSolveStrategy, IkSolverMeta } from "./types";
import { IK_RUNTIME_CONFIG } from "@/shared/config/runtime";
import { isIkfastAvailable } from "./ikfastSolver";

const KNOWN_SOLVER_IDS = new Set<IkSolverId>([
  "pyroki-http",
  "lerobot-placo",
  "ikfast-wasm",
]);

export const LOCAL_SOLVER_DEFS: IkSolverMeta[] = [
  {
    id: "ikfast-wasm",
    label: "IKFast (WASM)",
    description: "Analytic solver adapter (WASM module).",
    capabilities: ["Analytic", "Fast"],
    requirements: ["WASM"],
    source: "local",
  },
];

const normalizeSolverChain = (chain: unknown): IkSolverId[] => {
  if (!Array.isArray(chain)) return [];
  return chain.filter(
    (solverId): solverId is IkSolverId =>
      typeof solverId === "string" && KNOWN_SOLVER_IDS.has(solverId as IkSolverId)
  );
};

const mergeSolverChains = (primary: IkSolverId[], fallback: IkSolverId[]) => {
  const next: IkSolverId[] = [];
  const seen = new Set<IkSolverId>();
  for (const solverId of primary) {
    if (!seen.has(solverId)) {
      seen.add(solverId);
      next.push(solverId);
    }
  }
  for (const solverId of fallback) {
    if (!seen.has(solverId)) {
      seen.add(solverId);
      next.push(solverId);
    }
  }
  return next;
};

const FALLBACK_CHAIN: IkSolverId[] = ["pyroki-http"];

export const DEFAULT_IK_SOLVER_CHAIN: IkSolverId[] = (() => {
  const configured = normalizeSolverChain(IK_RUNTIME_CONFIG?.defaultSolverChain);
  const base = configured.length > 0 ? configured : FALLBACK_CHAIN;
  const withPyroki = mergeSolverChains(["pyroki-http"], base);
  const localOverrides: IkSolverId[] = isIkfastAvailable() ? ["ikfast-wasm"] : [];
  return mergeSolverChains(withPyroki, localOverrides);
})();

export type OrientationMode = "required" | "optional" | "prefer" | "ignore";

export const buildIkStrategies = (
  solverChain: IkSolverId[],
  orientationMode: OrientationMode,
  hasOrientation: boolean
): IkSolveStrategy[] => {
  const attempts: boolean[] = [];

  if (orientationMode === "ignore") {
    attempts.push(true);
  } else if (!hasOrientation) {
    attempts.push(true);
  } else if (orientationMode === "required") {
    attempts.push(false);
  } else if (orientationMode === "optional") {
    attempts.push(true, false);
  } else {
    // "prefer" - strict orientation then fallback
    attempts.push(false, true);
  }

  return solverChain.flatMap((solverId) =>
    attempts.map((ignoreOrientation) => ({ solverId, ignoreOrientation }))
  );
};

const solverChainCache = new Map<string, IkSolverId[]>();
const solverChainPromises = new Map<string, Promise<IkSolverId[]>>();

const fetchServerSolverChain = async (apiBaseUrl: string): Promise<IkSolverId[]> => {
  const response = await fetch(`${apiBaseUrl}/ik/solvers`);
  if (!response.ok) {
    return [];
  }
  const data = (await response.json()) as {
    solvers?: Array<{ id?: string } | string>;
    default_chain?: string[];
  };

  const directChain = normalizeSolverChain(data?.default_chain);
  if (directChain.length > 0) {
    return directChain;
  }

  if (Array.isArray(data?.solvers)) {
    const solverIds = data.solvers
      .map((entry) => (typeof entry === "string" ? entry : entry?.id))
      .filter((id): id is string => typeof id === "string");
    return normalizeSolverChain(solverIds);
  }

  return [];
};

const requestSolverChain = (apiBaseUrl: string) => {
  const cached = solverChainPromises.get(apiBaseUrl);
  if (cached) {
    return cached;
  }

  const promise = (async () => {
    let chain = DEFAULT_IK_SOLVER_CHAIN;
    try {
      const serverChain = await fetchServerSolverChain(apiBaseUrl);
      if (serverChain.length > 0) {
        const withPyroki = mergeSolverChains(["pyroki-http"], serverChain);
        const localOverrides: IkSolverId[] = isIkfastAvailable() ? ["ikfast-wasm"] : [];
        chain = mergeSolverChains(withPyroki, localOverrides);
      }
    } catch {
      // Ignore solver autodetect failures and stick with defaults.
    }
    solverChainCache.set(apiBaseUrl, chain);
    solverChainPromises.delete(apiBaseUrl);
    return chain;
  })();

  solverChainPromises.set(apiBaseUrl, promise);
  return promise;
};


export const getSolverChain = (apiBaseUrl: string) => {
  const cached = solverChainCache.get(apiBaseUrl);
  if (cached) {
    return cached;
  }
  void requestSolverChain(apiBaseUrl);
  return DEFAULT_IK_SOLVER_CHAIN;
};
