import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";

import type {
  RosVizClockControlRequest,
  RosVizClockState,
  RosVizDataSource,
  RosVizDeterministicMode,
  RosVizModeProfile,
  RosVizModeUpdateRequest,
  RosVizSessionMode,
  RosVizSessionSnapshot,
  RosVizSessionState,
  RosVizStreamTicketResponse,
  RosVizSubscriptionResponse,
  RosVizTopicCatalogResponse,
} from "@/runtime_engine/rosviz/types";

type RosVizCreateSessionRequest = {
  fixed_frame?: string;
  ros_domain_id?: number;
  replay_source?: string;
  deterministic_mode?: RosVizDeterministicMode;
  mode_profile?: RosVizModeProfile;
  data_source?: RosVizDataSource;
  session_mode?: RosVizSessionMode;
};

type RosVizSubscriptionRequest = {
  topic_ids: number[];
  include_clock?: boolean;
};

const JSON_HEADERS: HeadersInit = {
  "Content-Type": "application/json",
};

const CORE_API_OPTIONS = {
  requiredBackends: ["core-api"] as const,
};

const parseJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `ROS viz API request failed (${response.status}): ${detail || response.statusText}`
    );
  }
  return (await response.json()) as T;
};

export const createRosVizSession = async (
  request: RosVizCreateSessionRequest
): Promise<RosVizSessionSnapshot> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/ros-viz/sessions`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(request),
    },
    {
      ...CORE_API_OPTIONS,
      context: "ROS viz session creation",
    }
  );
  return parseJson<RosVizSessionSnapshot>(response);
};

export const fetchRosVizSessionState = async (
  sessionId: string
): Promise<RosVizSessionState> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/ros-viz/sessions/${encodeURIComponent(sessionId)}/state`,
    undefined,
    {
      ...CORE_API_OPTIONS,
      context: "ROS viz session state",
    }
  );
  return parseJson<RosVizSessionState>(response);
};

export const updateRosVizSessionMode = async (
  sessionId: string,
  request: RosVizModeUpdateRequest
): Promise<RosVizSessionState> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/ros-viz/sessions/${encodeURIComponent(sessionId)}/mode`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(request),
    },
    {
      ...CORE_API_OPTIONS,
      context: "ROS viz session mode update",
    }
  );
  return parseJson<RosVizSessionState>(response);
};

export const fetchRosVizClockState = async (
  sessionId: string
): Promise<RosVizClockState> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/ros-viz/sessions/${encodeURIComponent(sessionId)}/clock`,
    undefined,
    {
      ...CORE_API_OPTIONS,
      context: "ROS viz clock state",
    }
  );
  return parseJson<RosVizClockState>(response);
};

export const updateRosVizClockState = async (
  sessionId: string,
  request: RosVizClockControlRequest
): Promise<RosVizClockState> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/ros-viz/sessions/${encodeURIComponent(sessionId)}/clock`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(request),
    },
    {
      ...CORE_API_OPTIONS,
      context: "ROS viz clock control",
    }
  );
  return parseJson<RosVizClockState>(response);
};

export const fetchRosVizTopics = async (
  sessionId: string
): Promise<RosVizTopicCatalogResponse> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/ros-viz/sessions/${encodeURIComponent(sessionId)}/topics`,
    undefined,
    {
      ...CORE_API_OPTIONS,
      context: "ROS viz topic listing",
    }
  );
  return parseJson<RosVizTopicCatalogResponse>(response);
};

export const issueRosVizStreamTicket = async (
  sessionId: string
): Promise<RosVizStreamTicketResponse> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/ros-viz/sessions/${encodeURIComponent(sessionId)}/stream-ticket`,
    {
      method: "POST",
    },
    {
      ...CORE_API_OPTIONS,
      context: "ROS viz stream ticket",
    }
  );
  return parseJson<RosVizStreamTicketResponse>(response);
};

export const updateRosVizSubscriptions = async (
  sessionId: string,
  request: RosVizSubscriptionRequest
): Promise<RosVizSubscriptionResponse> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/ros-viz/sessions/${encodeURIComponent(sessionId)}/subscriptions`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(request),
    },
    {
      ...CORE_API_OPTIONS,
      context: "ROS viz subscription update",
    }
  );
  return parseJson<RosVizSubscriptionResponse>(response);
};
