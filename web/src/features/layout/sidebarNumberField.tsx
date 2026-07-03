import { NumberInput } from "@/shared/ui/number-input";

export type LabeledNumberFieldProps = {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  step: number;
  min?: number;
  max?: number;
  className: string;
  labelClassName: string;
  wrapperClassName?: string;
};

export const LabeledNumberField = ({
  label,
  value,
  onValueChange,
  step,
  min,
  max,
  className,
  labelClassName,
  wrapperClassName = "space-y-0.5",
}: LabeledNumberFieldProps) => (
  <div className={wrapperClassName}>
    <div className={labelClassName}>{label}</div>
    <NumberInput
      value={value}
      onValueChange={onValueChange}
      step={step}
      min={min}
      max={max}
      compact
      className={className}
    />
  </div>
);
