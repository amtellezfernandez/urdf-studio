import { useCallback, useEffect, useRef, useState } from "react";

import {
  buildWaypointsDocument,
  interpolateWaypoints,
  waypointsDuration,
  type RecordedKeyframe,
  type WaypointsDocument,
} from "@/features/scenarios/waypointRecording";

const REPLAY_INTERVAL_MS = 33;

type UseWaypointRecorderParams = {
  // Live joint state from the viewer.
  getJointValues: () => Record<string, number>;
  setJointValues: (values: Record<string, number>) => void;
};

export type UseWaypointRecorder = ReturnType<typeof useWaypointRecorder>;

const nowSeconds = () => performance.now() / 1000;

export const useWaypointRecorder = ({
  getJointValues,
  setJointValues,
}: UseWaypointRecorderParams) => {
  const [keyframes, setKeyframes] = useState<RecordedKeyframe[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);
  const recordStartRef = useRef<number | null>(null);
  const replayRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const replayStartRef = useRef<number | null>(null);

  const stopReplayTimer = useCallback(() => {
    if (replayRef.current) {
      clearInterval(replayRef.current);
      replayRef.current = null;
    }
  }, []);

  useEffect(() => () => stopReplayTimer(), [stopReplayTimer]);

  const startRecording = useCallback(() => {
    recordStartRef.current = nowSeconds();
    setKeyframes([]);
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    recordStartRef.current = null;
  }, []);

  const addKeyframe = useCallback(() => {
    const elapsed =
      recordStartRef.current === null ? 0 : Math.max(0, nowSeconds() - recordStartRef.current);
    setKeyframes((previous) => {
      // When not recording, append one second after the last keyframe so a
      // pose-by-pose workflow without the clock still produces a timeline.
      const time = recordStartRef.current === null
        ? (previous.length === 0 ? 0 : waypointsDuration(previous) + 1)
        : elapsed;
      return [...previous, { time_s: Number(time.toFixed(3)), joints: { ...getJointValues() } }];
    });
  }, [getJointValues]);

  const setKeyframeTime = useCallback((index: number, time_s: number) => {
    setKeyframes((previous) =>
      previous.map((keyframe, i) => (i === index ? { ...keyframe, time_s } : keyframe))
    );
  }, []);

  const setKeyframeAttach = useCallback((index: number, attach: string | null) => {
    setKeyframes((previous) =>
      previous.map((keyframe, i) =>
        i === index ? { ...keyframe, attach: attach ?? undefined } : keyframe
      )
    );
  }, []);

  const setKeyframeDetach = useCallback((index: number, detach: boolean) => {
    setKeyframes((previous) =>
      previous.map((keyframe, i) => (i === index ? { ...keyframe, detach } : keyframe))
    );
  }, []);

  const removeKeyframe = useCallback((index: number) => {
    setKeyframes((previous) => previous.filter((_, i) => i !== index));
  }, []);

  const clear = useCallback(() => {
    setKeyframes([]);
    recordStartRef.current = null;
    setIsRecording(false);
  }, []);

  const pauseReplay = useCallback(() => {
    stopReplayTimer();
    setIsReplaying(false);
  }, [stopReplayTimer]);

  const replay = useCallback(() => {
    if (keyframes.length < 1) return;
    const duration = waypointsDuration(keyframes);
    stopReplayTimer();
    replayStartRef.current = nowSeconds();
    setIsReplaying(true);
    setPreviewTime(0);
    replayRef.current = setInterval(() => {
      const elapsed =
        replayStartRef.current === null ? 0 : nowSeconds() - replayStartRef.current;
      const clamped = Math.min(elapsed, duration);
      setPreviewTime(clamped);
      setJointValues(interpolateWaypoints(keyframes, clamped));
      if (elapsed >= duration) {
        stopReplayTimer();
        setIsReplaying(false);
      }
    }, REPLAY_INTERVAL_MS);
  }, [keyframes, setJointValues, stopReplayTimer]);

  const document: WaypointsDocument = buildWaypointsDocument(keyframes);
  const usesAttach = keyframes.some((keyframe) => Boolean(keyframe.attach));

  return {
    keyframes,
    isRecording,
    isReplaying,
    previewTime,
    duration: waypointsDuration(keyframes),
    usesAttach,
    document,
    startRecording,
    stopRecording,
    addKeyframe,
    setKeyframeTime,
    setKeyframeAttach,
    setKeyframeDetach,
    removeKeyframe,
    clear,
    replay,
    pauseReplay,
  };
};
