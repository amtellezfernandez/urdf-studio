import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { loadDemoFileListFromManifestUrl } from "@/app/pages/index/demoBootstrap";
import {
  fetchIluSessionAssetManifest,
  fetchIluSessionSnapshot,
  getIluSessionAssetManifestUrl,
  saveIluSessionSnapshot,
  type IluSessionSnapshot,
} from "@/features/urdf/loader/iluSessionApi";
import type { GitHubSource } from "@/shared/store/useGitHubSourceStore";
import {
  getIluSessionLoadTarget,
  getIluSessionSourceKey,
  shouldApplyAttachedIluSessionUpdate,
  shouldSyncAttachedIluSession,
  toStudioGitHubSource,
} from "@/app/pages/index/iluSessionBridgeHelpers";
import { getFilenameFromPath } from "@/shared/lib/pathNames";
import {
  ILU_SESSION_POLL_INTERVAL_MS,
  ILU_SESSION_SAVE_DEBOUNCE_MS,
} from "@/app/pages/index/iluSessionBridgeParams";

type LoadUrdfText = (
  content: string,
  options?: {
    activePath?: string;
    filename?: string;
  }
) => void;

type HydrateLoadedAssetsFromFiles = (
  fileList: FileList,
  options?: {
    activePath?: string | null;
    shouldApply?: () => boolean;
    urdfContent?: string;
  }
) => Promise<boolean>;

type UseIluSessionBridgeOptions = {
  clearGitHubSource: () => void;
  hydrateLoadedAssetsFromFiles: HydrateLoadedAssetsFromFiles;
  iluSessionParam: string;
  loadUrdfText: LoadUrdfText;
  markUrdfContentReloaded: () => void;
  setOriginalVizUrdfContent: (content: string) => void;
  setSavedVizUrdfContent: (content: string) => void;
  setGitHubSource: (source: GitHubSource) => void;
  updateUrdfFile: (content: string, filename?: string) => void;
  vizUrdfContent: string;
};

