import { describe, expect, it } from "vitest";

import {
  RosVizStreamFrameType,
  type RosVizStreamFrame,
} from "@/runtime_engine/rosviz/protocol/rosVizProtocol";
import { useRuntimeHealthStore } from "@/runtime_engine/rosviz/state/runtimeHealthStore";

const frame = (type: RosVizStreamFrameType, sequence: bigint): RosVizStreamFrame => ({
  type,
  flags: 1,
  sequence,
  timestampNs: 1_000_000_000n + sequence,
  topicId: 1,
  payload: new Uint8Array(),
});

describe("useRuntimeHealthStore", () => {
  it("tracks frames and sequence gaps", () => {
    useRuntimeHealthStore.getState().reset();
    useRuntimeHealthStore.getState().setSession("abc");
    useRuntimeHealthStore.getState().setConnectionStatus("connected");
    useRuntimeHealthStore.getState().recordFrame(frame(RosVizStreamFrameType.CLOCK_TICK, 1n));
    useRuntimeHealthStore.getState().recordSequenceGap();

    const state = useRuntimeHealthStore.getState();
    expect(state.status).toBe("connected");
    expect(state.sessionId).toBe("abc");
    expect(state.framesReceived).toBe(1);
    expect(state.sequenceGapCount).toBe(1);
    expect(state.lastClockNs).toBe(1_000_000_001n);
  });

  it("tracks deterministic telemetry fields", () => {
    useRuntimeHealthStore.getState().reset();
    useRuntimeHealthStore.getState().setDeterministicMode("smooth");
    useRuntimeHealthStore.getState().setPoseHash("pose-hash");
    useRuntimeHealthStore.getState().setSessionHash("session-hash");

    const state = useRuntimeHealthStore.getState();
    expect(state.deterministicMode).toBe("smooth");
    expect(state.lastPoseHash).toBe("pose-hash");
    expect(state.sessionHash).toBe("session-hash");
  });

  it("detects deterministic hash mismatches for a repeated tick", () => {
    useRuntimeHealthStore.getState().reset();
    useRuntimeHealthStore.getState().recordDeterminismSample(100n, "hash-a");
    useRuntimeHealthStore.getState().recordDeterminismSample(100n, "hash-a");
    useRuntimeHealthStore.getState().recordDeterminismSample(100n, "hash-b");

    const state = useRuntimeHealthStore.getState();
    expect(state.determinismMismatchCount).toBe(1);
    expect(state.lastDeterminismMismatchNs).toBe(100n);
  });

  it("switches to error with message", () => {
    useRuntimeHealthStore.getState().reset();
    useRuntimeHealthStore.getState().setError("boom");

    const state = useRuntimeHealthStore.getState();
    expect(state.status).toBe("error");
    expect(state.lastError).toBe("boom");
  });
});
