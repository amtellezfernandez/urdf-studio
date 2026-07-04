/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useSimulationPrepRepairActions,
  type UseSimulationPrepRepairActionsOptions,
  type UseSimulationPrepRepairActionsResult,
} from "@/app/pages/index/useSimulationPrepRepairActions";

const {
  applyRepeatedInertiaGroupManualFixMock,
  applyRepeatedInertiaSymmetryFixMock,
  applyRobotMirrorParallelFixMock,
  applyRobotMirrorSymmetryFixMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  applyRepeatedInertiaGroupManualFixMock: vi.fn(),
  applyRepeatedInertiaSymmetryFixMock: vi.fn(),
  applyRobotMirrorParallelFixMock: vi.fn(),
  applyRobotMirrorSymmetryFixMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/features/urdf/inertia/repeatedInertiaManualFix", () => ({
  applyRepeatedInertiaGroupManualFix: (...args: unknown[]) =>
    applyRepeatedInertiaGroupManualFixMock(...args),
  REPEATED_INERTIA_MANUAL_FIX_ALREADY_CONSISTENT_ERROR: "already consistent",
  REPEATED_INERTIA_MANUAL_FIX_DIFFERS_TOO_MUCH_ERROR: "differs too much",
  REPEATED_INERTIA_MANUAL_FIX_LOW_CONFIDENCE_ERROR: "low confidence",
  REPEATED_INERTIA_MANUAL_FIX_POSTWRITE_MISMATCH_ERROR: "postwrite mismatch",
}));

vi.mock("@/features/layout/page/repeatedInertiaSymmetryFix", () => ({
  applyRepeatedInertiaSymmetryFix: (...args: unknown[]) =>
    applyRepeatedInertiaSymmetryFixMock(...args),
}));

vi.mock("@/features/layout/page/robotMirrorSymmetryFix", () => ({
  applyRobotMirrorParallelFix: (...args: unknown[]) =>
    applyRobotMirrorParallelFixMock(...args),
  applyRobotMirrorSymmetryFix: (...args: unknown[]) =>
    applyRobotMirrorSymmetryFixMock(...args),
}));

type RenderedHarness = {
  getHook: () => UseSimulationPrepRepairActionsResult;
  options: UseSimulationPrepRepairActionsOptions;
  unmount: () => Promise<void>;
};

const SIMULATION_PREP_REPAIR_ACTIONS_TEST_FIXTURES = {
  groupKey: "wheel-repeat-group",
  meshReference: "meshes/wheel.stl",
  nextUrdfContent: "<robot name='fixed' />",
} as const;

const flushAsyncWork = async () => {
  await new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
};

const createDefaultOptions = (
  overrides: Partial<UseSimulationPrepRepairActionsOptions> = {}
): UseSimulationPrepRepairActionsOptions => ({
  applySimulationPrepUrdfUpdate: vi.fn(async () => undefined),
  enableSimulationPrepViewerHighlights: vi.fn(),
  hasSimulationPrepFixActionInFlight: false,
  meshFiles: {},
  packageRoots: {},
  repeatedInertiaDiagnostics: [],
  repeatedInertiaDiagnosticsByKey: new Map([
    [
      SIMULATION_PREP_REPAIR_ACTIONS_TEST_FIXTURES.groupKey,
      {} as UseSimulationPrepRepairActionsOptions["repeatedInertiaDiagnostics"][number],
    ],
  ]),
  repeatedInertiaSymmetryLinkCentersLocal: new Map(),
  robotMirrorFixAvailability: {
    isLoading: false,
    value: {
      centerOnlyActionableTargetCount: 0,
      centerOnlyAvailable: false,
      orientationOnlyActionableTargetCount: 0,
      orientationOnlyAvailable: false,
    },
  },
  robotMirrorScopeKey: null,
  robotMirrorSelectionLinks: [],
  robotMirrorSymmetryCheck: null,
  robotMirrorVisualizationLinkNames: [],
  selectedRobotMirrorLinkNames: [],
  setActiveInertiaVisualizationScopeKey: vi.fn(),
  setActiveRobotMirrorAction: vi.fn(),
  setIsRobotMirrorActing: vi.fn(),
  setRepeatedInertiaGroupAction: vi.fn(),
  setRepeatedInertiaOutcomeByGroupKey: vi.fn(),
  setRepeatedInertiaResolvedGroupKeys: vi.fn(),
  setRepeatedInertiaSymmetryActingChainKey: vi.fn(),
  setRepeatedInertiaSymmetryActingProgress: vi.fn(),
  setRobotMirrorOutcome: vi.fn(),
  setShowHealthActionPanel: vi.fn(),
  urdfAnalysis: null,
  urdfBasePath: "robot",
  vizUrdfContent: "<robot name='source' />",
  ...overrides,
});

