/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useWorldRolloutController,
  type UseWorldRolloutControllerResult,
} from "@/app/pages/index/useWorldRolloutController";
import { WORLD_ROLLOUT_IMPORT_ACCEPT } from "@/features/world-share/worldRolloutParams";
import type { WorldSceneRegistryEnvelope } from "@/features/world-share/worldScenePackageTypes";
import type {
  WorldRolloutCampaignManifest,
  WorldRolloutCheckerProfile,
  WorldRolloutImportRequest,
  WorldRolloutImportResponse,
  WorldRolloutJobResponse,
} from "@/features/world-share/worldRolloutTypes";

const {
  buildWorldRolloutCampaignManifestMock,
  createWorldRolloutCheckerProfileMock,
  createWorldRolloutJobFromStateMock,
  downloadJsonDocumentMock,
  downloadWorldRolloutCampaignManifestMock,
  importWorldRolloutResultPayloadMock,
  openFileSelectionDialogMock,
  readWorldRolloutConfigDraftMock,
  resolveWorldRolloutImportPayloadMock,
  toastErrorMock,
  toastInfoMock,
  toastSuccessMock,
  toastWarningMock,
  waitForWorldRolloutJobMock,
} = vi.hoisted(() => ({
  buildWorldRolloutCampaignManifestMock: vi.fn(),
  createWorldRolloutCheckerProfileMock: vi.fn(),
  createWorldRolloutJobFromStateMock: vi.fn(),
  downloadJsonDocumentMock: vi.fn(),
  downloadWorldRolloutCampaignManifestMock: vi.fn(),
  importWorldRolloutResultPayloadMock: vi.fn(),
  openFileSelectionDialogMock: vi.fn(),
  readWorldRolloutConfigDraftMock: vi.fn(),
  resolveWorldRolloutImportPayloadMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastInfoMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastWarningMock: vi.fn(),
  waitForWorldRolloutJobMock: vi.fn(),
}));

vi.mock("@/app/pages/index/worldSceneRuntime", () => ({
  buildWorldRolloutCampaignManifest: (...args: unknown[]) =>
    buildWorldRolloutCampaignManifestMock(...args),
  createWorldRolloutCheckerProfile: (...args: unknown[]) =>
    createWorldRolloutCheckerProfileMock(...args),
  createWorldRolloutJobFromState: (...args: unknown[]) =>
    createWorldRolloutJobFromStateMock(...args),
  downloadWorldRolloutCampaignManifest: (...args: unknown[]) =>
    downloadWorldRolloutCampaignManifestMock(...args),
  importWorldRolloutResultPayload: (...args: unknown[]) =>
    importWorldRolloutResultPayloadMock(...args),
  resolveWorldRolloutImportPayload: (...args: unknown[]) =>
    resolveWorldRolloutImportPayloadMock(...args),
}));

vi.mock("@/app/pages/index/worldSceneManagerHelpers", () => ({
  downloadJsonDocument: (...args: unknown[]) => downloadJsonDocumentMock(...args),
  openFileSelectionDialog: (...args: unknown[]) => openFileSelectionDialogMock(...args),
  readWorldRolloutConfigDraft: (...args: unknown[]) => readWorldRolloutConfigDraftMock(...args),
  waitForWorldRolloutJob: (...args: unknown[]) => waitForWorldRolloutJobMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    info: (...args: unknown[]) => toastInfoMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
    warning: (...args: unknown[]) => toastWarningMock(...args),
  },
}));

type RenderedHarness = {
  buildManifestMock: ReturnType<typeof vi.fn>;
  getHook: () => UseWorldRolloutControllerResult;
  unmount: () => Promise<void>;
};

const WORLD_ROLLOUT_CONTROLLER_TEST_FIXTURES = {
  campaignId: "demo-world-1.0.0",
  jobId: "rollout-job-1",
  packageId: "demo-world",
  robotName: "demo_robot",
  version: "1.0.0",
} as const;

const createManifest = (): WorldSceneRegistryEnvelope => ({
  artifacts: [],
  package_id: WORLD_ROLLOUT_CONTROLLER_TEST_FIXTURES.packageId,
  provenance: {},
  version: WORLD_ROLLOUT_CONTROLLER_TEST_FIXTURES.version,
  world: {
    cameras: [],
    joint_positions: {},
    name: "Demo World",
    objects: [],
    scenario_duration_ms: 0,
    scenario_time_ms: 0,
    urdf_xml: "<robot name=\"demo\" />",
  },
});

