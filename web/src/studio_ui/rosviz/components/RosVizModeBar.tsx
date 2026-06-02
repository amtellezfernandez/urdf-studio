import type { RosVizSessionMode, RosVizSessionState } from "@/runtime_engine/rosviz/types";
import { ROSVIZ_SESSION_MODE_OPTIONS } from "@/runtime_engine/rosviz/session/modeSpecs";
import { cn } from "@/shared/lib/utils";

type RosVizModeBarProps = {
  sessionState: RosVizSessionState | null;
  clockIsPlaying: boolean;
  clockPlaybackRate: number;
  clockRequestPending: boolean;
  status: string;
  onModeChange: (mode: RosVizSessionMode) => void;
  onTogglePlay: () => void;
  onStep: () => void;
  onCyclePlaybackRate: () => void;
};

const toRateLabel = (value: number): string => `${value.toFixed(1)}x`;

export const RosVizModeBar = ({
  sessionState,
  clockIsPlaying,
  clockPlaybackRate,
  clockRequestPending,
  status,
  onModeChange,
  onTogglePlay,
  onStep,
  onCyclePlaybackRate,
}: RosVizModeBarProps) => {
  const mode = sessionState?.mode ?? "live_debug";
  const isConnected = status === "connected";
  const interactionEnabled = isConnected && !clockRequestPending;

  const canTogglePlay = Boolean(sessionState?.capabilities.can_toggle_play);
  const canStep = Boolean(sessionState?.capabilities.can_step);
  const canSetPlaybackRate = Boolean(sessionState?.capabilities.can_set_playback_rate);
  const hasTimelineControls = canTogglePlay || canStep || canSetPlaybackRate;

  return (
    <div className="absolute right-3 top-11 z-10 flex items-center gap-2 rounded border border-border/40 bg-background/90 px-2 py-1 text-[10px] backdrop-blur-sm">
      <span
        className={cn(
          "rounded px-1.5 py-0.5 font-mono",
          isConnected
            ? "bg-emerald-500/15 text-emerald-300"
            : "bg-amber-500/15 text-amber-300"
        )}
      >
        {isConnected ? "Connected" : "Disconnected"}
      </span>

      <span className="text-muted-foreground">Session</span>
      <select
        value={mode}
        disabled={!sessionState || clockRequestPending}
        onChange={(event) => onModeChange(event.target.value as RosVizSessionMode)}
        className={cn(
          "rounded border border-border/50 bg-background/90 px-2 py-1 font-mono text-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
      >
        {ROSVIZ_SESSION_MODE_OPTIONS.map((option) => (
          <option key={option.mode} value={option.mode}>
            {option.label}
          </option>
        ))}
      </select>

      {hasTimelineControls ? (
        <>
          {canTogglePlay ? (
            <button
              type="button"
              onClick={onTogglePlay}
              disabled={!interactionEnabled}
              className="rounded border border-border/50 bg-background/90 px-2 py-1 font-mono text-foreground hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
            >
              {clockIsPlaying ? "Pause" : "Run"}
            </button>
          ) : null}

          {canStep ? (
            <button
              type="button"
              onClick={onStep}
              disabled={!interactionEnabled}
              className="rounded border border-border/50 bg-background/90 px-2 py-1 font-mono text-foreground hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
            >
              Step +1
            </button>
          ) : null}

          {canSetPlaybackRate ? (
            <button
              type="button"
              onClick={onCyclePlaybackRate}
              disabled={!interactionEnabled}
              className="rounded border border-border/50 bg-background/90 px-2 py-1 font-mono text-foreground hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
            >
              Speed {toRateLabel(clockPlaybackRate)}
            </button>
          ) : null}
        </>
      ) : (
        <div className="rounded border border-border/40 bg-background/85 px-2 py-1 text-muted-foreground">
          Live-only mode
        </div>
      )}
    </div>
  );
};
