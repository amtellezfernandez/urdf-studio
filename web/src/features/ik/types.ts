import type { IkResponsePayload } from "@/features/viewer/ik-types";

export type IkSolverId =
  | "lerobot-placo"
  | "amik"
  | "ikfast-wasm"
  | "ik-js";

export type IkSolverMeta = {
  id: IkSolverId;
  label: string;
  description?: string;
  mode?: string;
  capabilities?: string[];
  requirements?: string[];
  source?: "server" | "local";
};

export type IkOrientationPayload = {
  rotation: number[][];
  wxyz: [number, number, number, number];
};

type IkOrientationMode =
  | "required"
  | "optional"
  | "prefer"
  | "ignore"
  | "position_first";

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
  solverChain: IkSolverId[];
  orientationMode?: IkOrientationMode;
};

export type IkSolveResponse = {
  requestId: string;
  ok: boolean;
  result?: IkResponsePayload;
  error?: string;
  status?: "timeout" | "cancelled" | "solver_error" | "worker_error";
};

export type IkConfigResponse = {
  version?: string;
  timeouts?: {
    request_ms?: number;
    drag_ms?: number;
    orbit_ms?: number;
  };
  drag?: {
    max_drag_speed?: number;
    min_solve_distance?: number;
    spring_strength?: number;
    spring_damping?: number;
    snap_distance?: number;
    reach_margin?: number;
    ik_throttle_ms?: number;
    max_link_traversal?: number;
  };
  orbit?: {
    radius?: number;
    inclination_deg?: number;
    phase_deg?: number;
    secondary_offset_deg?: number;
  };
  solver_tuning?: Record<
    string,
    {
      position_weight?: number;
      orientation_weight?: number;
      posture_weight?: number;
      velocity_dt?: number;
      limit_weight?: number;
      smooth_alpha?: number;
      max_step_delta?: number;
      max_blend_delta?: number;
      solve_iterations?: number;
    }
  >;
  tolerances?: {
    position_tolerance?: number;
    orientation_tolerance?: number;
  };
};