export const useIluSessionBridge = ({
  clearGitHubSource,
  hydrateLoadedAssetsFromFiles,
  iluSessionParam,
  loadUrdfText,
  markUrdfContentReloaded,
  setOriginalVizUrdfContent,
  setSavedVizUrdfContent,
  setGitHubSource,
  updateUrdfFile,
  vizUrdfContent,
}: UseIluSessionBridgeOptions) => {
  const [attachedIluSessionId, setAttachedIluSessionId] = useState<string>("");
  const [isAttachingIluSession, setIsAttachingIluSession] = useState(false);
  const lastBootstrappedIluSessionIdRef = useRef("");
  const lastSavedIluSessionContentRef = useRef("");
  const lastAppliedIluSessionUpdatedAtRef = useRef("");
  const lastAppliedIluSessionSourceKeyRef = useRef("");
  const isApplyingIluSessionSnapshotRef = useRef(false);
  const iluSessionAssetHydrationRequestRef = useRef(0);
  const isPollingAttachedIluSessionRef = useRef(false);
  const hasShownIluSessionSaveFailureRef = useRef(false);
  const hasShownIluSessionExternalConflictRef = useRef(false);

  const toGitHubSourceFiles = useCallback(
    (
      manifestFiles: Array<{ path: string; url: string; mime?: string | null }>
    ): GitHubSource["files"] =>
      manifestFiles
        .filter((file) => !file.url.includes("/ilu-session/") || !file.url.includes("kind=working"))
        .map((file) => ({
          name: getFilenameFromPath(file.path, "repo-file"),
          path: file.path,
          type: "file" as const,
          download_url: file.url,
        })),
    []
  );

  const finalizeAppliedSnapshot = useCallback(
    (snapshot: IluSessionSnapshot) => {
      lastSavedIluSessionContentRef.current = snapshot.urdfContent;
      lastAppliedIluSessionUpdatedAtRef.current = snapshot.updatedAt;
      lastAppliedIluSessionSourceKeyRef.current = getIluSessionSourceKey(snapshot);
      hasShownIluSessionSaveFailureRef.current = false;
      hasShownIluSessionExternalConflictRef.current = false;
      setAttachedIluSessionId(snapshot.sessionId);
      setOriginalVizUrdfContent(snapshot.urdfContent);
      setSavedVizUrdfContent(snapshot.urdfContent);
      markUrdfContentReloaded();
    },
    [markUrdfContentReloaded, setOriginalVizUrdfContent, setSavedVizUrdfContent]
  );

  const applyIluSessionSnapshot = useCallback(
    async (snapshot: IluSessionSnapshot, mode: "initial" | "external") => {
      if (isApplyingIluSessionSnapshotRef.current) {
        return;
      }

      isApplyingIluSessionSnapshotRef.current = true;
      try {
        const { activePath, filename } = getIluSessionLoadTarget(snapshot);
        const loadedSource = snapshot.loadedSource;
        const nextSourceKey = getIluSessionSourceKey(snapshot);
        const sourceChanged =
          lastAppliedIluSessionSourceKeyRef.current.trim().length === 0 ||
          lastAppliedIluSessionSourceKeyRef.current !== nextSourceKey;

        if (mode === "external" && !sourceChanged) {
          updateUrdfFile(snapshot.urdfContent, filename);
          finalizeAppliedSnapshot(snapshot);
          toast.success("Updated from ilu terminal");
          return;
        }

        clearGitHubSource();
        loadUrdfText(snapshot.urdfContent, {
          activePath,
          filename,
        });
        finalizeAppliedSnapshot(snapshot);
        toast.success(mode === "initial" ? "Attached ilu session" : "Updated from ilu terminal");

        if (!loadedSource) {
          return;
        }

        const hydrationRequestId = ++iluSessionAssetHydrationRequestRef.current;
        const shouldApplyHydration = () =>
          iluSessionAssetHydrationRequestRef.current === hydrationRequestId &&
          lastAppliedIluSessionUpdatedAtRef.current === snapshot.updatedAt &&
          lastAppliedIluSessionSourceKeyRef.current === nextSourceKey;

        void (async () => {
          try {
            const manifest = await fetchIluSessionAssetManifest(snapshot.sessionId);
            const fileList = await loadDemoFileListFromManifestUrl(
              getIluSessionAssetManifestUrl(snapshot.sessionId)
            );

            const didApply = await hydrateLoadedAssetsFromFiles(fileList, {
              activePath,
              shouldApply: shouldApplyHydration,
              urdfContent: snapshot.urdfContent,
            });

            if (!didApply) {
              return;
            }

            if (loadedSource.source === "github") {
              const githubSource = toStudioGitHubSource(snapshot, toGitHubSourceFiles(manifest.files));
              if (githubSource) {
                setGitHubSource(githubSource);
              }
            }
          } catch (error) {
            if (!shouldApplyHydration()) {
              return;
            }
            const detail =
              error instanceof Error
                ? error.message
                : loadedSource.source === "github"
                  ? "GitHub assets were unavailable for the attached session."
                  : "Local assets were unavailable for the attached session.";
            toast.warning(
              mode === "initial"
                ? `Attached ilu session without assets: ${detail}`
                : `Updated from ilu terminal without assets: ${detail}`
            );
          }
        })();
      } finally {
        isApplyingIluSessionSnapshotRef.current = false;
      }
    },
    [
      clearGitHubSource,
      finalizeAppliedSnapshot,
      hydrateLoadedAssetsFromFiles,
      loadUrdfText,
      setGitHubSource,
      toGitHubSourceFiles,
      updateUrdfFile,
    ]
  );

  const applyIluSessionSnapshotRef = useRef(applyIluSessionSnapshot);

  useEffect(() => {
    applyIluSessionSnapshotRef.current = applyIluSessionSnapshot;
  }, [applyIluSessionSnapshot]);

  useEffect(() => {
    if (
      !iluSessionParam ||
      lastBootstrappedIluSessionIdRef.current === iluSessionParam
    ) {
      return;
    }

    lastBootstrappedIluSessionIdRef.current = iluSessionParam;
    let cancelled = false;

    const attachIluSession = async () => {
      setIsAttachingIluSession(true);
      try {
        const snapshot = await fetchIluSessionSnapshot(iluSessionParam);
        if (cancelled) {
          return;
        }
        await applyIluSessionSnapshotRef.current(snapshot, "initial");
      } catch (error) {
        if (cancelled) {
          return;
        }
        const detail =
          error instanceof Error ? error.message : "Failed to attach the ilu session.";
        toast.error(detail);
      } finally {
        if (!cancelled) {
          setIsAttachingIluSession(false);
        }
      }
    };

    void attachIluSession();
    return () => {
      cancelled = true;
    };
  }, [
    iluSessionParam,
  ]);

  useEffect(() => {
    if (
      isApplyingIluSessionSnapshotRef.current ||
      !shouldSyncAttachedIluSession({
        attachedSessionId: attachedIluSessionId,
        isAttaching: isAttachingIluSession,
        lastSavedContent: lastSavedIluSessionContentRef.current,
        nextContent: vizUrdfContent,
      })
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void saveIluSessionSnapshot(attachedIluSessionId, vizUrdfContent)
        .then(() => {
          lastSavedIluSessionContentRef.current = vizUrdfContent;
          hasShownIluSessionSaveFailureRef.current = false;
        })
        .catch((error: unknown) => {
          console.warn("Failed to sync attached ilu session", error);
          if (!hasShownIluSessionSaveFailureRef.current) {
            const detail =
              error instanceof Error ? error.message : "Failed to sync the attached ilu session.";
            toast.error(detail);
            hasShownIluSessionSaveFailureRef.current = true;
          }
        });
    }, ILU_SESSION_SAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [attachedIluSessionId, isAttachingIluSession, vizUrdfContent]);

  useEffect(() => {
    if (attachedIluSessionId.trim().length === 0 || isAttachingIluSession) {
      return;
    }

    let cancelled = false;

    const pollAttachedIluSession = async () => {
      if (isPollingAttachedIluSessionRef.current || isApplyingIluSessionSnapshotRef.current) {
        return;
      }

      isPollingAttachedIluSessionRef.current = true;
      try {
        const snapshot = await fetchIluSessionSnapshot(attachedIluSessionId);
        if (cancelled) {
          return;
        }

        const hasLocalUnsavedChanges =
          vizUrdfContent.trim().length > 0 &&
          vizUrdfContent !== lastSavedIluSessionContentRef.current;
        const hasExternalChange =
          snapshot.updatedAt.trim().length > 0 &&
          snapshot.updatedAt !== lastAppliedIluSessionUpdatedAtRef.current &&
          (
            snapshot.urdfContent !== vizUrdfContent ||
            getIluSessionSourceKey(snapshot) !== lastAppliedIluSessionSourceKeyRef.current
          );

        if (hasExternalChange && hasLocalUnsavedChanges) {
          if (!hasShownIluSessionExternalConflictRef.current) {
            toast.warning("ilu changed this robot in the terminal. Save or revert Studio edits before reloading.");
            hasShownIluSessionExternalConflictRef.current = true;
          }
          return;
        }

        if (
          shouldApplyAttachedIluSessionUpdate({
            attachedSessionId: attachedIluSessionId,
            currentContent: vizUrdfContent,
            hasLocalUnsavedChanges,
            isAttaching: isAttachingIluSession,
            lastAppliedSourceKey: lastAppliedIluSessionSourceKeyRef.current,
            lastAppliedUpdatedAt: lastAppliedIluSessionUpdatedAtRef.current,
            nextSnapshot: snapshot,
          })
        ) {
          await applyIluSessionSnapshot(snapshot, "external");
        } else if (!hasLocalUnsavedChanges) {
          hasShownIluSessionExternalConflictRef.current = false;
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to refresh attached ilu session", error);
        }
      } finally {
        isPollingAttachedIluSessionRef.current = false;
      }
    };

    void pollAttachedIluSession();
    const intervalId = window.setInterval(() => {
      void pollAttachedIluSession();
    }, ILU_SESSION_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    applyIluSessionSnapshot,
    attachedIluSessionId,
    isAttachingIluSession,
    vizUrdfContent,
  ]);

  return {
    attachedIluSessionId,
    isAttachingIluSession,
  };
};
