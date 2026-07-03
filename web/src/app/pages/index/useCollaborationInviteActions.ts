import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { describeCollaborationLinkAccess } from "@/features/collaboration/collaborationTransport";
import type { CollaborationLinkAccess } from "@/features/collaboration/collaborationTypes";
import type { CollaborationInviteAction } from "@/features/layout/page/top-nav/types";

type CollaborationToastId = ReturnType<typeof toast.loading>;

type CreateCollaborationShareLink = (params: {
  access: CollaborationLinkAccess;
  baseUrl: string;
  label: string;
}) => Promise<string>;

type PrepareCollaborationInviteParams = {
  action: CollaborationInviteAction;
  buildLink: () => Promise<string>;
  onShareUrl: (shareUrl: string, toastId: CollaborationToastId) => Promise<boolean>;
  loadingMessage: string;
  successMessage: string;
  errorMessage: string;
};

type UseCollaborationInviteActionsParams = {
  collaborationStatus: "idle" | "connecting" | "connected" | "error";
  createShareLink: CreateCollaborationShareLink;
  resolvedRobotName: string | null;
  rotateShareLink: (params: { baseUrl: string }) => Promise<string>;
};

export type CollaborationInviteActions = {
  collaborationInviteAction: CollaborationInviteAction | null;
  handleCreateCollaborationLink: (
    baseUrl?: string,
    access?: CollaborationLinkAccess,
  ) => Promise<void>;
  handleEmailCollaborationLink: (
    email: string,
    baseUrl?: string,
    access?: CollaborationLinkAccess,
  ) => Promise<void>;
  handleResetCollaborationLink: () => Promise<void>;
};

export const buildCollaborationLinkLabel = (resolvedRobotName: string | null): string =>
  resolvedRobotName ? `${resolvedRobotName} live edit` : "URDF Studio live edit";

export const buildCollaborationEmailInviteHref = ({
  access,
  shareUrl,
  targetEmail,
}: {
  access: CollaborationLinkAccess;
  shareUrl: string;
  targetEmail: string;
}): string => {
  const subject = `URDF Studio ${describeCollaborationLinkAccess(access).toLowerCase()} link`;
  const body = `Open this URDF Studio workspace: ${shareUrl}`;
  return `mailto:${encodeURIComponent(targetEmail)}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
};

export const useCollaborationInviteActions = ({
  collaborationStatus,
  createShareLink,
  resolvedRobotName,
  rotateShareLink,
}: UseCollaborationInviteActionsParams): CollaborationInviteActions => {
  const [collaborationInviteAction, setCollaborationInviteAction] =
    useState<CollaborationInviteAction | null>(null);
  const activeInviteActionRef = useRef<CollaborationInviteAction | null>(null);

  const prepareCollaborationInviteLink = useCallback(
    async ({
      action,
      buildLink,
      errorMessage,
      loadingMessage,
      onShareUrl,
      successMessage,
    }: PrepareCollaborationInviteParams) => {
      if (activeInviteActionRef.current) return;
      activeInviteActionRef.current = action;
      setCollaborationInviteAction(action);
      const toastId = toast.loading(loadingMessage);
      try {
        const shareUrl = await buildLink();
        const shouldShowSuccess = await onShareUrl(shareUrl, toastId);
        if (shouldShowSuccess) {
          toast.success(successMessage, { id: toastId });
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : errorMessage, {
          id: toastId,
        });
      } finally {
        activeInviteActionRef.current = null;
        setCollaborationInviteAction(null);
      }
    },
    [],
  );

  const buildCurrentCollaborationShareLink = useCallback(
    (baseUrl: string = window.location.href, access: CollaborationLinkAccess = "viewer") =>
      createShareLink({
        access,
        baseUrl,
        label: buildCollaborationLinkLabel(resolvedRobotName),
      }),
    [createShareLink, resolvedRobotName],
  );

  const copyCollaborationShareUrl = useCallback(
    async (shareUrl: string, toastId: CollaborationToastId) => {
      if (!navigator.clipboard?.writeText) {
        toast.message("Copy this team invite link", {
          description: shareUrl,
          id: toastId,
        });
        return false;
      }
      await navigator.clipboard.writeText(shareUrl);
      return true;
    },
    [],
  );

  const handleCreateCollaborationLink = useCallback(
    async (baseUrl?: string, access: CollaborationLinkAccess = "viewer") => {
      const isCreatingRoom = collaborationStatus === "idle";
      await prepareCollaborationInviteLink({
        action: isCreatingRoom ? "creating" : "copying",
        buildLink: () => buildCurrentCollaborationShareLink(baseUrl, access),
        errorMessage: "Failed to prepare the share link.",
        loadingMessage: isCreatingRoom
          ? "Creating a room and copying the link..."
          : "Copying the current share link...",
        onShareUrl: copyCollaborationShareUrl,
        successMessage: isCreatingRoom
          ? `Room created. ${describeCollaborationLinkAccess(access)} link copied.`
          : `${describeCollaborationLinkAccess(access)} link copied.`,
      });
    },
    [
      buildCurrentCollaborationShareLink,
      collaborationStatus,
      copyCollaborationShareUrl,
      prepareCollaborationInviteLink,
    ],
  );

  const handleEmailCollaborationLink = useCallback(
    async (email: string, baseUrl?: string, access: CollaborationLinkAccess = "viewer") => {
      const targetEmail = email.trim();
      if (!targetEmail) {
        toast.error("Enter an email address before sending the invite.");
        return;
      }

      await prepareCollaborationInviteLink({
        action: "emailing",
        buildLink: () => buildCurrentCollaborationShareLink(baseUrl, access),
        errorMessage: "Failed to prepare the email invite.",
        loadingMessage: "Preparing email invite...",
        onShareUrl: async (shareUrl) => {
          window.location.href = buildCollaborationEmailInviteHref({
            access,
            shareUrl,
            targetEmail,
          });
          return true;
        },
        successMessage: "Email draft opened with the share link.",
      });
    },
    [buildCurrentCollaborationShareLink, prepareCollaborationInviteLink],
  );

  const handleResetCollaborationLink = useCallback(async () => {
    await prepareCollaborationInviteLink({
      action: "resetting",
      buildLink: () => rotateShareLink({ baseUrl: window.location.href }),
      errorMessage: "Failed to reset the share link.",
      loadingMessage: "Resetting the link and revoking the old one...",
      onShareUrl: copyCollaborationShareUrl,
      successMessage: "New link copied. Old guest links no longer work.",
    });
  }, [copyCollaborationShareUrl, prepareCollaborationInviteLink, rotateShareLink]);

  return {
    collaborationInviteAction,
    handleCreateCollaborationLink,
    handleEmailCollaborationLink,
    handleResetCollaborationLink,
  };
};