const createCheckerProfile = (): WorldRolloutCheckerProfile => ({
  artifacts: [],
  description: "Demo checker.",
  modules: [],
  params: {},
  profile_id: "demo-checker",
  schema_version: "world_rollout_checker_profile.v1",
  target_id: WORLD_ROLLOUT_CONTROLLER_TEST_FIXTURES.robotName,
});

const createCampaign = (): WorldRolloutCampaignManifest => ({
  artifacts: [],
  campaign_id: WORLD_ROLLOUT_CONTROLLER_TEST_FIXTURES.campaignId,
  checker_profile: createCheckerProfile(),
  created_at: "2026-07-04T00:00:00Z",
  rollout_params: {},
  runner: {
    kind: "local-cli",
    params: {},
  },
  schema_version: "world_rollout_campaign.v1",
  world_package: {
    package_id: WORLD_ROLLOUT_CONTROLLER_TEST_FIXTURES.packageId,
    version: WORLD_ROLLOUT_CONTROLLER_TEST_FIXTURES.version,
  },
});

const createJobResponse = (
  status: WorldRolloutJobResponse["status"] = "completed"
): WorldRolloutJobResponse => ({
  campaign: createCampaign(),
  created_at: "2026-07-04T00:00:00Z",
  decision_count: 2,
  escalation_count: 0,
  job_id: WORLD_ROLLOUT_CONTROLLER_TEST_FIXTURES.jobId,
  output_manifest_path: null,
  reject_count: 0,
  status,
  stderr: null,
  stdout: null,
  stop_count: 1,
  trace_record_count: 3,
  updated_at: "2026-07-04T00:00:01Z",
  warn_count: 1,
});

const createImportRequest = (): WorldRolloutImportRequest => ({
  campaign: createCampaign(),
  decisions_ndjson: "",
  trace_ndjson: "",
});

const createImportResponse = (): WorldRolloutImportResponse => ({
  campaign: createCampaign(),
  decision_count: 2,
  decisions: [],
  escalation_count: 0,
  reject_count: 0,
  stop_count: 1,
  trace_record_count: 3,
  trace_records: [],
  warn_count: 1,
});

const flushAsyncWork = async () => {
  await new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
};

