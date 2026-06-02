import { create } from "zustand";
import {
  OPENARM_HF_LIVE_STATUS_CONNECTING,
  OPENARM_HF_LIVE_STATUS_IDLE,
} from "@/features/teleop/perception/openArmHfLiveParams";
import {
  OPERATOR_LEADER_TELEMETRY_SOURCE_PREFIX,
  OPERATOR_POINT_CLOUD_AUTOCALIBRATION_DURATION_MS,
} from "@/features/teleop/params/operatorTeleopParams";
import type { OperatorPointCloudFrame } from "@/features/teleop/transport/operatorHelperApi";

export type OperatorCameraVideoFrame = {
  sourceId: string;
  label: string;
  stream: MediaStream;
  mode: "live";
};

export type OperatorLiveJointTelemetry = {
  positionRad: number;
  velocityRadPerSec: number;
  torqueNm: number;
  tempMos: number;
  tempRotor: number;
  sourceId: string;
  sourceLabel: string;
  sourceTsMs: number;
  motorId?: number | null;
};

const hasJointTelemetry = (
  telemetryByName: Record<string, OperatorLiveJointTelemetry>,
): boolean => Object.keys(telemetryByName).length > 0;

const sourceIdsFromTelemetry = (
  telemetryByName: Record<string, OperatorLiveJointTelemetry>,
): Set<string> =>
  new Set(
    Object.values(telemetryByName)
      .map((telemetry) => telemetry.sourceId)
      .filter((sourceId) => sourceId.length > 0),
  );

const removeJointTelemetryFromSources = (
  telemetryByName: Record<string, OperatorLiveJointTelemetry>,
  sourceIds: Set<string>,
): Record<string, OperatorLiveJointTelemetry> =>
  Object.fromEntries(
    Object.entries(telemetryByName).filter(
      ([, telemetry]) => !sourceIds.has(telemetry.sourceId),
    ),
  );

export type OperatorPointCloudAutocalibrationRequest = {
  requestId: number;
  startedAtMs: number;
  durationMs: number;
};

export type OperatorPointCloudAutocalibrationReview = {
  requestId: number;
  readyAtMs: number;
  cameraCount: number;
};

export type OperatorPointCloudAutocalibrationDecision = {
  requestId: number;
  action: "accept" | "discard";
  decidedAtMs: number;
};

export type OperatorPointCloudSceneMeshRequest = {
  requestId: number;
  requestedAtMs: number;
};

type OperatorPerceptionStore = {
  activePointCloudFrame: OperatorPointCloudFrame | null;
  activePointCloudFrames: OperatorPointCloudFrame[];
  activeCameraVideoFrame: OperatorCameraVideoFrame | null;
  activeCameraVideoFrames: OperatorCameraVideoFrame[];
  activeJointTelemetryByName: Record<string, OperatorLiveJointTelemetry>;
  activeLeaderJointTelemetryByName: Record<string, OperatorLiveJointTelemetry>;
  activeFollowerJointTelemetryByName: Record<string, OperatorLiveJointTelemetry>;
  pointCloudAutocalibrationRequest: OperatorPointCloudAutocalibrationRequest | null;
  pointCloudAutocalibrationReview: OperatorPointCloudAutocalibrationReview | null;
  pointCloudAutocalibrationDecision: OperatorPointCloudAutocalibrationDecision | null;
  pointCloudSceneMeshRequest: OperatorPointCloudSceneMeshRequest | null;
  pointCloudSceneMeshStatus: string;
  openArmHfLiveObserveRequested: boolean;
  openArmHfLiveObserveStatus: string;
  setActivePointCloudFrame: (frame: OperatorPointCloudFrame | null) => void;
  upsertActivePointCloudFrame: (frame: OperatorPointCloudFrame) => void;
  removeActivePointCloudFrame: (cameraId: string) => void;
  setActiveCameraVideoFrame: (frame: OperatorCameraVideoFrame | null) => void;
  upsertActiveCameraVideoFrame: (frame: OperatorCameraVideoFrame) => void;
  removeActiveCameraVideoFrame: (sourceId: string) => void;
  upsertActiveJointTelemetry: (
    telemetryByName: Record<string, OperatorLiveJointTelemetry>
  ) => void;
  upsertActiveLeaderJointTelemetry: (
    telemetryByName: Record<string, OperatorLiveJointTelemetry>
  ) => void;
  upsertActiveFollowerJointTelemetry: (
    telemetryByName: Record<string, OperatorLiveJointTelemetry>
  ) => void;
  clearActiveJointTelemetry: () => void;
  clearActiveLeaderJointTelemetry: () => void;
  clearActiveFollowerJointTelemetry: () => void;
  requestPointCloudAutocalibration: () => void;
  clearPointCloudAutocalibrationRequest: () => void;
  markPointCloudAutocalibrationReady: (
    requestId: number,
    cameraCount: number,
  ) => void;
  acceptPointCloudAutocalibration: () => void;
  discardPointCloudAutocalibration: () => void;
  clearPointCloudAutocalibrationReview: () => void;
  clearPointCloudAutocalibrationDecision: () => void;
  requestPointCloudSceneMeshes: () => void;
  clearPointCloudSceneMeshRequest: () => void;
  setPointCloudSceneMeshStatus: (status: string) => void;
  requestOpenArmHfLiveObserve: () => void;
  clearOpenArmHfLiveObserveRequest: () => void;
  setOpenArmHfLiveObserveStatus: (status: string) => void;
};

