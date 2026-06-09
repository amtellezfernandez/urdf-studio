/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GALLERY_EDITOR_AUTOSTART_QUERY_PARAM,
  GALLERY_EDITOR_AUTOSTART_QUERY_VALUE,
  GALLERY_EDITOR_ENTRY_QUERY_PARAM,
  GALLERY_EDITOR_ENTRY_QUERY_VALUE,
  GALLERY_EDITOR_SOURCE_QUERY_PARAM,
} from "@/features/dataset/iluGalleryParams";
import { FOLDER_UPLOAD_ROBOT_SHORTCUTS } from "@/features/dataset/folderUploadRobotShortcuts";
import {
  galleryJobFactory,
  TEST_GITHUB_BRANCH,
  TEST_GITHUB_OWNER,
  TEST_GITHUB_REPO,
  TEST_GITHUB_RESOLVED_SOURCE,
  TEST_GITHUB_SOURCE,
  TEST_OPENARM_CAMERA_CONFIG_BODY,
  TEST_PRIMARY_CANDIDATE_FILE,
  TEST_PRIMARY_CANDIDATE_PATH,
  TEST_SO101_CAMERA_CONFIG_BODY,
} from "@/features/dataset/FolderUploadScreen.testFixtures";
import {
  OPENARM_HF_LIVE_CAMERA_RPY_RAD,
  OPENARM_HF_LIVE_REAL_SENSE_POSITION_M,
} from "@/features/teleop/perception/openArmHfLiveParams";

