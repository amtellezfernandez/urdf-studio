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

    // Sync local value with prop value when not dragging
    React.useEffect(() => {
      if (!isDragging) {
        setLocalValue(value[0]);
      }
    }, [value, isDragging]);

    const percentage = ((localValue - min) / (max - min)) * 100;
    const clampedPercentage = Math.max(0, Math.min(100, percentage));

    // Get color for joint type
    const getJointColor = () => {
      if (jointType) {
        const color = (jointColors as Record<string, string>)[jointType] || jointColors.light_gray;
        return color;
      }
      return jointColors.light_gray;
    };

    const jointColor = getJointColor();

    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) return;
      e.preventDefault();
      setIsDragging(true);
      handleMouseMove(e);
    };

    const handleMouseMove = React.useCallback((e: React.MouseEvent<HTMLDivElement> | MouseEvent) => {
      if (disabled || !sliderRef.current) return;
      
      const rect = sliderRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
      const newValue = min + (percentage / 100) * (max - min);
      const steppedValue = Math.round(newValue / step) * step;
      const clampedValue = Math.max(min, Math.min(max, steppedValue));
      
      // Update local value immediately for instant visual feedback
      setLocalValue(clampedValue);
      // Update parent component
      onValueChange([clampedValue]);
    }, [disabled, min, max, step, onValueChange]);

    const handleMouseUp = React.useCallback(() => {
      setIsDragging(false);
    }, []);

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
            !isDragging && "transition-all duration-75"
          )}
          style={{ 
            width: `${clampedPercentage}%`,
            backgroundColor: jointColor
          }}
        />
        
        {/* Thumb - joint color */}
        <div
          className={cn(
            "absolute w-4 h-4 rounded-full border-2 shadow-sm",
            !isDragging && "transition-all duration-75",
            isDragging && "scale-110",
            "group-hover:scale-105"
          )}
          style={{
            left: `calc(${clampedPercentage}% - 8px)`,
            backgroundColor: jointColor,
            borderColor: jointColor
          }}
        />
      </div>
    );
  }
);
CustomSlider.displayName = "CustomSlider";

