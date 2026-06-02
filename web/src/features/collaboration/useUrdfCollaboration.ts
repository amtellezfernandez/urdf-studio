import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createCollaborationSession,
  issueCollaborationCapability,
  postCollaborationEvent,
  updateCollaborationAccess,
} from "@/features/collaboration/collaborationApi";
import {
  buildCollaborationShareUrl,
  buildCollaborationWebSocketProtocols,
  buildCollaborationWebSocketUrl,
  collaborationAccessIncludesTeleop,
  getOrCreateCollaborationClientId,
} from "@/features/collaboration/collaborationTransport";
import {
  createCollaborationClientSequenceBaseline,
  findMaxCollaborationClientSequence,
} from "@/features/collaboration/collaborationSequence";
import {
  buildCollaborationUrdfSnapshotPayload,
  isCollaborationUrdfPatchEvent,
  isCollaborationUrdfSnapshotEvent,
  isCollaborationUrdfSnapshotRequestEvent,
} from "@/features/collaboration/collaborationUrdfEvents";
import type {
  CollaborationEventRequest,
  CollaborationEventSnapshot,
  CollaborationLinkAccess,
  CollaborationServerMessage,
  CollaborationShareSession,
} from "@/features/collaboration/collaborationTypes";
import {
  applyCollaborationUrdfPatchPayload,
  buildCollaborationUrdfPatchPayload,
  buildCollaborationUrdfSnapshotRequestPayload,
  hashCollaborationContent,
} from "@/features/collaboration/collaborationPatch";
import {
  COLLABORATION_CLIENT_SEQUENCE_INCREMENT,
  COLLABORATION_DEFAULT_URDF_FILENAME,
  COLLABORATION_SESSION_ENDED_MESSAGE,
  COLLABORATION_LATENCY_CLOCK_SKEW_IGNORE_MS,
  COLLABORATION_LATENCY_TARGET_MS,
  COLLABORATION_PATCH_REVISION_INCREMENT,
  COLLABORATION_URDF_PATCH_EVENT_TYPE,
  COLLABORATION_URDF_SNAPSHOT_EVENT_TYPE,
  COLLABORATION_URDF_SNAPSHOT_REQUEST_EVENT_TYPE,
  COLLABORATION_WEBSOCKET_UNAUTHORIZED_CLOSE_CODE,
} from "@/features/collaboration/collaborationParams";

type LoadUrdfTextOptions = {
  activePath?: string;
  basePath?: string;
  filename?: string;
};

type UrdfCollaborationStatus = "idle" | "connecting" | "connected" | "error";

type UseUrdfCollaborationParams = {
  activeUrdfPath?: string | null;
  initialSession: CollaborationShareSession | null;
  hasLoadedFiles: boolean;
  loadUrdfText: (content: string, options?: LoadUrdfTextOptions) => void;
  markUrdfContentReloaded: () => void;
  updateUrdfFile: (content: string, filename?: string) => void;
  urdfBasePath?: string;
  urdfFileName?: string;
  vizUrdfContent: string;
};

type CreateShareLinkParams = {
  access: CollaborationLinkAccess;
  baseUrl: string;
  label: string;
};

const COLLABORATION_TELEOP_ALLOWED_TRANSPORTS = ["moq"];

type SyncedUrdfState = {
  content: string;
  revision: number;
  contentHash: string;
};

type PendingCollaborationEvent = {
  eventKey: string;
  request: CollaborationEventRequest;
  clientSequence: number;
  syncedUrdf: SyncedUrdfState;
};

const parseServerMessage = (
  rawData: MessageEvent["data"],
): CollaborationServerMessage | null => {
  if (typeof rawData !== "string") return null;
  try {
    return JSON.parse(rawData) as CollaborationServerMessage;
  } catch {
    return null;
  }
};

const collaborationCloseReason = (event: CloseEvent): string => {
  const reason = event.reason.trim();
  if (reason) return reason;
  if (event.code === COLLABORATION_WEBSOCKET_UNAUTHORIZED_CLOSE_CODE) {
    return COLLABORATION_SESSION_ENDED_MESSAGE;
  }
  return "";
};