const {
  createIluGalleryJobMock,
  generateIluGalleryJobMock,
  getIluGalleryJobMock,
  getIluGalleryPrDraftMock,
  getIluGalleryRepoPreviewMock,
  fetchIluGitHubRepoCandidateSummaryMock,
  fetchIluGitHubRepoCandidatesMock,
  fetchIluGitHubRepoFilesMock,
  buildIluGitHubCandidateFileListMock,
  checkCandidatesForUnsupportedFormatsMock,
  approveRuntimeProviderSessionMock,
  getRuntimeProviderSessionMock,
  startRuntimeProviderRecordingMock,
  stopRuntimeProviderRecordingMock,
  loadRobotAssetFileListFromManifestUrlMock,
  startOpenArmHfLiveObserveMock,
  gitHubSourceStoreState,
  cameraStoreState,
  assemblyStoreState,
} = vi.hoisted(() => ({
  createIluGalleryJobMock: vi.fn(),
  generateIluGalleryJobMock: vi.fn(),
  getIluGalleryJobMock: vi.fn(),
  getIluGalleryPrDraftMock: vi.fn(),
  getIluGalleryRepoPreviewMock: vi.fn(),
  fetchIluGitHubRepoCandidateSummaryMock: vi.fn(),
  fetchIluGitHubRepoCandidatesMock: vi.fn(),
  fetchIluGitHubRepoFilesMock: vi.fn(),
  buildIluGitHubCandidateFileListMock: vi.fn(),
  checkCandidatesForUnsupportedFormatsMock: vi.fn(async (candidates: unknown) => candidates),
  approveRuntimeProviderSessionMock: vi.fn(),
  getRuntimeProviderSessionMock: vi.fn(),
  startRuntimeProviderRecordingMock: vi.fn(),
  stopRuntimeProviderRecordingMock: vi.fn(),
  loadRobotAssetFileListFromManifestUrlMock: vi.fn(),
  startOpenArmHfLiveObserveMock: vi.fn(),
  gitHubSourceStoreState: {
    setSource: vi.fn(),
    clearSource: vi.fn(),
  },
  cameraStoreState: {
    cameras: [],
    loadCameras: vi.fn(),
    clearCameras: vi.fn(),
    removeCamera: vi.fn(),
  },
  assemblyStoreState: {
    setSelectedUrdfPaths: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("@/features/dataset/FolderUploadRobotLoader", () => ({
  FolderUploadRobotLoader: (props: {
    githubUrl: string;
    githubLoadButtonLabel: string;
    selectedCandidatePaths: string[];
    hasSelectedPrimaryCandidate: boolean;
    onGithubUrlChange: (value: string) => void;
    onGithubLoad: () => void | Promise<unknown>;
    onEditCandidateGalleryCards: () => void | Promise<unknown>;
  }) =>
    createElement(
      "div",
      { "data-testid": "robot-loader" },
      createElement("input", {
        placeholder: "owner/repo or https://github.com/owner/repo",
        value: props.githubUrl,
        onInput: (event: Event) =>
          props.onGithubUrlChange((event.target as HTMLInputElement | null)?.value ?? ""),
        onChange: (event: Event) =>
          props.onGithubUrlChange((event.target as HTMLInputElement | null)?.value ?? ""),
      }),
      createElement(
        "span",
        { "data-testid": "selected-candidate-count" },
        String(props.selectedCandidatePaths.length)
      ),
      createElement(
        "span",
        { "data-testid": "has-selected-primary-candidate" },
        String(props.hasSelectedPrimaryCandidate)
      ),
      createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            void props.onGithubLoad();
          },
        },
        props.githubLoadButtonLabel
      ),
      createElement(
        "button",
        {
          type: "button",
          "aria-label": "Edit gallery info",
          onClick: () => {
            void props.onEditCandidateGalleryCards();
          },
        },
        "Edit gallery info"
      )
    ),
}));

vi.mock("@/features/dataset/FolderUploadRuntimePanel", () => ({
  FolderUploadRuntimePanel: () => createElement("div", { "data-testid": "runtime-panel" }, "Runtime Panel"),
}));

vi.mock("@/shared/hooks/use-gpu-mode", () => ({
  useGPUMode: () => ({
    gpuMode: "high",
    setGPUMode: vi.fn(),
  }),
}));

vi.mock("@/shared/hooks/use-recent-github-repos", () => ({
  useRecentGitHubRepos: () => ({
    recentRepos: [],
    addRecentRepo: vi.fn(),
    removeRecentRepo: vi.fn(),
  }),
}));

vi.mock("@/shared/hooks/use-recent-links", () => ({
  useRecentLinks: () => ({
    recentLinks: [],
    addRecentLink: vi.fn(),
    removeRecentLink: vi.fn(),
  }),
}));

vi.mock("@/shared/store/useGitHubSourceStore", () => ({
  useGitHubSourceStore: (selector: (state: typeof gitHubSourceStoreState) => unknown) =>
    selector(gitHubSourceStoreState),
}));

vi.mock("@/shared/store/useCameraStore", () => ({
  useCameraStore: Object.assign(
    (selector: (state: typeof cameraStoreState) => unknown) => selector(cameraStoreState),
    {
      getState: () => cameraStoreState,
    }
  ),
}));

vi.mock("@/features/assembly/store/useAssemblyStore", () => ({
  useAssemblyStore: (selector: (state: typeof assemblyStoreState) => unknown) =>
    selector(assemblyStoreState),
}));

vi.mock("@/shared/config/featureGates", () => ({
  FEATURE_GATES: {
    xacroExpansion: "xacroExpansion",
  },
}));

vi.mock("@/shared/lib/featureGateUi", () => ({
  useFeatureGateAvailability: () => ({
    enabled: true,
    unavailableSuffix: "Unavailable",
    unavailableReason: "Unavailable",
  }),
}));

vi.mock("@/features/urdf/github/githubRepo", () => ({
  parseGitHubUrl: vi.fn(() => ({
    owner: TEST_GITHUB_OWNER,
    repo: TEST_GITHUB_REPO,
    path: "",
    branch: TEST_GITHUB_BRANCH,
  })),
  findURDFCandidates: vi.fn(() => []),
  resolveRepositoryXacroTargetPath: vi.fn(
    (files: Array<{ path: string }>, targetPath: string) =>
      files.find((file) => file.path === targetPath)?.path ?? targetPath
  ),
  checkCandidatesForUnsupportedFormats: checkCandidatesForUnsupportedFormatsMock,
}));

vi.mock("@/features/urdf/github/iluGitHubImport", () => ({
  buildIluGitHubCandidateFileList: buildIluGitHubCandidateFileListMock,
  fetchIluGitHubRepoCandidateSummary: fetchIluGitHubRepoCandidateSummaryMock,
  fetchIluGitHubRepoFiles: fetchIluGitHubRepoFilesMock,
  fetchIluGitHubRepoCandidates: fetchIluGitHubRepoCandidatesMock,
}));

vi.mock("@/shared/robotAssets/robotAssetManifest", () => ({
  loadRobotAssetFileListFromManifestUrl: loadRobotAssetFileListFromManifestUrlMock,
}));

vi.mock("@/features/teleop/perception/openArmHfLiveObserveClient", () => ({
  startOpenArmHfLiveObserve: startOpenArmHfLiveObserveMock,
}));

vi.mock("@/features/dataset/iluGalleryApi", () => ({
  createIluGalleryJob: createIluGalleryJobMock,
  generateIluGalleryJob: generateIluGalleryJobMock,
  getIluGalleryJob: getIluGalleryJobMock,
  getIluGalleryJobBundleUrl: vi.fn(() => "https://example.com/gallery.zip"),
  getIluGalleryPrDraft: getIluGalleryPrDraftMock,
  getIluGalleryRepoPreview: getIluGalleryRepoPreviewMock,
  publishIluGalleryJob: vi.fn(),
  updateIluGalleryJobMetadata: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(() => "loading-toast"),
    dismiss: vi.fn(),
  },
}));

