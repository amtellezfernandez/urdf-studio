import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";
import { COLLABORATION_SESSION_TOKEN_HEADER } from "@/features/collaboration/collaborationTransport";
import type {
  CollaborationAccessUpdateResponse,
  CollaborationCapabilityIssueRequest,
  CollaborationCapabilityIssueResponse,
  CollaborationEventRequest,
  CollaborationEventSnapshot,
  CollaborationSessionCreateResponse,
  CollaborationShareSession,
} from "@/features/collaboration/collaborationTypes";

const COLLABORATION_ENDPOINT = `${API_BASE_URL}/collaboration`;
const CORE_API_OPTIONS = {
  requiredBackends: ["core-api"] as const,
};

const readResponseErrorDetail = async (response: Response): Promise<string> => {
  const rawDetail = await response.text().catch(() => "");
  if (!rawDetail) return response.statusText;
  try {
    const parsed = JSON.parse(rawDetail) as { detail?: unknown };
    return typeof parsed.detail === "string" ? parsed.detail : rawDetail;
  } catch {
    return rawDetail;
  }
};

const ensureJsonResponse = async <T>(
  response: Response,
  context: string,
): Promise<T> => {
  if (!response.ok) {
    const detail = await readResponseErrorDetail(response);
    throw new Error(
      `${context} failed (${response.status}): ${detail || response.statusText}`,
    );
  }
  return (await response.json()) as T;
};

export const createCollaborationSession = async (
  label: string,
): Promise<CollaborationSessionCreateResponse> => {
  const response = await guardedFetch(
    `${COLLABORATION_ENDPOINT}/sessions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ label }),
    },
    {
      ...CORE_API_OPTIONS,
      context: "Collaboration session creation",
    },
  );
  return ensureJsonResponse<CollaborationSessionCreateResponse>(
    response,
    "Collaboration session creation",
  );
};

export const postCollaborationEvent = async (
  session: CollaborationShareSession,
  event: CollaborationEventRequest,
): Promise<CollaborationEventSnapshot> => {
  const response = await guardedFetch(
    `${COLLABORATION_ENDPOINT}/sessions/${encodeURIComponent(session.sessionId)}/events`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [COLLABORATION_SESSION_TOKEN_HEADER]:
          session.ownerToken ?? session.sessionToken,
      },
      body: JSON.stringify(event),
    },
    {
      ...CORE_API_OPTIONS,
      context: "Collaboration event publish",
    },
  );
  return ensureJsonResponse<CollaborationEventSnapshot>(
    response,
    "Collaboration event publish",
  );
};

export const updateCollaborationAccess = async (
  session: CollaborationShareSession & { ownerToken: string },
  request: {
    editors_enabled?: boolean;
    sharing_enabled?: boolean;
    rotate_editor_token?: boolean;
    rotate_session_token?: boolean;
  },
): Promise<CollaborationAccessUpdateResponse> => {
  const response = await guardedFetch(
    `${COLLABORATION_ENDPOINT}/sessions/${encodeURIComponent(session.sessionId)}/access`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        [COLLABORATION_SESSION_TOKEN_HEADER]: session.ownerToken,
      },
      body: JSON.stringify(request),
    },
    {
      ...CORE_API_OPTIONS,
      context: "Collaboration access update",
    },
  );
  return ensureJsonResponse<CollaborationAccessUpdateResponse>(
    response,
    "Collaboration access update",
  );
};

export const issueCollaborationCapability = async (
  session: CollaborationShareSession & { ownerToken: string },
  request: CollaborationCapabilityIssueRequest,
): Promise<CollaborationCapabilityIssueResponse> => {
  const response = await guardedFetch(
    `${COLLABORATION_ENDPOINT}/sessions/${encodeURIComponent(session.sessionId)}/capabilities`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [COLLABORATION_SESSION_TOKEN_HEADER]: session.ownerToken,
      },
      body: JSON.stringify(request),
    },
    {
      ...CORE_API_OPTIONS,
      context: "Collaboration capability issue",
    },
  );
  return ensureJsonResponse<CollaborationCapabilityIssueResponse>(
    response,
    "Collaboration capability issue",
  );
};
