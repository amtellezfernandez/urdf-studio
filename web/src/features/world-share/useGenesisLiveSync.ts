import { useEffect, useRef } from "react";
import { useJointStore } from "@/shared/store/useJointStore";
import {
  fetchGenesisLiveState,
  fetchGenesisRobotState,
  fetchGenesisWorldState,
  publishGenesisJointState,
} from "@/features/world-share/genesisWorldApi";
import { useGenesisWorldLiveStateStore } from "@/features/world-share/genesisWorldLiveStateStore";

const GENESIS_LIVE_SYNC_INTERVAL_MS = 16;
const JOINT_PUBLISH_INTERVAL_MS = GENESIS_LIVE_SYNC_INTERVAL_MS;
const LIVE_STATE_POLL_INTERVAL_MS = GENESIS_LIVE_SYNC_INTERVAL_MS;
const ROBOT_STATE_POLL_INTERVAL_MS = GENESIS_LIVE_SYNC_INTERVAL_MS;
const WORLD_STATE_POLL_INTERVAL_MS = GENESIS_LIVE_SYNC_INTERVAL_MS;
const GENESIS_FEEDBACK_JOINT_EPSILON = 1e-6;

let genesisFeedbackStoreUpdateDepth = 0;
let genesisLiveSyncActive = false;
let genesisCommandSequence = 0;
let latestGenesisCommandValues: Record<string, number> = {};
const genesisCommandListeners = new Set<() => void>();

const hasFiniteJointValues = (jointValues: Readonly<Record<string, number>>): boolean =>
  Object.values(jointValues).some((value) => Number.isFinite(value));

const toFiniteJointValues = (
  jointValues: Readonly<Record<string, number>>
): Record<string, number> =>
  Object.fromEntries(
    Object.entries(jointValues).filter(([, value]) => Number.isFinite(value))
  );

const mergeChangedGenesisJointValues = (
  currentJointValues: Readonly<Record<string, number>>,
  genesisJointValues: Readonly<Record<string, number>>
): Record<string, number> | null => {
  let changed = false;
  const nextJointValues = { ...currentJointValues };
  for (const [jointName, value] of Object.entries(genesisJointValues)) {
    if (!Number.isFinite(value)) continue;
    const currentValue = currentJointValues[jointName];
    if (
      currentValue === undefined ||
      Math.abs(currentValue - value) > GENESIS_FEEDBACK_JOINT_EPSILON
    ) {
      changed = true;
      nextJointValues[jointName] = value;
    }
  }
  return changed ? nextJointValues : null;
};

const applyGenesisFeedbackJointValues = (jointValues: Record<string, number>): void => {
  genesisFeedbackStoreUpdateDepth += 1;
  try {
    useJointStore.getState().setJointValues(jointValues);
  } finally {
    genesisFeedbackStoreUpdateDepth -= 1;
  }
};

export const isGenesisLiveSyncActive = (): boolean => genesisLiveSyncActive;

export const queueGenesisJointCommand = (
  jointValues: Readonly<Record<string, number>>
): boolean => {
  if (!genesisLiveSyncActive) return false;
  latestGenesisCommandValues = toFiniteJointValues(jointValues);
  if (!hasFiniteJointValues(latestGenesisCommandValues)) return false;
  genesisCommandSequence += 1;
  genesisCommandListeners.forEach((listener) => listener());
  return true;
};

const subscribeGenesisJointCommands = (listener: () => void): (() => void) => {
  genesisCommandListeners.add(listener);
  return () => {
    genesisCommandListeners.delete(listener);
  };
};

