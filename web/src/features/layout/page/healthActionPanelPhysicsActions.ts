import { HEALTH_ACTION_PANEL_PARAMS } from "@/features/layout/page/healthActionPanelParams";
import type { HealthActionPanelProps } from "@/features/layout/page/healthActionPanelTypes";
import type { SimulationPrepPhysicsActionStatus } from "@/features/layout/page/simulationPrepState";
import type { InertialDensityPresetId } from "@/features/urdf/inertia/inertialSynthesisParams";

export type MaterialOption = {
  id: InertialDensityPresetId;
  label: string;
  description: string;
};

export type PhysicsPanelAction = {
  key: "repair-missing-invalid" | "replace-all" | "voxel-recovery" | "psd-regularize";
  title: string;
  description: string;
  buttonLabel: string;
  available: boolean;
  onClick: (densityPresetId: InertialDensityPresetId) => void;
};

export type PhysicsPanelActionKey = PhysicsPanelAction["key"];
export type PhysicsActionMaterialSelection = Partial<
  Record<PhysicsPanelActionKey, InertialDensityPresetId>
>;

const HEALTH_ACTION_CLASS_NAMES = HEALTH_ACTION_PANEL_PARAMS.classNames;

export const MATERIAL_OPTIONS: ReadonlyArray<MaterialOption> = HEALTH_ACTION_PANEL_PARAMS.materialOptions;
export const MATERIAL_BUTTON_GRID_CLASS = HEALTH_ACTION_CLASS_NAMES.materialButtonGrid;

export const PHYSICS_ACTION_STATUS_LABELS: Record<
  PhysicsPanelActionKey,
  { queued: string; running: string }
> = {
  "repair-missing-invalid": { queued: "Queued", running: "Recalculating..." },
  "replace-all": { queued: "Queued", running: "Recalculating..." },
  "voxel-recovery": { queued: "Queued", running: "Recovering..." },
  "psd-regularize": { queued: "Queued", running: "Regularizing..." },
};

export const getPhysicsActionStatus = (
  statusByKey: HealthActionPanelProps["physicsActionStatusByKey"],
  actionKey: PhysicsPanelActionKey
): SimulationPrepPhysicsActionStatus => statusByKey?.[actionKey] ?? "idle";

const getPhysicsActionStatusLabel = (
  actionKey: PhysicsPanelActionKey,
  status: SimulationPrepPhysicsActionStatus,
  idleLabel: string
): string => {
  if (status === "running") {
    return PHYSICS_ACTION_STATUS_LABELS[actionKey].running;
  }
  if (status === "queued") {
    return PHYSICS_ACTION_STATUS_LABELS[actionKey].queued;
  }
  return idleLabel;
};

export const getPhysicsActionButtonLabel = ({
  action,
  status,
  isArmed,
  hasSelectedMaterial,
}: {
  action: PhysicsPanelAction;
  status: SimulationPrepPhysicsActionStatus;
  isArmed: boolean;
  hasSelectedMaterial: boolean;
}): string => {
  if (!action.available) {
    return "No Links Available";
  }
  if (status !== "idle") {
    return getPhysicsActionStatusLabel(action.key, status, action.buttonLabel);
  }
  if (isArmed && !hasSelectedMaterial) {
    return "Select Material";
  }
  return action.buttonLabel;
};

