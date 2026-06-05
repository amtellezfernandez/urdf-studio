import { API_BASE_URL } from "@/shared/config/api";
import { withBackendRequestHeaders } from "@/shared/lib/backendRequest";

export type SimulationPrepGeometryResult = {
  geom_name: string;
  mesh_file: string;
  staged: boolean;
  mujoco_loaded: boolean | null;
  authored_position: number[] | null;
  authored_quaternion: number[] | null;
  scale: number[] | null;
  error: string | null;
};

export type SimulationPrepSmokeSimResult = {
  ran: boolean;
  steps: number;
  passed: boolean;
  error: string | null;
};

export type SimulationPrepValidationReport = {
  success: boolean;
  error: string | null;
  geometry_count: number;
  geometries: SimulationPrepGeometryResult[];
  smoke_simulation: SimulationPrepSmokeSimResult | null;
  mujoco_available: boolean;
  warnings: string[];
};

const extractBasename = (ref: string): string => {
  const stripped = ref.includes("://") ? ref.split("://")[1] ?? ref : ref;
  return stripped.split("/").pop() || stripped;
};

export const validateSimulationPrep = async (
  urdfContent: string,
  meshFiles: Record<string, Blob>,
  signal?: AbortSignal
): Promise<SimulationPrepValidationReport> => {
  const form = new FormData();
  form.append("urdf_file", new Blob([urdfContent], { type: "text/xml" }), "robot.urdf");

  for (const [ref, blob] of Object.entries(meshFiles)) {
    form.append("mesh_files", blob, extractBasename(ref));
  }

  const { init } = withBackendRequestHeaders({ signal });
  const response = await fetch(`${API_BASE_URL}/simulation-prep/validate`, {
    ...init,
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Simulation prep validation failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<SimulationPrepValidationReport>;
};
