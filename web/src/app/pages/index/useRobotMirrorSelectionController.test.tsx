/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useRobotMirrorSelectionController,
  type UseRobotMirrorSelectionControllerResult,
} from "@/app/pages/index/useRobotMirrorSelectionController";
import type { RepeatedInertiaSymmetryLinkCentersLocal } from "@/features/layout/page/repeatedInertiaSymmetryRobot";
import type { RobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import type { RobotMirrorActionableSelection } from "@/features/layout/page/robotMirrorSymmetryFix";
import type { RobotMirrorSelectionLink } from "@/features/layout/page/robotMirrorSymmetrySelection";

const { resolveRobotMirrorActionableSelectionMock } = vi.hoisted(() => ({
  resolveRobotMirrorActionableSelectionMock: vi.fn(),
}));

vi.mock("@/features/layout/page/robotMirrorSymmetryFix", () => ({
  resolveRobotMirrorActionableSelection: (...args: unknown[]) =>
    resolveRobotMirrorActionableSelectionMock(...args),
}));

type HarnessProps = {
  resetRevision?: number;
  robotMirrorSelectionLinks?: readonly RobotMirrorSelectionLink[];
  robotMirrorSymmetryCheck?: RobotMirrorSymmetryCheck | null;
};

type RenderedHarness = {
  getHook: () => UseRobotMirrorSelectionControllerResult;
  rerender: (props?: HarnessProps) => Promise<void>;
  unmount: () => Promise<void>;
};

const ROBOT_MIRROR_SELECTION_TEST_FIXTURES = {
  centerLinkName: "center_link",
  defaultLinkName: "left_finger",
  groupKey: "group:fingers",
  meshLabel: "finger.stl",
  optionalLinkName: "right_finger",
  urdf: "<robot name=\"test\"><link name=\"base_link\" /></robot>",
} as const;

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
};

const flushAsyncWork = async () => {
  await new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
};

const waitForHookState = async (predicate: () => boolean) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (predicate()) {
      return;
    }
    await act(async () => {
      await flushAsyncWork();
    });
  }
  throw new Error("Hook state did not settle before the test timeout.");
};

const createSymmetryCheck = (
  overrides: Partial<RobotMirrorSymmetryCheck> = {}
): RobotMirrorSymmetryCheck => ({
  averageResidualMeters: 0,
  centeredLinkCount: 1,
  centeredLinkNames: [ROBOT_MIRROR_SELECTION_TEST_FIXTURES.centerLinkName],
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
  supportedLinkCount: 1,
  supportedLinkNames: [ROBOT_MIRROR_SELECTION_TEST_FIXTURES.defaultLinkName],
  totalRepeatedLinkCount: 1,
  ...overrides,
});

const createSelectionLink = ({
  linkName,
  preselected = false,
}: {
  linkName: string;
  preselected?: boolean;
}): RobotMirrorSelectionLink => ({
  counterpartLinkName: null,
  defaultExclusionReason: null,
  groupKey: ROBOT_MIRROR_SELECTION_TEST_FIXTURES.groupKey,
  groupLinkCount: 2,
  linkName,
  meshLabel: ROBOT_MIRROR_SELECTION_TEST_FIXTURES.meshLabel,
  preselected,
  status: preselected ? "centered" : "available",
});

const createSelectionLinks = (): RobotMirrorSelectionLink[] => [
  createSelectionLink({
    linkName: ROBOT_MIRROR_SELECTION_TEST_FIXTURES.defaultLinkName,
    preselected: true,
  }),
  createSelectionLink({
    linkName: ROBOT_MIRROR_SELECTION_TEST_FIXTURES.optionalLinkName,
  }),
];

const createActionableSelection = (
  overrides: Partial<RobotMirrorActionableSelection> = {}
): RobotMirrorActionableSelection => ({
  availability: {
    centerOnlyActionableTargetCount: 1,
    centerOnlyAvailable: true,
    orientationOnlyActionableTargetCount: 1,
    orientationOnlyAvailable: true,
  },
  deemphasizedVisualizationLinkNames: [ROBOT_MIRROR_SELECTION_TEST_FIXTURES.centerLinkName],
  visualizationLinkNames: [ROBOT_MIRROR_SELECTION_TEST_FIXTURES.defaultLinkName],
  ...overrides,
});

