/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HealthActionPanelProps } from "@/features/layout/page/healthActionPanelTypes";
import {
  useHealthActionPanelPhysicsController,
  type UseHealthActionPanelPhysicsControllerOptions,
  type UseHealthActionPanelPhysicsControllerResult,
} from "@/features/layout/page/useHealthActionPanelPhysicsController";

type RenderedHarness = {
  getHook: () => UseHealthActionPanelPhysicsControllerResult;
  rerender: (options: Partial<UseHealthActionPanelPhysicsControllerOptions>) => Promise<void>;
  unmount: () => Promise<void>;
};

const createPhysicsAuditSummary = (
  overrides: Partial<NonNullable<HealthActionPanelProps["physicsAuditSummary"]>> = {}
): NonNullable<HealthActionPanelProps["physicsAuditSummary"]> => ({
  invalidLinkCount: 0,
  missingLinkCount: 0,
  presentLinkCount: 6,
  repairableLinkCount: 0,
  totalLinkCount: 6,
  totalMassKg: 1.25,
  validLinkCount: 6,
  ...overrides,
});

const createDefaultOptions = (
  overrides: Partial<UseHealthActionPanelPhysicsControllerOptions> = {}
): UseHealthActionPanelPhysicsControllerOptions => ({
  isSimulationPrepActionBlocked: false,
  nearMissCount: 0,
  open: true,
  physicsAuditSummary: createPhysicsAuditSummary(),
  physicsPreflightLoading: false,
  voxelRecoveryCount: 0,
  ...overrides,
});

const flushAsyncWork = async () => {
  await new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
};

const renderPhysicsController = async (
  initialOptions: UseHealthActionPanelPhysicsControllerOptions
): Promise<RenderedHarness> => {
  let hookValue: UseHealthActionPanelPhysicsControllerResult | null = null;
  let currentOptions = initialOptions;
  const container = document.createElement("div");
  const root: Root = createRoot(container);

  const Harness = () => {
    hookValue = useHealthActionPanelPhysicsController(currentOptions);
    return null;
  };

  const render = async () => {
    await act(async () => {
      root.render(createElement(Harness));
      await flushAsyncWork();
    });
  };

  await render();

  return {
    getHook: () => {
      if (!hookValue) {
        throw new Error("Hook did not render.");
      }
      return hookValue;
    },
    rerender: async (options) => {
      currentOptions = {
        ...currentOptions,
        ...options,
      };
      await render();
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
};

describe("useHealthActionPanelPhysicsController", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("opens the physics panel and starts the preflight when no audit is loaded", async () => {
    const onOpenGeneratePhysicsDialog = vi.fn();
    const harness = await renderPhysicsController(
      createDefaultOptions({
        onOpenGeneratePhysicsDialog,
        physicsAuditSummary: null,
      })
    );

    expect(harness.getHook().physicsActionLabel).toBe("Run physics check");
    expect(harness.getHook().isPhysicsPanelVisible).toBe(false);

    await act(async () => {
      harness.getHook().openPhysicsPanel();
      await flushAsyncWork();
    });

    expect(onOpenGeneratePhysicsDialog).toHaveBeenCalledTimes(1);
    expect(harness.getHook().isPhysicsPanelVisible).toBe(true);

    await harness.unmount();
  });

  it("requires a material selection before dispatching a voxel recovery action", async () => {
    const onGenerateVoxelPhysics = vi.fn();
    const harness = await renderPhysicsController(
      createDefaultOptions({
        onGenerateVoxelPhysics,
        voxelRecoveryCount: 1,
      })
    );

    const initialRow = harness.getHook().voxelRecoveryActionRow;
    expect(initialRow).toMatchObject({
      actionButtonLabel: "Recover",
      isDisabled: false,
      shouldShowMaterialPicker: false,
    });

    await act(async () => {
      harness.getHook().handleRunPhysicsAction({
        action: initialRow?.action ?? (() => {
          throw new Error("Voxel recovery action row is missing.");
        })(),
        isDisabled: initialRow?.isDisabled ?? true,
      });
      await flushAsyncWork();
    });

    expect(onGenerateVoxelPhysics).not.toHaveBeenCalled();
    expect(harness.getHook().voxelRecoveryActionRow).toMatchObject({
      actionButtonLabel: "Select Material",
      isArmed: true,
      shouldShowMaterialPicker: true,
    });

    await act(async () => {
      harness.getHook().handleSelectPhysicsMaterial("voxel-recovery", "aluminum");
      await flushAsyncWork();
    });

    expect(onGenerateVoxelPhysics).toHaveBeenCalledWith("aluminum");

    await harness.unmount();
  });

  it("does not dispatch material selections while the action is already running", async () => {
    const onGenerateVoxelPhysics = vi.fn();
    const harness = await renderPhysicsController(
      createDefaultOptions({
        onGenerateVoxelPhysics,
        physicsActionStatusByKey: {
          "voxel-recovery": "running",
        },
        voxelRecoveryCount: 1,
      })
    );

    expect(harness.getHook().voxelRecoveryActionRow).toMatchObject({
      actionButtonLabel: "Recovering...",
      isDisabled: true,
      isRunning: true,
    });

    await act(async () => {
      harness.getHook().handleSelectPhysicsMaterial("voxel-recovery", "aluminum");
      await flushAsyncWork();
    });

    expect(onGenerateVoxelPhysics).not.toHaveBeenCalled();

    await harness.unmount();
  });
});
