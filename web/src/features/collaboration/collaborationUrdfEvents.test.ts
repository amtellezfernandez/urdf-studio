import { describe, expect, it } from "vitest";

import {
  buildCollaborationUrdfPatchPayload,
  buildCollaborationUrdfSnapshotRequestPayload,
} from "@/features/collaboration/collaborationPatch";
import {
  COLLABORATION_URDF_PATCH_EVENT_TYPE,
  COLLABORATION_URDF_SNAPSHOT_EVENT_TYPE,
  COLLABORATION_URDF_SNAPSHOT_REQUEST_EVENT_TYPE,
} from "@/features/collaboration/collaborationParams";
import {
  buildCollaborationUrdfSnapshotPayload,
  isCollaborationUrdfPatchEvent,
  isCollaborationUrdfSnapshotEvent,
  isCollaborationUrdfSnapshotRequestEvent,
} from "@/features/collaboration/collaborationUrdfEvents";

const CLIENT_SENT_AT_MS = 123;
const SERVER_RECEIVED_AT_MS = 456;
const SNAPSHOT_REVISION = 7;
const CLIENT_SEQUENCE = 13;
const NEXT_CLIENT_SEQUENCE = 14;
const FIRST_EVENT_ID = 1;
const SECOND_EVENT_ID = 2;
const PATCH_BASE_PADDING_LENGTH = 1100;

describe("collaborationUrdfEvents", () => {
  it("builds and recognizes URDF snapshot events", () => {
    const payload = buildCollaborationUrdfSnapshotPayload({
      activePath: "robots/demo.urdf",
      basePath: "robots",
      clientSequence: CLIENT_SEQUENCE,
      clientSentAtMs: CLIENT_SENT_AT_MS,
      content: "<robot name='demo'/>",
      filename: "demo.urdf",
      revision: SNAPSHOT_REVISION,
    });
    expect(payload.clientSentAtMs).toBe(CLIENT_SENT_AT_MS);
    expect(payload.clientSequence).toBe(CLIENT_SEQUENCE);
    expect(payload.revision).toBe(SNAPSHOT_REVISION);
    expect(payload.contentHash).toBeTruthy();

    expect(
      isCollaborationUrdfSnapshotEvent({
        event_id: FIRST_EVENT_ID,
        session_id: "collab-abc",
        client_id: "editor-a",
        event_type: COLLABORATION_URDF_SNAPSHOT_EVENT_TYPE,
        payload,
        occurred_at: "2026-04-11T00:00:00Z",
        server_received_at_ms: SERVER_RECEIVED_AT_MS,
      }),
    ).toBe(true);
  });

  it("recognizes patch and snapshot request control events", () => {
    const patchPayload = buildCollaborationUrdfPatchPayload({
      activePath: "robots/demo.urdf",
      basePath: "robots",
      baseRevision: SNAPSHOT_REVISION,
      clientSequence: CLIENT_SEQUENCE,
      filename: "demo.urdf",
      previousContent: `<robot name="demo">${" ".repeat(PATCH_BASE_PADDING_LENGTH)}</robot>`,
      nextContent: `<robot name="demo">${" ".repeat(PATCH_BASE_PADDING_LENGTH)}<link name="a"/></robot>`,
    });

    expect(patchPayload).toBeTruthy();
    expect(
      isCollaborationUrdfPatchEvent({
        event_id: FIRST_EVENT_ID,
        session_id: "collab-abc",
        client_id: "editor-a",
        event_type: COLLABORATION_URDF_PATCH_EVENT_TYPE,
        payload: patchPayload!,
        occurred_at: "2026-04-11T00:00:00Z",
        server_received_at_ms: SERVER_RECEIVED_AT_MS,
      }),
    ).toBe(true);

    const requestPayload = buildCollaborationUrdfSnapshotRequestPayload({
      clientSequence: NEXT_CLIENT_SEQUENCE,
      reason: "patch-base-mismatch",
      requestedRevision: SNAPSHOT_REVISION,
      targetClientId: "editor-a",
    });

    expect(
      isCollaborationUrdfSnapshotRequestEvent({
        event_id: SECOND_EVENT_ID,
        session_id: "collab-abc",
        client_id: "editor-b",
        event_type: COLLABORATION_URDF_SNAPSHOT_REQUEST_EVENT_TYPE,
        payload: requestPayload,
        occurred_at: "2026-04-11T00:00:00Z",
        server_received_at_ms: SERVER_RECEIVED_AT_MS,
      }),
    ).toBe(true);
  });
});