const renderRobotMirrorSelectionHook = async (
  initialProps: HarnessProps = {}
): Promise<RenderedHarness> => {
  let hookValue: UseRobotMirrorSelectionControllerResult | null = null;
  let currentProps = initialProps;
  const defaultRobotMirrorSelectionLinks = createSelectionLinks();
  const defaultRobotMirrorSymmetryCheck = createSymmetryCheck();
  const linkCentersLocal: RepeatedInertiaSymmetryLinkCentersLocal = new Map();
  const meshFiles = {};
  const packageRoots = {};
  const container = document.createElement("div");
  const root: Root = createRoot(container);

  const Harness = (props: HarnessProps) => {
    hookValue = useRobotMirrorSelectionController({
      meshFiles,
      packageRoots,
      repeatedInertiaSymmetryLinkCentersLocal: linkCentersLocal,
      resetRevision: props.resetRevision ?? 0,
      robot: null,
      robotMirrorSelectionLinks: props.robotMirrorSelectionLinks ?? defaultRobotMirrorSelectionLinks,
      robotMirrorSymmetryCheck:
        props.robotMirrorSymmetryCheck === undefined
          ? defaultRobotMirrorSymmetryCheck
          : props.robotMirrorSymmetryCheck,
      urdfBasePath: "/workspace",
      vizUrdfContent: ROBOT_MIRROR_SELECTION_TEST_FIXTURES.urdf,
    });
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

describe("useRobotMirrorSelectionController", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    resolveRobotMirrorActionableSelectionMock.mockReset();
    resolveRobotMirrorActionableSelectionMock.mockResolvedValue(createActionableSelection());
  });

  it("selects preselected mirror links and toggles manual selections", async () => {
    const harness = await renderRobotMirrorSelectionHook();

    await waitForHookState(
      () =>
        harness.getHook().selectedRobotMirrorLinkNames.length === 1 &&
        harness.getHook().selectedRobotMirrorLinkNames[0] ===
          ROBOT_MIRROR_SELECTION_TEST_FIXTURES.defaultLinkName
    );
    expect(harness.getHook().robotMirrorScopeKey).toBe("robot-mirror:yz");

    await act(async () => {
      harness
        .getHook()
        .handleToggleRobotMirrorSelectionLink(
          ROBOT_MIRROR_SELECTION_TEST_FIXTURES.optionalLinkName
        );
      await flushAsyncWork();
    });
    expect(harness.getHook().selectedRobotMirrorLinkNames).toEqual([
      ROBOT_MIRROR_SELECTION_TEST_FIXTURES.defaultLinkName,
      ROBOT_MIRROR_SELECTION_TEST_FIXTURES.optionalLinkName,
    ]);

    await act(async () => {
      harness
        .getHook()
        .handleToggleRobotMirrorSelectionLink(
          ROBOT_MIRROR_SELECTION_TEST_FIXTURES.defaultLinkName
        );
      await flushAsyncWork();
    });
    expect(harness.getHook().selectedRobotMirrorLinkNames).toEqual([
      ROBOT_MIRROR_SELECTION_TEST_FIXTURES.optionalLinkName,
    ]);

    await harness.unmount();
  });

  it("clears selections when the review reset revision changes", async () => {
    const harness = await renderRobotMirrorSelectionHook();
    await waitForHookState(() =>
      harness
        .getHook()
        .selectedRobotMirrorLinkNames.includes(
          ROBOT_MIRROR_SELECTION_TEST_FIXTURES.defaultLinkName
        )
    );

    await act(async () => {
      harness
        .getHook()
        .handleToggleRobotMirrorSelectionLink(
          ROBOT_MIRROR_SELECTION_TEST_FIXTURES.optionalLinkName
        );
      await flushAsyncWork();
    });
    expect(harness.getHook().selectedRobotMirrorLinkNames).toContain(
      ROBOT_MIRROR_SELECTION_TEST_FIXTURES.optionalLinkName
    );

    await harness.rerender({ resetRevision: 1 });
    await waitForHookState(() => harness.getHook().selectedRobotMirrorLinkNames.length === 0);

    await harness.unmount();
  });

  it("updates availability and visualization from the actionable selection", async () => {
    const pendingSelection = createDeferred<RobotMirrorActionableSelection>();
    resolveRobotMirrorActionableSelectionMock.mockReturnValueOnce(pendingSelection.promise);

    const harness = await renderRobotMirrorSelectionHook();
    await waitForHookState(() => resolveRobotMirrorActionableSelectionMock.mock.calls.length > 0);

    expect(harness.getHook().robotMirrorFixAvailability.isLoading).toBe(true);
    expect(resolveRobotMirrorActionableSelectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        alwaysIncludeVisualizationLinkNames: [
          ROBOT_MIRROR_SELECTION_TEST_FIXTURES.centerLinkName,
        ],
        selectedLinkNames: [ROBOT_MIRROR_SELECTION_TEST_FIXTURES.defaultLinkName],
        urdfContent: ROBOT_MIRROR_SELECTION_TEST_FIXTURES.urdf,
      })
    );

    const resolvedSelection = createActionableSelection({
      deemphasizedVisualizationLinkNames: [ROBOT_MIRROR_SELECTION_TEST_FIXTURES.optionalLinkName],
      visualizationLinkNames: [
        ROBOT_MIRROR_SELECTION_TEST_FIXTURES.defaultLinkName,
        ROBOT_MIRROR_SELECTION_TEST_FIXTURES.optionalLinkName,
      ],
    });
    await act(async () => {
      pendingSelection.resolve(resolvedSelection);
      await pendingSelection.promise;
      await flushAsyncWork();
    });

    expect(harness.getHook().robotMirrorFixAvailability).toEqual({
      isLoading: false,
      value: resolvedSelection.availability,
    });
    expect(harness.getHook().robotMirrorVisualizationState).toEqual({
      deemphasizedVisualizationLinkNames: resolvedSelection.deemphasizedVisualizationLinkNames,
      visualizationLinkNames: resolvedSelection.visualizationLinkNames,
    });

    await harness.unmount();
  });
});
