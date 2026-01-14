import { NumberInput } from "@/shared/ui/number-input";
import { cn } from "@/shared/lib/utils";

interface Vector3InputsProps {
  values: [number, number, number];
  onChange: (index: number, value: number) => void;
  step?: number;
  min?: number;
  compact?: boolean;
  className?: string;
  inputClassName?: string;
}

export const Vector3Inputs = ({
  values,
  onChange,
  step = 0.01,
  min,
  compact = true,
  className,
  inputClassName = "w-16",
}: Vector3InputsProps) => {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {values.map((val, i) => (
        <NumberInput
          key={i}
          value={val}
          onValueChange={(newVal) => onChange(i, newVal)}
          step={step}
          min={min}
          compact={compact}
          className={inputClassName}
        />
      ))}
    </div>
  );
};
