import type { WorldScenePackageManifest } from "@/features/world-share/worldScenePackageTypes";

export type WorldRolloutArtifactRef = {
  kind: string;
  uri: string;
  digest_sha256?: string | null;
  metadata: Record<string, unknown>;
};

export type WorldRolloutModuleSpec = {
  module_id: string;
  tier: string;
  role: string;
  trigger?: string | null;
  latency_budget_ms?: number | null;
  params: Record<string, unknown>;
};

export type WorldRolloutCheckerProfile = {
  schema_version: string;
  profile_id: string;
  target_id: string;
  description?: string | null;
  params: Record<string, unknown>;
  modules: WorldRolloutModuleSpec[];
  artifacts: WorldRolloutArtifactRef[];
};

export type WorldRolloutPackageRef = {
  package_id: string;
  version: string;
  digest_sha256?: string | null;
};

export type WorldRolloutRunnerSpec = {
  kind: string;
  tool?: string | null;
  params: Record<string, unknown>;
};

export type WorldRolloutCampaignManifest = {
  schema_version: string;
  campaign_id: string;
  created_at: string;
  world_package: WorldRolloutPackageRef;
  checker_profile: WorldRolloutCheckerProfile;
  rollout_params: Record<string, unknown>;
  runner: WorldRolloutRunnerSpec;
  artifacts: WorldRolloutArtifactRef[];
};

export type WorldRolloutTraceRecord = {
  t_ms: number;
  stream: string;
  module_id?: string | null;
  tier?: string | null;
  state: Record<string, unknown>;
  semantic_outputs: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type WorldRolloutDecisionRecord = {
  t_ms?: number | null;
  module_id?: string | null;
  tier?: string | null;
  subject_ref?: string | null;
  decision: "allow" | "warn" | "reject" | "stop" | "escalate";
  rule_id: string;
  message?: string | null;
  confidence?: number | null;
  metrics: Record<string, unknown>;
  semantic_outputs: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type WorldRolloutJobCreateRequest = {
  world_package: WorldScenePackageManifest;
  checker_profile: WorldRolloutCheckerProfile;
  campaign_id?: string;
  rollout_params: Record<string, unknown>;
  runner_params: Record<string, unknown>;
};

export type WorldRolloutJobResponse = {
  job_id: string;
  status: "queued" | "running" | "completed" | "failed";
  created_at: string;
  updated_at: string;
  campaign: WorldRolloutCampaignManifest;
  output_manifest_path?: string | null;
  trace_record_count: number;
  decision_count: number;
  reject_count: number;
  warn_count: number;
  stop_count: number;
  escalation_count: number;
  error?: string | null;
  stdout?: string | null;
  stderr?: string | null;
};

export type WorldRolloutImportRequest = {
  campaign: WorldRolloutCampaignManifest;
  trace_ndjson: string;
  decisions_ndjson: string;
};

export type WorldRolloutImportResponse = {
  campaign: WorldRolloutCampaignManifest;
  trace_records: WorldRolloutTraceRecord[];
  decisions: WorldRolloutDecisionRecord[];
  trace_record_count: number;
  decision_count: number;
  reject_count: number;
  warn_count: number;
  stop_count: number;
  escalation_count: number;
};
