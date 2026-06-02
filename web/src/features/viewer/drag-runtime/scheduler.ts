import type { DragSolveTicket, DragTargetLocal } from "./types";

export type DragSchedulerState = {
  solveIntervalMs: number;
  lastDispatchAtMs: number;
  nextSequenceId: number;
  inFlightSequenceId: number | null;
  latestPendingTicket: DragSolveTicket | null;
};

export const createDragSchedulerState = (solveHz: number): DragSchedulerState => {
  const clampedHz = Number.isFinite(solveHz) && solveHz > 0 ? solveHz : 60;
  return {
    solveIntervalMs: 1000 / clampedHz,
    lastDispatchAtMs: 0,
    nextSequenceId: 1,
    inFlightSequenceId: null,
    latestPendingTicket: null,
  };
};

export const enqueueLatestDragTarget = (
  scheduler: DragSchedulerState,
  targetLocal: DragTargetLocal,
  submittedAtMs: number
): DragSolveTicket => {
  const ticket: DragSolveTicket = {
    sequenceId: scheduler.nextSequenceId++,
    submittedAtMs,
    targetLocal,
  };
  scheduler.latestPendingTicket = ticket;
  return ticket;
};

export const popNextDragSolveTicket = (
  scheduler: DragSchedulerState,
  nowMs: number
): DragSolveTicket | null => {
  if (scheduler.inFlightSequenceId !== null) {
    return null;
  }
  const ticket = scheduler.latestPendingTicket;
  if (!ticket) {
    return null;
  }
  if (nowMs - scheduler.lastDispatchAtMs < scheduler.solveIntervalMs) {
    return null;
  }
  scheduler.latestPendingTicket = null;
  scheduler.inFlightSequenceId = ticket.sequenceId;
  scheduler.lastDispatchAtMs = nowMs;
  return ticket;
};

export const markDragSolveComplete = (scheduler: DragSchedulerState, sequenceId: number) => {
  if (scheduler.inFlightSequenceId === sequenceId) {
    scheduler.inFlightSequenceId = null;
  }
};

export const isDragSolveResultStale = (
  scheduler: DragSchedulerState,
  sequenceId: number
): boolean => {
  if (scheduler.inFlightSequenceId !== sequenceId) {
    return true;
  }
  const newestPendingSeq = scheduler.latestPendingTicket?.sequenceId ?? -1;
  return newestPendingSeq > sequenceId;
};

