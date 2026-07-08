import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";
import { readResponseErrorDetail } from "@/shared/lib/responseErrorDetails";

const SCENARIOS_API_OPTIONS = {
  requiredBackends: ["core-api"] as const,
};

export type ScenarioSummary = {
  scenario_id: string;
  title: string | null;
  task_family: string;
  instruction: string;
  world_package: string;
  default_sims: string[];
  episodes: number;
  success_condition_count: number;
};

export type ScenarioRunStatus = "queued" | "running" | "completed" | "failed";

export type ScenarioRunSummary = {
  run_id: string;
  scenario_id: string;
  sims: string[];
  status: ScenarioRunStatus;
  created_at: string;
  updated_at: string;
  error: string | null;
};

export type ScenarioComparison = {
  scenario_id: string;
  backends: string[];
  summary: Record<
    string,
    {
      completed: number;
      success_count: number;
      success_rate: number;
      mean_time_to_success_s: number | null;
    }
  >;
  divergence: Record<
    string,
    {
      success_agreement_rate: number | null;
      episodes: Array<{
        episode_index: number;
        final_object_pose_delta: Record<string, { position_m: number; rotation_rad: number }>;
        final_joint_rmse_rad: number | null;
      }>;
    }
  >;
};

export type ScenarioRunDetail = ScenarioRunSummary & {
  comparison: ScenarioComparison | null;
  has_report: boolean;
};

const failOn = async (response: Response, fallback: string): Promise<never> => {
  throw new Error(await readResponseErrorDetail(response, { fallback }));
};

export const listScenarios = async (): Promise<ScenarioSummary[]> => {
  const response = await guardedFetch(`${API_BASE_URL}/scenarios`, undefined, {
    ...SCENARIOS_API_OPTIONS,
    context: "Scenario library",
  });
  if (!response.ok) await failOn(response, `Scenario library failed (${response.status})`);
  return ((await response.json()) as { scenarios: ScenarioSummary[] }).scenarios;
};

export const listScenarioRuns = async (): Promise<ScenarioRunSummary[]> => {
  const response = await guardedFetch(`${API_BASE_URL}/scenarios/runs`, undefined, {
    ...SCENARIOS_API_OPTIONS,
    context: "Scenario runs",
  });
  if (!response.ok) await failOn(response, `Scenario runs failed (${response.status})`);
  return ((await response.json()) as { runs: ScenarioRunSummary[] }).runs;
};

export const getScenarioRun = async (runId: string): Promise<ScenarioRunDetail> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/scenarios/runs/${encodeURIComponent(runId)}`,
    undefined,
    { ...SCENARIOS_API_OPTIONS, context: "Scenario run status" }
  );
  if (!response.ok) await failOn(response, `Scenario run status failed (${response.status})`);
  return (await response.json()) as ScenarioRunDetail;
};

export const createScenarioRun = async (
  scenarioId: string,
  sims: string[],
  episodes?: number
): Promise<ScenarioRunSummary> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/scenarios/${encodeURIComponent(scenarioId)}/runs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sims, episodes: episodes ?? null }),
    },
    { ...SCENARIOS_API_OPTIONS, context: "Scenario run" }
  );
  if (!response.ok) await failOn(response, `Scenario run failed (${response.status})`);
  return (await response.json()) as ScenarioRunSummary;
};

export const scenarioRunReportUrl = (runId: string): string =>
  `${API_BASE_URL}/scenarios/runs/${encodeURIComponent(runId)}/report`;

export type ScenarioAuthoringRequest = {
  name: string;
  world: unknown;
  waypoints: unknown;
  target_object_id: string;
  container_object_id: string;
  attach_link?: string | null;
  robot_urdf?: string | null;
};

export const saveAuthoredScenario = async (
  request: ScenarioAuthoringRequest
): Promise<ScenarioSummary> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/scenarios/authored`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
    { ...SCENARIOS_API_OPTIONS, context: "Save recorded scenario" }
  );
  if (!response.ok) await failOn(response, `Save recorded scenario failed (${response.status})`);
  return (await response.json()) as ScenarioSummary;
};
