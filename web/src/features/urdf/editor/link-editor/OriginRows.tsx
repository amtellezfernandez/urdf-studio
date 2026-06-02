import { BlenderPropertyRow } from "@/shared/ui/blender-panel";
import { Vector3Inputs } from "@/features/urdf/editor/link-editor/Vector3Inputs";

type Origin = { xyz: [number, number, number]; rpy: [number, number, number] };

interface OriginRowsProps {
  origin: Origin;
  onChange: (field: "xyz" | "rpy", index: number, value: number) => void;
  step?: number;
  className?: string;
  inputClassName?: string;
  gapClassName?: string;
}

export const OriginRows = ({
  origin,
  onChange,
  step = 0.01,
  className,
  inputClassName,
  gapClassName,
}: OriginRowsProps) => (
  <div className={className}>
    <BlenderPropertyRow label="Origin XYZ">
      <Vector3Inputs
        values={origin.xyz}
        onChange={(i, newVal) => onChange("xyz", i, newVal)}
        step={step}
        className={gapClassName}
        inputClassName={inputClassName}
      />
    </BlenderPropertyRow>

    <BlenderPropertyRow label="Origin RPY">
      <Vector3Inputs
        values={origin.rpy}
        onChange={(i, newVal) => onChange("rpy", i, newVal)}
        step={step}
        className={gapClassName}
        inputClassName={inputClassName}
      />
    </BlenderPropertyRow>
  </div>
);
