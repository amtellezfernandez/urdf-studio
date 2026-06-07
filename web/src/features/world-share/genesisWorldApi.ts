import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";
import { withBackendRequestHeaders } from "@/shared/lib/backendRequest";

export type GenesisDynamicContainerMode = "mesh" | "box" | "visual-only";
export type GenesisWorldRobotMode = "so101" | "crane";

export type GenesisWorldOpenResponse = {
  started: boolean;
  pid: number;
  command: string[];
  dynamic_container_mode: GenesisDynamicContainerMode;
  robot_mode: GenesisWorldRobotMode;
  log_path?: string | null;
};

export type GenesisWorldPoseResponse = {
  element_id: string;
  position_xyz: [number, number, number];
  orientation_wxyz: [number, number, number, number];
};

export type GenesisJointStateResponse = {
  sequence: number;
  joint_values: Record<string, number>;
  updated_at_monotonic_sec: number;
};

export type GenesisWorldStateResponse = {
  sequence: number;
  source_sequence: number;
  poses: GenesisWorldPoseResponse[];
  updated_at_monotonic_sec: number;
};

export type GenesisLiveStateResponse = {
  sequence: number;
  robot_joint_values: Record<string, number>;
  world_source_sequence: number;
  poses: GenesisWorldPoseResponse[];
  updated_at_monotonic_sec: number;
};

export const openGenesisWorld = async (
  dynamicContainerMode: GenesisDynamicContainerMode = "box",
  robotMode: GenesisWorldRobotMode = "so101",
): Promise<GenesisWorldOpenResponse> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/worlds/genesis/open`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dynamic_container_mode: dynamicContainerMode,
        robot_mode: robotMode,
      }),
    },
    {
      requiredBackends: ["core-api"],
      context: "Open Genesis world",
    }
  );
  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.clone().json()) as { detail?: unknown };
      detail = typeof payload.detail === "string" ? payload.detail : "";
    } catch {
      detail = await response.text();
    }
    throw new Error(detail || `Genesis launch failed (${response.status})`);
  }
  return (await response.json()) as GenesisWorldOpenResponse;
};

export const publishGenesisJointState = async (
  jointValues: Readonly<Record<string, number>>
): Promise<void> => {
  const { init } = withBackendRequestHeaders({
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      joint_values: jointValues,
    }),
  });
  const response = await fetch(`${API_BASE_URL}/worlds/genesis/joint-state`, init);
  if (!response.ok) {
    throw new Error(`Genesis joint publish failed (${response.status})`);
  }
};

export const fetchGenesisWorldState = async (): Promise<GenesisWorldStateResponse> => {
  const { init } = withBackendRequestHeaders({
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  const response = await fetch(`${API_BASE_URL}/worlds/genesis/world-state/latest`, init);
  if (!response.ok) {
    throw new Error(`Genesis world state fetch failed (${response.status})`);
  }
  return (await response.json()) as GenesisWorldStateResponse;
};

export const fetchGenesisLiveState = async (): Promise<GenesisLiveStateResponse> => {
  const { init } = withBackendRequestHeaders({
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  const response = await fetch(`${API_BASE_URL}/worlds/genesis/live-state/latest`, init);
  if (!response.ok) {
    throw new Error(`Genesis live state fetch failed (${response.status})`);
  }
  return (await response.json()) as GenesisLiveStateResponse;
};

export const fetchGenesisRobotState = async (): Promise<GenesisJointStateResponse> => {
  const { init } = withBackendRequestHeaders({
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  const response = await fetch(`${API_BASE_URL}/worlds/genesis/robot-state/latest`, init);
  if (!response.ok) {
    throw new Error(`Genesis robot state fetch failed (${response.status})`);
  }
  return (await response.json()) as GenesisJointStateResponse;
};
