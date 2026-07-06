/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useWorldRegistryController,
  type UseWorldRegistryControllerResult,
} from "@/app/pages/index/useWorldRegistryController";
import type {
  WorldScenePackageListEntry,
  WorldSceneRegistryEnvelope,
  WorldScenePackageVersionRecord,
} from "@/features/world-share/worldScenePackageTypes";

const {
  fetchWorldRegistryPackagesMock,
  fetchWorldScenePackageVersionMock,
  requireFeatureGateMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  fetchWorldRegistryPackagesMock: vi.fn(),
  fetchWorldScenePackageVersionMock: vi.fn(),
  requireFeatureGateMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/shared/lib/backendGuard", () => ({
  requireFeatureGate: (...args: unknown[]) => requireFeatureGateMock(...args),
}));

vi.mock("@/app/pages/index/worldSceneRuntime", () => ({
  fetchWorldRegistryPackages: (...args: unknown[]) => fetchWorldRegistryPackagesMock(...args),
  fetchWorldScenePackageVersion: (...args: unknown[]) =>
    fetchWorldScenePackageVersionMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

type RenderedHarness = {
  appliedManifests: WorldSceneRegistryEnvelope[];
  getHook: () => UseWorldRegistryControllerResult;
  unmount: () => Promise<void>;
};

const WORLD_REGISTRY_CONTROLLER_TEST_FIXTURES = {
  packageId: "demo-world",
  title: "Demo World",
  version: "1.0.0",
} as const;

const createRegistryEntry = (): WorldScenePackageListEntry => ({
  description: "A test world",
  latest_digest_sha256: "digest",
  latest_version: WORLD_REGISTRY_CONTROLLER_TEST_FIXTURES.version,
  owner: "studio",
  package_id: WORLD_REGISTRY_CONTROLLER_TEST_FIXTURES.packageId,
  runtime_targets: ["browser"],
  tags: ["test"],
  title: WORLD_REGISTRY_CONTROLLER_TEST_FIXTURES.title,
  trust_level: "metadata_only",
  updated_at: "2026-07-04T00:00:00Z",
});

const createVersionRecord = (): WorldScenePackageVersionRecord => ({
  digest_sha256: "digest",
  manifest: {
    package_id: WORLD_REGISTRY_CONTROLLER_TEST_FIXTURES.packageId,
    version: WORLD_REGISTRY_CONTROLLER_TEST_FIXTURES.version,
    provenance: {},
    artifacts: [],
    world: {
      name: WORLD_REGISTRY_CONTROLLER_TEST_FIXTURES.title,
      urdf_xml: "<robot name=\"demo\" />",
      joint_positions: {},
      cameras: [],
      objects: [],
      scenario_time_ms: 0,
      scenario_duration_ms: 0,
      environment: {
        frame_convention: "urdf",
      },
    },
  },
  package_id: WORLD_REGISTRY_CONTROLLER_TEST_FIXTURES.packageId,
  published_at: "2026-07-04T00:00:00Z",
  version: WORLD_REGISTRY_CONTROLLER_TEST_FIXTURES.version,
});

const flushAsyncWork = async () => {
  await new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
};

const renderWorldRegistryControllerHook = async (): Promise<RenderedHarness> => {
  let hookValue: UseWorldRegistryControllerResult | null = null;
  const appliedManifests: WorldSceneRegistryEnvelope[] = [];
  const container = document.createElement("div");
  const root: Root = createRoot(container);

  const Harness = () => {
    hookValue = useWorldRegistryController({
      applyWorldScenePackage: (manifest) => {
        if ("world" in manifest) {
          appliedManifests.push(manifest);
        }
      },
    });
    return null;
  };

  await act(async () => {
    root.render(createElement(Harness));
    await flushAsyncWork();
  });

  return {
    appliedManifests,
    getHook: () => {
      if (!hookValue) {
        throw new Error("Hook did not render.");
      }
      return hookValue;
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
};

describe("useWorldRegistryController", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    fetchWorldRegistryPackagesMock.mockReset();
    fetchWorldScenePackageVersionMock.mockReset();
    requireFeatureGateMock.mockReset();
    toastErrorMock.mockReset();
    fetchWorldRegistryPackagesMock.mockResolvedValue([createRegistryEntry()]);
    fetchWorldScenePackageVersionMock.mockResolvedValue(createVersionRecord());
  });

  it("opens and refreshes registry entries with a single availability check", async () => {
    const harness = await renderWorldRegistryControllerHook();

    await act(async () => {
      await harness.getHook().handleListWorldScenePackages();
    });

    expect(requireFeatureGateMock).toHaveBeenCalledOnce();
    expect(fetchWorldRegistryPackagesMock).toHaveBeenCalledOnce();
    expect(harness.getHook().worldRegistryOpen).toBe(true);
    expect(harness.getHook().worldRegistryEntries).toEqual([createRegistryEntry()]);

    await harness.unmount();
  });

  it("caches package version records after the first load", async () => {
    const harness = await renderWorldRegistryControllerHook();
    const registryEntry = createRegistryEntry();

    await act(async () => {
      await harness.getHook().handleLoadWorldScenePackageFromRegistry(registryEntry);
    });
    await act(async () => {
      await harness.getHook().handleLoadWorldScenePackageFromRegistry(registryEntry);
    });

    expect(fetchWorldScenePackageVersionMock).toHaveBeenCalledOnce();
    expect(harness.appliedManifests).toEqual([createVersionRecord().manifest, createVersionRecord().manifest]);
    expect(harness.getHook().worldRegistryOpen).toBe(false);

    await harness.unmount();
  });

  it("reports feature-gate failures without touching registry transport", async () => {
    requireFeatureGateMock.mockImplementationOnce(() => {
      throw new Error("World registry unavailable on this runtime");
    });
    const harness = await renderWorldRegistryControllerHook();

    await act(async () => {
      await harness.getHook().refreshWorldRegistry();
    });

    expect(fetchWorldRegistryPackagesMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("World registry unavailable on this runtime");

    await harness.unmount();
  });
});
