/** @vitest-environment jsdom */
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FolderUploadRobotLoader } from "@/features/dataset/FolderUploadRobotLoader";
import { getFolderUploadEntryModeConfig } from "@/features/dataset/folderUploadEntryModes";
import { createEmptySubstitutionAssignments } from "@/features/dataset/substitutionAssignments";
import type { IluGalleryEntry, IluGalleryPublishedRepo } from "@/features/dataset/iluGalleryApi";
import type { URDFCandidate } from "@/features/urdf/github/githubRepo";

const TEST_GITHUB_OWNER = "google-deepmind";
const TEST_GITHUB_REPO = "mujoco_menagerie";
const TEST_GITHUB_SOURCE = `${TEST_GITHUB_OWNER}/${TEST_GITHUB_REPO}`;
const TEST_PRIMARY_CANDIDATE_PATH = "google_barkour_v0/barkour_v0.urdf";
const TEST_PRIMARY_CANDIDATE_FILE = "barkour_v0.urdf";
const TEST_PRIMARY_CANDIDATE_DISPLAY = "Barkour V0";
const TEST_PRIMARY_CANDIDATE_FILE_BASE = "google-barkour-v0";
const TEST_PRIMARY_GALLERY_MESH_COUNT = 33;
const TEST_PRIMARY_GALLERY_LINK_COUNT = 17;
const TEST_PRIMARY_GALLERY_JOINT_COUNT = 16;
const TEST_PRIMARY_GALLERY_CONTROLLABLE_JOINT_COUNT = 12;
const TEST_PRIMARY_GALLERY_DOF_COUNT = 12;
const TEST_PRIMARY_GALLERY_ARM_COUNT = 0;
const TEST_PRIMARY_GALLERY_LEG_COUNT = 4;
const TEST_PRIMARY_GALLERY_WHEEL_COUNT = 0;
const TEST_SECONDARY_CANDIDATE_PATH = "google_barkour_vb/barkour_vb_rev_1_0_head_straight.urdf";
const TEST_SECONDARY_CANDIDATE_FILE = "barkour_vb_rev_1_0_head_straight.urdf";
const TEST_SECONDARY_CANDIDATE_DISPLAY = "Barkour VB";
const TEST_SECONDARY_CANDIDATE_FILE_BASE = "google-barkour-vb";
const TEST_STALE_GALLERY_ROBOT_FILE = "legacy_barkour.urdf";
const TEST_STALE_GALLERY_ROBOT_FILE_BASE = "legacy-barkour";

const flushMicrotasks = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const hoverElement = async (element: Element | null, eventName: "mouseover" | "mouseout"): Promise<void> => {
  expect(element).toBeTruthy();
  await act(async () => {
    element?.dispatchEvent(new MouseEvent(eventName, { bubbles: true }));
  });
};

const createCandidate = (overrides: Partial<URDFCandidate>): URDFCandidate => ({
  path: TEST_PRIMARY_CANDIDATE_PATH,
  name: TEST_PRIMARY_CANDIDATE_FILE,
  displayName: TEST_PRIMARY_CANDIDATE_DISPLAY,
  fileBase: TEST_PRIMARY_CANDIDATE_FILE_BASE,
  sourceFile: TEST_PRIMARY_CANDIDATE_FILE,
  hasMeshesFolder: true,
  isXacro: false,
  ...overrides,
});

const createGalleryPreview = (overrides: Partial<IluGalleryEntry>): IluGalleryEntry => ({
  id: TEST_PRIMARY_CANDIDATE_PATH,
  title: TEST_PRIMARY_CANDIDATE_DISPLAY,
  summary: "gallery catalog thumbnail available",
  attentionNotes: [],
  owner: TEST_GITHUB_OWNER,
  repo: TEST_GITHUB_REPO,
  path: null,
  branch: "main",
  urdfPath: TEST_PRIMARY_CANDIDATE_PATH,
  sourceFile: TEST_PRIMARY_CANDIDATE_FILE,
  thumbnailUrl: "https://example.com/demo.png",
  previewUrl: "https://example.com/demo.webp",
  videoUrl: null,
  galleryRepoKey: TEST_GITHUB_SOURCE,
  galleryFileBase: TEST_PRIMARY_CANDIDATE_FILE_BASE,
  macroTags: [],
  meshCount: null,
  linkCount: null,
  jointCount: null,
  armCount: null,
  legCount: null,
  wheelCount: null,
  robotTraits: null,
  tags: ["urdf"],
  ...overrides,
});

