import { Button } from "@/shared/ui/button";
import { MotionTimeline } from "@/features/scenarios/MotionTimeline";
import type { WaypointRecorderContext } from "@/features/scenarios/WaypointRecorderPanel";
import { useWaypointRecorder } from "@/features/scenarios/useWaypointRecorder";

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
            {recorder.keyframes.length} keys · {recorder.duration.toFixed(2)}s
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <MotionTimeline
            keyframes={recorder.keyframes}
            duration={recorder.duration}
            previewTime={recorder.previewTime}
            onSeek={recorder.seek}
            compact
          />
        </div>
      </div>
    </section>
  );
};
