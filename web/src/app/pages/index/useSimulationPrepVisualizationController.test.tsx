/** @vitest-environment jsdom */
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";

import { useSimulationPrepVisualizationController } from "@/app/pages/index/useSimulationPrepVisualizationController";
import type { RobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import {
  buildRobotMirrorSymmetryVisualizationScopeKey,
  SIMULATION_PREP_VOXEL_RECOVERY_SCOPE_KEY,
  type SimulationPrepVisualizationPreview,
} from "@/features/layout/page/simulationPrepViewerState";
import type { InertialVisualizationSettings } from "@/shared/types/feature";

type HarnessProps = {
  physicsExcludedLinks?: Array<{
    linkName: string;
    recoveryDisposition: string;
  }>;
  robotMirrorVisualizationLinkNames?: string[];
};

type HookState = ReturnType<typeof useSimulationPrepVisualizationController> & {
  inertialVisualization: InertialVisualizationSettings;
  panelOpen: boolean;
};

type RenderedHarness = {
  getHook: () => HookState;
  rerender: (props?: HarnessProps) => Promise<void>;
  unmount: () => Promise<void>;
};

const VISUALIZATION_CONTROLLER_TEST_FIXTURES = {
  leftLinkName: "left_link",
  rightLinkName: "right_link",
  voxelRecoveredLinkName: "thin_cover",
} as const;

const flushAsyncWork = async () => {
  await new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
};

const createRobotMirrorSymmetryCheck = (): RobotMirrorSymmetryCheck => ({
  averageResidualMeters: 0,
  centeredLinkCount: 0,
  centeredLinkNames: [],
  matchedPairCount: 0,
  matchedPairs: [],
  maxResidualMeters: 0,
  originMeters: [0, 0, 0],
  pairedGroupCount: 0,
  pairedLinkCount: 0,
  planeLabel: "yz",
  planeNormalWorld: [1, 0, 0],
  reviewGroups: [],
  reviewLinkCount: 0,
  supportedGroupCount: 1,
  supportedLinkCount: 2,
  supportedLinkNames: [
    VISUALIZATION_CONTROLLER_TEST_FIXTURES.leftLinkName,
    VISUALIZATION_CONTROLLER_TEST_FIXTURES.rightLinkName,
  ],
  totalRepeatedLinkCount: 2,
});

const renderVisualizationControllerHook = async (
  initialProps: HarnessProps = {}
): Promise<RenderedHarness> => {
  const robotMirrorSymmetryCheck = createRobotMirrorSymmetryCheck();
  const robotMirrorScopeKey =
    buildRobotMirrorSymmetryVisualizationScopeKey(robotMirrorSymmetryCheck);
  let hookValue: HookState | null = null;
  let currentProps = initialProps;
  const container = document.createElement("div");
  const root: Root = createRoot(container);

  const Harness = (props: HarnessProps) => {
    const [activeScopeKey, setActiveScopeKey] = useState<string | null>(null);
    const [hoveredPreview, setHoveredPreview] =
      useState<SimulationPrepVisualizationPreview | null>(null);
    const [panelOpen, setPanelOpen] = useState(false);
    const [inertialVisualization, setInertialVisualization] =
      useState<InertialVisualizationSettings>({
        scopedLinkNames: null,
        showGlobalCOM: true,
        showInertia: false,
        showLinkCOM: false,
        showReferenceGeometry: false,
      });
    const controller = useSimulationPrepVisualizationController({
      activeScopeKey,
      displayedSymmetryChains: [],
      hoveredPreview,
      inertialVisualization,
      physicsExcludedLinks: props.physicsExcludedLinks ?? [],
      repeatedInertiaDiagnostics: [],
      robotMirrorScopeKey,
      robotMirrorSymmetryCheck,
      robotMirrorVisualizationLinkNames:
        props.robotMirrorVisualizationLinkNames ?? [
          VISUALIZATION_CONTROLLER_TEST_FIXTURES.leftLinkName,
          VISUALIZATION_CONTROLLER_TEST_FIXTURES.rightLinkName,
        ],
      setActiveScopeKey,
      setHoveredPreview,
      setInertialVisualization,
      setShowHealthActionPanel: setPanelOpen,
    });
    hookValue = {
      ...controller,
      inertialVisualization,
      panelOpen,
    };
    return null;
  };

  const rerender = async (nextProps: HarnessProps = currentProps) => {
    currentProps = nextProps;
    await act(async () => {
      root.render(createElement(Harness, currentProps));
      await flushAsyncWork();
    });
  };

  await rerender(initialProps);

  return {
    getHook: () => {
      if (!hookValue) {
        throw new Error("Hook did not render.");
      }
      return hookValue;
    },
    rerender,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
};

describe("useSimulationPrepVisualizationController", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("activates robot mirror visualization and syncs the scoped link overlay", async () => {
    const harness = await renderVisualizationControllerHook();
    const robotMirrorScopeKey = buildRobotMirrorSymmetryVisualizationScopeKey(
      createRobotMirrorSymmetryCheck()
    );

    await act(async () => {
      harness.getHook().handleToggleInertiaVisualizationScope(robotMirrorScopeKey, [
        VISUALIZATION_CONTROLLER_TEST_FIXTURES.rightLinkName,
        VISUALIZATION_CONTROLLER_TEST_FIXTURES.leftLinkName,
      ]);
      await flushAsyncWork();
    });

    expect(harness.getHook().effectiveScopeKey).toBe(robotMirrorScopeKey);
    expect(harness.getHook().activeRobotMirrorVisualization?.planeLabel).toBe("yz");
    expect(harness.getHook().panelOpen).toBe(true);
    expect(harness.getHook().inertialVisualization.scopedLinkNames).toEqual([
      VISUALIZATION_CONTROLLER_TEST_FIXTURES.leftLinkName,
      VISUALIZATION_CONTROLLER_TEST_FIXTURES.rightLinkName,
    ]);

    await harness.unmount();
  });

  it("keeps physics recovery scopes valid without page-level bookkeeping", async () => {
    const harness = await renderVisualizationControllerHook({
      physicsExcludedLinks: [
        {
          linkName: VISUALIZATION_CONTROLLER_TEST_FIXTURES.voxelRecoveredLinkName,
          recoveryDisposition: "recover",
        },
      ],
    });

    await act(async () => {
      harness.getHook().handleToggleInertiaVisualizationScope(
        SIMULATION_PREP_VOXEL_RECOVERY_SCOPE_KEY,
        [VISUALIZATION_CONTROLLER_TEST_FIXTURES.voxelRecoveredLinkName]
      );
      await flushAsyncWork();
    });

    expect(harness.getHook().effectiveScopeKey).toBe(SIMULATION_PREP_VOXEL_RECOVERY_SCOPE_KEY);
    expect(harness.getHook().inertialVisualization.scopedLinkNames).toEqual([
      VISUALIZATION_CONTROLLER_TEST_FIXTURES.voxelRecoveredLinkName,
    ]);

    await harness.unmount();
  });

  it("clears active scopes that disappear from available visualization targets", async () => {
    const harness = await renderVisualizationControllerHook();
    const robotMirrorScopeKey = buildRobotMirrorSymmetryVisualizationScopeKey(
      createRobotMirrorSymmetryCheck()
    );

    await act(async () => {
      harness.getHook().handleToggleInertiaVisualizationScope(robotMirrorScopeKey, [
        VISUALIZATION_CONTROLLER_TEST_FIXTURES.leftLinkName,
      ]);
      await flushAsyncWork();
    });
    expect(harness.getHook().effectiveScopeKey).toBe(robotMirrorScopeKey);

    await harness.rerender({
      robotMirrorVisualizationLinkNames: [],
    });

    expect(harness.getHook().effectiveScopeKey).toBeNull();
    expect(harness.getHook().inertialVisualization.scopedLinkNames).toBeNull();

    await harness.unmount();
  });
});