const createPublishedRepo = (overrides: Partial<IluGalleryPublishedRepo> = {}): IluGalleryPublishedRepo => ({
  repo: TEST_GITHUB_SOURCE,
  repoKey: TEST_GITHUB_SOURCE,
  path: null,
  name: "MuJoCo Menagerie",
  summary: "Open robot models from DeepMind.",
  org: "Google DeepMind",
  demo: "https://example.com/demo",
  tags: ["quadruped"],
  robots: [
    {
      name: TEST_PRIMARY_CANDIDATE_DISPLAY,
      file: TEST_PRIMARY_CANDIDATE_FILE,
      fileBase: TEST_PRIMARY_CANDIDATE_FILE_BASE,
    },
    {
      name: "Legacy Barkour",
      file: TEST_STALE_GALLERY_ROBOT_FILE,
      fileBase: TEST_STALE_GALLERY_ROBOT_FILE_BASE,
    },
  ],
  hfDatasets: [],
  authorWebsite: "https://example.com",
  authorX: "",
  authorLinkedin: "",
  authorGithub: "google-deepmind",
  contact: "robotics@example.com",
  extra: "",
  stars: 123,
  ownerLogin: TEST_GITHUB_OWNER,
  ownerAvatar: null,
  authorLogin: TEST_GITHUB_OWNER,
  authorAvatar: null,
  repoUpdatedAt: "2026-03-01T00:00:00Z",
  updatedAt: "2026-03-02T00:00:00Z",
  license: "Apache-2.0",
  ...overrides,
});

type FolderUploadRobotLoaderProps = ComponentProps<typeof FolderUploadRobotLoader>;

const createRobotLoaderProps = (
  overrides: Partial<FolderUploadRobotLoaderProps> = {}
): FolderUploadRobotLoaderProps => ({
  title: "Robot",
  entryMode: getFolderUploadEntryModeConfig("studio"),
  isLoadingGithub: false,
  isLoadInteractionLocked: false,
  isPreparingLocalSource: false,
  isRobotSourceDropActive: false,
  githubUrl: TEST_GITHUB_SOURCE,
  githubLoadButtonDisabled: false,
  githubLoadButtonLabel: "Load",
  loadedRobotName: null,
  stagedSetupRobotName: null,
  recentRepos: [],
  lastLocalFolder: null,
  assemblySources: [],
  activeAssemblySourceLabel: null,
  assemblyQueuedSelections: [],
  assemblyQueuedSelectionCount: 0,
  maxAssemblyRobots: 4,
  substitutionAssignments: createEmptySubstitutionAssignments(),
  showUrdfDialog: true,
  candidateDialogTitle: `Choose Robot · ${TEST_GITHUB_SOURCE}`,
  candidateDialogDescription: `Found robot files in ${TEST_GITHUB_SOURCE}.`,
  urdfCandidates: [createCandidate({})],
  candidateGalleryPreviewByPath: {},
  candidateGalleryPublishedRepo: null,
  isLoadingCandidateGalleryPreviews: false,
  selectedCandidatePaths: [],
  localSelectionFilesPresent: false,
  xacroGateUnavailableSuffix: "",
  xacroGateUnavailableMessage: "",
  hasSelectedPrimaryCandidate: false,
  onGithubUrlChange: vi.fn(),
  onGithubLoad: vi.fn(),
  onBrowseFolder: vi.fn(),
  onBrowseFiles: vi.fn(),
  onRobotSourceDragEnter: vi.fn(),
  onRobotSourceDragOver: vi.fn(),
  onRobotSourceDragLeave: vi.fn(),
  onRobotSourceDrop: vi.fn(),
  onLoadRecentRepo: vi.fn(),
  onRemoveRecentRepo: vi.fn(),
  onClearLastLocalFolder: vi.fn(),
  onClearLoadedRobotSelection: vi.fn(),
  onClearStagedSetupRobot: vi.fn(),
  onClearAssemblyQueue: vi.fn(),
  onOpenAssemblySource: vi.fn(),
  onRemoveAssemblySource: vi.fn(),
  onRemoveAssemblyQueuedSelection: vi.fn(),
  onAssignSubstitutionTarget: vi.fn(),
  onClearSubstitutionTarget: vi.fn(),
  onCloseUrdfDialog: vi.fn(),
  onSelectAllAssemblyCandidates: vi.fn(),
  onClearAssemblyCandidates: vi.fn(),
  onToggleAssemblyCandidate: vi.fn(),
  onSelectSingleCandidate: vi.fn(),
  onAssemblyLoadSelected: vi.fn(),
  onLoadRobotOnlyFromDialog: vi.fn(),
  onSelectRobotForSetup: vi.fn(),
  onEditCandidateGalleryCards: vi.fn(),
  ...overrides,
});