const sendCollaborationEvent = (
  websocket: WebSocket | null,
  request: CollaborationEventRequest,
): boolean => {
  if (!websocket || websocket.readyState !== WebSocket.OPEN) return false;
  try {
    websocket.send(JSON.stringify(request));
    return true;
  } catch {
    return false;
  }
};

const reportCollaborationLatency = (
  event: CollaborationEventSnapshot,
): void => {
  if (!import.meta.env.DEV) return;
  const relayMs = Date.now() - event.server_received_at_ms;
  if (
    relayMs > COLLABORATION_LATENCY_TARGET_MS &&
    relayMs < COLLABORATION_LATENCY_CLOCK_SKEW_IGNORE_MS
  ) {
    console.warn(
      `Collaboration relay exceeded ${COLLABORATION_LATENCY_TARGET_MS}ms target: ${relayMs}ms`,
      {
        clientId: event.client_id,
        eventId: event.event_id,
        eventType: event.event_type,
        sessionId: event.session_id,
      },
    );
  }
};

export const useUrdfCollaboration = ({
  activeUrdfPath,
  initialSession,
  hasLoadedFiles,
  loadUrdfText,
  markUrdfContentReloaded,
  updateUrdfFile,
  urdfBasePath,
  urdfFileName,
  vizUrdfContent,
}: UseUrdfCollaborationParams) => {
  const [session, setSession] = useState<CollaborationShareSession | null>(
    initialSession,
  );
  const [status, setStatus] = useState<UrdfCollaborationStatus>(
    initialSession ? "connecting" : "idle",
  );
  const clientId = useMemo(() => getOrCreateCollaborationClientId(), []);
  const applyingRemoteEventRef = useRef(false);
  const hasLoadedFilesRef = useRef(hasLoadedFiles);
  const loadUrdfTextRef = useRef(loadUrdfText);
  const markUrdfContentReloadedRef = useRef(markUrdfContentReloaded);
  const updateUrdfFileRef = useRef(updateUrdfFile);
  const lastPublishedEventKeyRef = useRef<string | null>(null);
  const pendingEventRef = useRef<PendingCollaborationEvent | null>(null);
  const publishingSnapshotKeyRef = useRef<string | null>(null);
  const clientSequenceRef = useRef(createCollaborationClientSequenceBaseline());
  const lastRemoteSequenceByClientRef = useRef(new Map<string, number>());
  const websocketRef = useRef<WebSocket | null>(null);
  const syncedUrdfRef = useRef<SyncedUrdfState>({
    content: vizUrdfContent,
    revision: 0,
    contentHash: hashCollaborationContent(vizUrdfContent),
  });
  const latestSnapshotRef = useRef({
    activeUrdfPath,
    content: vizUrdfContent,
    filename: urdfFileName,
    basePath: urdfBasePath,
  });

  useEffect(() => {
    hasLoadedFilesRef.current = hasLoadedFiles;
  }, [hasLoadedFiles]);

  useEffect(() => {
    loadUrdfTextRef.current = loadUrdfText;
    markUrdfContentReloadedRef.current = markUrdfContentReloaded;
    updateUrdfFileRef.current = updateUrdfFile;
  }, [loadUrdfText, markUrdfContentReloaded, updateUrdfFile]);

  useEffect(() => {
    latestSnapshotRef.current = {
      activeUrdfPath,
      content: vizUrdfContent,
      filename: urdfFileName,
      basePath: urdfBasePath,
    };
  }, [activeUrdfPath, urdfBasePath, urdfFileName, vizUrdfContent]);

  const peekNextClientSequence = useCallback(
    () => clientSequenceRef.current + COLLABORATION_CLIENT_SEQUENCE_INCREMENT,
    [],
  );

  const commitClientSequence = useCallback((clientSequence: number) => {
    clientSequenceRef.current = Math.max(
      clientSequenceRef.current,
      clientSequence,
    );
  }, []);

  const commitPublishedEvent = useCallback(
    ({ clientSequence, eventKey, syncedUrdf }: PendingCollaborationEvent) => {
      commitClientSequence(clientSequence);
      lastPublishedEventKeyRef.current = eventKey;
      syncedUrdfRef.current = syncedUrdf;
    },
    [commitClientSequence],
  );

  const rememberRemoteSequence = useCallback(
    (event: CollaborationEventSnapshot, clientSequence: number): boolean => {
      if (event.client_id === clientId) return false;
      const lastRemoteSequence = lastRemoteSequenceByClientRef.current.get(
        event.client_id,
      );
      if (
        lastRemoteSequence !== undefined &&
        clientSequence <= lastRemoteSequence
      ) {
        return false;
      }
      lastRemoteSequenceByClientRef.current.set(
        event.client_id,
        clientSequence,
      );
      return true;
    },
    [clientId],
  );

  const publishUrdfSnapshot = useCallback(
    async (content: string, filename?: string) => {
      if (!session || !content.trim()) return;
      const snapshot = latestSnapshotRef.current;
      const syncedUrdf = syncedUrdfRef.current;
      const nextRevision =
        syncedUrdf.content === content
          ? syncedUrdf.revision
          : syncedUrdf.revision + COLLABORATION_PATCH_REVISION_INCREMENT;
      const snapshotKey = [
        session.sessionId,
        COLLABORATION_URDF_SNAPSHOT_EVENT_TYPE,
        filename ?? snapshot.filename ?? "",
        snapshot.activeUrdfPath ?? "",
        String(nextRevision),
        content,
      ].join("\n");
      if (lastPublishedEventKeyRef.current === snapshotKey) return;
      const clientSequence = peekNextClientSequence();
      const nextSyncedUrdf = {
        content,
        revision: nextRevision,
        contentHash: hashCollaborationContent(content),
      };
      const request = {
        client_id: clientId,
        event_type: COLLABORATION_URDF_SNAPSHOT_EVENT_TYPE,
        payload: buildCollaborationUrdfSnapshotPayload({
          activePath: snapshot.activeUrdfPath,
          basePath: snapshot.basePath,
          clientSequence,
          content,
          filename: filename ?? snapshot.filename,
          revision: nextRevision,
        }),
      };
      const pendingEvent = {
        eventKey: snapshotKey,
        request,
        clientSequence,
        syncedUrdf: nextSyncedUrdf,
      };
      if (sendCollaborationEvent(websocketRef.current, request)) {
        commitPublishedEvent(pendingEvent);
        return;
      }
      if (!session.ownerToken) {
        pendingEventRef.current = pendingEvent;
        return;
      }
      await postCollaborationEvent(session, request);
      commitPublishedEvent(pendingEvent);
    },
    [clientId, commitPublishedEvent, peekNextClientSequence, session],
  );

  const publishUrdfUpdate = useCallback(
    async (content: string, filename?: string) => {
      if (!session || !content.trim()) return;
      const snapshot = latestSnapshotRef.current;
      const syncedUrdf = syncedUrdfRef.current;
      const nextFilename =
        filename ?? snapshot.filename ?? COLLABORATION_DEFAULT_URDF_FILENAME;
      const activePath = snapshot.activeUrdfPath?.trim() || nextFilename;
      const clientSequence = peekNextClientSequence();
      const patch = buildCollaborationUrdfPatchPayload({
        activePath,
        basePath: snapshot.basePath ?? "",
        baseRevision: syncedUrdf.revision,
        clientSequence,
        filename: nextFilename,
        nextContent: content,
        previousContent: syncedUrdf.content,
      });

      if (!patch) {
        await publishUrdfSnapshot(content, filename);
        return;
      }

      const patchKey = [
        session.sessionId,
        COLLABORATION_URDF_PATCH_EVENT_TYPE,
        String(patch.baseRevision),
        String(patch.revision),
        patch.baseHash,
        patch.resultHash,
      ].join("\n");
      if (lastPublishedEventKeyRef.current === patchKey) return;

      const request = {
        client_id: clientId,
        event_type: COLLABORATION_URDF_PATCH_EVENT_TYPE,
        payload: patch,
      };
      const pendingEvent = {
        eventKey: patchKey,
        request,
        clientSequence,
        syncedUrdf: {
          content,
          revision: patch.revision,
          contentHash: patch.resultHash,
        },
      };
      if (sendCollaborationEvent(websocketRef.current, request)) {
        commitPublishedEvent(pendingEvent);
        return;
      }
      if (!session.ownerToken) {
        pendingEventRef.current = pendingEvent;
        return;
      }
      await postCollaborationEvent(session, request);
      commitPublishedEvent(pendingEvent);
    },
    [
      clientId,
      commitPublishedEvent,
      peekNextClientSequence,
      publishUrdfSnapshot,
      session,
    ],
  );

  const updateUrdfFileWithCollaboration = useCallback(
    (content: string, filename?: string) => {
      updateUrdfFile(content, filename);
      if (!applyingRemoteEventRef.current) {
        void publishUrdfUpdate(content, filename).catch((error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "Failed to publish collaboration update.",
          );
        });
      }
    },
    [publishUrdfUpdate, updateUrdfFile],
  );

  const applyRemoteUrdfSnapshot = useCallback(
    (event: CollaborationEventSnapshot) => {
      if (
        event.client_id === clientId ||
        !isCollaborationUrdfSnapshotEvent(event)
      ) {
        return;
      }
      if (!rememberRemoteSequence(event, event.payload.clientSequence)) return;
      reportCollaborationLatency(event);

      applyingRemoteEventRef.current = true;
      try {
        if (
          hashCollaborationContent(event.payload.content) !==
          event.payload.contentHash
        ) {
          return;
        }
        if (hasLoadedFilesRef.current) {
          updateUrdfFileRef.current(
            event.payload.content,
            event.payload.filename,
          );
        } else {
          loadUrdfTextRef.current(event.payload.content, {
            activePath: event.payload.activePath,
            basePath: event.payload.basePath,
            filename: event.payload.filename,
          });
        }
        syncedUrdfRef.current = {
          content: event.payload.content,
          revision: event.payload.revision,
          contentHash: event.payload.contentHash,
        };
        markUrdfContentReloadedRef.current();
      } finally {
        applyingRemoteEventRef.current = false;
      }
    },
    [clientId, rememberRemoteSequence],
  );

  const requestRemoteSnapshot = useCallback(
    (
      event: CollaborationEventSnapshot,
      reason: "patch-base-mismatch" | "patch-apply-failed",
    ) => {
      const clientSequence = peekNextClientSequence();
      const sent = sendCollaborationEvent(websocketRef.current, {
        client_id: clientId,
        event_type: COLLABORATION_URDF_SNAPSHOT_REQUEST_EVENT_TYPE,
        payload: buildCollaborationUrdfSnapshotRequestPayload({
          reason,
          requestedRevision: syncedUrdfRef.current.revision,
          targetClientId: event.client_id,
          clientSequence,
        }),
      });
      if (sent) {
        commitClientSequence(clientSequence);
      }
    },
    [clientId, commitClientSequence, peekNextClientSequence],
  );

  const applyRemoteUrdfPatch = useCallback(
    (event: CollaborationEventSnapshot) => {
      if (
        event.client_id === clientId ||
        !isCollaborationUrdfPatchEvent(event)
      ) {
        return;
      }
      if (!rememberRemoteSequence(event, event.payload.clientSequence)) return;
      reportCollaborationLatency(event);
      const applied = applyCollaborationUrdfPatchPayload({
        currentContent: syncedUrdfRef.current.content,
        currentRevision: syncedUrdfRef.current.revision,
        patch: event.payload,
      });
      if (applied.ok === false) {
        const { reason } = applied;
        requestRemoteSnapshot(event, reason);
        return;
      }

      applyingRemoteEventRef.current = true;
      try {
        if (hasLoadedFilesRef.current) {
          updateUrdfFileRef.current(applied.content, event.payload.filename);
        } else {
          loadUrdfTextRef.current(applied.content, {
            activePath: event.payload.activePath,
            basePath: event.payload.basePath,
            filename: event.payload.filename,
          });
        }
        syncedUrdfRef.current = {
          content: applied.content,
          revision: applied.revision,
          contentHash: applied.contentHash,
        };
        markUrdfContentReloadedRef.current();
      } finally {
        applyingRemoteEventRef.current = false;
      }
    },
    [clientId, rememberRemoteSequence, requestRemoteSnapshot],
  );

  const respondToSnapshotRequest = useCallback(
    (event: CollaborationEventSnapshot) => {
      if (
        event.client_id === clientId ||
        !isCollaborationUrdfSnapshotRequestEvent(event) ||
        event.payload.targetClientId !== clientId
      ) {
        return;
      }
      if (!rememberRemoteSequence(event, event.payload.clientSequence)) return;
      void publishUrdfSnapshot(syncedUrdfRef.current.content).catch((error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to publish collaboration resync.",
        );
      });
    },
    [clientId, publishUrdfSnapshot, rememberRemoteSequence],
  );

  useEffect(() => {
    if (!session) {
      setStatus("idle");
      return;
    }

    const websocketToken = session.ownerToken ?? session.sessionToken;
    setStatus("connecting");
    const websocket = new WebSocket(
      buildCollaborationWebSocketUrl({
        clientId,
        sessionId: session.sessionId,
      }),
      buildCollaborationWebSocketProtocols(websocketToken),
    );
    websocketRef.current = websocket;

    websocket.onopen = () => {
      setStatus("connected");
      const pendingEvent = pendingEventRef.current;
      if (!pendingEvent) return;
      if (!sendCollaborationEvent(websocket, pendingEvent.request)) return;
      commitPublishedEvent(pendingEvent);
      pendingEventRef.current = null;
    };
    websocket.onerror = () => setStatus("error");
    websocket.onclose = (event) => {
      if (websocketRef.current === websocket) {
        websocketRef.current = null;
      }
      setStatus((current) => (current === "idle" ? current : "error"));
      const reason = collaborationCloseReason(event);
      if (reason) toast.error(reason);
    };
    websocket.onmessage = (messageEvent) => {
      const message = parseServerMessage(messageEvent.data);
      if (!message) return;
      if (message.type === "session.joined") {
        const maxLocalSequence = findMaxCollaborationClientSequence(
          message.recent_events,
          clientId,
        );
        if (maxLocalSequence !== null) {
          commitClientSequence(maxLocalSequence);
        }
        setSession((currentSession) =>
          currentSession?.sessionId === message.snapshot.session_id
            ? {
                ...currentSession,
                peerCount: message.snapshot.peer_count,
                sharingEnabled: message.snapshot.sharing_enabled,
              }
            : currentSession,
        );
        message.recent_events.forEach(applyRemoteUrdfSnapshot);
        message.recent_events.forEach(applyRemoteUrdfPatch);
        return;
      }
      if (message.type === "event") {
        applyRemoteUrdfSnapshot(message.event);
        applyRemoteUrdfPatch(message.event);
        respondToSnapshotRequest(message.event);
        return;
      }
      if (message.type === "error") {
        toast.error(message.message);
      }
    };

    return () => {
      if (websocketRef.current === websocket) {
        websocketRef.current = null;
      }
      websocket.onclose = null;
      websocket.close();
    };
  }, [
    applyRemoteUrdfPatch,
    applyRemoteUrdfSnapshot,
    clientId,
    commitClientSequence,
    commitPublishedEvent,
    respondToSnapshotRequest,
    session,
  ]);

  const createShareLink = useCallback(
    async ({ access, baseUrl, label }: CreateShareLinkParams) => {
      let activeSession = session;
      if (!activeSession) {
        const createdSession = await createCollaborationSession(label);
        activeSession = {
          sessionId: createdSession.session_id,
          sessionToken: createdSession.session_token,
          editorToken: createdSession.editor_token,
          ownerToken: createdSession.owner_token,
          peerCount: createdSession.peer_count,
          sharingEnabled: createdSession.sharing_enabled,
        };
      }

      setSession(activeSession);

      const snapshot = latestSnapshotRef.current;
      if (snapshot.content.trim()) {
        const syncedUrdf = syncedUrdfRef.current;
        const nextRevision =
          syncedUrdf.content === snapshot.content
            ? syncedUrdf.revision
            : syncedUrdf.revision + COLLABORATION_PATCH_REVISION_INCREMENT;
        const snapshotKey = [
          activeSession.sessionId,
          COLLABORATION_URDF_SNAPSHOT_EVENT_TYPE,
          snapshot.filename ?? "",
          snapshot.activeUrdfPath ?? "",
          String(nextRevision),
          snapshot.content,
        ].join("\n");
        const shouldPublishSnapshot =
          lastPublishedEventKeyRef.current !== snapshotKey &&
          publishingSnapshotKeyRef.current !== snapshotKey;
        if (shouldPublishSnapshot) {
          publishingSnapshotKeyRef.current = snapshotKey;
          try {
            const clientSequence = peekNextClientSequence();
            const snapshotRequest = {
              client_id: clientId,
              event_type: COLLABORATION_URDF_SNAPSHOT_EVENT_TYPE,
              payload: buildCollaborationUrdfSnapshotPayload({
                activePath: snapshot.activeUrdfPath,
                basePath: snapshot.basePath,
                clientSequence,
                content: snapshot.content,
                filename: snapshot.filename,
                revision: nextRevision,
              }),
            };
            await postCollaborationEvent(activeSession, snapshotRequest);
            commitPublishedEvent({
              eventKey: snapshotKey,
              request: snapshotRequest,
              clientSequence,
              syncedUrdf: {
                content: snapshot.content,
                revision: nextRevision,
                contentHash: hashCollaborationContent(snapshot.content),
              },
            });
          } finally {
            if (publishingSnapshotKeyRef.current === snapshotKey) {
              publishingSnapshotKeyRef.current = null;
            }
          }
        }
      }

      const shareSession: CollaborationShareSession = { ...activeSession };
      if (collaborationAccessIncludesTeleop(access)) {
        if (!activeSession.ownerToken) {
          throw new Error("Only the room owner can create teleop links.");
        }
        const capability = await issueCollaborationCapability(
          {
            ...activeSession,
            ownerToken: activeSession.ownerToken,
          },
          {
            role: "teleop_operator",
            allowed_transports: COLLABORATION_TELEOP_ALLOWED_TRANSPORTS,
          },
        );
        shareSession.teleopCapabilityToken = capability.capability_token;
        activeSession = {
          ...activeSession,
          teleopCapabilityToken: capability.capability_token,
        };
        setSession(activeSession);
      }

      return buildCollaborationShareUrl(shareSession, baseUrl, access);
    },
    [clientId, commitPublishedEvent, peekNextClientSequence, session],
  );

  const updateOwnerAccess = useCallback(
    async (request: {
      editors_enabled?: boolean;
      sharing_enabled?: boolean;
      rotate_editor_token?: boolean;
      rotate_session_token?: boolean;
    }) => {
      if (!session?.ownerToken) {
        throw new Error("Only the room owner can change collaboration access.");
      }
      const response = await updateCollaborationAccess(
        {
          ...session,
          ownerToken: session.ownerToken,
        },
        request,
      );
      const nextSession = {
        ...session,
        sessionToken: response.session_token,
        editorToken: response.editor_token,
        peerCount: response.snapshot.peer_count,
        sharingEnabled: response.snapshot.sharing_enabled,
      };
      if (
        request.sharing_enabled === false ||
        request.rotate_session_token ||
        request.rotate_editor_token
      ) {
        delete nextSession.teleopCapabilityToken;
      }
      setSession(nextSession);
      return nextSession;
    },
    [session],
  );

  const rotateShareLink = useCallback(
    async ({ baseUrl }: { baseUrl: string }) => {
      const nextSession = await updateOwnerAccess({
        editors_enabled: true,
        sharing_enabled: true,
        rotate_editor_token: true,
        rotate_session_token: true,
      });
      return buildCollaborationShareUrl(nextSession, baseUrl);
    },
    [updateOwnerAccess],
  );

  const setCollaborationSharingEnabled = useCallback(
    async (enabled: boolean) => {
      await updateOwnerAccess({ sharing_enabled: enabled });
    },
    [updateOwnerAccess],
  );

  return {
    clientId,
    collaborationOwner: Boolean(session?.ownerToken),
    collaborationOwnerToken: session?.ownerToken ?? null,
    collaborationPeerCount: session?.peerCount,
    collaborationSharingEnabled: session?.sharingEnabled ?? true,
    collaborationSessionId: session?.sessionId ?? null,
    collaborationStatus: status,
    collaborationTeleopCapabilityToken: session?.teleopCapabilityToken ?? null,
    createShareLink,
    rotateShareLink,
    setCollaborationSharingEnabled,
    updateUrdfFileWithCollaboration,
  };
};
