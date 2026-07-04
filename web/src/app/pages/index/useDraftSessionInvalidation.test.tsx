/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CanonicalSynthesisPreviewSession,
  InertialSynthesisSession,
} from "@/app/pages/index/indexPageRuntimeHelpers";
import {
  shouldClearBakePreviewSession,
  shouldClearCanonicalSynthesisPreview,
  shouldClearInertialSynthesisSession,
  useDraftSessionInvalidation,
} from "@/app/pages/index/useDraftSessionInvalidation";
import type { UrdfBakePreviewSession } from "@/features/urdf/bake/virtualBake";

const DRAFT_SESSION_FIXTURES = {
  currentUrdf: "<robot name=\"current\" />",
  draftBase: "<robot name=\"draft-base\" />",
  oldDraftBase: "<robot name=\"old-draft-base\" />",
  oldUrdf: "<robot name=\"old\" />",
  stagedUrdf: "<robot name=\"staged\" />",
} as const;

const createBakeSession = (
  overrides: Partial<UrdfBakePreviewSession> = {}
): UrdfBakePreviewSession =>
  ({
    preview: { entries: [], skipped: [], success: true },
    sourceContent: DRAFT_SESSION_FIXTURES.currentUrdf,
    stagedContent: DRAFT_SESSION_FIXTURES.stagedUrdf,
    ...overrides,
  }) as UrdfBakePreviewSession;

const createCanonicalSession = (
  overrides: Partial<CanonicalSynthesisPreviewSession> = {}
): CanonicalSynthesisPreviewSession =>
  ({
    draftContent: "<robot name=\"canonical-draft\" />",
    preview: { jointCount: 1 },
    sourceContent: DRAFT_SESSION_FIXTURES.currentUrdf,
    synthesisSourceContent: DRAFT_SESSION_FIXTURES.stagedUrdf,
    ...overrides,
  }) as CanonicalSynthesisPreviewSession;

const createInertialSession = (
  overrides: Partial<InertialSynthesisSession> = {}
): InertialSynthesisSession =>
  ({
    audit: null,
    baseContent: DRAFT_SESSION_FIXTURES.draftBase,
    draftContent: "<robot name=\"inertial-draft\" />",
    sourceContent: DRAFT_SESSION_FIXTURES.currentUrdf,
    synthesis: { results: [] },
    ...overrides,
  }) as InertialSynthesisSession;

describe("draft session invalidation", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("detects stale bake preview sessions by source content", () => {
    expect(
      shouldClearBakePreviewSession({
        session: createBakeSession(),
        vizUrdfContent: DRAFT_SESSION_FIXTURES.currentUrdf,
      })
    ).toBe(false);
    expect(
      shouldClearBakePreviewSession({
        session: createBakeSession(),
        vizUrdfContent: DRAFT_SESSION_FIXTURES.oldUrdf,
      })
    ).toBe(true);
  });

  it("detects stale canonical previews by source or synthesis source content", () => {
    expect(
      shouldClearCanonicalSynthesisPreview({
        activeSynthesisSourceContent: DRAFT_SESSION_FIXTURES.stagedUrdf,
        session: createCanonicalSession(),
        vizUrdfContent: DRAFT_SESSION_FIXTURES.currentUrdf,
      })
    ).toBe(false);
    expect(
      shouldClearCanonicalSynthesisPreview({
        activeSynthesisSourceContent: DRAFT_SESSION_FIXTURES.stagedUrdf,
        session: createCanonicalSession(),
        vizUrdfContent: DRAFT_SESSION_FIXTURES.oldUrdf,
      })
    ).toBe(true);
    expect(
      shouldClearCanonicalSynthesisPreview({
        activeSynthesisSourceContent: DRAFT_SESSION_FIXTURES.currentUrdf,
        session: createCanonicalSession(),
        vizUrdfContent: DRAFT_SESSION_FIXTURES.currentUrdf,
      })
    ).toBe(true);
  });

  it("detects stale inertial sessions by source or base content", () => {
    expect(
      shouldClearInertialSynthesisSession({
        inertialDraftBaseContent: DRAFT_SESSION_FIXTURES.draftBase,
        session: createInertialSession(),
        vizUrdfContent: DRAFT_SESSION_FIXTURES.currentUrdf,
      })
    ).toBe(false);
    expect(
      shouldClearInertialSynthesisSession({
        inertialDraftBaseContent: DRAFT_SESSION_FIXTURES.oldDraftBase,
        session: createInertialSession(),
        vizUrdfContent: DRAFT_SESSION_FIXTURES.currentUrdf,
      })
    ).toBe(true);
  });

  it("clears stale sessions through the hook", async () => {
    const setBakePreviewSession = vi.fn();
    const setCanonicalSynthesisPreview = vi.fn();
    const setInertialSynthesisSession = vi.fn();

    const Probe = () => {
      useDraftSessionInvalidation({
        bakePreviewSession: createBakeSession({
          sourceContent: DRAFT_SESSION_FIXTURES.oldUrdf,
        }),
        canonicalSynthesisPreview: createCanonicalSession({
          sourceContent: DRAFT_SESSION_FIXTURES.oldUrdf,
        }),
        inertialDraftBaseContent: DRAFT_SESSION_FIXTURES.oldDraftBase,
        inertialSynthesisSession: createInertialSession(),
        setBakePreviewSession,
        setCanonicalSynthesisPreview,
        setInertialSynthesisSession,
        vizUrdfContent: DRAFT_SESSION_FIXTURES.currentUrdf,
      });
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Probe));
    });

    expect(setBakePreviewSession).toHaveBeenCalledWith(null);
    expect(setCanonicalSynthesisPreview).toHaveBeenCalledWith(null);
    expect(setInertialSynthesisSession).toHaveBeenCalledWith(null);

    await act(async () => {
      root.unmount();
    });
  });
});