export const buildPhysicsPanelActions = ({
  audit,
  voxelRecoveryCount,
  nearMissCount,
  onGeneratePhysics,
  onGenerateVoxelPhysics,
  onGenerateRegularizedPhysics,
}: {
  audit: HealthActionPanelProps["physicsAuditSummary"];
  voxelRecoveryCount: number;
  nearMissCount: number;
  onGeneratePhysics?: HealthActionPanelProps["onGeneratePhysics"];
  onGenerateVoxelPhysics?: HealthActionPanelProps["onGenerateVoxelPhysics"];
  onGenerateRegularizedPhysics?: HealthActionPanelProps["onGenerateRegularizedPhysics"];
}): PhysicsPanelAction[] => {
  const actions: PhysicsPanelAction[] = [];
  if (audit?.repairableLinkCount && audit.repairableLinkCount > 0 && onGeneratePhysics) {
    actions.push({
      key: "repair-missing-invalid",
      title: `Recalculate ${audit.repairableLinkCount} missing / invalid inertial link${audit.repairableLinkCount === 1 ? "" : "s"}`,
      description: "Only recalculate links that are currently missing inertials or fail validation.",
      buttonLabel: `Recalculate ${audit.repairableLinkCount} missing`,
      available: true,
      onClick: (densityPresetId) => onGeneratePhysics(densityPresetId, "repair-missing-invalid"),
    });
  }
  if (onGenerateVoxelPhysics) {
    actions.push({
      key: "voxel-recovery",
      title:
        voxelRecoveryCount > 0
          ? `Recover ${voxelRecoveryCount} skipped inertial link${voxelRecoveryCount === 1 ? "" : "s"}`
          : "Recover skipped inertial links",
      description:
        voxelRecoveryCount > 0
          ? `${voxelRecoveryCount} passed voxel precheck.`
          : "No links available for voxel recovery.",
      buttonLabel: "Recover",
      available: voxelRecoveryCount > 0,
      onClick: (densityPresetId) => onGenerateVoxelPhysics(densityPresetId),
    });
  }
  if (onGenerateRegularizedPhysics) {
    actions.push({
      key: "psd-regularize",
      title:
        nearMissCount > 0
          ? `Regularize ${nearMissCount} near-miss inertial link${nearMissCount === 1 ? "" : "s"}`
          : "Regularize near-miss inertial links",
      description:
        nearMissCount > 0
          ? "Only links with tiny spectral violations are healed. Hard failures stay blocked."
          : "No links available for PSD regularization.",
      buttonLabel: "Regularize",
      available: nearMissCount > 0,
      onClick: (densityPresetId) => onGenerateRegularizedPhysics(densityPresetId),
    });
  }
  return actions;
};

export type PhysicsPanelActionRowViewState = {
  action: PhysicsPanelAction;
  buttonLabel: string;
  disabled: boolean;
  isArmed: boolean;
  isRunning: boolean;
  key: PhysicsPanelActionKey;
  runningLabel: string | null;
  selectedMaterial: InertialDensityPresetId | null;
  showMaterialPicker: boolean;
  status: SimulationPrepPhysicsActionStatus;
};

export const buildPhysicsPanelActionLookup = (
  actions: readonly PhysicsPanelAction[]
): Partial<Record<PhysicsPanelActionKey, PhysicsPanelAction>> =>
  Object.fromEntries(actions.map((action) => [action.key, action])) as Partial<
    Record<PhysicsPanelActionKey, PhysicsPanelAction>
  >;

export const buildPhysicsPanelActionRowViewStates = ({
  actions,
  armedActionKey,
  isAnySimulationPrepFixBusy,
  selectedMaterials,
  statusByKey,
}: {
  actions: readonly PhysicsPanelAction[];
  armedActionKey: PhysicsPanelActionKey | null;
  isAnySimulationPrepFixBusy: boolean;
  selectedMaterials: PhysicsActionMaterialSelection;
  statusByKey: HealthActionPanelProps["physicsActionStatusByKey"];
}): PhysicsPanelActionRowViewState[] =>
  actions.map((action) => {
    const status = getPhysicsActionStatus(statusByKey, action.key);
    const isArmed = armedActionKey === action.key;
    const selectedMaterial = selectedMaterials[action.key] ?? null;
    const disabled = !action.available || status !== "idle" || isAnySimulationPrepFixBusy;
    return {
      action,
      buttonLabel: getPhysicsActionButtonLabel({
        action,
        hasSelectedMaterial: selectedMaterial !== null,
        isArmed,
        status,
      }),
      disabled,
      isArmed,
      isRunning: status === "running",
      key: action.key,
      runningLabel: status === "running" ? PHYSICS_ACTION_STATUS_LABELS[action.key].running : null,
      selectedMaterial,
      showMaterialPicker: action.available && isArmed,
      status,
    };
  });

export const findPhysicsPanelActionRowViewState = (
  rows: readonly PhysicsPanelActionRowViewState[],
  actionKey: PhysicsPanelActionKey
): PhysicsPanelActionRowViewState | null =>
  rows.find((row) => row.key === actionKey) ?? null;
