import type { LiveTransportDescriptor } from "@/features/live-transport/liveTransportTypes";

export type CollaborationSessionCreateResponse = {
  session_id: string;
  session_token: string;
  editor_token: string;
  owner_token: string;
  label: string;
  role: "owner" | "editor" | "viewer";
  editors_enabled: boolean;
  sharing_enabled: boolean;
  created_at: string;
  updated_at: string;
  peer_count: number;
  event_count: number;
  last_event_id: number;
  live_transport?: LiveTransportDescriptor | null;
};

export type CollaborationSessionSnapshot = Omit<
  CollaborationSessionCreateResponse,
  "session_token" | "editor_token" | "owner_token"
>;

export type CollaborationBaseAccess = "viewer" | "editor";
export type CollaborationLinkAccess =
  | "viewer"
  | "editor"
  | "viewer_teleop"
  | "editor_teleop";

export type CollaborationCapabilityRole =
  | "room_owner"
  | "room_editor"
  | "teleop_operator"
  | "robot_peer"
  | "observer";

export type CollaborationShareSession = {
  sessionId: string;
  sessionToken: string;
  editorToken?: string;
  ownerToken?: string;
  teleopCapabilityToken?: string;
  peerCount?: number;
  sharingEnabled?: boolean;
};

export type CollaborationAccessUpdateResponse = {
  snapshot: CollaborationSessionSnapshot;
  session_token: string;
  editor_token: string;
};

export type CollaborationCapabilityIssueRequest = {
  role: CollaborationCapabilityRole;
  ttl_ms?: number | null;
  allowed_transports?: string[];
};

export type CollaborationCapabilityIssueResponse = {
  session_id: string;
  role: CollaborationCapabilityRole;
  capability_token: string;
  issued_at: string;
  expires_at: string;
  allowed_transports: string[];
};

export type CollaborationEventRequest = {
  client_id: string;
  event_type: string;
  payload: Record<string, unknown>;
};

export type CollaborationEventSnapshot = {
  event_id: number;
  session_id: string;
  client_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: string;
  server_received_at_ms: number;
};

export type CollaborationSessionJoinedMessage = {
  type: "session.joined";
  snapshot: CollaborationSessionSnapshot;
  recent_events: CollaborationEventSnapshot[];
};

export type CollaborationEventMessage = {
  type: "event";
  event: CollaborationEventSnapshot;
};

export type CollaborationErrorMessage = {
  type: "error";
  message: string;
};

export type CollaborationServerMessage =
  | CollaborationSessionJoinedMessage
  | CollaborationEventMessage
  | CollaborationErrorMessage;