vi.mock("@/runtime_engine/runtime_contract", () => ({
  approveRuntimeProviderSession: approveRuntimeProviderSessionMock,
  getRuntimeProviderSession: getRuntimeProviderSessionMock,
  getRuntimeSessionStats: vi.fn(),
  listRuntimeTelemetryChannels: vi.fn(),
  startRuntimeProviderRecording: startRuntimeProviderRecordingMock,
  stopRuntimeProviderRecording: stopRuntimeProviderRecordingMock,
  TelemetryStreamKind: {
    TF_EDGE_BATCH: "tf",
    MARKER_DELTA_BATCH: "marker",
    POSE: "pose",
    JOINT_STATE_BATCH: "joint",
    DIAGNOSTIC_EVENT: "diag",
  },
}));

vi.mock("@/studio_ui/runtimeviz/butterclawApi", () => ({
  sendButterClawChatCommand: vi.fn(),
}));

vi.mock("@/studio_ui/runtimeviz/verifiableRoboticsApi", () => ({
  proveVerifiableRoboticsExecution: vi.fn(),
}));

vi.mock("@/studio_ui/runtimeviz/runtimeRobotPreviewParams", () => ({
  isRuntimeDemoEnabled: vi.fn(() => false),
}));

vi.mock("@/studio_ui/runtimeviz/runtimeDemoScene", () => ({
  RUNTIME_DEMO_DEFAULT_RESTRICTED_AREA_IDS: [],
  RUNTIME_DEMO_OBJECTS: [],
  RUNTIME_DEMO_RESTRICTED_AREAS: [],
  findRuntimeDemoRestrictedArea: vi.fn(),
  getRuntimeDemoRestrictedRegions: vi.fn(() => []),
}));

vi.mock("@/studio_ui/attestation/attestationApi", () => ({
  allowAttestationConnection: vi.fn(),
  fetchAttestationStatuses: vi.fn(),
}));

vi.mock("@/shared/contracts/previewBridge", () => ({
  isResetRuntimeTraceMessage: vi.fn(() => false),
  isRuntimePoseSampleMessage: vi.fn(() => false),
}));

vi.mock("@/shared/lib/backendGuard", () => ({
  guardedFetch: vi.fn(),
}));

vi.mock("@/features/dataset/runtimeConnectionTargets", () => ({
  buildRuntimeConnectionTargets: vi.fn(() => ({})),
}));

vi.mock("@/features/dataset/runtimeReviewHelpers", () => ({
  buildRuntimeAdapterFamilies: vi.fn(() => []),
  buildRuntimeAdapterStatus: vi.fn(() => ({ connected: false })),
  buildRuntimeStatsAuditSnapshot: vi.fn(() => ({})),
}));

vi.mock("@/features/dataset/substitutionWorkspace", () => ({
  buildSubstitutionWorkspaceLaunchPlan: vi.fn(() => null),
}));

import { FolderUploadScreen } from "./FolderUploadScreen";

const flushMicrotasks = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const waitFor = async (assertion: () => void): Promise<void> => {
  const maxAttempts = 10;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flushMicrotasks();
    }
  }

  throw lastError;
};