export const useGenesisJointStatePublisher = (enabled: boolean): void => {
  const lastPublishAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const latestJointValuesRef = useRef<Record<string, number>>({});
  const publishingRef = useRef(false);
  const needsFlushRef = useRef(false);

  useEffect(() => {
    genesisLiveSyncActive = enabled;
    if (!enabled) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      latestGenesisCommandValues = {};
      genesisCommandSequence = 0;
      return;
    }

    const flush = () => {
      timerRef.current = null;
      if (publishingRef.current) {
        needsFlushRef.current = true;
        return;
      }
      const jointValues = latestJointValuesRef.current;
      if (!hasFiniteJointValues(jointValues)) return;
      needsFlushRef.current = false;
      publishingRef.current = true;
      lastPublishAtRef.current = Date.now();
      void publishGenesisJointState(jointValues)
        .catch(() => undefined)
        .finally(() => {
          publishingRef.current = false;
          if (needsFlushRef.current) {
            const elapsed = Date.now() - lastPublishAtRef.current;
            const delay = Math.max(0, JOINT_PUBLISH_INTERVAL_MS - elapsed);
            timerRef.current = window.setTimeout(flush, delay);
          }
        });
    };

    const schedule = (jointValues: Record<string, number>) => {
      latestJointValuesRef.current = toFiniteJointValues(jointValues);
      if (timerRef.current !== null) {
        needsFlushRef.current = true;
        return;
      }
      const elapsed = Date.now() - lastPublishAtRef.current;
      const delay = Math.max(0, JOINT_PUBLISH_INTERVAL_MS - elapsed);
      timerRef.current = window.setTimeout(flush, delay);
    };

    schedule(useJointStore.getState().jointValues);
    let lastQueuedCommandSequence = genesisCommandSequence;
    const scheduleQueuedCommand = () => {
      if (genesisCommandSequence <= lastQueuedCommandSequence) return;
      lastQueuedCommandSequence = genesisCommandSequence;
      schedule(latestGenesisCommandValues);
    };
    const unsubscribeCommands = subscribeGenesisJointCommands(scheduleQueuedCommand);
    const unsubscribe = useJointStore.subscribe((state, previousState) => {
      if (state.jointValues === previousState.jointValues) return;
      if (genesisFeedbackStoreUpdateDepth > 0) return;
      schedule(state.jointValues);
    });

    return () => {
      genesisLiveSyncActive = false;
      unsubscribeCommands();
      unsubscribe();
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled]);
};

export const useGenesisLiveStatePoller = (enabled: boolean): void => {
  const latestSequenceRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      latestSequenceRef.current = 0;
      return;
    }
    let cancelled = false;
    let inFlight = false;

    const poll = () => {
      if (inFlight) return;
      inFlight = true;
      void fetchGenesisLiveState()
        .then((state) => {
          if (cancelled) return;
          if (state.sequence === 0) {
            latestSequenceRef.current = 0;
            return;
          }
          if (state.sequence <= latestSequenceRef.current) return;
          latestSequenceRef.current = state.sequence;
          useGenesisWorldLiveStateStore
            .getState()
            .setLivePoses(state.sequence, state.poses);
          const nextJointValues = mergeChangedGenesisJointValues(
            useJointStore.getState().jointValues,
            state.robot_joint_values
          );
          if (nextJointValues !== null) {
            applyGenesisFeedbackJointValues(nextJointValues);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };

    poll();
    const intervalId = window.setInterval(poll, LIVE_STATE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [enabled]);
};

export const useGenesisRobotStatePoller = (enabled: boolean): void => {
  const latestSequenceRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      latestSequenceRef.current = 0;
      return;
    }
    let cancelled = false;
    let inFlight = false;

    const poll = () => {
      if (inFlight) return;
      inFlight = true;
      void fetchGenesisRobotState()
        .then((state) => {
          if (cancelled) return;
          if (state.sequence === 0) {
            latestSequenceRef.current = 0;
            return;
          }
          if (state.sequence <= latestSequenceRef.current) return;
          latestSequenceRef.current = state.sequence;
          const nextJointValues = mergeChangedGenesisJointValues(
            useJointStore.getState().jointValues,
            state.joint_values
          );
          if (nextJointValues === null) return;
          applyGenesisFeedbackJointValues(nextJointValues);
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };

    poll();
    const intervalId = window.setInterval(poll, ROBOT_STATE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [enabled]);
};

export const useGenesisWorldStatePoller = (enabled: boolean): void => {
  const latestSequenceRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      latestSequenceRef.current = 0;
      return;
    }
    let cancelled = false;
    let inFlight = false;

    const poll = () => {
      if (inFlight) return;
      inFlight = true;
      void fetchGenesisWorldState()
        .then((state) => {
          if (cancelled) return;
          if (useGenesisWorldLiveStateStore.getState().sequence === 0) {
            latestSequenceRef.current = 0;
          }
          if (state.sequence <= latestSequenceRef.current) return;
          latestSequenceRef.current = state.sequence;
          useGenesisWorldLiveStateStore
            .getState()
            .setLivePoses(state.sequence, state.poses);
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };

    poll();
    const intervalId = window.setInterval(poll, WORLD_STATE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [enabled]);
};
