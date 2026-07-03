import { create } from "zustand";

type JointValues = Record<string, number>;

export type DataZeroJointSource = "auto" | "imported";

export type JointTopology = {
  name: string;
  type: string;
  parentLinkName: string | null;
  childLinkNames: string[];
};

interface SetJointValueOptions {
  enforceVelocity?: boolean;
  timestamp?: number;
}
export type { SetJointValueOptions };

interface JointParameter {
  name: string;
  value: number;
}

interface TransitionOptions {
  smooth: boolean;
  smoothness: number; // Controls FPS and transition speed (0-100)
}

interface NodeState {
  id: string;
  type: "joint" | "transition";
  joints?: JointParameter[];
  transition?: TransitionOptions;
}

interface JointStore {
  jointValues: JointValues;
  initialJointValues: JointValues;
  dataZeroJointValues: JointValues;
  importedDataZeroJointValues: JointValues;
  dataZeroJointSource: DataZeroJointSource;
  jointUpdateTimes: Record<string, number>;
  availableJoints: string[];
  jointTopologyByName: Record<string, JointTopology>;
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
  setInitialJointValues: (values: JointValues) => void;
  setDataZeroJointValues: (values: JointValues) => void;
  setImportedDataZeroJointValues: (values: JointValues) => void;
  setDataZeroJointSource: (source: DataZeroJointSource) => void;
  getActiveDataZeroJointValues: () => JointValues;
  setAvailableJoints: (joints: string[]) => void;
  setJointTopology: (topology: Record<string, JointTopology>) => void;
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

  const rawDt = (now - lastTimestamp) / 1000;
  // Fail-safe toward stricter limiting when timestamps are invalid or identical.
  const dt = Number.isFinite(rawDt) && rawDt > 0 ? rawDt : 1 / 1000;
  const maxDelta = maxVelocity * dt;
  const delta = target - current;

  if (Math.abs(delta) <= maxDelta) {
    return target;
  }

  return current + Math.sign(delta) * maxDelta;
};

const resolveEffectiveMaxVelocity = (state: JointStore, jointName: string): number | null => {
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
  initialJointValues: {},
  dataZeroJointValues: {},
  importedDataZeroJointValues: {},
  dataZeroJointSource: "auto",
  jointUpdateTimes: {},
  availableJoints: [],
  jointTopologyByName: {},
  nodeStates: {},
  isAnimating: false,
  activeNodeId: null,
  velocityLimitEnabled: true,
  globalMaxJointVelocity: 1,
  jointVelocityLimits: {},
  setVelocityLimitEnabled: () => set({ velocityLimitEnabled: true }),
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
  setInitialJointValues: (values) => set({ initialJointValues: { ...values } }),
  setDataZeroJointValues: (values) => set({ dataZeroJointValues: { ...values } }),
  setImportedDataZeroJointValues: (values) =>
    set({ importedDataZeroJointValues: { ...values } }),
  setDataZeroJointSource: (source) => set({ dataZeroJointSource: source }),
  getActiveDataZeroJointValues: () => {
    const state = get();
    return state.dataZeroJointSource === "imported"
      ? state.importedDataZeroJointValues
      : state.dataZeroJointValues;
  },
  setAvailableJoints: (joints) => set({ availableJoints: [...joints] }),
  setJointTopology: (topology) => set({ jointTopologyByName: { ...topology } }),
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
