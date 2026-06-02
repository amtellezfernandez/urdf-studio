import { create } from "zustand";

import {
  RosVizStreamFrameType,
  type RosVizStreamFrame,
} from "@/runtime_engine/rosviz/protocol/rosVizProtocol";
import type {
  RuntimeConnectionStatus,
  RuntimeHealthSnapshot,
} from "@/runtime_engine/rosviz/state/runtimeHealthTypes";
import type { RosVizDeterministicMode } from "@/runtime_engine/rosviz/types";

type RuntimeHealthStoreState = RuntimeHealthSnapshot & {
  setSession: (sessionId: string | null) => void;
  setConnectionStatus: (status: RuntimeConnectionStatus) => void;
  setFixedFrame: (fixedFrame: string) => void;
  setDeterministicMode: (mode: RosVizDeterministicMode) => void;
  setPoseHash: (poseHash: string | null) => void;
  setSessionHash: (sessionHash: string | null) => void;
  recordDeterminismSample: (tickNs: bigint, poseHash: string | null) => void;
  recordFrame: (frame: RosVizStreamFrame) => void;
  recordSequenceGap: () => void;
  setError: (message: string) => void;
  setDiagnostic: (message: string | null) => void;
  reset: () => void;
  _seenPoseHashesByTick: Record<string, string>;
  _seenTickOrder: string[];
};

const MAX_TRACKED_TICKS = 4096;

const INITIAL_SNAPSHOT: RuntimeHealthSnapshot = {
  sessionId: null,
  status: "idle",
  fixedFrame: "world",
  deterministicMode: "strict",
  framesReceived: 0,
  sequenceGapCount: 0,
  lastSequence: null,
  lastClockNs: null,
  lastFrameType: null,
  lastPoseHash: null,
  sessionHash: null,
  determinismMismatchCount: 0,
  lastDeterminismMismatchNs: null,
  lastError: null,
  lastDiagnostic: null,
};

export const useRuntimeHealthStore = create<RuntimeHealthStoreState>((set) => ({
  ...INITIAL_SNAPSHOT,
  _seenPoseHashesByTick: {},
  _seenTickOrder: [],
  setSession: (sessionId) => set(() => ({ sessionId })),
  setConnectionStatus: (status) => set(() => ({ status })),
  setFixedFrame: (fixedFrame) => set(() => ({ fixedFrame })),
  setDeterministicMode: (deterministicMode) => set(() => ({ deterministicMode })),
  setPoseHash: (lastPoseHash) => set(() => ({ lastPoseHash })),
  setSessionHash: (sessionHash) => set(() => ({ sessionHash })),
  recordDeterminismSample: (tickNs, poseHash) =>
    set((state) => {
      if (!poseHash) {
        return state;
      }

      const tickKey = tickNs.toString();
      const existingHash = state._seenPoseHashesByTick[tickKey];
      const nextSeen = { ...state._seenPoseHashesByTick };
      const nextOrder = [...state._seenTickOrder];

      if (existingHash === undefined) {
        nextSeen[tickKey] = poseHash;
        nextOrder.push(tickKey);
        if (nextOrder.length > MAX_TRACKED_TICKS) {
          const removed = nextOrder.shift();
          if (removed) {
            delete nextSeen[removed];
          }
        }
        return {
          _seenPoseHashesByTick: nextSeen,
          _seenTickOrder: nextOrder,
        };
      }

      if (existingHash !== poseHash) {
        nextSeen[tickKey] = poseHash;
        return {
          _seenPoseHashesByTick: nextSeen,
          determinismMismatchCount: state.determinismMismatchCount + 1,
          lastDeterminismMismatchNs: tickNs,
        };
      }

      return state;
    }),
  recordFrame: (frame) =>
    set((state) => ({
      framesReceived: state.framesReceived + 1,
      lastSequence: frame.sequence,
      lastClockNs:
        frame.type === RosVizStreamFrameType.CLOCK_TICK
          ? frame.timestampNs
          : state.lastClockNs,
      lastFrameType: frame.type,
      lastError: null,
    })),
  recordSequenceGap: () =>
    set((state) => ({ sequenceGapCount: state.sequenceGapCount + 1 })),
  setError: (message) =>
    set(() => ({
      status: "error",
      lastError: message,
    })),
  setDiagnostic: (message) =>
    set(() => ({
      lastDiagnostic: message,
    })),
  reset: () =>
    set(() => ({
      ...INITIAL_SNAPSHOT,
      _seenPoseHashesByTick: {},
      _seenTickOrder: [],
    })),
}));
