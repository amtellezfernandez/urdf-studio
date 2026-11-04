import type { RecordedKeyframe } from "@/features/scenarios/waypointRecording";

type MotionTimelineProps = {
  keyframes: RecordedKeyframe[];
  duration: number;
  previewTime: number;
  onSeek: (time: number) => void;
  compact?: boolean;
};

const timelineDuration = (duration: number) => Math.max(duration, 1);

const CURVE_COLORS = ["text-sky-500", "text-violet-500", "text-emerald-500"];

type JointCurve = {
  name: string;
  path: string;
  colorClass: string;
};

const buildJointCurves = (keyframes: RecordedKeyframe[], duration: number): JointCurve[] => {
  const names = [...new Set(keyframes.flatMap((keyframe) => Object.keys(keyframe.joints)))].sort().slice(0, 3);
  const displayDuration = timelineDuration(duration);
  return names.map((name, index) => {
    const samples = keyframes
      .filter((keyframe) => Number.isFinite(keyframe.joints[name]))
      .sort((a, b) => a.time_s - b.time_s);
    const values = samples.map((sample) => sample.joints[name]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const path = samples
      .map((sample, sampleIndex) => {
        const x = (Math.min(Math.max(sample.time_s, 0), displayDuration) / displayDuration) * 100;
        const y = 28 - ((sample.joints[name] - min) / span) * 24;
        return `${sampleIndex === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
    return { name, path, colorClass: CURVE_COLORS[index] };
  });
};

export const MotionTimeline = ({
  keyframes,
  duration,
  previewTime,
  onSeek,
  compact = false,
}: MotionTimelineProps) => {
  const displayDuration = timelineDuration(duration);
  const playhead = `${(Math.min(Math.max(previewTime, 0), displayDuration) / displayDuration) * 100}%`;
  const curves = buildJointCurves(keyframes, duration);

  return (
    <section className={`space-y-2 rounded-md border border-border/70 bg-muted/20 ${compact ? "h-full p-2" : "p-3"}`} aria-label="Dope Sheet and Graph Editor">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold uppercase tracking-wide text-foreground">Dope Sheet</span>
        <span className="tabular-nums text-muted-foreground">
          {previewTime.toFixed(2)}s / {duration.toFixed(2)}s
        </span>
      </div>
      <div className={`${compact ? "relative h-9" : "relative h-12"} overflow-hidden rounded border border-border/70 bg-background`}>
        <button
          type="button"
          className="absolute inset-0 cursor-pointer bg-[linear-gradient(90deg,transparent_24.75%,hsl(var(--border))_25%,transparent_25.25%,transparent_49.75%,hsl(var(--border))_50%,transparent_50.25%,transparent_74.75%,hsl(var(--border))_75%,transparent_75.25%)]"
          aria-label="Scrub Dope Sheet"
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            onSeek(((event.clientX - bounds.left) / bounds.width) * displayDuration);
          }}
        />
        <div
          className="pointer-events-none absolute bottom-0 top-0 w-px bg-primary"
          style={{ left: playhead }}
          aria-hidden="true"
        />
        {keyframes.map((keyframe, index) => {
          const left = `${(Math.min(Math.max(keyframe.time_s, 0), displayDuration) / displayDuration) * 100}%`;
          return (
            <button
              key={`${keyframe.time_s}-${index}`}
              type="button"
              className={`absolute top-1 z-10 ${compact ? "h-7" : "h-10"} w-8 -translate-x-1/2 text-center text-[10px] text-primary hover:text-primary/70 focus:outline-none focus:ring-2 focus:ring-ring`}
              style={{ left }}
              onClick={() => onSeek(keyframe.time_s)}
              aria-label={`Keyframe ${index + 1}, ${keyframe.time_s.toFixed(2)} seconds`}
            >
              <span className="mx-auto block h-2.5 w-2.5 rotate-45 rounded-[1px] bg-current" />
              {!compact ? <span className="mt-1 block tabular-nums text-muted-foreground">{index + 1}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between px-px text-[10px] tabular-nums text-muted-foreground">
        <span>0.0s</span>
        <span>{(duration / 2).toFixed(1)}s</span>
        <span>{duration.toFixed(1)}s</span>
      </div>
      <div className="space-y-1 rounded border border-border/60 bg-background px-2 py-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-wide text-foreground">Graph Editor</span>
            <span>{curves.length > 0 ? `first ${curves.length} recorded joints` : "no curves yet"}</span>
          </div>
          {curves.length === 0 ? (
            <div className={`grid ${compact ? "h-[76px]" : "h-[108px]"} place-items-center border-t border-border/50 text-xs text-muted-foreground`}>
              Set a key to display joint curves.
            </div>
          ) : (
          <div className="grid grid-cols-[minmax(72px,auto)_1fr] gap-x-2">
            <div className="flex flex-col justify-around py-1 text-right text-[10px] text-muted-foreground">
              {curves.map((curve) => <span key={curve.name} className="truncate" title={curve.name}>{curve.name}</span>)}
            </div>
            <svg viewBox={`0 0 100 ${curves.length * 36}`} preserveAspectRatio="none" className={`${compact ? "h-[76px]" : "h-[108px]"} w-full`} aria-label="Recorded joint value curves">
              {curves.map((curve, index) => {
                const y = index * 36;
                const playheadX = (Math.min(Math.max(previewTime, 0), displayDuration) / displayDuration) * 100;
                return <g key={curve.name} transform={`translate(0 ${y})`}>
                  <path d="M0 4H100M0 28H100" stroke="currentColor" className="text-border/70" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
                  <path d={curve.path} fill="none" stroke="currentColor" className={curve.colorClass} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                  <path d={`M${playheadX} 2V31`} stroke="currentColor" className="text-primary/75" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
                </g>;
              })}
            </svg>
          </div>
          )}
      </div>
    </section>
  );
};
