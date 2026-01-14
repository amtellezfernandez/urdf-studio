import { Button } from "@/components/ui/button";
import { 
  Maximize2, 
  Move3D,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavigationGizmoProps {
  onViewChange: (direction: 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right') => void;
  onFitToView: () => void;
  className?: string;
}

export const NavigationGizmo = ({ 
  onViewChange, 
  onFitToView,
  className 
}: NavigationGizmoProps) => {
  return (
    <div className={cn("absolute bottom-6 right-6 z-10 flex flex-col gap-2.5", className)}>
      {/* Main Navigation Cube - Blender Style */}
      <div className="bg-background/95 backdrop-blur-xl rounded-md p-2 border border-border/50 shadow-lg">
        {/* View Buttons - Cube-like arrangement */}
        <div className="relative w-24 h-24 flex items-center justify-center">
          {/* Top Button */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-0 left-1/2 -translate-x-1/2 h-6 w-6 text-xs hover:bg-primary/20 hover:text-primary transition-all rounded-sm"
            onClick={() => onViewChange('top')}
            title="Top View"
          >
            <ArrowUp className="h-3 w-3" />
          </Button>
          
          {/* Bottom Button */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute bottom-0 left-1/2 -translate-x-1/2 h-6 w-6 text-xs hover:bg-primary/20 hover:text-primary transition-all rounded-sm"
            onClick={() => onViewChange('bottom')}
            title="Bottom View"
          >
            <ArrowDown className="h-3 w-3" />
          </Button>
          
          {/* Front Button */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-1/2 left-0 -translate-y-1/2 h-6 w-6 text-xs hover:bg-primary/20 hover:text-primary transition-all rounded-sm"
            onClick={() => onViewChange('front')}
            title="Front View"
          >
            <Eye className="h-3 w-3" />
          </Button>
          
          {/* Back Button */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-1/2 right-0 -translate-y-1/2 h-6 w-6 text-xs hover:bg-primary/20 hover:text-primary transition-all rounded-sm"
            onClick={() => onViewChange('back')}
            title="Back View"
          >
            <EyeOff className="h-3 w-3" />
          </Button>
          
          {/* Right Button */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-1.5 right-1.5 h-6 w-6 text-xs hover:bg-primary/20 hover:text-primary transition-all rounded-sm"
            onClick={() => onViewChange('right')}
            title="Right View"
          >
            <ArrowRight className="h-3 w-3" />
          </Button>
          
          {/* Left Button */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute bottom-1.5 left-1.5 h-6 w-6 text-xs hover:bg-primary/20 hover:text-primary transition-all rounded-sm"
            onClick={() => onViewChange('left')}
            title="Left View"
          >
            <ArrowLeft className="h-3 w-3" />
          </Button>
          
          {/* Center - Orbit indicator (subtle) */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none opacity-20">
            <Move3D className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </div>
      
      {/* Fit to View Button */}
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8 mx-auto bg-background/95 backdrop-blur-xl border-border/50 hover:bg-primary/10 hover:text-primary hover:border-primary/50 shadow-lg transition-all rounded-sm"
        onClick={onFitToView}
        title="Fit Selection to View"
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
};

