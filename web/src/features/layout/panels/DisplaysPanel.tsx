import { X } from "lucide-react";

import { DISPLAY_ORDER } from "@/features/displays/displayRegistry";
import { useDisplayStore } from "@/features/displays/useDisplayStore";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { Switch } from "@/shared/ui/switch";
import { cn } from "@/shared/lib/utils";

export const DisplaysPanel = () => {
  const isOpen = useWorkspaceStore((state) => state.panels.displays);
  const closePanel = useWorkspaceStore((state) => state.closePanel);
  const displays = useDisplayStore((state) => state.displays);
  const setDisplayEnabled = useDisplayStore((state) => state.setDisplayEnabled);
  const resetDisplays = useDisplayStore((state) => state.resetDisplays);

  if (!isOpen) return null;

  return (
    <aside
      className="fixed right-4 top-[96px] z-50 w-[320px] rounded-md border border-border/40 bg-background/95 shadow-lg backdrop-blur-sm"
      aria-label="Displays panel"
    >
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
        <div>
          <div className="text-xs font-semibold text-foreground">Displays</div>
          <div className="text-[10px] text-muted-foreground">
            Enable only what you need for performance and clarity.
          </div>
        </div>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => closePanel("displays")}
          aria-label="Close displays panel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="max-h-[50vh] overflow-y-auto px-3 py-2 minimal-scrollbar">
        {DISPLAY_ORDER.map((kind) => {
          const display = displays[kind];
          return (
            <div
              key={kind}
              className="mb-2 rounded border border-border/30 bg-background/60 px-2 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-foreground">
                    {display.label}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {display.description}
                  </div>
                </div>
                <Switch
                  checked={display.enabled}
                  onCheckedChange={(checked) => setDisplayEnabled(kind, checked)}
                  aria-label={`Toggle ${display.label}`}
                />
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[10px]">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 uppercase tracking-wide",
                    display.status === "ok" && "bg-emerald-500/20 text-emerald-400",
                    display.status === "warning" && "bg-amber-500/20 text-amber-400",
                    display.status === "error" && "bg-red-500/20 text-red-400",
                    display.status === "idle" && "bg-muted text-muted-foreground"
                  )}
                >
                  {display.status}
                </span>
                <span className="text-muted-foreground">source: {display.source}</span>
                {Object.entries(display.metrics)
                  .slice(0, 2)
                  .map(([name, value]) => (
                    <span key={name} className="text-muted-foreground">
                      {name} {value}
                    </span>
                  ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-border/40 px-3 py-2">
        <button
          type="button"
          className="rounded border border-border/40 px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={resetDisplays}
        >
          Reset Displays
        </button>
      </div>
    </aside>
  );
};
