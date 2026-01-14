import * as React from "react";
import { cn } from "@/lib/utils";
import jointColors from "@/joint_colors.json";

interface CustomSliderProps {
  value: number[];
  onValueChange: (value: number[]) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  jointType?: string; // Joint type for color mapping
}

// Helper function to convert hex color string to rgba
const hexToRgba = (hex: string, alpha: number = 1) => {
  const cleanHex = hex.replace("#", "");
  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const CustomSlider = React.forwardRef<HTMLDivElement, CustomSliderProps>(
  ({ value, onValueChange, min, max, step = 0.01, disabled = false, className, jointType }, ref) => {
    const sliderRef = React.useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = React.useState(false);
    const [localValue, setLocalValue] = React.useState(value[0]);
    const lastValueRef = React.useRef(value[0]);
    const rafIdRef = React.useRef<number | null>(null);
    const pendingValueRef = React.useRef<number | null>(null);

    // Sync local value with prop value immediately when not dragging
    // Use useLayoutEffect for immediate sync before paint to prevent visual lag
    React.useLayoutEffect(() => {
      if (!isDragging) {
        const newValue = value[0];
        // Always sync when not dragging to prevent lag when number input changes
        if (newValue !== lastValueRef.current) {
          setLocalValue(newValue);
          lastValueRef.current = newValue;
        }
      }
    }, [value, isDragging]);

    const percentage = ((localValue - min) / (max - min)) * 100;
    const clampedPercentage = Math.max(0, Math.min(100, percentage));

    // Get color for joint type (memoized)
    const jointColor = React.useMemo(() => {
      if (jointType) {
        return (jointColors as Record<string, string>)[jointType] || jointColors.light_gray;
      }
      return jointColors.light_gray;
    }, [jointType]);

    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) return;
      e.preventDefault();
      setIsDragging(true);
      handleMouseMove(e);
    };

    // Throttle parent updates using requestAnimationFrame for smooth dragging
    const updateParentValue = React.useCallback((newValue: number) => {
      pendingValueRef.current = newValue;
      
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          if (pendingValueRef.current !== null) {
            onValueChange([pendingValueRef.current]);
            pendingValueRef.current = null;
          }
          rafIdRef.current = null;
        });
      }
    }, [onValueChange]);

    const handleMouseMove = React.useCallback((e: React.MouseEvent<HTMLDivElement> | MouseEvent) => {
      if (disabled || !sliderRef.current) return;
      
      const rect = sliderRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
      const newValue = min + (percentage / 100) * (max - min);
      const steppedValue = Math.round(newValue / step) * step;
      const clampedValue = Math.max(min, Math.min(max, steppedValue));
      
      // Update local value immediately for instant visual feedback (smooth UI)
      setLocalValue(clampedValue);
      // Throttle parent updates via requestAnimationFrame for performance
      updateParentValue(clampedValue);
    }, [disabled, min, max, step, updateParentValue]);

    const handleMouseUp = React.useCallback(() => {
      setIsDragging(false);
      // Flush any pending value updates when dragging ends
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (pendingValueRef.current !== null) {
        onValueChange([pendingValueRef.current]);
        pendingValueRef.current = null;
      }
    }, [onValueChange]);

    React.useEffect(() => {
      if (isDragging) {
        const handleGlobalMouseMove = (e: MouseEvent) => {
          e.preventDefault();
          handleMouseMove(e);
        };
        const handleGlobalMouseUp = (e: MouseEvent) => {
          e.preventDefault();
          handleMouseUp();
        };
        
        window.addEventListener("mousemove", handleGlobalMouseMove, { passive: false });
        window.addEventListener("mouseup", handleGlobalMouseUp, { passive: false });
        window.addEventListener("mouseleave", handleGlobalMouseUp, { passive: false });
        
        return () => {
          window.removeEventListener("mousemove", handleGlobalMouseMove);
          window.removeEventListener("mouseup", handleGlobalMouseUp);
          window.removeEventListener("mouseleave", handleGlobalMouseUp);
        };
      }
    }, [isDragging, handleMouseMove, handleMouseUp]);

    return (
      <div
        ref={sliderRef}
        className={cn(
          "relative w-full h-8 flex items-center cursor-pointer group select-none",
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
        onMouseDown={handleMouseDown}
      >
        {/* Track background - joint color with opacity */}
        <div 
          className="absolute w-full h-1.5 rounded-full"
          style={{ backgroundColor: hexToRgba(jointColor, 0.15) }}
        />
        
        {/* Active track - joint color, no transition when dragging for instant response */}
        <div
          className={cn(
            "absolute h-1.5 rounded-full",
            !isDragging && "transition-all duration-100 ease-out"
          )}
          style={{ 
            width: `${clampedPercentage}%`,
            backgroundColor: jointColor,
            willChange: isDragging ? 'width' : 'auto'
          }}
        />
        
        {/* Thumb - joint color */}
        <div
          className={cn(
            "absolute w-3 h-3 rounded-full border-2 shadow-sm",
            !isDragging && "transition-all duration-100 ease-out",
            isDragging && "scale-110",
            "group-hover:scale-105"
          )}
          style={{
            left: `calc(${clampedPercentage}% - 6px)`,
            backgroundColor: jointColor,
            borderColor: jointColor,
            willChange: isDragging ? 'left, transform' : 'auto',
            transform: isDragging ? 'translateZ(0)' : undefined // Force GPU acceleration
          }}
        />
      </div>
    );
  }
);
CustomSlider.displayName = "CustomSlider";

