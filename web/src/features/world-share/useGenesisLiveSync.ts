import { useEffect, useRef } from "react";
import { useJointStore } from "@/shared/store/useJointStore";
import {
  fetchGenesisRobotState,
  fetchGenesisWorldState,
  publishGenesisJointState,
} from "@/features/world-share/genesisWorldApi";
import { useGenesisWorldLiveStateStore } from "@/features/world-share/genesisWorldLiveStateStore";

const JOINT_PUBLISH_INTERVAL_MS = 33;
const ROBOT_STATE_POLL_INTERVAL_MS = 50;
const WORLD_STATE_POLL_INTERVAL_MS = 50;
const GENESIS_FEEDBACK_JOINT_EPSILON = 1e-6;

let genesisFeedbackStoreUpdateDepth = 0;

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

export const useGenesisJointStatePublisher = (enabled: boolean): void => {
  const lastPublishAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const latestJointValuesRef = useRef<Record<string, number>>({});
  const publishingRef = useRef(false);
  const needsFlushRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
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
    const unsubscribe = useJointStore.subscribe((state, previousState) => {
      if (state.jointValues === previousState.jointValues) return;
      if (genesisFeedbackStoreUpdateDepth > 0) return;
      schedule(state.jointValues);
    });

    return () => {
      unsubscribe();
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
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
