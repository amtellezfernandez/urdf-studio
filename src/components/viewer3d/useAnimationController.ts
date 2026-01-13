import { useCallback, useMemo, useRef, type MutableRefObject } from "react";

export type AnimationController = {
  manualFrameTimeRef: MutableRefObject<number | null>;
  preserveFrameTimeRef: MutableRefObject<number | null>;
  currentFrameIndexRef: MutableRefObject<number>;
  resetAnimationStartRef: MutableRefObject<boolean>;
  isPausedRef: MutableRefObject<boolean>;
  hasManualJointChangesRef: MutableRefObject<boolean>;
  skipFrameUpdateRef: MutableRefObject<boolean>;
  setManualFrameTime: (value: number | null) => void;
  setPreserveFrameTime: (value: number | null) => void;
  setCurrentFrameIndex: (value: number) => void;
  setResetAnimationStart: (value: boolean) => void;
  setPaused: (value: boolean) => void;
  setSkipFrameUpdate: (value: boolean) => void;
  markManualJointChange: () => void;
  clearManualJointChange: () => void;
};

export const useAnimationController = (): AnimationController => {
  const manualFrameTimeRef = useRef<number | null>(null);
  const preserveFrameTimeRef = useRef<number | null>(null);
  const currentFrameIndexRef = useRef<number>(0);
  const resetAnimationStartRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  const hasManualJointChangesRef = useRef<boolean>(false);
  const skipFrameUpdateRef = useRef<boolean>(false);

  const setManualFrameTime = useCallback((value: number | null) => {
    manualFrameTimeRef.current = value;
  }, []);

  const setPreserveFrameTime = useCallback((value: number | null) => {
    preserveFrameTimeRef.current = value;
  }, []);

  const setCurrentFrameIndex = useCallback((value: number) => {
    currentFrameIndexRef.current = value;
  }, []);

  const setResetAnimationStart = useCallback((value: boolean) => {
    resetAnimationStartRef.current = value;
  }, []);

  const setPaused = useCallback((value: boolean) => {
    isPausedRef.current = value;
  }, []);

  const setSkipFrameUpdate = useCallback((value: boolean) => {
    skipFrameUpdateRef.current = value;
  }, []);

  const markManualJointChange = useCallback(() => {
    hasManualJointChangesRef.current = true;
  }, []);

  const clearManualJointChange = useCallback(() => {
    hasManualJointChangesRef.current = false;
  }, []);

  return useMemo(
    () => ({
      manualFrameTimeRef,
      preserveFrameTimeRef,
      currentFrameIndexRef,
      resetAnimationStartRef,
      isPausedRef,
      hasManualJointChangesRef,
      skipFrameUpdateRef,
      setManualFrameTime,
      setPreserveFrameTime,
      setCurrentFrameIndex,
      setResetAnimationStart,
      setPaused,
      setSkipFrameUpdate,
      markManualJointChange,
      clearManualJointChange,
    }),
    [
      setCurrentFrameIndex,
      setManualFrameTime,
      setPaused,
      setPreserveFrameTime,
      setResetAnimationStart,
      setSkipFrameUpdate,
      clearManualJointChange,
      markManualJointChange,
    ]
  );
};
