import * as React from "react";
import { cn } from "@/shared/lib/utils";
import { ChevronUp, ChevronDown } from "lucide-react";

interface NumberInputProps extends Omit<React.ComponentProps<"input">, "type" | "onChange"> {
  value: number;
  onValueChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  compact?: boolean;
}

export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ 
    value, 
    onValueChange, 
    step = 1, 
    min, 
    max, 
    className, 
    compact = false,
    disabled,
    ...props 
  }, ref) => {
    const [localValue, setLocalValue] = React.useState(String(value));
    const inputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
      setLocalValue(String(value));
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setLocalValue(e.target.value);
    };

    const handleBlur = () => {
      const numValue = parseFloat(localValue);
      if (!isNaN(numValue)) {
        let clampedValue = numValue;
        if (min !== undefined) clampedValue = Math.max(min, clampedValue);
        if (max !== undefined) clampedValue = Math.min(max, clampedValue);
        onValueChange(clampedValue);
        setLocalValue(String(clampedValue));
      } else {
        setLocalValue(String(value));
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.currentTarget.blur();
      }
    };

    const increment = () => {
      if (disabled) return;
      const newValue = value + step;
      let clampedValue = newValue;
      if (min !== undefined) clampedValue = Math.max(min, clampedValue);
      if (max !== undefined) clampedValue = Math.min(max, clampedValue);
      onValueChange(clampedValue);
    };

    const decrement = () => {
      if (disabled) return;
      const newValue = value - step;
      let clampedValue = newValue;
      if (min !== undefined) clampedValue = Math.max(min, clampedValue);
      if (max !== undefined) clampedValue = Math.min(max, clampedValue);
      onValueChange(clampedValue);
    };

    if (compact) {
      return (
        <div className={cn("relative flex items-center group", className)}>
          <input
            ref={ref || inputRef}
            type="text"
            value={localValue}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            className={cn(
              "w-full h-6 pr-6 pl-1.5 text-xs blender-number bg-input border border-border rounded text-foreground",
              "focus:outline-none focus:ring-1 focus:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-50",
              "group-hover:border-border/80",
              className
            )}
            {...props}
          />
          <div className="absolute right-0 top-0 bottom-0 flex flex-col border-l border-border rounded-r">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                increment();
              }}
              disabled={disabled || (max !== undefined && value >= max)}
              className="h-3 w-3 flex items-center justify-center hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed rounded-tr"
              tabIndex={-1}
            >
              <ChevronUp className="w-2.5 h-2.5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                decrement();
              }}
              disabled={disabled || (min !== undefined && value <= min)}
              className="h-3 w-3 flex items-center justify-center hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed rounded-br border-t border-border"
              tabIndex={-1}
            >
              <ChevronDown className="w-2.5 h-2.5" />
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className={cn("relative flex items-center gap-1", className)}>
        <input
          ref={ref || inputRef}
          type="text"
          value={localValue}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          className={cn(
            "flex-1 h-7 px-2 text-xs blender-number bg-input border border-border rounded text-foreground",
            "focus:outline-none focus:ring-1 focus:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
          {...props}
        />
        <div className="flex flex-col">
          <button
            type="button"
            onClick={increment}
            disabled={disabled || (max !== undefined && value >= max)}
            className="h-3.5 w-4 flex items-center justify-center hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed border border-border rounded-t"
          >
            <ChevronUp className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={decrement}
            disabled={disabled || (min !== undefined && value <= min)}
            className="h-3.5 w-4 flex items-center justify-center hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed border border-border border-t-0 rounded-b"
          >
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>
      </div>
    );
  }
);

NumberInput.displayName = "NumberInput";

