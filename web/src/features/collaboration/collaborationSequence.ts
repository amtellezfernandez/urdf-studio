import { COLLABORATION_CLIENT_SEQUENCE_INITIAL } from "@/features/collaboration/collaborationParams";
import type { CollaborationEventSnapshot } from "@/features/collaboration/collaborationTypes";

export const createCollaborationClientSequenceBaseline = (
  nowMs: number = Date.now(),
): number => {
  if (!Number.isSafeInteger(nowMs) || nowMs < COLLABORATION_CLIENT_SEQUENCE_INITIAL) {
    return COLLABORATION_CLIENT_SEQUENCE_INITIAL;
  }
  return nowMs;
};

export const getCollaborationEventClientSequence = (
  event: CollaborationEventSnapshot,
): number | null => {
  const value = event.payload.clientSequence;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  return value;
};

export const findMaxCollaborationClientSequence = (
  events: CollaborationEventSnapshot[],
  clientId: string,
): number | null => {
  let maxSequence: number | null = null;
  for (const event of events) {
    if (event.client_id !== clientId) continue;
    const sequence = getCollaborationEventClientSequence(event);
    if (sequence === null) continue;
    maxSequence = maxSequence === null ? sequence : Math.max(maxSequence, sequence);
  }
  return maxSequence;
};
