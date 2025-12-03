import * as React from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface BlenderPanelProps {
  title: string | React.ReactNode | null;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  alwaysExpanded?: boolean;
}

export const BlenderPanel = ({ title, defaultOpen = true, children, className, alwaysExpanded = false }: BlenderPanelProps) => {
  const [isOpen, setIsOpen] = React.useState(alwaysExpanded || defaultOpen);

  React.useEffect(() => {
    if (alwaysExpanded) {
      setIsOpen(true);
    }
  }, [alwaysExpanded]);

  const shouldShowTitle = title !== "" && title !== null && title !== undefined;
  
  return (
    <Collapsible open={isOpen} onOpenChange={alwaysExpanded ? undefined : setIsOpen} className={cn(shouldShowTitle ? "mb-0.5" : "mb-0", className)}>
      {shouldShowTitle && (
        <CollapsibleTrigger 
          className={cn(
            "w-full flex items-center justify-between px-1.5 py-1 text-xs font-medium text-foreground hover:bg-muted/20 transition-colors rounded-sm",
            alwaysExpanded && "cursor-default"
          )}
          disabled={alwaysExpanded}
        >
          <div className="flex items-center gap-1 min-w-0 flex-1">
            {!alwaysExpanded && (
              <ChevronRight 
                className={cn(
                  "w-2.5 h-2.5 transition-transform duration-200 flex-shrink-0",
                  isOpen && "rotate-90"
                )} 
              />
            )}
            <div className="min-w-0 flex-1 text-left truncate">
              {typeof title === "string" ? <span className="truncate block">{title}</span> : title}
            </div>
          </div>
        </CollapsibleTrigger>
      )}
      <CollapsibleContent className={cn(
        shouldShowTitle ? "px-1.5 pb-1 pt-0.5" : "px-1 pb-0.5 pt-0"
      )}>
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
  labelWidth = "w-20"
}: BlenderPropertyRowProps) => {
  return (
    <div className={cn("flex items-center gap-1.5 py-0.5", className)}>
      <label className={cn("text-[10px] text-muted-foreground flex-shrink-0", labelWidth)}>
        {label}
      </label>
      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  );
};

