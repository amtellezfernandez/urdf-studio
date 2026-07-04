import { useCallback, useEffect, useMemo, useState } from "react";

import type { HealthActionPanelProps } from "@/features/layout/page/healthActionPanelTypes";
import {
  buildPhysicsActionLabel,
  buildPhysicsActionSummary,
} from "@/features/layout/page/healthActionPanelOverview";
import {
  buildPhysicsPanelActionLookup,
  buildPhysicsPanelActionRowViewStates,
  buildPhysicsPanelActions,
  findPhysicsPanelActionRowViewState,
  type PhysicsActionMaterialSelection,
  type PhysicsPanelAction,
  type PhysicsPanelActionKey,
  type PhysicsPanelActionRowViewState,
} from "@/features/layout/page/healthActionPanelPhysicsActions";
import type { InertialDensityPresetId } from "@/features/urdf/inertia/inertialSynthesisParams";

export type UseHealthActionPanelPhysicsControllerOptions = {
  isSimulationPrepActionBlocked: boolean;
  nearMissCount: number;
  onGeneratePhysics?: HealthActionPanelProps["onGeneratePhysics"];
  onGenerateRegularizedPhysics?: HealthActionPanelProps["onGenerateRegularizedPhysics"];
  onGenerateVoxelPhysics?: HealthActionPanelProps["onGenerateVoxelPhysics"];
  onOpenGeneratePhysicsDialog?: HealthActionPanelProps["onOpenGeneratePhysicsDialog"];
  open: boolean;
  physicsActionStatusByKey?: HealthActionPanelProps["physicsActionStatusByKey"];
  physicsAuditSummary: HealthActionPanelProps["physicsAuditSummary"];
  physicsPreflightLoading: boolean;
  voxelRecoveryCount: number;
};

export type UseHealthActionPanelPhysicsControllerResult = {
  handleRunPhysicsAction: (input: {
    action: PhysicsPanelAction;
    isDisabled: boolean;
  }) => void;
  handleSelectPhysicsMaterial: (
    actionKey: PhysicsPanelActionKey,
    materialId: InertialDensityPresetId
  ) => void;
  isPhysicsPanelVisible: boolean;
  openPhysicsPanel: () => void;
  physicsAction: ReturnType<typeof buildPhysicsActionSummary>;
  physicsActionLabel: string;
  physicsPanelActionRows: PhysicsPanelActionRowViewState[];
  regularizeActionRow: PhysicsPanelActionRowViewState | null;
  setIsPhysicsPanelVisible: (visible: boolean) => void;
  shouldShowInlinePhysicsActions: boolean;
  shouldShowPhysicsActionButton: boolean;
  voxelRecoveryActionRow: PhysicsPanelActionRowViewState | null;
};

