import { useMemo } from "react";
import { Button } from "@/shared/ui/button";
import { MotionTimeline } from "@/features/scenarios/MotionTimeline";
import type { WaypointRecorderContext } from "@/features/scenarios/WaypointRecorderPanel";
import { useWaypointRecorder } from "@/features/scenarios/useWaypointRecorder";
import { useViewerPlaybackStore } from "@/shared/store/useViewerPlaybackStore";

type MotionDockProps = {
  context: WaypointRecorderContext;
};

/**
 * Persistent DCC-style motion controls for the main robot workspace.
 * The detailed scenario/export workflow stays in Motion Studio; this dock is
 * deliberately the place where posing, keying, scrubbing and curves live.
 */
export const MotionDock = ({ context }: MotionDockProps) => {
  const recorder = useWaypointRecorder({
    getJointValues: context.getJointValues,
    setJointValues: context.setJointValues,
  });
  const activePlaybackFrames = useViewerPlaybackStore(
    (state) => state.activeFramePlayback?.frames ?? null
  );
  const activePlaybackFrameIndex = useViewerPlaybackStore((state) => state.currentFrame);
  const setPlaybackFrame = useViewerPlaybackStore((state) => state.setFrame);
  const playbackKeyframes = useMemo(() => {
    if (!activePlaybackFrames || activePlaybackFrames.length === 0) return [];
    const stride = Math.max(1, Math.ceil(activePlaybackFrames.length / 40));
    const sampled = activePlaybackFrames
      .filter((_, index) => index % stride === 0)
      .map((frame) => ({
        time_s: frame.timestamp / 1000,
        joints: { ...frame.joints },
      }));
    const last = activePlaybackFrames[activePlaybackFrames.length - 1];
    if (sampled.at(-1)?.time_s !== last.timestamp / 1000) {
      sampled.push({ time_s: last.timestamp / 1000, joints: { ...last.joints } });
    }
    return sampled;
  }, [activePlaybackFrames]);
  const showingPlayback = recorder.keyframes.length === 0 && playbackKeyframes.length > 0;
  const displayedKeyframes = showingPlayback ? playbackKeyframes : recorder.keyframes;
  const displayedDuration = showingPlayback
    ? playbackKeyframes.at(-1)?.time_s ?? 0
    : recorder.duration;
  const displayedPreviewTime = showingPlayback
    ? (activePlaybackFrames?.[activePlaybackFrameIndex]?.timestamp ?? 0) / 1000
    : recorder.previewTime;
  const handleTimelineSeek = (time: number) => {
    if (!showingPlayback || !activePlaybackFrames) {
      recorder.seek(time);
      return;
    }
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    activePlaybackFrames.forEach((frame, index) => {
      const distance = Math.abs(frame.timestamp / 1000 - time);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    setPlaybackFrame(nearestIndex);
  };

  return (
    <section
      className="h-[244px] shrink-0 border-t border-border/70 bg-background px-3 py-2 shadow-[0_-10px_22px_-22px_hsl(var(--foreground))]"
      aria-label="Motion dock"
    >
      <div className="mx-auto flex h-full max-w-[96rem] flex-col gap-2">
        <div className="flex min-h-7 items-center gap-2">
          <span className="mr-1 text-xs font-semibold uppercase tracking-[0.12em] text-foreground">
            Motion
          </span>
          {showingPlayback ? (
            <span className="rounded border border-border/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              Sample playback
            </span>
          ) : null}
          {recorder.isRecording ? (
            <Button size="sm" variant="destructive" onClick={recorder.stopRecording}>
              ■ Stop
            </Button>
          ) : (
            <Button size="sm" onClick={recorder.startRecording}>
              ● Record
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={recorder.addKeyframe}>
            + Key
          </Button>
          {recorder.isReplaying ? (
            <Button size="sm" variant="outline" onClick={recorder.pauseReplay}>
              ⏸ Pause
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={recorder.replay}
              disabled={recorder.keyframes.length < 1}
            >
              ▶ Play
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={recorder.clear}
            disabled={recorder.keyframes.length === 0}
          >
            Clear
          </Button>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {showingPlayback
              ? `${activePlaybackFrames?.length ?? 0} frames · ${displayedDuration.toFixed(2)}s`
              : `${recorder.keyframes.length} keys · ${recorder.duration.toFixed(2)}s`}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <MotionTimeline
            keyframes={displayedKeyframes}
            duration={displayedDuration}
            previewTime={displayedPreviewTime}
            onSeek={handleTimelineSeek}
            curveLabel={showingPlayback ? "sample joints" : undefined}
            compact
          />
        </div>
      </div>
    </section>
  );
};
