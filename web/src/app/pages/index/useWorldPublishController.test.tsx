/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useWorldPublishController,
  type UseWorldPublishControllerResult,
} from "@/app/pages/index/useWorldPublishController";
import { WORLD_SCENE_PACKAGE_SCHEMA_VERSION } from "@/features/world-share/worldScenePackageParams";
import type { WorldScenePackageManifest } from "@/features/world-share/worldScenePackageTypes";

const {
  publishWorldScenePackageMock,
  requireFeatureGateMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  publishWorldScenePackageMock: vi.fn(),
  requireFeatureGateMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@/shared/lib/backendGuard", () => ({
  requireFeatureGate: (...args: unknown[]) => requireFeatureGateMock(...args),
}));

vi.mock("@/app/pages/index/worldSceneRuntime", () => ({
  publishWorldScenePackage: (...args: unknown[]) => publishWorldScenePackageMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

type WorldPublishManifestOverrides = Partial<
  Pick<WorldScenePackageManifest, "package_id" | "title" | "version" | "description">
>;

type BuildManifest = (
  overrides?: WorldPublishManifestOverrides
) => Promise<WorldScenePackageManifest>;

type RenderedHarness = {
  buildManifestMock: ReturnType<typeof vi.fn>;
  getHook: () => UseWorldPublishControllerResult;
  unmount: () => Promise<void>;
};

const WORLD_PUBLISH_CONTROLLER_TEST_FIXTURES = {
  digest: "abcdef1234567890",
  packageId: "demo-world",
  robotName: "demo_robot",
  title: "Demo World",
  version: "2.0.0",
} as const;

const createManifest = (
  overrides: WorldPublishManifestOverrides = {}
): WorldScenePackageManifest => ({
  artifacts: [],
  created_at: "2026-07-04T00:00:00Z",
  description: overrides.description,
  interface: {
    action_semantics: "none",
    frame_convention: "urdf",
    observation_modalities: [],
    timestep_ms: 0,
  },
  package_id: overrides.package_id ?? WORLD_PUBLISH_CONTROLLER_TEST_FIXTURES.packageId,
  provenance: {},
  runtime_targets: [],
  schema_version: WORLD_SCENE_PACKAGE_SCHEMA_VERSION,
  security: {
    attestation_refs: [],
    sbom_ref: null,
    signature_ref: null,
  },
  title: overrides.title ?? WORLD_PUBLISH_CONTROLLER_TEST_FIXTURES.title,
  version: overrides.version ?? WORLD_PUBLISH_CONTROLLER_TEST_FIXTURES.version,
  world_snapshot: {
    cameras: [],
    joint_positions: {},
    objects: [],
    scenario_duration_ms: 0,
    scenario_time_ms: 0,
    urdf_xml: "<robot name=\"demo\" />",
  },
});

const flushAsyncWork = async () => {
  await new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
};

const renderWorldPublishControllerHook = async (): Promise<RenderedHarness> => {
  let hookValue: UseWorldPublishControllerResult | null = null;
  const buildManifestMock = vi.fn<BuildManifest>(async (overrides) => createManifest(overrides));
  const container = document.createElement("div");
  const root: Root = createRoot(container);

  const Harness = () => {
    hookValue = useWorldPublishController({
      buildCurrentWorldScenePackageManifest: buildManifestMock,
      resolvedRobotName: WORLD_PUBLISH_CONTROLLER_TEST_FIXTURES.robotName,
    });
    return null;
  };

  await act(async () => {
    root.render(createElement(Harness));
    await flushAsyncWork();
  });

  return {
    buildManifestMock,
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

describe("useWorldPublishController", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    publishWorldScenePackageMock.mockReset();
    requireFeatureGateMock.mockReset();
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
    publishWorldScenePackageMock.mockResolvedValue({
      digest_sha256: WORLD_PUBLISH_CONTROLLER_TEST_FIXTURES.digest,
      package_id: WORLD_PUBLISH_CONTROLLER_TEST_FIXTURES.packageId,
      version: WORLD_PUBLISH_CONTROLLER_TEST_FIXTURES.version,
    });
  });

  it("opens registry and hub publish dialogs with robot-derived defaults", async () => {
    const harness = await renderWorldPublishControllerHook();

    await act(async () => {
      harness.getHook().handlePublishCurrentWorldScenePackage();
      await flushAsyncWork();
    });

    expect(harness.getHook().worldPublishDialogOpen).toBe(true);
    expect(harness.getHook().worldPublishTarget).toBe("registry");
    expect(harness.getHook().publishTargetLabel).toBe("World Registry");
    expect(harness.getHook().worldPublishDraft.packageId).toBe(
      WORLD_PUBLISH_CONTROLLER_TEST_FIXTURES.robotName
    );
    expect(harness.getHook().worldPublishDraft.title).toBe(
      WORLD_PUBLISH_CONTROLLER_TEST_FIXTURES.robotName
    );

    await act(async () => {
      harness.getHook().handlePublishCurrentWorldScenePackageToHub();
      await flushAsyncWork();
    });

    expect(harness.getHook().worldPublishTarget).toBe("hub");
    expect(harness.getHook().publishTargetLabel).toBe("URDF Star Hub");

    await harness.unmount();
  });

  it("publishes a trimmed registry draft and closes the dialog on success", async () => {
    const harness = await renderWorldPublishControllerHook();

    await act(async () => {
      harness.getHook().handlePublishCurrentWorldScenePackage();
      harness.getHook().setWorldPublishDraft({
        description: " Demo description ",
        packageId: ` ${WORLD_PUBLISH_CONTROLLER_TEST_FIXTURES.packageId} `,
        title: ` ${WORLD_PUBLISH_CONTROLLER_TEST_FIXTURES.title} `,
        version: ` ${WORLD_PUBLISH_CONTROLLER_TEST_FIXTURES.version} `,
      });
      await flushAsyncWork();
    });
    await act(async () => {
      await harness.getHook().handleSubmitWorldPublishDialog();
    });

    expect(requireFeatureGateMock).toHaveBeenCalledWith(
      expect.anything(),
      "World package publish"
    );
    expect(harness.buildManifestMock).toHaveBeenCalledWith({
      description: "Demo description",
      package_id: WORLD_PUBLISH_CONTROLLER_TEST_FIXTURES.packageId,
      title: WORLD_PUBLISH_CONTROLLER_TEST_FIXTURES.title,
      version: WORLD_PUBLISH_CONTROLLER_TEST_FIXTURES.version,
    });
    expect(publishWorldScenePackageMock).toHaveBeenCalledWith(
      createManifest({
        description: "Demo description",
        package_id: WORLD_PUBLISH_CONTROLLER_TEST_FIXTURES.packageId,
        title: WORLD_PUBLISH_CONTROLLER_TEST_FIXTURES.title,
        version: WORLD_PUBLISH_CONTROLLER_TEST_FIXTURES.version,
      }),
      "registry"
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("Published demo-world@2.0.0 (abcdef123456...)");
    expect(harness.getHook().worldPublishDialogOpen).toBe(false);
    expect(harness.getHook().isPublishingWorldPackage).toBe(false);

    await harness.unmount();
  });

  it("rejects invalid drafts before feature gates or transport", async () => {
    const harness = await renderWorldPublishControllerHook();

    await act(async () => {
      harness.getHook().setWorldPublishDraft({
        description: "",
        packageId: " ",
        title: "",
        version: "",
      });
      await flushAsyncWork();
    });
    await act(async () => {
      await harness.getHook().handleSubmitWorldPublishDialog();
    });

    expect(toastErrorMock).toHaveBeenCalledWith("Package ID is required");
    expect(requireFeatureGateMock).not.toHaveBeenCalled();
    expect(harness.buildManifestMock).not.toHaveBeenCalled();
    expect(publishWorldScenePackageMock).not.toHaveBeenCalled();

    await harness.unmount();
  });

  it("keeps the dialog open when the selected publish target is unavailable", async () => {
    requireFeatureGateMock.mockImplementationOnce(() => {
      throw new Error("Hub unavailable");
    });
    const harness = await renderWorldPublishControllerHook();

    await act(async () => {
      harness.getHook().handlePublishCurrentWorldScenePackageToHub();
      await flushAsyncWork();
    });
    await act(async () => {
      await harness.getHook().handleSubmitWorldPublishDialog();
    });

    expect(requireFeatureGateMock).toHaveBeenCalledWith(expect.anything(), "URDF Star publish");
    expect(toastErrorMock).toHaveBeenCalledWith("Hub unavailable");
    expect(publishWorldScenePackageMock).not.toHaveBeenCalled();
    expect(harness.getHook().worldPublishDialogOpen).toBe(true);
    expect(harness.getHook().isPublishingWorldPackage).toBe(false);

    await harness.unmount();
  });
});
