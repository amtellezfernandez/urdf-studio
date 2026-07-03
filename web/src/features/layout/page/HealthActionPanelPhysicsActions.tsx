import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import type { SimulationPrepPhysicsActionStatus } from "@/features/layout/page/simulationPrepState";
import {
  INERTIAL_SYNTHESIS_DENSITY_PRESETS,
  type InertialDensityPresetId,
} from "@/features/urdf/inertia/inertialSynthesisParams";
import {
  getPhysicsActionButtonLabel,
  MATERIAL_BUTTON_GRID_CLASS,
  MATERIAL_OPTIONS,
  type PhysicsPanelAction,
  type PhysicsPanelActionKey,
} from "@/features/layout/page/healthActionPanelPhysicsActions";

type PhysicsMaterialPickerProps = {
  actionKey: PhysicsPanelActionKey;
  selectedMaterial: InertialDensityPresetId | null;
  disabled: boolean;
  onSelect: (actionKey: PhysicsPanelActionKey, materialId: InertialDensityPresetId) => void;
};

export const PhysicsMaterialPicker = ({
  actionKey,
  selectedMaterial,
  disabled,
  onSelect,
}: PhysicsMaterialPickerProps) => (
  <div className={MATERIAL_BUTTON_GRID_CLASS}>
    {MATERIAL_OPTIONS.map((option) => (
      <Tooltip key={`${actionKey}-${option.id}`} delayDuration={0}>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            className={`h-6 min-h-0 justify-center border-border/50 px-2 py-0 text-[10px] text-muted-foreground hover:text-foreground ${
              selectedMaterial === option.id
                ? "border-foreground/60 bg-muted/50 text-foreground"
                : "bg-transparent"
            }`}
            aria-label={`${option.label} physics material`}
            aria-pressed={selectedMaterial === option.id}
            disabled={disabled}
            onClick={() => onSelect(actionKey, option.id)}
          >
            <span className="font-normal">{option.label}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {option.description} • {INERTIAL_SYNTHESIS_DENSITY_PRESETS[option.id].label}: ρ ={" "}
          {INERTIAL_SYNTHESIS_DENSITY_PRESETS[option.id].densityKgPerM3.toLocaleString()} kg/m^3
        </TooltipContent>
      </Tooltip>
    ))}
  </div>
);

type PhysicsQuickActionCardProps = {
  action: PhysicsPanelAction;
  status: SimulationPrepPhysicsActionStatus;
  isArmed: boolean;
  selectedMaterial: InertialDensityPresetId | null;
  disabled: boolean;
  onRun: (action: PhysicsPanelAction, disabled: boolean) => void;
  onSelect: (actionKey: PhysicsPanelActionKey, materialId: InertialDensityPresetId) => void;
};

export const PhysicsQuickActionCard = ({
  action,
  status,
  isArmed,
  selectedMaterial,
  disabled,
  onRun,
  onSelect,
}: PhysicsQuickActionCardProps) => {
  const isDisabled = disabled || !action.available || status !== "idle";
  return (
    <div className="space-y-1.5 rounded border border-border/30 bg-background/30 p-2">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <div className="min-w-0">
          <div className="text-foreground/90">{action.title}</div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">{action.description}</div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0 border-border/50 bg-transparent px-2.5 text-[10px] font-normal text-muted-foreground hover:text-foreground"
          disabled={isDisabled}
          aria-label={action.title}
          onClick={() => {
            onRun(action, isDisabled);
          }}
        >
          {getPhysicsActionButtonLabel({
            action,
            status,
            isArmed,
            hasSelectedMaterial: selectedMaterial !== null,
          })}
        </Button>
      </div>
      {action.available && isArmed ? (
        <div className="space-y-1.5 border-t border-border/30 pt-1.5">
          <div className="text-[10px] text-muted-foreground">Choose a material to continue.</div>
          <PhysicsMaterialPicker
            actionKey={action.key}
            selectedMaterial={selectedMaterial}
            disabled={isDisabled}
            onSelect={onSelect}
          />
        </div>
      ) : null}
    </div>
  );
};
