import { hexToRgba } from "@/shared/lib/color";
import type { JointLimits } from "@/shared/lib/urdfBrowser";
import { cn } from "@/shared/lib/utils";
import {
  buildJointTypeEntries,
  buildJointTypeNamesByType,
} from "@/features/viewer/components/viewerJointTypesPanelState";

type ViewerJointTypesPanelProps = {
  jointLimits?: JointLimits;
  onJointSelect?: (jointName: string | null) => void;
  selectedJoint?: string | null;
  selectedLink?: string | null;
};

export function ViewerJointTypesPanel({
  jointLimits,
  onJointSelect,
  selectedJoint,
  selectedLink,
}: ViewerJointTypesPanelProps) {
  const namesByType = buildJointTypeNamesByType(jointLimits);
  const entries = buildJointTypeEntries({ jointLimits, selectedJoint });
  const totalJoints = Object.keys(jointLimits ?? {}).length;

  const selectFirstJointOfType = (type: string) => {
    const typeJoints = namesByType[type] ?? [];
    if (typeJoints.length > 0) {
      onJointSelect?.(typeJoints[0]);
    }
  };

  return (
    <div className="absolute top-4 left-4 z-10 w-44 rounded border border-border/40 bg-background/98 shadow-md backdrop-blur-sm">
      <div className="border-b border-border/20 px-2 py-1">
        <div className="text-[8px] font-semibold uppercase tracking-tight text-muted-foreground/80">
          Joint Types {totalJoints}
        </div>
      </div>

      <div className="space-y-1 p-1.5">
        <div className="space-y-0.5">
          {entries.map((entry) => (
            <div
              key={entry.type}
              className={cn(
                "flex items-center gap-1 px-1 py-0.5 rounded cursor-pointer transition-colors",
                entry.isSelected
                  ? "bg-primary/15 border border-primary/30"
                  : "hover:bg-muted/15 border border-transparent"
              )}
              onClick={() => selectFirstJointOfType(entry.type)}
            >
              <div
                className="h-1.5 w-1.5 flex-shrink-0 rounded-[2px] border"
                style={{
                  borderColor: entry.color,
                  backgroundColor: entry.isFixed ? entry.color : hexToRgba(entry.color, 0.25),
                }}
              />
              <span className="flex-1 truncate text-[10px] font-medium capitalize text-foreground">
                {entry.label}
              </span>
              <span className="flex-shrink-0 text-[8px] text-muted-foreground/75">
                {entry.count}
              </span>
            </div>
          ))}
        </div>

        <div className="border-t border-border/15 pt-1 text-[8.5px] leading-tight">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground/80">L</span>
            <span className="truncate text-foreground">{selectedLink || "None"}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1">
            <span className="text-muted-foreground/80">J</span>
            <span className="truncate text-foreground">{selectedJoint || "None"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
