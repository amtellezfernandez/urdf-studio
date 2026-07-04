import { useCallback } from "react";
import { toast } from "sonner";

import { downloadTextDocument } from "@/app/pages/index/useWorldSceneManager";

type DownloadDocument = (content: string, filename: string, mimeType: string) => void;

type DraftExportContent = {
  canonicalDraftContent?: string | null;
  getBaseExportContent: () => string;
  inertialDraftContent?: string | null;
};

type UseUrdfExportActionsParams = DraftExportContent & {
  downloadDocument?: DownloadDocument;
  resolvedRobotName?: string | null;
  robotName?: string | null;
};

export const resolveCurrentUrdfExportContent = ({
  canonicalDraftContent,
  getBaseExportContent,
  inertialDraftContent,
}: DraftExportContent): string => {
  if (inertialDraftContent) {
    return inertialDraftContent;
  }
  if (canonicalDraftContent) {
    return canonicalDraftContent;
  }
  return getBaseExportContent();
};

export const resolveUrdfExportFileName = ({
  resolvedRobotName,
  robotName,
}: {
  resolvedRobotName?: string | null;
  robotName?: string | null;
}): string => {
  const safeRobotName =
    (robotName || resolvedRobotName || "robot")
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "robot";
  return `${safeRobotName}.urdf`;
};

export const useUrdfExportActions = ({
  canonicalDraftContent,
  downloadDocument = downloadTextDocument,
  getBaseExportContent,
  inertialDraftContent,
  resolvedRobotName,
  robotName,
}: UseUrdfExportActionsParams) => {
  const getResolvedExportUrdfContent = useCallback(
    () =>
      resolveCurrentUrdfExportContent({
        canonicalDraftContent,
        getBaseExportContent,
        inertialDraftContent,
      }),
    [canonicalDraftContent, getBaseExportContent, inertialDraftContent]
  );

  const handleExportCurrentUrdf = useCallback(() => {
    const exportContent = getResolvedExportUrdfContent();
    if (!exportContent) {
      toast.error("No URDF content to export");
      return;
    }

    downloadDocument(
      exportContent,
      resolveUrdfExportFileName({ resolvedRobotName, robotName }),
      "application/xml"
    );
    toast.success("Exported URDF");
  }, [downloadDocument, getResolvedExportUrdfContent, resolvedRobotName, robotName]);

  return {
    getResolvedExportUrdfContent,
    handleExportCurrentUrdf,
  };
};
