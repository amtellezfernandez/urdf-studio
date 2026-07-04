/** @vitest-environment jsdom */
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  InertialSynthesisSession,
  PhysicsPreflightSession,
} from "@/app/pages/index/indexPageRuntimeHelpers";
import {
  useSimulationPrepPhysicsActions,
  type UseSimulationPrepPhysicsActionsResult,
} from "@/app/pages/index/useSimulationPrepPhysicsActions";
import type { UrdfViewMode } from "@/shared/types/feature";

const {
  generatePhysicsDraftViaBackendMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  generatePhysicsDraftViaBackendMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@/features/urdf/inertia/robotMasteringApi", () => ({
  generatePhysicsDraftViaBackend: (...args: unknown[]) =>
    generatePhysicsDraftViaBackendMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

type HarnessProps = {
  externalActionInFlight?: boolean;
  physicsPreflightSession?: PhysicsPreflightSession | null;
  showUrdfEditor?: boolean;
};

type HarnessState = {
  inertialSession: InertialSynthesisSession | null;
  viewMode: UrdfViewMode;
};

type RenderedHarness = {
  getHook: () => UseSimulationPrepPhysicsActionsResult;
  getState: () => HarnessState;
  loadPhysicsPreflightMock: ReturnType<typeof vi.fn>;
  rerender: (props?: HarnessProps) => Promise<void>;
  unmount: () => Promise<void>;
};

const PHYSICS_ACTION_TEST_FIXTURES = {
  baseUrdf: "<robot name=\"base\"><link name=\"base_link\" /></robot>",
  draftUrdf: "<robot name=\"draft\"><link name=\"base_link\" /></robot>",
  recoverLinkName: "recover_link",
  regularizeLinkName: "regularize_link",
  sourceUrdf: "<robot name=\"source\"><link name=\"base_link\" /></robot>",
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

const createDraftResult = ({
  draftUrdfContent = PHYSICS_ACTION_TEST_FIXTURES.draftUrdf,
  linkNames = ["base_link"],
}: {
  draftUrdfContent?: string;
  linkNames?: string[];
} = {}) =>
  ({
    auditSummary: null,
    draftUrdfContent,
    jobId: "job-physics",
    synthesisResult: {
      repeatedMeshCanonicalizationSummaries: [],
      results: linkNames.map((linkName) => ({
        linkName,
        status: "synthesized",
        warnings: [],
      })),
    },
  }) as const;

const createPhysicsPreflightSession = (): PhysicsPreflightSession =>
  ({
    auditSummary: null,
    meshFilesCacheKey: "empty-meshes",
    packageRootsCacheKey: "empty-roots",
    plausibilitySummary: {
      authoredMassKg: 1,
      comparableLinkCount: 2,
      excludedLinks: [
        {
          linkName: PHYSICS_ACTION_TEST_FIXTURES.recoverLinkName,
          recoveryDisposition: "recover",
        },
        {
          linkName: PHYSICS_ACTION_TEST_FIXTURES.regularizeLinkName,
          recoveryDisposition: "regularize",
        },
      ],
      heavyEstimateMassKg: 1.5,
      lightEstimateMassKg: 0.5,
      offenders: [],
      verdict: "plausible",
      warning: null,
    },
    sourceContent: PHYSICS_ACTION_TEST_FIXTURES.sourceUrdf,
    urdfBasePath: "/workspace",
  }) as PhysicsPreflightSession;

const renderPhysicsActionsHook = async (
  initialProps: HarnessProps = {}
): Promise<RenderedHarness> => {
  let hookValue: UseSimulationPrepPhysicsActionsResult | null = null;
  let harnessState: HarnessState = {
    inertialSession: null,
    viewMode: "split",
  };
  let currentProps = initialProps;
  const loadPhysicsPreflightMock = vi.fn(async () => "success" as const);
  const container = document.createElement("div");
  const root: Root = createRoot(container);

  const Harness = (props: HarnessProps) => {
    const [inertialSession, setInertialSession] =
      useState<InertialSynthesisSession | null>(null);
    const [viewMode, setViewMode] = useState<UrdfViewMode>("split");
    harnessState = { inertialSession, viewMode };
    hookValue = useSimulationPrepPhysicsActions({
      externalActionInFlight: props.externalActionInFlight ?? false,
      inertialDraftBaseContent: PHYSICS_ACTION_TEST_FIXTURES.baseUrdf,
      loadPhysicsPreflight: loadPhysicsPreflightMock,
      meshFiles: {},
      packageRoots: {},
      physicsGenerationSourceContent: PHYSICS_ACTION_TEST_FIXTURES.sourceUrdf,
      physicsPreflightSession:
        props.physicsPreflightSession === undefined
          ? createPhysicsPreflightSession()
          : props.physicsPreflightSession,
      setInertialSynthesisSession: setInertialSession,
      setUrdfViewMode: setViewMode,
      showUrdfEditor: props.showUrdfEditor ?? false,
      urdfBasePath: "/workspace",
      vizUrdfContent: PHYSICS_ACTION_TEST_FIXTURES.sourceUrdf,
    });
    return null;
  };

  const rerender = async (nextProps: HarnessProps = currentProps) => {
    currentProps = nextProps;
    await act(async () => {
      root.render(createElement(Harness, currentProps));
      await Promise.resolve();
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
    getState: () => harnessState,
    loadPhysicsPreflightMock,
    rerender,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
};

describe("useSimulationPrepPhysicsActions", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    generatePhysicsDraftViaBackendMock.mockReset();
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
    generatePhysicsDraftViaBackendMock.mockResolvedValue(createDraftResult());
  });

  it("suppresses rapid duplicate physics generation requests", async () => {
    const deferredDraft = createDeferred<ReturnType<typeof createDraftResult>>();
    generatePhysicsDraftViaBackendMock.mockReturnValueOnce(deferredDraft.promise);
    const harness = await renderPhysicsActionsHook();

    await act(async () => {
      harness.getHook().handleGeneratePhysicsDraft("pla", "replace-all");
      harness.getHook().handleGeneratePhysicsDraft("pla", "replace-all");
      await Promise.resolve();
    });

    expect(generatePhysicsDraftViaBackendMock).toHaveBeenCalledOnce();
    expect(harness.getHook().physicsActionStatusByKey["replace-all"]).toBe("running");

    await act(async () => {
      deferredDraft.resolve(createDraftResult());
      await flushAsyncWork();
    });

    expect(harness.loadPhysicsPreflightMock).toHaveBeenCalledWith({
      sourceUrdf: PHYSICS_ACTION_TEST_FIXTURES.draftUrdf,
    });
    expect(harness.getState().inertialSession?.draftContent).toBe(
      PHYSICS_ACTION_TEST_FIXTURES.draftUrdf
    );

    await harness.unmount();
  });

  it("queues compatible diagnosis actions and runs them one at a time", async () => {
    const voxelDraft = createDeferred<ReturnType<typeof createDraftResult>>();
    const regularizedDraft = createDeferred<ReturnType<typeof createDraftResult>>();
    generatePhysicsDraftViaBackendMock
      .mockReturnValueOnce(voxelDraft.promise)
      .mockReturnValueOnce(regularizedDraft.promise);
    const harness = await renderPhysicsActionsHook();

    await act(async () => {
      harness.getHook().handleGenerateVoxelPhysicsDraft("pla");
      harness.getHook().handleGenerateRegularizedPhysicsDraft("pla");
      await Promise.resolve();
    });

    expect(generatePhysicsDraftViaBackendMock).toHaveBeenCalledOnce();
    expect(harness.getHook().physicsActionStatusByKey["voxel-recovery"]).toBe("running");
    expect(harness.getHook().physicsActionStatusByKey["psd-regularize"]).toBe("queued");

    await act(async () => {
      voxelDraft.resolve(
        createDraftResult({
          linkNames: [PHYSICS_ACTION_TEST_FIXTURES.recoverLinkName],
        })
      );
      await flushAsyncWork();
    });

    expect(generatePhysicsDraftViaBackendMock).toHaveBeenCalledTimes(2);
    expect(generatePhysicsDraftViaBackendMock.mock.calls[1]?.[0]).toMatchObject({
      linkNames: [PHYSICS_ACTION_TEST_FIXTURES.regularizeLinkName],
      meshSolveMode: "voxel-only",
      regularizeNearMissTensors: true,
    });

    await act(async () => {
      regularizedDraft.resolve(
        createDraftResult({
          linkNames: [PHYSICS_ACTION_TEST_FIXTURES.regularizeLinkName],
        })
      );
      await flushAsyncWork();
    });

    expect(harness.loadPhysicsPreflightMock).toHaveBeenCalledTimes(2);
    expect(harness.getHook().isPhysicsActionInFlight).toBe(false);

    await harness.unmount();
  });

  it("does not start physics actions while another simulation-prep fix is running", async () => {
    const harness = await renderPhysicsActionsHook({
      externalActionInFlight: true,
    });

    await act(async () => {
      harness.getHook().handleGeneratePhysicsDraft("pla", "replace-all");
      await Promise.resolve();
    });

    expect(generatePhysicsDraftViaBackendMock).not.toHaveBeenCalled();
    expect(harness.getHook().isPhysicsActionInFlight).toBe(false);

    await harness.unmount();
  });

  it("stages a direct link inertial draft and switches the editor to modified view", async () => {
    const harness = await renderPhysicsActionsHook({
      showUrdfEditor: true,
    });

    await act(async () => {
      await harness.getHook().handleGenerateInertialDraft("arm_link", "pla");
      await flushAsyncWork();
    });

    expect(generatePhysicsDraftViaBackendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        linkNames: ["arm_link"],
        repairMode: "replace-all",
      })
    );
    expect(harness.getState().inertialSession?.draftContent).toBe(
      PHYSICS_ACTION_TEST_FIXTURES.draftUrdf
    );
    expect(harness.getState().viewMode).toBe("modified");
    expect(toastSuccessMock).toHaveBeenCalledWith("Generated inertial draft for base_link.");

    await harness.unmount();
  });
});
