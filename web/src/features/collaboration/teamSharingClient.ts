import { TEAM_SHARING_CLIENT_PARAMS } from "@/features/collaboration/teamSharingClientParams";

export type TeamSharingStatus = {
  available: boolean;
  enabled: boolean;
  localUrl: string;
  teamUrl: string;
};

const TEAM_SHARING_STATUS_PATH = TEAM_SHARING_CLIENT_PARAMS.statusPath;

export const TEAM_SHARING_UNAVAILABLE_STATUS: TeamSharingStatus = {
  available: false,
  enabled: false,
  localUrl: "",
  teamUrl: "",
};

const normalizeTeamSharingStatus = (value: unknown): TeamSharingStatus => {
  const raw = value as Partial<TeamSharingStatus> | null;
  return {
    available: raw?.available === true,
    enabled: raw?.enabled === true,
    localUrl: typeof raw?.localUrl === "string" ? raw.localUrl : "",
    teamUrl: typeof raw?.teamUrl === "string" ? raw.teamUrl : "",
  };
};

export const fetchTeamSharingStatus = async (
  fetcher: typeof fetch = fetch,
): Promise<TeamSharingStatus> => {
  try {
    const response = await fetcher(TEAM_SHARING_STATUS_PATH, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return TEAM_SHARING_UNAVAILABLE_STATUS;
    return normalizeTeamSharingStatus(await response.json());
  } catch {
    return TEAM_SHARING_UNAVAILABLE_STATUS;
  }
};

export const setTeamSharingEnabled = async (
  enabled: boolean,
  fetcher: typeof fetch = fetch,
): Promise<TeamSharingStatus> => {
  const response = await fetcher(TEAM_SHARING_STATUS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    credentials: "same-origin",
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    throw new Error(
      enabled
        ? "Failed to turn on Team sharing."
        : "Failed to turn off Team sharing.",
    );
  }
  return normalizeTeamSharingStatus(await response.json());
};
