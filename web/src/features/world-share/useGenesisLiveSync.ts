import { useEffect, useRef } from "react";
import { useJointStore } from "@/shared/store/useJointStore";
import {
  fetchGenesisWorldState,
  publishGenesisJointState,
} from "@/features/world-share/genesisWorldApi";
import { useGenesisWorldLiveStateStore } from "@/features/world-share/genesisWorldLiveStateStore";

const JOINT_PUBLISH_INTERVAL_MS = 33;
const WORLD_STATE_POLL_INTERVAL_MS = 50;

const hasFiniteJointValues = (jointValues: Readonly<Record<string, number>>): boolean =>
  Object.values(jointValues).some((value) => Number.isFinite(value));

const toFiniteJointValues = (
  jointValues: Readonly<Record<string, number>>
): Record<string, number> =>
  Object.fromEntries(
    Object.entries(jointValues).filter(([, value]) => Number.isFinite(value))
  );

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
