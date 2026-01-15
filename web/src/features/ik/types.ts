import type { IkResponsePayload } from "@/features/viewer/ik-types";

export type IkSolverId = "pyroki-http" | "ikfast-wasm";

export type IkOrientationPayload = {
  rotation: number[][];
  wxyz: [number, number, number, number];
};

export type IkSolvePayload = {
  urdf: string;
  jointValues: Record<string, number>;
  targetLink: string;
  targetPosition: [number, number, number];
  targetRotation?: number[][] | null;
  targetWxyz?: [number, number, number, number] | null;
};

export type IkSolveStrategy = {
  solverId: IkSolverId;
  ignoreOrientation: boolean;
};

export type IkSolveRequest = {
  requestId: string;
  apiBaseUrl: string;
  timeoutMs: number;
  payload: IkSolvePayload;
  strategies: IkSolveStrategy[];
};

export type IkSolveResponse = {
  requestId: string;
  ok: boolean;
  result?: IkResponsePayload;
  error?: string;
  status?: "timeout" | "cancelled" | "solver_error" | "worker_error";
};