const renderSimulationPrepRepairActions = async (
  overrides: Partial<UseSimulationPrepRepairActionsOptions> = {}
): Promise<RenderedHarness> => {
  let hookValue: UseSimulationPrepRepairActionsResult | null = null;
  const root: Root = createRoot(document.createElement("div"));
  const options = createDefaultOptions(overrides);

  const Harness = () => {
    hookValue = useSimulationPrepRepairActions(options);
    return null;
  };

  await act(async () => {
    root.render(createElement(Harness));
    await flushAsyncWork();
  });

  return {
    getHook: () => {
      if (!hookValue) {
        throw new Error("Hook did not render.");
      }
      return hookValue;
    },
    options,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
};

describe("useSimulationPrepRepairActions", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
  });

  it("does not start a repeated-inertia repair while another prep action is running", async () => {
    const harness = await renderSimulationPrepRepairActions({
      hasSimulationPrepFixActionInFlight: true,
    });

    await act(async () => {
      await harness
        .getHook()
        .handleFixRepeatedInertiaGroup(
          SIMULATION_PREP_REPAIR_ACTIONS_TEST_FIXTURES.groupKey
        );
    });

    expect(applyRepeatedInertiaGroupManualFixMock).not.toHaveBeenCalled();
    expect(harness.options.setRepeatedInertiaGroupAction).not.toHaveBeenCalledWith({
      groupKey: SIMULATION_PREP_REPAIR_ACTIONS_TEST_FIXTURES.groupKey,
    });

    await harness.unmount();
  });

  it("applies a successful repeated-inertia repair through the shared URDF update path", async () => {
    applyRepeatedInertiaGroupManualFixMock.mockResolvedValue({
      ok: true,
      draftUrdfContent: SIMULATION_PREP_REPAIR_ACTIONS_TEST_FIXTURES.nextUrdfContent,
      linkNames: ["left_wheel", "right_wheel"],
      meshReference: SIMULATION_PREP_REPAIR_ACTIONS_TEST_FIXTURES.meshReference,
    });
    const harness = await renderSimulationPrepRepairActions();
    vi.mocked(harness.options.setRepeatedInertiaGroupAction).mockClear();
    vi.mocked(harness.options.setRepeatedInertiaOutcomeByGroupKey).mockClear();

    await act(async () => {
      await harness
        .getHook()
        .handleFixRepeatedInertiaGroup(
          SIMULATION_PREP_REPAIR_ACTIONS_TEST_FIXTURES.groupKey
        );
    });

    expect(applyRepeatedInertiaGroupManualFixMock).toHaveBeenCalledWith(
      expect.objectContaining({
        groupKey: SIMULATION_PREP_REPAIR_ACTIONS_TEST_FIXTURES.groupKey,
        meshFiles: {},
        packageRoots: {},
        urdfBasePath: "robot",
        urdfContent: "<robot name='source' />",
      })
    );
    expect(harness.options.applySimulationPrepUrdfUpdate).toHaveBeenCalledWith({
      nextUrdfContent: SIMULATION_PREP_REPAIR_ACTIONS_TEST_FIXTURES.nextUrdfContent,
      successMessage: `Unified repeated group for 2 links (${SIMULATION_PREP_REPAIR_ACTIONS_TEST_FIXTURES.meshReference}).`,
    });
    expect(harness.options.setRepeatedInertiaGroupAction).toHaveBeenNthCalledWith(1, {
      groupKey: SIMULATION_PREP_REPAIR_ACTIONS_TEST_FIXTURES.groupKey,
    });
    expect(harness.options.setRepeatedInertiaGroupAction).toHaveBeenLastCalledWith(null);
    expect(harness.options.setRepeatedInertiaOutcomeByGroupKey).toHaveBeenCalledTimes(1);

    await harness.unmount();
  });
});