export const useOperatorPerceptionStore = create<OperatorPerceptionStore>((set) => ({
  activePointCloudFrame: null,
  activePointCloudFrames: [],
  activeCameraVideoFrame: null,
  activeCameraVideoFrames: [],
  activeJointTelemetryByName: {},
  activeLeaderJointTelemetryByName: {},
  activeFollowerJointTelemetryByName: {},
  pointCloudAutocalibrationRequest: null,
  pointCloudAutocalibrationReview: null,
  pointCloudAutocalibrationDecision: null,
  pointCloudSceneMeshRequest: null,
  pointCloudSceneMeshStatus: "",
  openArmHfLiveObserveRequested: false,
  openArmHfLiveObserveStatus: OPENARM_HF_LIVE_STATUS_IDLE,
  setActivePointCloudFrame: (frame) =>
    set({ activePointCloudFrame: frame, activePointCloudFrames: frame ? [frame] : [] }),
  upsertActivePointCloudFrame: (frame) =>
    set((state) => {
      const nextFrames = [
        ...state.activePointCloudFrames.filter(
          (candidate) => candidate.cameraId !== frame.cameraId
        ),
        frame,
      ];
      return {
        activePointCloudFrame: nextFrames[0] ?? null,
        activePointCloudFrames: nextFrames,
      };
    }),
  removeActivePointCloudFrame: (cameraId) =>
    set((state) => {
      const nextFrames = state.activePointCloudFrames.filter(
        (candidate) => candidate.cameraId !== cameraId,
      );
      return {
        activePointCloudFrame: nextFrames[0] ?? null,
        activePointCloudFrames: nextFrames,
      };
    }),
  setActiveCameraVideoFrame: (frame) =>
    set({ activeCameraVideoFrame: frame, activeCameraVideoFrames: frame ? [frame] : [] }),
  upsertActiveCameraVideoFrame: (frame) =>
    set((state) => {
      const nextFrames = [
        ...state.activeCameraVideoFrames.filter(
          (candidate) => candidate.sourceId !== frame.sourceId
        ),
        frame,
      ];
      return {
        activeCameraVideoFrame: nextFrames[0] ?? null,
        activeCameraVideoFrames: nextFrames,
      };
    }),
  removeActiveCameraVideoFrame: (sourceId) =>
    set((state) => {
      const nextFrames = state.activeCameraVideoFrames.filter(
        (candidate) => candidate.sourceId !== sourceId,
      );
      return {
        activeCameraVideoFrame: nextFrames[0] ?? null,
        activeCameraVideoFrames: nextFrames,
      };
    }),
  upsertActiveJointTelemetry: (telemetryByName) =>
    set((state) => ({
      activeJointTelemetryByName: {
        ...state.activeJointTelemetryByName,
        ...telemetryByName,
      },
    })),
  upsertActiveLeaderJointTelemetry: (telemetryByName) =>
    set((state) => ({
      activeLeaderJointTelemetryByName: {
        ...state.activeLeaderJointTelemetryByName,
        ...telemetryByName,
      },
    })),
  upsertActiveFollowerJointTelemetry: (telemetryByName) =>
    set((state) => ({
      activeFollowerJointTelemetryByName: {
        ...state.activeFollowerJointTelemetryByName,
        ...telemetryByName,
      },
    })),
  clearActiveJointTelemetry: () =>
    set((state) =>
      hasJointTelemetry(state.activeJointTelemetryByName) ||
      hasJointTelemetry(state.activeLeaderJointTelemetryByName) ||
      hasJointTelemetry(state.activeFollowerJointTelemetryByName)
        ? {
            activeJointTelemetryByName: {},
            activeLeaderJointTelemetryByName: {},
            activeFollowerJointTelemetryByName: {},
          }
        : {},
    ),
  clearActiveLeaderJointTelemetry: () =>
    set((state) =>
      hasJointTelemetry(state.activeLeaderJointTelemetryByName) ||
      Object.values(state.activeJointTelemetryByName).some((telemetry) =>
        telemetry.sourceId.startsWith(OPERATOR_LEADER_TELEMETRY_SOURCE_PREFIX),
      )
        ? {
            activeLeaderJointTelemetryByName: {},
            activeJointTelemetryByName: Object.fromEntries(
              Object.entries(state.activeJointTelemetryByName).filter(
                ([, telemetry]) =>
                  !telemetry.sourceId.startsWith(
                    OPERATOR_LEADER_TELEMETRY_SOURCE_PREFIX,
                  ),
              ),
            ),
          }
        : {},
    ),
  clearActiveFollowerJointTelemetry: () =>
    set((state) => {
      const followerSourceIds = sourceIdsFromTelemetry(
        state.activeFollowerJointTelemetryByName,
      );
      const hasFollowerJointTelemetry = hasJointTelemetry(
        state.activeFollowerJointTelemetryByName,
      );
      const hasActiveFollowerJointTelemetry =
        followerSourceIds.size > 0 &&
        Object.values(state.activeJointTelemetryByName).some((telemetry) =>
          followerSourceIds.has(telemetry.sourceId),
        );

      return hasFollowerJointTelemetry || hasActiveFollowerJointTelemetry
        ? {
            activeFollowerJointTelemetryByName: {},
            activeJointTelemetryByName: removeJointTelemetryFromSources(
              state.activeJointTelemetryByName,
              followerSourceIds,
            ),
          }
        : {};
    }),
  requestPointCloudAutocalibration: () =>
    set((state) => ({
      pointCloudAutocalibrationRequest: {
        requestId: (state.pointCloudAutocalibrationRequest?.requestId ?? 0) + 1,
        startedAtMs: Date.now(),
        durationMs: OPERATOR_POINT_CLOUD_AUTOCALIBRATION_DURATION_MS,
      },
      pointCloudAutocalibrationReview: null,
      pointCloudAutocalibrationDecision: null,
    })),
  clearPointCloudAutocalibrationRequest: () =>
    set({ pointCloudAutocalibrationRequest: null }),
  markPointCloudAutocalibrationReady: (requestId, cameraCount) =>
    set({
      pointCloudAutocalibrationReview: {
        requestId,
        cameraCount,
        readyAtMs: Date.now(),
      },
    }),
  acceptPointCloudAutocalibration: () =>
    set((state) =>
      state.pointCloudAutocalibrationReview
        ? {
            pointCloudAutocalibrationDecision: {
              requestId: state.pointCloudAutocalibrationReview.requestId,
              action: "accept",
              decidedAtMs: Date.now(),
            },
          }
        : {},
    ),
  discardPointCloudAutocalibration: () =>
    set((state) =>
      state.pointCloudAutocalibrationReview
        ? {
            pointCloudAutocalibrationDecision: {
              requestId: state.pointCloudAutocalibrationReview.requestId,
              action: "discard",
              decidedAtMs: Date.now(),
            },
          }
        : {},
    ),
  clearPointCloudAutocalibrationReview: () =>
    set({ pointCloudAutocalibrationReview: null }),
  clearPointCloudAutocalibrationDecision: () =>
    set({ pointCloudAutocalibrationDecision: null }),
  requestPointCloudSceneMeshes: () =>
    set((state) => ({
      pointCloudSceneMeshRequest: {
        requestId: (state.pointCloudSceneMeshRequest?.requestId ?? 0) + 1,
        requestedAtMs: Date.now(),
      },
      pointCloudSceneMeshStatus: "Creating scene meshes from cloud.",
    })),
  clearPointCloudSceneMeshRequest: () =>
    set({ pointCloudSceneMeshRequest: null }),
  setPointCloudSceneMeshStatus: (status) =>
    set({ pointCloudSceneMeshStatus: status }),
  requestOpenArmHfLiveObserve: () =>
    set({
      openArmHfLiveObserveRequested: true,
      openArmHfLiveObserveStatus: OPENARM_HF_LIVE_STATUS_CONNECTING,
    }),
  clearOpenArmHfLiveObserveRequest: () =>
    set({
      openArmHfLiveObserveRequested: false,
      activeCameraVideoFrame: null,
      activeCameraVideoFrames: [],
      activePointCloudFrame: null,
      activePointCloudFrames: [],
      activeJointTelemetryByName: {},
      activeLeaderJointTelemetryByName: {},
      activeFollowerJointTelemetryByName: {},
      pointCloudAutocalibrationRequest: null,
      pointCloudAutocalibrationReview: null,
      pointCloudAutocalibrationDecision: null,
      pointCloudSceneMeshRequest: null,
      pointCloudSceneMeshStatus: "",
      openArmHfLiveObserveStatus: OPENARM_HF_LIVE_STATUS_IDLE,
    }),
  setOpenArmHfLiveObserveStatus: (status) => set({ openArmHfLiveObserveStatus: status }),
}));