const clickElement = async (element: Element | null): Promise<void> => {
  expect(element).toBeTruthy();
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const changeInputValue = async (element: HTMLInputElement | null, value: string): Promise<void> => {
  expect(element).toBeTruthy();
  await act(async () => {
    if (!element) {
      return;
    }
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    valueSetter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

const pressEnter = async (element: HTMLInputElement | null): Promise<void> => {
  expect(element).toBeTruthy();
  await act(async () => {
    if (!element) {
      return;
    }
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      })
    );
  });
};

const openGalleryEditorDeepLink = (options: { autostart: boolean; source?: string }): void => {
  const params = new URLSearchParams({
    [GALLERY_EDITOR_ENTRY_QUERY_PARAM]: GALLERY_EDITOR_ENTRY_QUERY_VALUE,
    [GALLERY_EDITOR_SOURCE_QUERY_PARAM]: options.source ?? TEST_GITHUB_SOURCE,
  });
  if (options.autostart) {
    params.set(GALLERY_EDITOR_AUTOSTART_QUERY_PARAM, GALLERY_EDITOR_AUTOSTART_QUERY_VALUE);
  }
  window.history.replaceState({}, "", `/?${params.toString()}`);
};

describe("FolderUploadScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    createIluGalleryJobMock.mockResolvedValue(galleryJobFactory());
    generateIluGalleryJobMock.mockResolvedValue(galleryJobFactory());
    getIluGalleryJobMock.mockResolvedValue(galleryJobFactory());
    getIluGalleryPrDraftMock.mockResolvedValue({
      title: "Update gallery assets",
      body: "Generated assets",
      repoSlug: "urdf-studio/urdf-robot-gallery",
      branchName: "gallery/test",
      files: [],
    });
    getIluGalleryRepoPreviewMock.mockResolvedValue({
      source: { owner: TEST_GITHUB_OWNER, repo: TEST_GITHUB_REPO, path: "", branch: TEST_GITHUB_BRANCH },
      publishedRepo: null,
      items: [],
    });
    buildIluGitHubCandidateFileListMock.mockResolvedValue({} as FileList);
    loadRobotAssetFileListFromManifestUrlMock.mockResolvedValue({} as FileList);
    fetchIluGitHubRepoCandidateSummaryMock.mockResolvedValue({ ref: TEST_GITHUB_BRANCH, candidates: [] });
    fetchIluGitHubRepoFilesMock.mockResolvedValue([]);
    checkCandidatesForUnsupportedFormatsMock.mockClear();
    getRuntimeProviderSessionMock.mockRejectedValue(new Error("Runtime session request failed (404): not found"));
    approveRuntimeProviderSessionMock.mockReset();
    startRuntimeProviderRecordingMock.mockReset();
    stopRuntimeProviderRecordingMock.mockReset();
  });

  it("shows gallery loading placeholders immediately while the repo scan is pending", async () => {
    let resolveGalleryJob: ((value: ReturnType<typeof galleryJobFactory>) => void) | null = null;
    createIluGalleryJobMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGalleryJob = resolve;
        })
    );
    openGalleryEditorDeepLink({ autostart: true });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(FolderUploadScreen, {
          onFolderSelected: vi.fn(),
          onImportWorldLayout: vi.fn(),
          onWorkspaceModeChange: vi.fn(),
          workspaceMode: "studio",
        })
      );
    });

    await flushMicrotasks();

    expect(
      Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Gallery")
    ).toBe(false);
    expect(container.textContent).toContain("Scanning Gallery Repo");
    expect(container.textContent).toContain(
      "Inspecting the repository and preparing gallery cards."
    );
    expect(container.querySelectorAll('[data-testid="gallery-loading-card"]')).toHaveLength(4);

    resolveGalleryJob?.(galleryJobFactory());
    await flushMicrotasks();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("does not start a gallery load when pressing Enter in the gallery source input", async () => {
    openGalleryEditorDeepLink({ autostart: false });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(FolderUploadScreen, {
          onFolderSelected: vi.fn(),
          onImportWorldLayout: vi.fn(),
          onWorkspaceModeChange: vi.fn(),
          workspaceMode: "studio",
        })
      );
    });

    const galleryInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="owner/repo or https://github.com/owner/repo"]'
    );
    expect(galleryInput?.value).toBe(TEST_GITHUB_SOURCE);
    await pressEnter(galleryInput);
    await flushMicrotasks();

    expect(createIluGalleryJobMock).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("opens the Studio gallery card editor in a separate tab", async () => {
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);
    fetchIluGitHubRepoCandidateSummaryMock.mockResolvedValue({
      ref: TEST_GITHUB_BRANCH,
      candidates: [
        {
          name: TEST_PRIMARY_CANDIDATE_FILE,
          path: TEST_PRIMARY_CANDIDATE_PATH,
          displayName: "Barkour V0",
          fileBase: "barkour-v0",
          sourceFile: TEST_PRIMARY_CANDIDATE_FILE,
          hasMeshesFolder: false,
          isXacro: false,
        },
      ],
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(FolderUploadScreen, {
          onFolderSelected: vi.fn(),
          onImportWorldLayout: vi.fn(),
          onWorkspaceModeChange: vi.fn(),
          workspaceMode: "studio",
        })
      );
    });
    expect(
      Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Gallery")
    ).toBe(false);

    const gitHubInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="owner/repo or https://github.com/owner/repo"]'
    );
    await changeInputValue(gitHubInput, TEST_GITHUB_SOURCE);

    const loadGitHubButton = container.querySelector('[data-testid="robot-loader"] button');
    await clickElement(loadGitHubButton ?? null);
    await waitFor(() => {
      expect(fetchIluGitHubRepoCandidateSummaryMock).toHaveBeenCalledTimes(1);
    });

    const editGalleryCardsButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit gallery info"]'
    );
    await clickElement(editGalleryCardsButton);

    expect(openMock).toHaveBeenCalledTimes(1);
    const openedUrl = new URL(String(openMock.mock.calls[0]?.[0]));
    expect(openedUrl.searchParams.get(GALLERY_EDITOR_ENTRY_QUERY_PARAM)).toBe(
      GALLERY_EDITOR_ENTRY_QUERY_VALUE
    );
    expect(openedUrl.searchParams.get(GALLERY_EDITOR_SOURCE_QUERY_PARAM)).toBe(
      TEST_GITHUB_RESOLVED_SOURCE
    );
    expect(openedUrl.searchParams.get(GALLERY_EDITOR_AUTOSTART_QUERY_PARAM)).toBe(
      GALLERY_EDITOR_AUTOSTART_QUERY_VALUE
    );
    expect(createIluGalleryJobMock).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("GitHub Source");

    await act(async () => {
      root.unmount();
    });
    container.remove();
    openMock.mockRestore();
  });

  it("loads the gallery editor when opened from a Studio editor deep link", async () => {
    openGalleryEditorDeepLink({ autostart: true });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(FolderUploadScreen, {
          onFolderSelected: vi.fn(),
          onImportWorldLayout: vi.fn(),
          onWorkspaceModeChange: vi.fn(),
          workspaceMode: "studio",
        })
      );
    });

    await waitFor(() => {
      expect(createIluGalleryJobMock).toHaveBeenCalledWith({
        owner: TEST_GITHUB_OWNER,
        repo: TEST_GITHUB_REPO,
        path: "",
        branch: TEST_GITHUB_BRANCH,
      });
      expect(container.textContent).toContain("GitHub Source");
    });
    const galleryInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="owner/repo or https://github.com/owner/repo"]'
    );
    expect(galleryInput?.value).toBe(TEST_GITHUB_SOURCE);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("shows progress feedback immediately when generating gallery assets", async () => {
    let resolveGeneration: ((value: ReturnType<typeof galleryJobFactory>) => void) | null = null;
    generateIluGalleryJobMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGeneration = resolve;
        })
    );
    openGalleryEditorDeepLink({ autostart: true });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(FolderUploadScreen, {
          onFolderSelected: vi.fn(),
          onImportWorldLayout: vi.fn(),
          onWorkspaceModeChange: vi.fn(),
          workspaceMode: "studio",
        })
      );
    });

    await waitFor(() => {
      expect(container.textContent).toContain("Generate Repo");
    });

    const generateRepoButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Generate Repo")
    );
    await clickElement(generateRepoButton ?? null);

    expect(generateIluGalleryJobMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Generating gallery assets: 1% progress (0/4 assets done).");
    expect(container.textContent).toContain("Generating 1%");

    resolveGeneration?.({
      ...galleryJobFactory(),
      status: "completed",
      phase: "generate",
      progress: {
        completed: 4,
        total: 4,
        percent: 100,
      },
    });
    await flushMicrotasks();
    await waitFor(() => {
      expect(container.textContent).toContain("Generated gallery assets: 100% progress (4/4 assets done).");
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("locks entry switching while a selected gallery card load is pending", async () => {
    let resolveGalleryFetch: ((value: unknown[]) => void) | null = null;
    fetchIluGitHubRepoFilesMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGalleryFetch = resolve;
        })
    );
    openGalleryEditorDeepLink({ autostart: true });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onFolderSelected = vi.fn();

    await act(async () => {
      root.render(
        createElement(FolderUploadScreen, {
          onFolderSelected,
          onImportWorldLayout: vi.fn(),
          onWorkspaceModeChange: vi.fn(),
          workspaceMode: "studio",
        })
      );
    });

    const galleryInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="owner/repo or https://github.com/owner/repo"]'
    );
    expect(galleryInput?.value).toBe(TEST_GITHUB_SOURCE);

    await waitFor(() => {
      expect(createIluGalleryJobMock).toHaveBeenCalledTimes(1);
      const loadIntoStudioButtons = Array.from(container.querySelectorAll("button")).filter(
        (button) => button.textContent?.includes("Load Into Studio")
      );
      expect(loadIntoStudioButtons).toHaveLength(2);
    });

    const loadIntoStudioButtons = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent?.includes("Load Into Studio")
    );

    await act(async () => {
      loadIntoStudioButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      loadIntoStudioButtons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushMicrotasks();

    const entryButtons = Array.from(container.querySelectorAll("button")).filter((button) =>
      ["Assembly", "Runtime"].includes(button.textContent ?? "")
    );
    expect(fetchIluGitHubRepoFilesMock).toHaveBeenCalledTimes(1);
    expect(
      Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Gallery")
    ).toBe(false);
    expect(entryButtons).toHaveLength(0);
    expect(container.textContent).not.toContain("Entry Mode");
    expect(loadIntoStudioButtons.every((button) => button.disabled)).toBe(true);
    expect(loadIntoStudioButtons[0]?.innerHTML.includes("animate-spin")).toBe(true);
    expect(loadIntoStudioButtons[1]?.innerHTML.includes("animate-spin")).toBe(false);

    resolveGalleryFetch?.([]);
    await waitFor(() => {
      expect(buildIluGitHubCandidateFileListMock).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: TEST_GITHUB_OWNER,
          repo: TEST_GITHUB_REPO,
          files: [],
          branch: TEST_GITHUB_BRANCH,
        }),
        TEST_PRIMARY_CANDIDATE_PATH,
        expect.objectContaining({
          additionalUrdfPaths: undefined,
        })
      );
      expect(onFolderSelected).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("ignores stale gallery generation completion after a new source load starts", async () => {
    const initialJob = galleryJobFactory();
    const nextInspectionJob = {
      ...galleryJobFactory(),
      jobId: "gallery-job-2",
      source: {
        owner: TEST_GITHUB_OWNER,
        repo: "new_gallery_repo",
        path: "",
        branch: TEST_GITHUB_BRANCH,
      },
      items: [
        {
          ...galleryJobFactory().items[0],
          id: "entry-gamma",
          title: "Gamma",
          repo: "new_gallery_repo",
          sourceFile: "gamma.urdf",
          urdfPath: "gamma.urdf",
        },
      ],
    };
    const staleGenerationJob = {
      ...galleryJobFactory(),
      jobId: initialJob.jobId,
      status: "completed",
      phase: "generate",
      items: [
        {
          ...galleryJobFactory().items[0],
          id: "entry-stale",
          title: "Stale Generation Result",
        },
      ],
      progress: {
        completed: 4,
        total: 4,
        percent: 100,
      },
    };
    let resolveGeneration: ((value: typeof staleGenerationJob) => void) | null = null;
    createIluGalleryJobMock
      .mockResolvedValueOnce(initialJob)
      .mockResolvedValueOnce(nextInspectionJob);
    generateIluGalleryJobMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGeneration = resolve;
        })
    );
    openGalleryEditorDeepLink({ autostart: true });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(FolderUploadScreen, {
          onFolderSelected: vi.fn(),
          onImportWorldLayout: vi.fn(),
          onWorkspaceModeChange: vi.fn(),
          workspaceMode: "studio",
        })
      );
    });

    await waitFor(() => {
      expect(container.textContent).toContain("Generate Repo");
    });

    const generateRepoButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Generate Repo")
    );
    await clickElement(generateRepoButton ?? null);
    await waitFor(() => {
      expect(generateIluGalleryJobMock).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain("Generating gallery assets: 1% progress (0/4 assets done).");
    });

    const galleryInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="owner/repo or https://github.com/owner/repo"]'
    );
    await changeInputValue(galleryInput, "google-deepmind/new_gallery_repo");
    const galleryLoadButton = container.querySelector<HTMLButtonElement>(
      'button[title="Load GitHub gallery source"]'
    );
    await clickElement(galleryLoadButton);

    await waitFor(() => {
      expect(createIluGalleryJobMock).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain("Gamma");
    });

    resolveGeneration?.(staleGenerationJob);
    await flushMicrotasks();

    expect(container.textContent).toContain("Gamma");
    expect(container.textContent).not.toContain("Stale Generation Result");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("lets a gallery card load into Studio while asset regeneration is running", async () => {
    const runningGenerationJob = {
      ...galleryJobFactory(),
      status: "running",
      phase: "generate",
      progress: {
        completed: 0,
        total: 4,
        percent: 1,
      },
    };
    generateIluGalleryJobMock.mockResolvedValue(runningGenerationJob);
    getIluGalleryJobMock.mockResolvedValue(runningGenerationJob);
    openGalleryEditorDeepLink({ autostart: true });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onFolderSelected = vi.fn();
    const onWorkspaceModeChange = vi.fn();

    await act(async () => {
      root.render(
        createElement(FolderUploadScreen, {
          onFolderSelected,
          onImportWorldLayout: vi.fn(),
          onWorkspaceModeChange,
          workspaceMode: "studio",
        })
      );
    });

    await waitFor(() => {
      expect(container.textContent).toContain("Regenerate");
    });

    const regenerateButtons = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent?.includes("Regenerate")
    );
    await clickElement(regenerateButtons[0]);

    await waitFor(() => {
      expect(generateIluGalleryJobMock).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain("Generating gallery assets: 1% progress (0/4 assets done).");
    });

    const loadIntoStudioButtons = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent?.includes("Load Into Studio")
    );
    expect(loadIntoStudioButtons).toHaveLength(2);
    expect(loadIntoStudioButtons[0]?.disabled).toBe(false);

    await clickElement(loadIntoStudioButtons[0]);

    await waitFor(() => {
      expect(onFolderSelected).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain("Entry Mode");
      expect(container.querySelector('[data-testid="robot-loader"]')).toBeTruthy();
      expect(onWorkspaceModeChange).toHaveBeenCalledWith("studio");
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("does not inspect GitHub candidate diagnostics in the background when opening the picker", async () => {
    fetchIluGitHubRepoCandidateSummaryMock.mockResolvedValue({
      ref: TEST_GITHUB_BRANCH,
      candidates: [
        {
          name: TEST_PRIMARY_CANDIDATE_FILE,
          path: TEST_PRIMARY_CANDIDATE_PATH,
          displayName: "Barkour V0",
          fileBase: "barkour-v0",
          sourceFile: TEST_PRIMARY_CANDIDATE_FILE,
          hasMeshesFolder: false,
          isXacro: false,
        },
      ],
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(FolderUploadScreen));
    });

    const gitHubInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="owner/repo or https://github.com/owner/repo"]'
    );
    await changeInputValue(gitHubInput, TEST_GITHUB_SOURCE);

    const loadGitHubButton = container.querySelector('[data-testid="robot-loader"] button');
    await clickElement(loadGitHubButton ?? null);
    await flushMicrotasks();

    expect(fetchIluGitHubRepoCandidateSummaryMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="selected-candidate-count"]')?.textContent).toBe("0");
    expect(container.querySelector('[data-testid="has-selected-primary-candidate"]')?.textContent).toBe("false");
    expect(fetchIluGitHubRepoFilesMock).not.toHaveBeenCalled();
    expect(checkCandidatesForUnsupportedFormatsMock).not.toHaveBeenCalled();
    expect(getIluGalleryRepoPreviewMock).toHaveBeenCalledWith({
      owner: TEST_GITHUB_OWNER,
      repo: TEST_GITHUB_REPO,
      path: "",
      branch: TEST_GITHUB_BRANCH,
    }, [
      {
        name: TEST_PRIMARY_CANDIDATE_FILE,
        path: TEST_PRIMARY_CANDIDATE_PATH,
        displayName: "Barkour V0",
        fileBase: "barkour-v0",
        sourceFile: TEST_PRIMARY_CANDIDATE_FILE,
        hasMeshesFolder: false,
        isXacro: false,
      },
    ]);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("loads the OpenArm shortcut from the bundled manifest", async () => {
    const shortcut = FOLDER_UPLOAD_ROBOT_SHORTCUTS.openArm;
    const openArmFileList = { length: 1 } as FileList;
    loadRobotAssetFileListFromManifestUrlMock.mockResolvedValue(openArmFileList);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe(shortcut.cameraConfigUrl);
        return new Response(TEST_OPENARM_CAMERA_CONFIG_BODY, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) satisfies typeof fetch,
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onFolderSelected = vi.fn();
    const onWorkspaceModeChange = vi.fn();

    await act(async () => {
      root.render(
        createElement(FolderUploadScreen, {
          onFolderSelected,
          onImportWorldLayout: vi.fn(),
          onWorkspaceModeChange,
          workspaceMode: "studio",
        })
      );
    });

    const tryOpenArmButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Try OpenArm")
    );
    await clickElement(tryOpenArmButton ?? null);

    await waitFor(() => {
      expect(loadRobotAssetFileListFromManifestUrlMock).toHaveBeenCalledWith(
        shortcut.manifestUrl
      );
      expect(cameraStoreState.loadCameras).toHaveBeenCalledWith({
        cameras: [
          expect.objectContaining({
            name: "openarm_depth_camera",
            parent_joint: "openarm_body_world_joint",
            pose: {
              xyz: [...OPENARM_HF_LIVE_REAL_SENSE_POSITION_M],
              rpy: [...OPENARM_HF_LIVE_CAMERA_RPY_RAD],
            },
          }),
        ],
      });
      expect(fetchIluGitHubRepoFilesMock).not.toHaveBeenCalled();
      expect(buildIluGitHubCandidateFileListMock).not.toHaveBeenCalled();
      expect(gitHubSourceStoreState.clearSource).toHaveBeenCalledOnce();
      expect(onWorkspaceModeChange).toHaveBeenCalledWith("studio");
      expect(onFolderSelected).toHaveBeenCalledWith(openArmFileList, { preserveCameras: false });
      expect(startOpenArmHfLiveObserveMock).not.toHaveBeenCalled();
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("loads the SO101 shortcut from the bundled manifest and camera config without GitHub", async () => {
    const shortcut = FOLDER_UPLOAD_ROBOT_SHORTCUTS.so101;
    const so101FileList = { length: 1 } as FileList;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(shortcut.cameraConfigUrl);
      return new Response(TEST_SO101_CAMERA_CONFIG_BODY, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) satisfies typeof fetch;
    loadRobotAssetFileListFromManifestUrlMock.mockResolvedValue(so101FileList);
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onFolderSelected = vi.fn();
    const onWorkspaceModeChange = vi.fn();

    await act(async () => {
      root.render(
        createElement(FolderUploadScreen, {
          onFolderSelected,
          onImportWorldLayout: vi.fn(),
          onWorkspaceModeChange,
          workspaceMode: "studio",
        })
      );
    });

    const trySo101Button = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Try SO101")
    );
    await clickElement(trySo101Button ?? null);

    await waitFor(() => {
      expect(loadRobotAssetFileListFromManifestUrlMock).toHaveBeenCalledWith(
        shortcut.manifestUrl
      );
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(cameraStoreState.loadCameras).toHaveBeenCalledWith({
        cameras: [
          expect.objectContaining({
            name: "so101_overhead_scene",
            parent_joint: "base_link",
            pose: {
              xyz: [0.2, 0.02, 0.75],
              rpy: [0, 1.3909428270024187, 0],
            },
          }),
          expect.objectContaining({
            name: "so101_gripper_down",
            parent_joint: "gripper_frame_joint",
            pose: {
              xyz: [0, 0, 0.045],
              rpy: [
                -2.9287597456336267,
                0.5047613939080733,
                0.055446603046238024,
              ],
            },
          }),
          expect.objectContaining({
            name: "so101_port_oblique",
            parent_joint: "base_link",
            pose: {
              xyz: [0.52, -0.38, 0.34],
              rpy: [
                6.740378120644072e-17,
                0.6031350448467916,
                2.014244663214635,
              ],
            },
          }),
        ],
      });
      expect(cameraStoreState.clearCameras).not.toHaveBeenCalled();
      expect(fetchIluGitHubRepoFilesMock).not.toHaveBeenCalled();
      expect(buildIluGitHubCandidateFileListMock).not.toHaveBeenCalled();
      expect(gitHubSourceStoreState.clearSource).toHaveBeenCalledOnce();
      expect(onWorkspaceModeChange).toHaveBeenCalledWith("studio");
      expect(onFolderSelected).toHaveBeenCalledWith(so101FileList, { preserveCameras: false });
      expect(startOpenArmHfLiveObserveMock).not.toHaveBeenCalled();
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