const renderWorldRolloutControllerHook = async (): Promise<RenderedHarness> => {
  let hookValue: UseWorldRolloutControllerResult | null = null;
  const buildManifestMock = vi.fn(async () => createManifest());
  const container = document.createElement("div");
  const root: Root = createRoot(container);

  const Harness = () => {
    hookValue = useWorldRolloutController({
      buildCurrentWorldSceneRegistryEnvelope: buildManifestMock,
      resolvedRobotName: WORLD_ROLLOUT_CONTROLLER_TEST_FIXTURES.robotName,
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

describe("useWorldRolloutController", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    buildWorldRolloutCampaignManifestMock.mockReset();
    createWorldRolloutCheckerProfileMock.mockReset();
    createWorldRolloutJobFromStateMock.mockReset();
    downloadJsonDocumentMock.mockReset();
    downloadWorldRolloutCampaignManifestMock.mockReset();
    importWorldRolloutResultPayloadMock.mockReset();
    openFileSelectionDialogMock.mockReset();
    readWorldRolloutConfigDraftMock.mockReset();
    resolveWorldRolloutImportPayloadMock.mockReset();
    toastErrorMock.mockReset();
    toastInfoMock.mockReset();
    toastSuccessMock.mockReset();
    toastWarningMock.mockReset();
    waitForWorldRolloutJobMock.mockReset();

    const checkerProfile = createCheckerProfile();
    createWorldRolloutCheckerProfileMock.mockReturnValue(checkerProfile);
    readWorldRolloutConfigDraftMock.mockReturnValue({
      checkerProfile,
      rolloutParams: { seed: 7 },
      runnerParams: { max_steps: 12 },
    });
    buildWorldRolloutCampaignManifestMock.mockReturnValue(createCampaign());
    createWorldRolloutJobFromStateMock.mockResolvedValue(createJobResponse("running"));
    waitForWorldRolloutJobMock.mockResolvedValue(createJobResponse("completed"));
    resolveWorldRolloutImportPayloadMock.mockReturnValue(createImportRequest());
    importWorldRolloutResultPayloadMock.mockResolvedValue(createImportResponse());
  });

  it("exports a rollout campaign from the current world package", async () => {
    const harness = await renderWorldRolloutControllerHook();

    await act(async () => {
      await harness.getHook().handleExportWorldRolloutCampaign();
    });

    const expectedInputs = {
      checkerProfile: createCheckerProfile(),
      rolloutParams: { seed: 7 },
      runnerParams: { max_steps: 12 },
      worldPackage: createManifest(),
    };
    expect(createWorldRolloutCheckerProfileMock).toHaveBeenCalledWith({
      params: {},
      resolvedRobotName: WORLD_ROLLOUT_CONTROLLER_TEST_FIXTURES.robotName,
    });
    expect(harness.buildManifestMock).toHaveBeenCalledOnce();
    expect(buildWorldRolloutCampaignManifestMock).toHaveBeenCalledWith(expectedInputs);
    expect(downloadWorldRolloutCampaignManifestMock).toHaveBeenCalledWith(
      createCampaign(),
      expect.any(Function)
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("World rollout campaign exported");

    await harness.unmount();
  });

  it("does not build a world package when the rollout config prompt is cancelled", async () => {
    readWorldRolloutConfigDraftMock.mockReturnValueOnce(null);
    const harness = await renderWorldRolloutControllerHook();

    await act(async () => {
      await harness.getHook().handleExportWorldRolloutCampaign();
    });

    expect(harness.buildManifestMock).not.toHaveBeenCalled();
    expect(buildWorldRolloutCampaignManifestMock).not.toHaveBeenCalled();
    expect(downloadWorldRolloutCampaignManifestMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();

    await harness.unmount();
  });

  it("runs a local rollout job and reports the completed job summary", async () => {
    const harness = await renderWorldRolloutControllerHook();

    await act(async () => {
      await harness.getHook().handleRunLocalWorldRollout();
    });

    expect(createWorldRolloutJobFromStateMock).toHaveBeenCalledWith({
      checkerProfile: createCheckerProfile(),
      rolloutParams: { seed: 7 },
      runnerParams: { max_steps: 12 },
      worldPackage: createManifest(),
    });
    expect(toastInfoMock).toHaveBeenCalledWith(
      `World rollout job started: ${WORLD_ROLLOUT_CONTROLLER_TEST_FIXTURES.jobId}`
    );
    expect(waitForWorldRolloutJobMock).toHaveBeenCalledWith(
      WORLD_ROLLOUT_CONTROLLER_TEST_FIXTURES.jobId
    );
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "World rollout completed: 2 decisions, 1 stops, 0 escalations"
    );

    await harness.unmount();
  });

  it("imports rollout result files into review state", async () => {
    openFileSelectionDialogMock.mockImplementationOnce(
      ({ onFiles }: { onFiles: (files: File[]) => Promise<void> }) =>
        onFiles([
          new File([JSON.stringify(createCampaign())], "campaign.json", {
            type: "application/json",
          }),
        ])
    );
    const harness = await renderWorldRolloutControllerHook();

    await act(async () => {
      harness.getHook().handleImportWorldRolloutResults();
      await flushAsyncWork();
    });

    expect(openFileSelectionDialogMock).toHaveBeenCalledWith({
      accept: WORLD_ROLLOUT_IMPORT_ACCEPT,
      multiple: true,
      onFiles: expect.any(Function),
    });
    expect(resolveWorldRolloutImportPayloadMock).toHaveBeenCalledWith([
      { name: "campaign.json", text: JSON.stringify(createCampaign()) },
    ]);
    expect(importWorldRolloutResultPayloadMock).toHaveBeenCalledWith(createImportRequest());
    expect(harness.getHook().worldRolloutReview).toEqual(createImportResponse());
    expect(harness.getHook().worldRolloutReviewOpen).toBe(true);
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "World rollout imported: 2 decisions, 1 stops, 0 escalations"
    );

    await harness.unmount();
  });
});
