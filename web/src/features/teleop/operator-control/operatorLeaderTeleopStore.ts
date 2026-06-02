import { create } from "zustand";

export type OperatorLeaderTeleopStatus = {
  available: boolean;
  connected: boolean;
  label: string | null;
  reason: string;
};

export const OPERATOR_LEADER_TELEOP_UNAVAILABLE_STATUS = {
  available: false,
  connected: false,
  label: null,
  reason: "Configure leader input before using Leader Teleop.",
} as const satisfies OperatorLeaderTeleopStatus;

type OperatorLeaderTeleopStore = OperatorLeaderTeleopStatus & {
  viewerModeActive: boolean;
  viewerModeRequestId: number;
  viewerModeExitRequestId: number;
  localLeaderAssigned: boolean;
  followerHardwareConnected: boolean;
  studioIkAffectsFollowerHardware: boolean;
  setLeaderTeleopStatus: (status: OperatorLeaderTeleopStatus) => void;
  setLocalLeaderAssigned: (assigned: boolean) => void;
  setFollowerHardwareConnected: (connected: boolean) => void;
  setLeaderTeleopViewerModeActive: (active: boolean) => void;
  requestLeaderTeleopViewerMode: () => void;
  requestExitLeaderTeleopViewerMode: () => void;
  setStudioIkAffectsFollowerHardware: (active: boolean) => void;
};

export const useOperatorLeaderTeleopStore =
  create<OperatorLeaderTeleopStore>((set) => ({
    ...OPERATOR_LEADER_TELEOP_UNAVAILABLE_STATUS,
    viewerModeActive: false,
    viewerModeRequestId: 0,
    viewerModeExitRequestId: 0,
    localLeaderAssigned: false,
    followerHardwareConnected: false,
    studioIkAffectsFollowerHardware: false,
    setLeaderTeleopStatus: (status) => set(status),
    setLocalLeaderAssigned: (assigned) => set({ localLeaderAssigned: assigned }),
    setFollowerHardwareConnected: (connected) =>
      set({ followerHardwareConnected: connected }),
    setLeaderTeleopViewerModeActive: (active) =>
      set({ viewerModeActive: active }),
    requestLeaderTeleopViewerMode: () =>
      set((state) => ({ viewerModeRequestId: state.viewerModeRequestId + 1 })),
    requestExitLeaderTeleopViewerMode: () =>
      set((state) => ({
        viewerModeExitRequestId: state.viewerModeExitRequestId + 1,
      })),
    setStudioIkAffectsFollowerHardware: (active) =>
      set({ studioIkAffectsFollowerHardware: active }),
  }));
