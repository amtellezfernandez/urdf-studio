import { Calculator } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  INERTIAL_SYNTHESIS_DENSITY_PRESET_OPTIONS,
  type InertialDensityPresetId,
} from "@/features/urdf/inertia/inertialSynthesisParams";

type InertialDraftGeneratorControlsProps = {
  densityPresetId: InertialDensityPresetId;
  onDensityPresetChange: (densityPresetId: InertialDensityPresetId) => void;
  onGenerate: () => void;
  size?: "compact" | "regular";
};

const SIZE_CLASS = {
  compact: {
    selectTrigger: "h-5 w-[88px] text-[9px]",
    selectItem: "text-[10px]",
    button: "h-5 px-1.5 text-[9px]",
    icon: "w-2.5 h-2.5 mr-0.5",
  },
  regular: {
    selectTrigger: "h-6 w-[96px] text-[10px]",
    selectItem: "text-[10px]",
    button: "h-6 px-2 text-[10px]",
    icon: "w-3 h-3 mr-1",
  },
} as const;

export const InertialDraftGeneratorControls = ({
  densityPresetId,
  onDensityPresetChange,
  onGenerate,
  size = "regular",
}: InertialDraftGeneratorControlsProps) => {
  const sizeClass = SIZE_CLASS[size];

  return (
    <div className="flex items-center gap-1">
      <Select
        value={densityPresetId}
        onValueChange={(value) => onDensityPresetChange(value as InertialDensityPresetId)}
      >
        <SelectTrigger className={sizeClass.selectTrigger}>
          <SelectValue placeholder="Density" />
        </SelectTrigger>
        <SelectContent>
          {INERTIAL_SYNTHESIS_DENSITY_PRESET_OPTIONS.map((preset) => (
            <SelectItem key={preset.id} value={preset.id} className={sizeClass.selectItem}>
              {preset.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="sm"
        className={sizeClass.button}
        onClick={onGenerate}
        title="Generate an inertial draft from collision or visual geometry"
      >
        <Calculator className={sizeClass.icon} />
        Generate
      </Button>
    </div>
  );
};
