import { useEffect, useRef } from "react";

export type LoadReviewFileIdentity = Pick<File, "name" | "lastModified">;

export const buildLoadReviewKey = ({
  activeUrdfPath,
  urdfFile,
}: {
  activeUrdfPath?: string | null;
  urdfFile?: LoadReviewFileIdentity | null;
}): string =>
  [
    activeUrdfPath ?? "",
    urdfFile?.name ?? "",
    String(urdfFile?.lastModified ?? 0),
  ].join("::");

export const useLoadReviewPanelController = ({
  activeUrdfPath,
  hasLoadedFiles,
  hasLoadReviewAttention,
  setShowLoadIssues,
  showLoadIssues,
  urdfFile,
}: {
  activeUrdfPath?: string | null;
  hasLoadedFiles: boolean;
  hasLoadReviewAttention: boolean;
  setShowLoadIssues: (open: boolean) => void;
  showLoadIssues: boolean;
  urdfFile?: LoadReviewFileIdentity | null;
}) => {
  const autoOpenedLoadReviewKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hasLoadedFiles || !hasLoadReviewAttention) {
      return;
    }
    const loadReviewKey = buildLoadReviewKey({ activeUrdfPath, urdfFile });
    if (autoOpenedLoadReviewKeyRef.current === loadReviewKey) {
      return;
    }
    autoOpenedLoadReviewKeyRef.current = loadReviewKey;
    setShowLoadIssues(true);
  }, [
    activeUrdfPath,
    hasLoadedFiles,
    hasLoadReviewAttention,
    setShowLoadIssues,
    urdfFile,
  ]);

  useEffect(() => {
    if (!showLoadIssues || !hasLoadedFiles || hasLoadReviewAttention) {
      return;
    }

    setShowLoadIssues(false);
  }, [hasLoadedFiles, hasLoadReviewAttention, setShowLoadIssues, showLoadIssues]);
};
