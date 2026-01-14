import { useEffect, useRef } from "react";
import { useViewerPlaybackStore } from "@/shared/store/useViewerPlaybackStore";

type PlaybackTraceEntry = {
  type: string;
  at: number;
  payload?: Record<string, unknown>;
};

type PlaybackTraceWindow = Window & {
  __playbackTrace?: PlaybackTraceEntry[];
  __playbackTraceLimit?: number;
};

const isPlaybackDebugEnabled = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem("urdfstudio:playbackDebug") === "1";
  } catch {
    return false;
  }
};

const getTraceWindow = (): PlaybackTraceWindow => window as PlaybackTraceWindow;

const pushTraceEntry = (entry: PlaybackTraceEntry) => {
  const traceWindow = getTraceWindow();
  const list = traceWindow.__playbackTrace ?? [];
  traceWindow.__playbackTrace = list;
  const limit = traceWindow.__playbackTraceLimit ?? 300;
  traceWindow.__playbackTraceLimit = limit;
  list.push(entry);
  if (list.length > limit) {
    list.splice(0, list.length - limit);
  }
};

export const recordPlaybackTrace = (
  type: string,
  payload?: Record<string, unknown>
) => {
  if (!isPlaybackDebugEnabled()) {
    return;
  }
  const timestamp =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const entry: PlaybackTraceEntry = { type, at: timestamp, payload };
  pushTraceEntry(entry);
  console.log("[playback]", entry);
};

const diffPlaybackState = (
  next: ReturnType<typeof useViewerPlaybackStore.getState>,
  prev: ReturnType<typeof useViewerPlaybackStore.getState>
) => {
  const changes: Record<string, unknown> = {};
  if (next.isPlaying !== prev.isPlaying) {
    changes.isPlaying = { from: prev.isPlaying, to: next.isPlaying };
  }
  if (next.currentFrame !== prev.currentFrame) {
    changes.currentFrame = { from: prev.currentFrame, to: next.currentFrame };
  }
  if (next.totalFrames !== prev.totalFrames) {
    changes.totalFrames = { from: prev.totalFrames, to: next.totalFrames };
  }
  if (next.hasFrames !== prev.hasFrames) {
    changes.hasFrames = { from: prev.hasFrames, to: next.hasFrames };
  }
  if (next.playbackSpeed !== prev.playbackSpeed) {
    changes.playbackSpeed = {
      from: prev.playbackSpeed,
      to: next.playbackSpeed,
    };
  }
  return changes;
};

export const usePlaybackDebugTrace = () => {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!isPlaybackDebugEnabled()) {
      return;
    }
    if (initializedRef.current) {
      return;
    }
    initializedRef.current = true;

    recordPlaybackTrace("debug:enabled");

    const unsubscribe = useViewerPlaybackStore.subscribe((state, prevState) => {
      const changes = diffPlaybackState(state, prevState);
      if (Object.keys(changes).length > 0) {
        recordPlaybackTrace("state", changes);
      }
    });

    const handleFrameEvent = (event: Event) => {
      const detail = (event as CustomEvent).detail ?? {};
      recordPlaybackTrace("event:frameUpdate", detail as Record<string, unknown>);
    };

    window.addEventListener("viewer3d:frameUpdate", handleFrameEvent);

    return () => {
      unsubscribe();
      window.removeEventListener("viewer3d:frameUpdate", handleFrameEvent);
      initializedRef.current = false;
    };
  }, []);
};
