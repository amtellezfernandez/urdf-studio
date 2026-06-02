import { describe, expect, it } from "vitest";
import {
  createCollaborationClientSequenceBaseline,
  findMaxCollaborationClientSequence,
  getCollaborationEventClientSequence,
} from "@/features/collaboration/collaborationSequence";
import type { CollaborationEventSnapshot } from "@/features/collaboration/collaborationTypes";

const createEvent = (
  clientId: string,
  clientSequence: unknown,
): CollaborationEventSnapshot => ({
  client_id: clientId,
  event_id: 1,
  event_type: "urdf.snapshot",
  occurred_at: "2026-04-12T00:00:00.000Z",
  payload: { clientSequence },
  server_received_at_ms: 0,
  session_id: "collab-test",
});

describe("collaborationSequence", () => {
  it("starts new page loads from a time-based safe sequence baseline", () => {
    expect(createCollaborationClientSequenceBaseline(1_776_000_000_000)).toBe(1_776_000_000_000);
    expect(createCollaborationClientSequenceBaseline(-1)).toBe(0);
    expect(createCollaborationClientSequenceBaseline(1.5)).toBe(0);
  });

  it("reads safe integer client sequences from collaboration events", () => {
    expect(getCollaborationEventClientSequence(createEvent("editor-a", 3))).toBe(3);
    expect(getCollaborationEventClientSequence(createEvent("editor-a", 1.5))).toBeNull();
    expect(getCollaborationEventClientSequence(createEvent("editor-a", "3"))).toBeNull();
  });

  it("finds the latest sequence for the local client in recent events", () => {
    expect(
      findMaxCollaborationClientSequence(
        [
          createEvent("editor-a", 1),
          createEvent("editor-b", 9),
          createEvent("editor-a", 4),
          createEvent("editor-a", "5"),
        ],
        "editor-a",
      ),
    ).toBe(4);
  });

  it("returns null when recent events do not include the client", () => {
    expect(findMaxCollaborationClientSequence([createEvent("editor-b", 1)], "editor-a")).toBeNull();
  });
});
