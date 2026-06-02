import type { RosVizStreamFrameType } from "@/runtime_engine/rosviz/protocol/rosVizProtocol";
import type { RosVizDeterministicMode } from "@/runtime_engine/rosviz/types";

export type RuntimeConnectionStatus = "idle" | "connecting" | "connected" | "error";

export type RuntimeHealthSnapshot = {
  sessionId: string | null;
  status: RuntimeConnectionStatus;
  fixedFrame: string;
  deterministicMode: RosVizDeterministicMode;
  framesReceived: number;
  sequenceGapCount: number;
  lastSequence: bigint | null;
  lastClockNs: bigint | null;
  lastFrameType: RosVizStreamFrameType | null;
  lastPoseHash: string | null;
  sessionHash: string | null;
  determinismMismatchCount: number;
  lastDeterminismMismatchNs: bigint | null;
  lastError: string | null;
  lastDiagnostic: string | null;
};