export const useHealthActionPanelPhysicsController = ({
  isSimulationPrepActionBlocked,
  nearMissCount,
  onGeneratePhysics,
  onGenerateRegularizedPhysics,
  onGenerateVoxelPhysics,
  onOpenGeneratePhysicsDialog,
  open,
  physicsActionStatusByKey,
  physicsAuditSummary,
  physicsPreflightLoading,
  voxelRecoveryCount,
}: UseHealthActionPanelPhysicsControllerOptions): UseHealthActionPanelPhysicsControllerResult => {
  const [isPhysicsPanelVisible, setIsPhysicsPanelVisible] = useState(false);
  const [armedPhysicsActionKey, setArmedPhysicsActionKey] =
    useState<PhysicsPanelActionKey | null>(null);
  const [selectedPhysicsMaterials, setSelectedPhysicsMaterials] =
    useState<PhysicsActionMaterialSelection>({});

  useEffect(() => {
    if (!open) {
      return;
    }
    setArmedPhysicsActionKey(null);
    setSelectedPhysicsMaterials({});
  }, [open]);

  const openPhysicsPanel = useCallback(() => {
    if (!physicsAuditSummary) {
      void onOpenGeneratePhysicsDialog?.();
    }
    setArmedPhysicsActionKey(null);
    setSelectedPhysicsMaterials({});
    setIsPhysicsPanelVisible(true);
  }, [onOpenGeneratePhysicsDialog, physicsAuditSummary]);

  const physicsAction = useMemo(
    () =>
      buildPhysicsActionSummary({
        onOpenGeneratePhysicsDialog,
        physicsPreflightLoading,
        physicsAuditSummary,
        voxelRecoveryCount,
        nearMissCount,
      }),
    [
      nearMissCount,
      onOpenGeneratePhysicsDialog,
      physicsAuditSummary,
      physicsPreflightLoading,
      voxelRecoveryCount,
    ]
  );

  const physicsActionLabel = useMemo(
    () =>
      buildPhysicsActionLabel({
        physicsPreflightLoading,
        physicsAuditSummary,
        voxelRecoveryCount,
        nearMissCount,
      }),
    [nearMissCount, physicsAuditSummary, physicsPreflightLoading, voxelRecoveryCount]
  );

  const physicsPanelActions = useMemo(
    () =>
      buildPhysicsPanelActions({
        audit: physicsAuditSummary,
        voxelRecoveryCount,
        nearMissCount,
        onGeneratePhysics,
        onGenerateVoxelPhysics,
        onGenerateRegularizedPhysics,
      }),
    [
      nearMissCount,
      onGeneratePhysics,
      onGenerateRegularizedPhysics,
      onGenerateVoxelPhysics,
      physicsAuditSummary,
      voxelRecoveryCount,
    ]
  );

  const shouldShowPhysicsActionButton =
    !physicsAuditSummary || physicsPanelActions.length > 0;
  const shouldShowInlinePhysicsActions = Boolean(physicsAuditSummary) &&
    physicsPanelActions.length > 0;
  const physicsActionByKey = useMemo(
    () => buildPhysicsPanelActionLookup(physicsPanelActions),
    [physicsPanelActions]
  );
  const physicsPanelActionRows = useMemo(
    () =>
      buildPhysicsPanelActionRowViewStates({
        actions: physicsPanelActions,
        armedActionKey: armedPhysicsActionKey,
        isBlockedBySimulationPrep: isSimulationPrepActionBlocked,
        selectedMaterials: selectedPhysicsMaterials,
        statusByKey: physicsActionStatusByKey,
      }),
    [
      armedPhysicsActionKey,
      isSimulationPrepActionBlocked,
      physicsActionStatusByKey,
      physicsPanelActions,
      selectedPhysicsMaterials,
    ]
  );

  const voxelRecoveryActionRow = useMemo(
    () => findPhysicsPanelActionRowViewState(physicsPanelActionRows, "voxel-recovery"),
    [physicsPanelActionRows]
  );
  const regularizeActionRow = useMemo(
    () => findPhysicsPanelActionRowViewState(physicsPanelActionRows, "psd-regularize"),
    [physicsPanelActionRows]
  );

  const handleSelectPhysicsMaterial = useCallback(
    (actionKey: PhysicsPanelActionKey, materialId: InertialDensityPresetId) => {
      setSelectedPhysicsMaterials((current) => ({
        ...current,
        [actionKey]: materialId,
      }));
      setArmedPhysicsActionKey(actionKey);

      const action = physicsActionByKey[actionKey];
      const actionStatus =
        findPhysicsPanelActionRowViewState(physicsPanelActionRows, actionKey)?.status ?? "idle";
      if (!action || actionStatus !== "idle") {
        return;
      }
      action.onClick(materialId);
    },
    [physicsActionByKey, physicsPanelActionRows]
  );

  const handleRunPhysicsAction = useCallback(
    ({
      action,
      isDisabled,
    }: {
      action: PhysicsPanelAction;
      isDisabled: boolean;
    }) => {
      if (isDisabled) {
        return;
      }
      const selectedMaterial = selectedPhysicsMaterials[action.key] ?? null;
      if (armedPhysicsActionKey !== action.key || !selectedMaterial) {
        setArmedPhysicsActionKey(action.key);
        return;
      }
      action.onClick(selectedMaterial);
    },
    [armedPhysicsActionKey, selectedPhysicsMaterials]
  );

  return {
    handleRunPhysicsAction,
    handleSelectPhysicsMaterial,
    isPhysicsPanelVisible,
    openPhysicsPanel,
    physicsAction,
    physicsActionLabel,
    physicsPanelActionRows,
    regularizeActionRow,
    setIsPhysicsPanelVisible,
    shouldShowInlinePhysicsActions,
    shouldShowPhysicsActionButton,
    voxelRecoveryActionRow,
  };
};
