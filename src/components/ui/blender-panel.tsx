import * as React from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface BlenderPanelProps {
  title: string | React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}

export const BlenderPanel = ({ title, defaultOpen = true, children, className }: BlenderPanelProps) => {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className={cn("mb-1", className)}>
      <CollapsibleTrigger className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/30 transition-colors rounded-sm">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <ChevronRight 
            className={cn(
              "w-3 h-3 transition-transform duration-200 flex-shrink-0",
              isOpen && "rotate-90"
            )} 
          />
          <div className="min-w-0 flex-1 text-left truncate">
            {typeof title === "string" ? <span className="truncate block">{title}</span> : title}
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-2 pb-2 pt-1">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
};

interface BlenderPropertyRowProps {
  label: string;
  children: React.ReactNode;
  className?: string;
  labelWidth?: string;
}

export const BlenderPropertyRow = ({ 
  label, 
  children, 
  className,
  labelWidth = "w-24"
}: BlenderPropertyRowProps) => {
  return (
    <div className={cn("flex items-center gap-2 py-0.5", className)}>
      <label className={cn("text-xs text-muted-foreground flex-shrink-0", labelWidth)}>
        {label}
      </label>
      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  );
};

