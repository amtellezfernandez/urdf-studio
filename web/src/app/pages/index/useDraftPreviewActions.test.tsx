/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { URDFRobot } from "urdf-loader";

import type { CanonicalSynthesisPreviewSession } from "@/app/pages/index/indexPageRuntimeHelpers";
import { useDraftPreviewActions } from "@/app/pages/index/useDraftPreviewActions";
import type { CanonicalSynthesisResult } from "@/features/urdf/inertia/robotMasteringApi";
import type { CapturedKinematicState } from "@/features/urdf/synthesis/kinematicSynthesizer";
import type { UrdfBakePreviewSession } from "@/features/urdf/bake/virtualBake";
import type { UrdfViewMode } from "@/shared/types/feature";

const {
  captureKinematicState,
  executeCanonicalSynthesisViaBackend,
  toast,
} = vi.hoisted(() => ({
  captureKinematicState: vi.fn(),
  executeCanonicalSynthesisViaBackend: vi.fn(),
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast,
}));

vi.mock("@/features/urdf/synthesis/kinematicSynthesizer", () => ({
  captureKinematicState,
}));

vi.mock("@/features/urdf/inertia/robotMasteringApi", () => ({
  executeCanonicalSynthesisViaBackend,
}));

type DraftPreviewActions = ReturnType<typeof useDraftPreviewActions>;

const DRAFT_PREVIEW_FIXTURES = {
  bakableUrdf: `
  <robot name="demo">
    <link name="base">
      <visual>
        <origin xyz="0.1 0 0" rpy="0 0 0" />
        <geometry><box size="1 1 1" /></geometry>
      </visual>
    </link>
  </robot>
  `,
} as const;

const createCapturedState = (): CapturedKinematicState => ({
  robotName: "demo",
  supportPlane: {
    success: false,
    confidence: 0,
    candidates: [],
    evidence: "test fixture",
    fallbackReason: "test fixture",
  },
  capturedLinkWorldPoses: [],
});

const createCanonicalResult = (jointCount: number): CanonicalSynthesisResult =>
  ({
    draftContent: "<robot name=\"canonical\" />",
    preview: {
      jointCount,
    },
  }) as CanonicalSynthesisResult;

const renderDraftPreviewActions = (
  overrides: Partial<Parameters<typeof useDraftPreviewActions>[0]> = {}
) => {
  let actions: DraftPreviewActions | null = null;
  const setBakePreviewSession = vi.fn();
  const setCanonicalSynthesisPreview = vi.fn();
  const setShowUrdfEditor = vi.fn();
  const setUrdfViewMode = vi.fn();

  const Harness = () => {
    actions = useDraftPreviewActions({
      bakePreviewSession: null,
      robot: {} as URDFRobot,
      setBakePreviewSession,
      setCanonicalSynthesisPreview,
      setShowUrdfEditor,
      setUrdfViewMode,
      vizUrdfContent: DRAFT_PREVIEW_FIXTURES.bakableUrdf,
      ...overrides,
    });
    return null;
  };

  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(createElement(Harness));
  });

  if (!actions) {
    throw new Error("Draft preview actions hook did not render.");
  }

  return {
    actions,
    root,
    setBakePreviewSession,
    setCanonicalSynthesisPreview,
    setShowUrdfEditor,
    setUrdfViewMode,
  };
};

describe("useDraftPreviewActions", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    captureKinematicState.mockReset();
    executeCanonicalSynthesisViaBackend.mockReset();
    toast.error.mockReset();
    toast.info.mockReset();
    toast.success.mockReset();
  });

  it("stages a visual/collision bake preview", () => {
    const { actions, root, setBakePreviewSession } = renderDraftPreviewActions();

    act(() => {
      actions.handlePreviewBakeVisualTransforms();
    });

    expect(setBakePreviewSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceContent: DRAFT_PREVIEW_FIXTURES.bakableUrdf,
        preview: expect.objectContaining({
          success: true,
          entries: expect.any(Array),
        }),
      })
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Staged bake export for 1 visual/collision entry."
    );

    act(() => {
      root.unmount();
    });
  });

  it("reports canonical capture failure before calling the backend", async () => {
    captureKinematicState.mockReturnValue(null);
    const { actions, root } = renderDraftPreviewActions();

    await act(async () => {
      await actions.handleCaptureCanonicalSynthesis();
    });

    expect(executeCanonicalSynthesisViaBackend).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Failed to capture the current robot state for canonical synthesis."
    );

    act(() => {
      root.unmount();
    });
  });

  it("stores canonical synthesis previews from the backend result", async () => {
    const capturedState = createCapturedState();
    captureKinematicState.mockReturnValue(capturedState);
    executeCanonicalSynthesisViaBackend.mockResolvedValue(createCanonicalResult(2));
    const stagedBakeSession = {
      stagedContent: "<robot name=\"staged\" />",
    } as UrdfBakePreviewSession;
    const {
      actions,
      root,
      setCanonicalSynthesisPreview,
      setShowUrdfEditor,
      setUrdfViewMode,
    } = renderDraftPreviewActions({
      bakePreviewSession: stagedBakeSession,
    });

    await act(async () => {
      await actions.handleCaptureCanonicalSynthesis();
    });

    expect(executeCanonicalSynthesisViaBackend).toHaveBeenCalledWith({
      sourceUrdf: DRAFT_PREVIEW_FIXTURES.bakableUrdf,
      synthesisSourceUrdf: stagedBakeSession.stagedContent,
      capturedState,
    });
    expect(setCanonicalSynthesisPreview).toHaveBeenCalledWith({
      sourceContent: DRAFT_PREVIEW_FIXTURES.bakableUrdf,
      synthesisSourceContent: stagedBakeSession.stagedContent,
      preview: expect.objectContaining({ jointCount: 2 }),
      draftContent: "<robot name=\"canonical\" />",
    } satisfies CanonicalSynthesisPreviewSession);
    expect(setShowUrdfEditor).toHaveBeenCalledWith(true);
    expect(setUrdfViewMode).toHaveBeenCalledWith("modified" satisfies UrdfViewMode);
    expect(toast.success).toHaveBeenCalledWith(
      "Captured canonical synthesis draft for 2 joints."
    );

    act(() => {
      root.unmount();
    });
  });
});
