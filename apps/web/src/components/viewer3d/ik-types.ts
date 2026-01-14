export interface IkDiagnostics {
  termination_reason: string;
  termination_flags: boolean[];
  iterations: number;
  cost: number;
  lambda_final: number;
  validity: string;
  stability: string;
  degeneracy: string;
  branch_maybe: boolean;
  branch_metric: number;
  branch_message: string;
}

export interface IkResponsePayload {
  solution: Record<string, number>;
  diagnostics: IkDiagnostics;
  metadata: {
    target_link: string;
    actuated_joint_names?: string[];
  };
}
