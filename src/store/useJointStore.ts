import { create } from "zustand";

export type JointValues = Record<string, number>;

export interface SetJointValueOptions {
  enforceVelocity?: boolean;
  timestamp?: number;
}

export interface JointParameter {
  name: string;
  value: number;
}

export interface TransitionOptions {
  smooth: boolean;
  smoothness: number; // Controls FPS and transition speed (0-100)
}

export interface NodeState {
  id: string;
  type: "joint" | "transition";
  joints?: JointParameter[];
  transition?: TransitionOptions;
}

interface JointStore {
  jointValues: JointValues;
  jointUpdateTimes: Record<string, number>;
  availableJoints: string[];
  nodeStates: Record<string, NodeState>;
  isAnimating: boolean;
  activeNodeId: string | null;
  velocityLimitEnabled: boolean;
  globalMaxJointVelocity: number;
  jointVelocityLimits: Record<string, number | undefined>;
  setVelocityLimitEnabled: (enabled: boolean) => void;
  setGlobalMaxJointVelocity: (velocity: number) => void;
  setJointMaxVelocity: (jointName: string, velocity: number | null) => void;
  applyGlobalVelocityToAll: () => void;
  previewJointValue: (name: string, target: number, timestamp?: number) => number;
  setJointValue: (name: string, value: number, options?: SetJointValueOptions) => number;
  setJointValues: (values: JointValues) => void;
  setAvailableJoints: (joints: string[]) => void;
  setNodeState: (nodeId: string, state: NodeState) => void;
  getNodeState: (nodeId: string) => NodeState | undefined;
  updateNodeJoints: (nodeId: string, joints: JointParameter[]) => void;
  updateNodeTransition: (nodeId: string, transition: TransitionOptions) => void;
  setIsAnimating: (isAnimating: boolean) => void;
  setActiveNodeId: (nodeId: string | null) => void;
}

const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const MIN_VELOCITY = 1e-4;

const limitJointDelta = (
  target: number,
  current: number,
  maxVelocity: number | null,
  lastTimestamp: number,
  now: number
) => {
  if (maxVelocity === null || !Number.isFinite(maxVelocity) || maxVelocity <= 0) {
    return target;
  }

  const dt = Math.max((now - lastTimestamp) / 1000, 1 / 120);
  const maxDelta = maxVelocity * dt;
  const delta = target - current;

  if (Math.abs(delta) <= maxDelta) {
    return target;
  }

  return current + Math.sign(delta) * maxDelta;
};

const resolveEffectiveMaxVelocity = (state: JointStore, jointName: string): number | null => {
  if (!state.velocityLimitEnabled) {
    return null;
  }

  const override = state.jointVelocityLimits[jointName];
  const candidate =
    override !== undefined && override !== null ? override : state.globalMaxJointVelocity;

  if (!Number.isFinite(candidate) || candidate <= 0) {
    return null;
  }

  return candidate;
};

export const useJointStore = create<JointStore>((set, get) => ({
  jointValues: {},
  jointUpdateTimes: {},
  availableJoints: [],
  nodeStates: {},
  isAnimating: false,
  activeNodeId: null,
  velocityLimitEnabled: false,
  globalMaxJointVelocity: 1,
  jointVelocityLimits: {},
  setVelocityLimitEnabled: (enabled) => set({ velocityLimitEnabled: enabled }),
  setGlobalMaxJointVelocity: (velocity) =>
    set(() => ({
      globalMaxJointVelocity:
        Number.isFinite(velocity) && velocity > 0 ? Math.max(velocity, MIN_VELOCITY) : 1,
    })),
  setJointMaxVelocity: (jointName, velocity) =>
    set((state) => {
      const next = { ...state.jointVelocityLimits };
      if (velocity === null || !Number.isFinite(velocity) || velocity <= 0) {
        delete next[jointName];
      } else {
        next[jointName] = Math.max(velocity, MIN_VELOCITY);
      }
      return { jointVelocityLimits: next };
    }),
  applyGlobalVelocityToAll: () => set(() => ({ jointVelocityLimits: {} })),
  previewJointValue: (name, target, timestamp) => {
    const state = get();
    const now = timestamp ?? nowMs();
    const current = state.jointValues[name] ?? target;
    const last = state.jointUpdateTimes[name] ?? now;
    const maxVelocity = resolveEffectiveMaxVelocity(state, name);
    return limitJointDelta(target, current, maxVelocity, last, now);
  },
  setJointValue: (name, value, options) => {
    const state = get();
    const now = options?.timestamp ?? nowMs();
    const last = state.jointUpdateTimes[name] ?? now;
    const current = state.jointValues[name] ?? value;
    const enforce = options?.enforceVelocity ?? true;
    const maxVelocity = enforce ? resolveEffectiveMaxVelocity(state, name) : null;
    const next =
      enforce && maxVelocity !== null
        ? limitJointDelta(value, current, maxVelocity, last, now)
        : value;

    set({
      jointValues: { ...state.jointValues, [name]: next },
      jointUpdateTimes: { ...state.jointUpdateTimes, [name]: now },
    });

    return next;
  },
  setJointValues: (values) =>
    set((state) => {
      const now = nowMs();
      const nextTimes = { ...state.jointUpdateTimes };
      Object.keys(values).forEach((key) => {
        nextTimes[key] = now;
      });
      return {
        jointValues: { ...values },
        jointUpdateTimes: nextTimes,
      };
    }),
  setAvailableJoints: (joints) => set({ availableJoints: [...joints] }),
  setNodeState: (nodeId, state) =>
    set((s) => ({
      nodeStates: { ...s.nodeStates, [nodeId]: state },
    })),
  getNodeState: (nodeId) => get().nodeStates[nodeId],
  updateNodeJoints: (nodeId, joints) =>
    set((s) => {
      const existing = s.nodeStates[nodeId];
      if (!existing) return s;
      return {
        nodeStates: {
          ...s.nodeStates,
          [nodeId]: { ...existing, joints },
        },
      };
    }),
  updateNodeTransition: (nodeId, transition) =>
    set((s) => {
      const existing = s.nodeStates[nodeId];
      if (!existing) return s;
      return {
        nodeStates: {
          ...s.nodeStates,
          [nodeId]: { ...existing, transition },
        },
      };
    }),
  setIsAnimating: (isAnimating) => set({ isAnimating }),
  setActiveNodeId: (nodeId) => set({ activeNodeId: nodeId }),
}));