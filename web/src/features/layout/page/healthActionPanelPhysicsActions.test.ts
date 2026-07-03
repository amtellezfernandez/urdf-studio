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
      isAnySimulationPrepFixBusy: false,
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
        buttonLabel: "Recalculate",
        disabled: false,
        isArmed: true,
        isRunning: false,
        key: "repair-missing-invalid",
        runningLabel: null,
        selectedMaterial: "aluminum",
        showMaterialPicker: true,
        status: "idle",
      },
      {
        action: voxelAction,
        buttonLabel: "Recovering...",
        disabled: true,
        isArmed: false,
        isRunning: true,
        key: "voxel-recovery",
        runningLabel: "Recovering...",
        selectedMaterial: null,
        showMaterialPicker: false,
        status: "running",
      },
      {
        action: unavailableRegularizeAction,
        buttonLabel: "No Links Available",
        disabled: true,
        isArmed: false,
        key: "psd-regularize",
        selectedMaterial: null,
        showMaterialPicker: false,
        status: "idle",
      },
    ]);
  });

  it("keeps labels informative while global prep work disables idle actions", () => {
    const rows = buildPhysicsPanelActionRowViewStates({
      actions: [createPhysicsAction()],
      armedActionKey: "repair-missing-invalid",
      isAnySimulationPrepFixBusy: true,
      selectedMaterials: {},
      statusByKey: {},
    });

    expect(rows[0]).toMatchObject({
      buttonLabel: "Select Material",
      disabled: true,
      isArmed: true,
      showMaterialPicker: true,
      status: "idle",
    });
  });

  it("provides lookup helpers for handlers and targeted quick actions", () => {
    const repairAction = createPhysicsAction();
    const rows = buildPhysicsPanelActionRowViewStates({
      actions: [repairAction],
      armedActionKey: null,
      isAnySimulationPrepFixBusy: false,
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
