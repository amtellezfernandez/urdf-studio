import { API_BASE_URL } from "@/shared/config/api";
import {
  COLLABORATION_CLIENT_ID_PREFIX,
  COLLABORATION_CLIENT_ID_STORAGE_KEY,
  COLLABORATION_FALLBACK_RANDOM_PREFIX_START,
  COLLABORATION_FALLBACK_RANDOM_RADIX,
  COLLABORATION_TRANSPORT_PARAMS,
  COLLABORATION_URL_FALLBACK_BASE,
  COLLABORATION_WEBSOCKET_PROTOCOL,
  COLLABORATION_WEBSOCKET_TOKEN_PROTOCOL_PREFIX,
} from "@/features/collaboration/collaborationParams";
import type {
  CollaborationBaseAccess,
  CollaborationLinkAccess,
  CollaborationShareSession,
} from "@/features/collaboration/collaborationTypes";
import { resolveBrowserStorage } from "@/shared/lib/browserStorage";

type CollaborationWebSocketUrlRequest = Pick<
  CollaborationShareSession,
  "sessionId"
> & {
  apiBaseUrl?: string;
  clientId: string;
};

export const COLLABORATION_SESSION_TOKEN_HEADER =
  COLLABORATION_TRANSPORT_PARAMS.sessionTokenHeader;
const COLLABORATION_SESSION_FRAGMENT_PARAM =
  COLLABORATION_TRANSPORT_PARAMS.sessionFragmentParam;
const COLLABORATION_SESSION_TOKEN_FRAGMENT_PARAM =
  COLLABORATION_TRANSPORT_PARAMS.sessionTokenFragmentParam;
const COLLABORATION_CLIENT_ID_QUERY_PARAM =
  COLLABORATION_TRANSPORT_PARAMS.clientIdQueryParam;

const getUrlResolutionBase = (): string => {
  if (typeof window !== "undefined" && window.location.href.trim()) {
    return window.location.href;
  }
  return COLLABORATION_URL_FALLBACK_BASE;
};

const parseCollaborationUrl = (rawUrl: string, context: string): URL => {
  try {
    return new URL(rawUrl.trim(), getUrlResolutionBase());
  } catch {
    throw new Error(context + " URL is invalid.");
  }
};

const setApiScopedPathname = (url: URL, path: string): void => {
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = basePath + path;
};

const resolveShareToken = (
  session: CollaborationShareSession,
  access: CollaborationLinkAccess,
): string => {
  const baseAccess = getCollaborationBaseAccess(access);
  if (baseAccess === "viewer") return session.sessionToken;
  if (session.editorToken) return session.editorToken;
  throw new Error("Only the room owner can create edit links.");
};

export const getCollaborationBaseAccess = (
  access: CollaborationLinkAccess,
): CollaborationBaseAccess => (access === "editor" ? "editor" : "viewer");

export const describeCollaborationLinkAccess = (
  access: CollaborationLinkAccess,
): string => (getCollaborationBaseAccess(access) === "editor" ? "Can edit" : "Can view");

export const buildCollaborationShareUrl = (
  session: CollaborationShareSession,
  baseUrl: string,
  access: CollaborationLinkAccess = "viewer",
): string => {
  const url = parseCollaborationUrl(baseUrl, "Collaboration share");
  url.searchParams.delete(COLLABORATION_SESSION_FRAGMENT_PARAM);
  url.searchParams.delete(COLLABORATION_SESSION_TOKEN_FRAGMENT_PARAM);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  hashParams.set(COLLABORATION_SESSION_FRAGMENT_PARAM, session.sessionId);
  hashParams.set(COLLABORATION_SESSION_TOKEN_FRAGMENT_PARAM, resolveShareToken(session, access));
  url.hash = hashParams.toString();
  return url.toString();
};

const toWebSocketBaseUrl = (apiBaseUrl: string): URL => {
  const url = parseCollaborationUrl(
    apiBaseUrl,
    "Collaboration websocket API base",
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
};

export const buildCollaborationWebSocketUrl = ({
  apiBaseUrl = API_BASE_URL,
  clientId,
  sessionId,
}: CollaborationWebSocketUrlRequest): string => {
  const url = toWebSocketBaseUrl(apiBaseUrl);
  setApiScopedPathname(
    url,
    "/ws/collaboration/" + encodeURIComponent(sessionId),
  );
  url.search = "";
  url.hash = "";
  url.searchParams.set(COLLABORATION_CLIENT_ID_QUERY_PARAM, clientId);
  return url.toString();
};

export const buildCollaborationWebSocketProtocols = (
  sessionToken: string,
): string[] => [
  COLLABORATION_WEBSOCKET_PROTOCOL,
  `${COLLABORATION_WEBSOCKET_TOKEN_PROTOCOL_PREFIX}${sessionToken}`,
];

export const readCollaborationShareSessionFromUrl = (
  rawUrl: string,
): CollaborationShareSession | null => {
  const url = parseCollaborationUrl(rawUrl, "Collaboration share session");
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const sessionId = hashParams.get(COLLABORATION_SESSION_FRAGMENT_PARAM)?.trim();
  const sessionToken = hashParams.get(COLLABORATION_SESSION_TOKEN_FRAGMENT_PARAM)?.trim();
  if (!sessionId || !sessionToken) return null;
  return {
    sessionId,
    sessionToken,
  };
};

export const createCollaborationClientId = (
  randomUuid: (() => string) | undefined = globalThis.crypto?.randomUUID?.bind(
    globalThis.crypto,
  ),
): string => {
  const randomPart = randomUuid
    ? randomUuid()
    : `${Date.now()}-${Math.random()
        .toString(COLLABORATION_FALLBACK_RANDOM_RADIX)
        .slice(COLLABORATION_FALLBACK_RANDOM_PREFIX_START)}`;
  return `${COLLABORATION_CLIENT_ID_PREFIX}-${randomPart}`;
};

export const getOrCreateCollaborationClientId = (
  storage: Storage | undefined = typeof window === "undefined"
    ? undefined
    : resolveBrowserStorage("local"),
): string => {
  try {
    const storedClientId = storage
      ?.getItem(COLLABORATION_CLIENT_ID_STORAGE_KEY)
      ?.trim();
    if (storedClientId) return storedClientId;
  } catch {
    return createCollaborationClientId();
  }

  const clientId = createCollaborationClientId();
  try {
    storage?.setItem(COLLABORATION_CLIENT_ID_STORAGE_KEY, clientId);
  } catch {
    return clientId;
  }
  return clientId;
};
