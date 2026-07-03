import { describe, expect, it } from "vitest";
import {
  buildPhysicsPanelActionLookup,
  buildPhysicsPanelActionRowViewStates,
  findPhysicsPanelActionRowViewState,
  type PhysicsPanelAction,
} from "@/features/layout/page/healthActionPanelPhysicsActions";

const createPhysicsAction = (
  overrides: Partial<PhysicsPanelAction> = {}
): PhysicsPanelAction => ({
  available: true,
  buttonLabel: "Recalculate",
  description: "Repair invalid inertial values.",
  key: "repair-missing-invalid",
  onClick: () => undefined,
  title: "Recalculate invalid links",
  ...overrides,
});

describe("healthActionPanelPhysicsActions", () => {
  it("builds action row state with status, material, and button labels", () => {
    const repairAction = createPhysicsAction();
    const voxelAction = createPhysicsAction({
      buttonLabel: "Recover",
      key: "voxel-recovery",
      title: "Recover skipped links",
    });
    const unavailableRegularizeAction = createPhysicsAction({
      available: false,
      buttonLabel: "Regularize",
      key: "psd-regularize",
      title: "Regularize near-miss links",
    });

    const rows = buildPhysicsPanelActionRowViewStates({
      actions: [repairAction, voxelAction, unavailableRegularizeAction],
      armedActionKey: "repair-missing-invalid",
      isBlockedBySimulationPrep: false,
      selectedMaterials: {
        "repair-missing-invalid": "aluminum",
      },
      statusByKey: {
        "voxel-recovery": "running",
      },
    });

    expect(rows).toMatchObject([
      {
        action: repairAction,
        actionButtonLabel: "Recalculate",
        actionKey: "repair-missing-invalid",
        isDisabled: false,
        isArmed: true,
        isRunning: false,
        runningStatusLabel: null,
        selectedMaterial: "aluminum",
        shouldShowMaterialPicker: true,
        status: "idle",
      },
      {
        action: voxelAction,
        actionButtonLabel: "Recovering...",
        actionKey: "voxel-recovery",
        isDisabled: true,
        isArmed: false,
        isRunning: true,
        runningStatusLabel: "Recovering...",
        selectedMaterial: null,
        shouldShowMaterialPicker: false,
        status: "running",
      },
      {
        action: unavailableRegularizeAction,
        actionButtonLabel: "No Links Available",
        actionKey: "psd-regularize",
        isDisabled: true,
        isArmed: false,
        selectedMaterial: null,
        shouldShowMaterialPicker: false,
        status: "idle",
      },
    ]);
  });

  it("keeps labels informative while global prep work disables idle actions", () => {
    const rows = buildPhysicsPanelActionRowViewStates({
      actions: [createPhysicsAction()],
      armedActionKey: "repair-missing-invalid",
      isBlockedBySimulationPrep: true,
      selectedMaterials: {},
      statusByKey: {},
    });

    expect(rows[0]).toMatchObject({
      actionButtonLabel: "Select Material",
      isDisabled: true,
      isArmed: true,
      shouldShowMaterialPicker: true,
      status: "idle",
    });
  });

  it("provides lookup helpers for handlers and targeted quick actions", () => {
    const repairAction = createPhysicsAction();
    const rows = buildPhysicsPanelActionRowViewStates({
      actions: [repairAction],
      armedActionKey: null,
      isBlockedBySimulationPrep: false,
      selectedMaterials: {},
      statusByKey: {},
    });

    expect(buildPhysicsPanelActionLookup([repairAction])).toEqual({
      "repair-missing-invalid": repairAction,
    });
    expect(findPhysicsPanelActionRowViewState(rows, "repair-missing-invalid")).toBe(rows[0]);
    expect(findPhysicsPanelActionRowViewState(rows, "voxel-recovery")).toBeNull();
  });
});
