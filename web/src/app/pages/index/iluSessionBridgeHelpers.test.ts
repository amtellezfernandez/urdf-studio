import { describe, expect, it } from "vitest";
import {
  getFilenameFromPath,
  getIluSessionLoadTarget,
  getIluSessionSourceKey,
  shouldApplyAttachedIluSessionUpdate,
  shouldSyncAttachedIluSession,
  toStudioGitHubSource,
} from "@/app/pages/index/iluSessionBridgeHelpers";
import type { IluSessionSnapshot } from "@/features/urdf/loader/iluSessionApi";

const createSnapshot = (
  overrides: Partial<IluSessionSnapshot> = {}
): IluSessionSnapshot => ({
  createdAt: "2026-03-23T00:00:00Z",
  githubSource: null,
  lastUrdfPath: "/tmp/robot.urdf",
  loadedSource: null,
  schema: "ilu-shared-session",
  schemaVersion: 1,
  sessionId: "session-1",
  updatedAt: "2026-03-23T00:00:00Z",
  urdfContent: "<robot name=\"test\" />",
  workingUrdfPath: "/tmp/robot.urdf",
  ...overrides,
});

describe("iluSessionBridgeHelpers", () => {
  it("derives a filename from a path with fallback handling", () => {
    expect(getFilenameFromPath("/tmp/robots/demo/robot.urdf")).toBe("robot.urdf");
    expect(getFilenameFromPath("workspace\\robot.xacro")).toBe("robot.xacro");
    expect(getFilenameFromPath("", "fallback.urdf")).toBe("fallback.urdf");
  });

  it("prefers repository source paths when deriving the ILU load target", () => {
    const snapshot = createSnapshot({
      loadedSource: {
        source: "github",
        urdfPath: "/tmp/working.urdf",
        localPath: "/workspace/repo",
        repositoryUrdfPath: "robots/demo/robot.urdf",
      },
      workingUrdfPath: "/tmp/working.urdf",
    });

    expect(getIluSessionLoadTarget(snapshot)).toEqual({
      activePath: "robots/demo/robot.urdf",
      filename: "working.urdf",
    });
  });

  it("only syncs attached ILU content when the session is stable and content changed", () => {
    expect(
      shouldSyncAttachedIluSession({
        attachedSessionId: "session-1",
        isAttaching: false,
        lastSavedContent: "<robot />",
        nextContent: "<robot name=\"updated\" />",
      })
    ).toBe(true);
    expect(
      shouldSyncAttachedIluSession({
        attachedSessionId: "session-1",
        isAttaching: true,
        lastSavedContent: "",
        nextContent: "<robot />",
      })
    ).toBe(false);
    expect(
      shouldSyncAttachedIluSession({
        attachedSessionId: "",
        isAttaching: false,
        lastSavedContent: "",
        nextContent: "<robot />",
      })
    ).toBe(false);
  });

  it("builds a stable source key for attached ILU snapshots", () => {
    const snapshot = createSnapshot({
      loadedSource: {
        source: "local-repo",
        urdfPath: "/tmp/working.urdf",
        localPath: "/workspace/demo",
        repositoryUrdfPath: "robots/demo/robot.urdf",
      },
      workingUrdfPath: "/tmp/working.urdf",
    });

    expect(getIluSessionSourceKey(snapshot)).toContain("\"source\":\"local-repo\"");
    expect(getIluSessionSourceKey(snapshot)).toContain("\"repositoryUrdfPath\":\"robots/demo/robot.urdf\"");
  });

  it("applies newer attached ILU snapshots only when Studio has no local unsaved edits", () => {
    const nextSnapshot = createSnapshot({
      updatedAt: "2026-03-23T00:00:05Z",
      urdfContent: "<robot name=\"updated\" />",
    });

    expect(
      shouldApplyAttachedIluSessionUpdate({
        attachedSessionId: "session-1",
        currentContent: "<robot />",
        hasLocalUnsavedChanges: false,
        isAttaching: false,
        lastAppliedSourceKey: getIluSessionSourceKey(createSnapshot()),
        lastAppliedUpdatedAt: "2026-03-23T00:00:00Z",
        nextSnapshot,
      })
    ).toBe(true);

    expect(
      shouldApplyAttachedIluSessionUpdate({
        attachedSessionId: "session-1",
        currentContent: "<robot />",
        hasLocalUnsavedChanges: true,
        isAttaching: false,
        lastAppliedSourceKey: getIluSessionSourceKey(createSnapshot()),
        lastAppliedUpdatedAt: "2026-03-23T00:00:00Z",
        nextSnapshot,
      })
    ).toBe(false);
  });

  it("re-applies an attached ILU snapshot when the source changes", () => {
    const currentSnapshot = createSnapshot({
      loadedSource: {
        source: "local-repo",
        urdfPath: "/tmp/working.urdf",
        localPath: "/workspace/a",
        repositoryUrdfPath: "robots/a.urdf",
      },
    });
    const nextSnapshot = createSnapshot({
      updatedAt: "2026-03-23T00:00:10Z",
      urdfContent: "<robot name=\"test\" />",
      loadedSource: {
        source: "local-repo",
        urdfPath: "/tmp/working.urdf",
        localPath: "/workspace/b",
        repositoryUrdfPath: "robots/b.urdf",
      },
    });

    expect(
      shouldApplyAttachedIluSessionUpdate({
        attachedSessionId: "session-1",
        currentContent: "<robot name=\"test\" />",
        hasLocalUnsavedChanges: false,
        isAttaching: false,
        lastAppliedSourceKey: getIluSessionSourceKey(currentSnapshot),
        lastAppliedUpdatedAt: "2026-03-23T00:00:00Z",
        nextSnapshot,
      })
    ).toBe(true);
  });

  it("creates a Studio GitHub source only when the ILU snapshot has repository metadata", () => {
    const snapshot = createSnapshot({
      githubSource: {
        owner: "openai",
        repo: "robot",
        ref: "main",
        repositoryUrl: "https://github.com/openai/robot",
      },
      loadedSource: {
        source: "github",
        urdfPath: "/tmp/working.urdf",
        repositoryUrdfPath: "robots/demo/robot.urdf",
      },
    });

    expect(toStudioGitHubSource(snapshot, [])).toEqual({
      owner: "openai",
      repo: "robot",
      branch: "main",
      files: [],
      path: "robots/demo/robot.urdf",
      urdfPath: "robots/demo/robot.urdf",
    });
    expect(toStudioGitHubSource(createSnapshot(), [])).toBeNull();
  });
});