describe("FolderUploadRobotLoader", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("plays the hovered robot card video and stops the previous card preview when the hover moves", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const editGalleryCards = vi.fn();

    await act(async () => {
      root.render(
        createElement(FolderUploadRobotLoader, {
          title: "Robot",
          entryMode: getFolderUploadEntryModeConfig("studio"),
          isLoadingGithub: false,
          isLoadInteractionLocked: false,
          isPreparingLocalSource: false,
          isRobotSourceDropActive: false,
          githubUrl: TEST_GITHUB_SOURCE,
          githubLoadButtonDisabled: false,
          githubLoadButtonLabel: "Load",
          loadedRobotName: null,
          stagedSetupRobotName: null,
          recentRepos: [],
          lastLocalFolder: null,
          assemblySources: [],
          activeAssemblySourceLabel: null,
          assemblyQueuedSelections: [],
          assemblyQueuedSelectionCount: 0,
          maxAssemblyRobots: 4,
          substitutionAssignments: createEmptySubstitutionAssignments(),
          showUrdfDialog: true,
          candidateDialogTitle: `Choose Robot · ${TEST_GITHUB_SOURCE}`,
          candidateDialogDescription: `Found 2 robot files in ${TEST_GITHUB_SOURCE}.`,
          urdfCandidates: [
            createCandidate({
              path: TEST_PRIMARY_CANDIDATE_PATH,
              name: TEST_PRIMARY_CANDIDATE_FILE,
              displayName: TEST_PRIMARY_CANDIDATE_DISPLAY,
              fileBase: TEST_PRIMARY_CANDIDATE_FILE_BASE,
              sourceFile: TEST_PRIMARY_CANDIDATE_FILE,
            }),
            createCandidate({
              path: TEST_SECONDARY_CANDIDATE_PATH,
              name: TEST_SECONDARY_CANDIDATE_FILE,
              displayName: TEST_SECONDARY_CANDIDATE_DISPLAY,
              fileBase: TEST_SECONDARY_CANDIDATE_FILE_BASE,
              sourceFile: TEST_SECONDARY_CANDIDATE_FILE,
            }),
          ],
          candidateGalleryPreviewByPath: {
            [TEST_PRIMARY_CANDIDATE_PATH]: createGalleryPreview({
              id: TEST_PRIMARY_CANDIDATE_PATH,
              title: TEST_PRIMARY_CANDIDATE_DISPLAY,
              urdfPath: TEST_PRIMARY_CANDIDATE_PATH,
              sourceFile: TEST_PRIMARY_CANDIDATE_FILE,
              thumbnailUrl: "https://example.com/alpha.png",
              previewUrl: "https://example.com/alpha.webp",
              videoUrl: "https://example.com/alpha.webm",
              galleryFileBase: TEST_PRIMARY_CANDIDATE_FILE_BASE,
              macroTags: ["quadruped"],
              meshCount: TEST_PRIMARY_GALLERY_MESH_COUNT,
              linkCount: TEST_PRIMARY_GALLERY_LINK_COUNT,
              jointCount: TEST_PRIMARY_GALLERY_JOINT_COUNT,
              armCount: TEST_PRIMARY_GALLERY_ARM_COUNT,
              legCount: TEST_PRIMARY_GALLERY_LEG_COUNT,
              wheelCount: TEST_PRIMARY_GALLERY_WHEEL_COUNT,
              robotTraits: {
                primaryFamily: "quadruped",
                families: ["quadruped"],
                linkCount: TEST_PRIMARY_GALLERY_LINK_COUNT,
                jointCount: TEST_PRIMARY_GALLERY_JOINT_COUNT,
                controllableJointCount: TEST_PRIMARY_GALLERY_CONTROLLABLE_JOINT_COUNT,
                dofCount: TEST_PRIMARY_GALLERY_DOF_COUNT,
                armCount: TEST_PRIMARY_GALLERY_ARM_COUNT,
                legCount: TEST_PRIMARY_GALLERY_LEG_COUNT,
                wheelCount: TEST_PRIMARY_GALLERY_WHEEL_COUNT,
              },
            }),
            [TEST_SECONDARY_CANDIDATE_PATH]: createGalleryPreview({
              id: TEST_SECONDARY_CANDIDATE_PATH,
              title: TEST_SECONDARY_CANDIDATE_DISPLAY,
              urdfPath: TEST_SECONDARY_CANDIDATE_PATH,
              sourceFile: TEST_SECONDARY_CANDIDATE_FILE,
              thumbnailUrl: "https://example.com/beta.png",
              previewUrl: "https://example.com/beta.webp",
              videoUrl: null,
              galleryFileBase: TEST_SECONDARY_CANDIDATE_FILE_BASE,
            }),
          },
          candidateGalleryPublishedRepo: createPublishedRepo(),
          isLoadingCandidateGalleryPreviews: false,
          selectedCandidatePaths: [TEST_PRIMARY_CANDIDATE_PATH],
          localSelectionFilesPresent: false,
          xacroGateUnavailableSuffix: "",
          xacroGateUnavailableMessage: "",
          hasSelectedPrimaryCandidate: true,
          onGithubUrlChange: vi.fn(),
          onGithubLoad: vi.fn(),
          onBrowseFolder: vi.fn(),
          onBrowseFiles: vi.fn(),
          onRobotSourceDragEnter: vi.fn(),
          onRobotSourceDragOver: vi.fn(),
          onRobotSourceDragLeave: vi.fn(),
          onRobotSourceDrop: vi.fn(),
          onLoadRecentRepo: vi.fn(),
          onRemoveRecentRepo: vi.fn(),
          onClearLastLocalFolder: vi.fn(),
          onClearLoadedRobotSelection: vi.fn(),
          onClearStagedSetupRobot: vi.fn(),
          onClearAssemblyQueue: vi.fn(),
          onOpenAssemblySource: vi.fn(),
          onRemoveAssemblySource: vi.fn(),
          onRemoveAssemblyQueuedSelection: vi.fn(),
          onAssignSubstitutionTarget: vi.fn(),
          onClearSubstitutionTarget: vi.fn(),
          onCloseUrdfDialog: vi.fn(),
          onSelectAllAssemblyCandidates: vi.fn(),
          onClearAssemblyCandidates: vi.fn(),
          onToggleAssemblyCandidate: vi.fn(),
          onSelectSingleCandidate: vi.fn(),
          onAssemblyLoadSelected: vi.fn(),
          onLoadRobotOnlyFromDialog: vi.fn(),
          onSelectRobotForSetup: vi.fn(),
          onEditCandidateGalleryCards: editGalleryCards,
        })
      );
    });

    await flushMicrotasks();

    const primaryPreviewImage = document.body.querySelector<HTMLImageElement>(
      `img[alt="${TEST_PRIMARY_CANDIDATE_FILE} gallery thumbnail"]`
    );
    const secondaryPreviewImage = document.body.querySelector<HTMLImageElement>(
      `img[alt="${TEST_SECONDARY_CANDIDATE_FILE} gallery thumbnail"]`
    );
    expect(primaryPreviewImage?.src).toBe("https://example.com/alpha.png");
    expect(secondaryPreviewImage?.src).toBe("https://example.com/beta.png");

    const primaryCard = primaryPreviewImage?.closest("button") ?? null;
    const secondaryCard = secondaryPreviewImage?.closest("button") ?? null;

    await hoverElement(primaryCard ?? null, "mouseover");
    await flushMicrotasks();
    expect(
      document.body.querySelector<HTMLVideoElement>('video[src="https://example.com/alpha.webm"]')
    ).toBeTruthy();
    expect(
      document.body.querySelector<HTMLVideoElement>('video[src="https://example.com/beta.webm"]')
    ).toBeFalsy();

    await hoverElement(secondaryCard ?? null, "mouseover");
    await flushMicrotasks();
    expect(
      document.body.querySelector<HTMLVideoElement>('video[src="https://example.com/alpha.webm"]')
    ).toBeFalsy();
    expect(
      document.body.querySelector<HTMLVideoElement>('video[src="https://example.com/beta.webm"]')
    ).toBeFalsy();
    expect(
      document.body.querySelector<HTMLImageElement>('img[src="https://example.com/beta.webp"]')
    ).toBeTruthy();

    await hoverElement(secondaryCard ?? null, "mouseout");
    await flushMicrotasks();
    expect(
      document.body.querySelector<HTMLVideoElement>('video[src="https://example.com/alpha.webm"]')
    ).toBeFalsy();
    expect(
      document.body.querySelector<HTMLVideoElement>('video[src="https://example.com/beta.webm"]')
    ).toBeFalsy();
    expect(
      document.body.querySelector<HTMLImageElement>(`img[alt="${TEST_PRIMARY_CANDIDATE_FILE} gallery thumbnail"]`)?.src
    ).toBe("https://example.com/alpha.png");
    expect(
      document.body.querySelector<HTMLImageElement>(`img[alt="${TEST_SECONDARY_CANDIDATE_FILE} gallery thumbnail"]`)?.src
    ).toBe("https://example.com/beta.png");
    expect(document.body.textContent).toContain("Quadruped");
    expect(document.body.textContent).toContain(
      `Meshes ${TEST_PRIMARY_GALLERY_MESH_COUNT} · Links ${TEST_PRIMARY_GALLERY_LINK_COUNT} · Joints ${TEST_PRIMARY_GALLERY_JOINT_COUNT}`
    );
    expect(document.body.textContent).toContain(
      `Arms ${TEST_PRIMARY_GALLERY_ARM_COUNT} · Legs ${TEST_PRIMARY_GALLERY_LEG_COUNT} · Wheels ${TEST_PRIMARY_GALLERY_WHEEL_COUNT}`
    );
    expect(document.body.textContent).not.toContain(`Gallery mapping ${TEST_PRIMARY_CANDIDATE_FILE_BASE}`);
    expect(document.body.textContent).not.toContain(`Gallery source ${TEST_PRIMARY_CANDIDATE_FILE}`);
    expect(document.body.textContent).toContain("GitHub is the source of truth; some gallery robots look stale.");
    expect(document.body.textContent).toContain("Edit gallery info");
    const editGalleryCardsButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Edit gallery info")
    );
    expect(editGalleryCardsButton).toBeTruthy();
    await act(async () => {
      editGalleryCardsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(editGalleryCards).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(`Choose Robot · ${TEST_GITHUB_SOURCE}`);

    const metadataButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("View metadata")
    );
    expect(metadataButton).toBeTruthy();
    await act(async () => {
      metadataButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("Google DeepMind");
    expect(document.body.textContent).toContain("Open robot models from DeepMind.");
    expect(document.body.textContent).toContain("Apache-2.0");
    expect(document.body.textContent).toContain(
      `${TEST_PRIMARY_CANDIDATE_FILE}: Gallery mapping ${TEST_PRIMARY_CANDIDATE_FILE_BASE}`
    );
    expect(document.body.textContent).toContain(`Gallery source ${TEST_PRIMARY_CANDIDATE_FILE}`);
    expect(document.body.textContent).toContain("Possibly stale gallery robots:");
    expect(document.body.textContent).toContain(
      `Legacy Barkour (gallery mapping ${TEST_STALE_GALLERY_ROBOT_FILE_BASE})`
    );
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("matches gallery thumbnails by source file and gallery asset base when paths differ", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(
          FolderUploadRobotLoader,
          createRobotLoaderProps({
            candidateGalleryPreviewByPath: {
              [TEST_PRIMARY_CANDIDATE_FILE_BASE]: createGalleryPreview({
                id: "published-gallery-card",
                urdfPath: null,
                sourceFile: TEST_PRIMARY_CANDIDATE_FILE,
                thumbnailUrl: "https://example.com/source-file-match.png",
                previewUrl: null,
                galleryFileBase: TEST_PRIMARY_CANDIDATE_FILE_BASE,
              }),
            },
            candidateGalleryPublishedRepo: createPublishedRepo(),
          })
        )
      );
    });

    await flushMicrotasks();

    expect(document.body.textContent).not.toContain("No gallery thumbnail");
    expect(
      document.body.querySelector<HTMLImageElement>(`img[alt="${TEST_PRIMARY_CANDIDATE_FILE} gallery thumbnail"]`)?.src
    ).toBe("https://example.com/source-file-match.png");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("hides gallery preview copy and empty tiles when no preview context is available", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(FolderUploadRobotLoader, {
          title: "Robot",
          entryMode: getFolderUploadEntryModeConfig("studio"),
          isLoadingGithub: false,
          isLoadInteractionLocked: false,
          isPreparingLocalSource: false,
          isRobotSourceDropActive: false,
          githubUrl: "",
          githubLoadButtonDisabled: true,
          githubLoadButtonLabel: "Load",
          loadedRobotName: null,
          stagedSetupRobotName: null,
          recentRepos: [],
          lastLocalFolder: null,
          assemblySources: [],
          activeAssemblySourceLabel: null,
          assemblyQueuedSelections: [],
          assemblyQueuedSelectionCount: 0,
          maxAssemblyRobots: 4,
          substitutionAssignments: createEmptySubstitutionAssignments(),
          showUrdfDialog: true,
          candidateDialogTitle: "Choose Robot",
          candidateDialogDescription: null,
          urdfCandidates: [createCandidate({ path: "robots/local/local.urdf", name: "local.urdf" })],
          candidateGalleryPreviewByPath: {},
          candidateGalleryPublishedRepo: null,
          isLoadingCandidateGalleryPreviews: false,
          selectedCandidatePaths: [],
          localSelectionFilesPresent: true,
          xacroGateUnavailableSuffix: "",
          xacroGateUnavailableMessage: "",
          hasSelectedPrimaryCandidate: false,
          onGithubUrlChange: vi.fn(),
          onGithubLoad: vi.fn(),
          onBrowseFolder: vi.fn(),
          onBrowseFiles: vi.fn(),
          onRobotSourceDragEnter: vi.fn(),
          onRobotSourceDragOver: vi.fn(),
          onRobotSourceDragLeave: vi.fn(),
          onRobotSourceDrop: vi.fn(),
          onLoadRecentRepo: vi.fn(),
          onRemoveRecentRepo: vi.fn(),
          onClearLastLocalFolder: vi.fn(),
          onClearLoadedRobotSelection: vi.fn(),
          onClearStagedSetupRobot: vi.fn(),
          onClearAssemblyQueue: vi.fn(),
          onOpenAssemblySource: vi.fn(),
          onRemoveAssemblySource: vi.fn(),
          onRemoveAssemblyQueuedSelection: vi.fn(),
          onAssignSubstitutionTarget: vi.fn(),
          onClearSubstitutionTarget: vi.fn(),
          onCloseUrdfDialog: vi.fn(),
          onSelectAllAssemblyCandidates: vi.fn(),
          onClearAssemblyCandidates: vi.fn(),
          onToggleAssemblyCandidate: vi.fn(),
          onSelectSingleCandidate: vi.fn(),
          onAssemblyLoadSelected: vi.fn(),
          onLoadRobotOnlyFromDialog: vi.fn(),
          onSelectRobotForSetup: vi.fn(),
          onEditCandidateGalleryCards: vi.fn(),
        })
      );
    });

    await flushMicrotasks();

    expect(container.textContent).not.toContain("Published gallery thumbnails appear here when available.");
    expect(container.textContent).not.toContain("View metadata");
    expect(container.textContent).not.toContain("No gallery thumbnail");
    expect(
      Array.from(document.body.querySelectorAll("button"))
        .filter((button) => button.textContent?.trim() === "Load")
        .every((button) => button.disabled)
    ).toBe(true);
    expect(
      Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Setup")
        ?.disabled
    ).toBe(true);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
