/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useSimulationPrepPreflight,
  type UseSimulationPrepPreflightResult,
} from "@/app/pages/index/useSimulationPrepPreflight";

const {
  framePreflightViaBackendMock,
  generatePhysicsPreflightViaBackendMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  framePreflightViaBackendMock: vi.fn(),
  generatePhysicsPreflightViaBackendMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/features/urdf/inertia/robotMasteringApi", () => ({
  framePreflightViaBackend: (...args: unknown[]) => framePreflightViaBackendMock(...args),
  generatePhysicsPreflightViaBackend: (...args: unknown[]) =>
    generatePhysicsPreflightViaBackendMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

type HarnessProps = {
  hasLoadedFiles?: boolean;
  physicsGenerationSourceContent?: string;
  vizUrdfContent?: string;
};

type RenderedHarness = {
  getHook: () => UseSimulationPrepPreflightResult;
  rerender: (props?: HarnessProps) => Promise<void>;
  unmount: () => Promise<void>;
};

const TEST_URDF = "<robot name=\"test\"><link name=\"base\" /></robot>";

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

const renderPreflightHook = async (initialProps: HarnessProps = {}): Promise<RenderedHarness> => {
  let hookValue: UseSimulationPrepPreflightResult | null = null;
  let currentProps = initialProps;
  const container = document.createElement("div");
  const root: Root = createRoot(container);

  const Harness = (props: HarnessProps) => {
    hookValue = useSimulationPrepPreflight({
      autoLoad: false,
      hasLoadedFiles: props.hasLoadedFiles ?? true,
      meshFiles: {},
      meshFilesCacheKey: "empty-meshes",
      packageRoots: {},
      packageRootsCacheKey: "empty-roots",
      physicsGenerationSourceContent: props.physicsGenerationSourceContent ?? TEST_URDF,
      urdfBasePath: "/workspace",
      vizUrdfContent: props.vizUrdfContent ?? TEST_URDF,
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
    rerender,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
};

describe("useSimulationPrepPreflight", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    framePreflightViaBackendMock.mockReset();
    generatePhysicsPreflightViaBackendMock.mockReset();
    toastErrorMock.mockReset();
    framePreflightViaBackendMock.mockResolvedValue({
      frameLint: null,
      orientationCard: null,
    });
    generatePhysicsPreflightViaBackendMock.mockResolvedValue({
      auditSummary: null,
      plausibilitySummary: null,
    });
  });

  it("reuses the current frame preflight session when the source has not changed", async () => {
    const harness = await renderPreflightHook();

    let firstResult: string | null = null;
    await act(async () => {
      firstResult = await harness.getHook().loadFramePreflight();
    });
    expect(firstResult).toBe("success");
    expect(framePreflightViaBackendMock).toHaveBeenCalledOnce();
    expect(harness.getHook().framePreflightSession?.sourceContent).toBe(TEST_URDF);

    let secondResult: string | null = null;
    await act(async () => {
      secondResult = await harness.getHook().loadFramePreflight();
    });
    expect(secondResult).toBe("skipped");
    expect(framePreflightViaBackendMock).toHaveBeenCalledOnce();

    await harness.unmount();
  });

  it("suppresses duplicate physics preflight requests while a source is already in flight", async () => {
    const deferredPhysicsPreflight = createDeferred<{
      auditSummary: null;
      plausibilitySummary: null;
    }>();
    generatePhysicsPreflightViaBackendMock.mockReturnValueOnce(deferredPhysicsPreflight.promise);
    const harness = await renderPreflightHook();

    let firstRequest!: Promise<string>;
    let secondResult: string | null = null;
    await act(async () => {
      firstRequest = harness.getHook().loadPhysicsPreflight();
      secondResult = await harness.getHook().loadPhysicsPreflight();
    });

    expect(secondResult).toBe("pending");
    expect(generatePhysicsPreflightViaBackendMock).toHaveBeenCalledOnce();

    let firstResult: string | null = null;
    await act(async () => {
      deferredPhysicsPreflight.resolve({
        auditSummary: null,
        plausibilitySummary: null,
      });
      firstResult = await firstRequest;
    });

    expect(firstResult).toBe("success");
    expect(harness.getHook().physicsPreflightSession?.sourceContent).toBe(TEST_URDF);

    await harness.unmount();
  });

  it("clears physics preflight state when physics input is no longer available", async () => {
    const harness = await renderPreflightHook();

    await act(async () => {
      await harness.getHook().loadPhysicsPreflight();
    });
    expect(harness.getHook().physicsPreflightSession?.sourceContent).toBe(TEST_URDF);

    await harness.rerender({
      hasLoadedFiles: false,
      physicsGenerationSourceContent: "",
    });
    expect(harness.getHook().physicsPreflightSession).toBeNull();
    expect(harness.getHook().isPhysicsPreflightLoading).toBe(false);

    await harness.unmount();
  });

  it("shows a toast when explicit physics preflight loading fails", async () => {
    generatePhysicsPreflightViaBackendMock.mockRejectedValueOnce(new Error("backend unavailable"));
    const harness = await renderPreflightHook();

    let result: string | null = null;
    await act(async () => {
      result = await harness.getHook().loadPhysicsPreflight({ showErrorToast: true });
    });

    expect(result).toBe("failed");
    expect(toastErrorMock).toHaveBeenCalledWith("backend unavailable");

    await harness.unmount();
  });
});
