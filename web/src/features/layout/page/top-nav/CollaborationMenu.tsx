import { Link, UserPlus, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { resolveCollaborationShareScope } from "@/features/collaboration/collaborationShareScope";
import {
  describeCollaborationLinkAccess,
  getCollaborationBaseAccess,
} from "@/features/collaboration/collaborationTransport";
import {
  TEAM_SHARING_UNAVAILABLE_STATUS,
  fetchTeamSharingStatus,
  setTeamSharingEnabled,
  type TeamSharingStatus,
} from "@/features/collaboration/teamSharingClient";
import { cn } from "@/shared/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import type { TopNavBarProps } from "./types";
import type { CollaborationLinkAccess } from "@/features/collaboration/collaborationTypes";
import { menuContentClass } from "./menuStyles";

const EMPTY_PEER_COUNT = 0;
const OWNER_PEER_COUNT = 1;
const SHARE_SCOPE_FALLBACK_URL = "";
const INVITE_AVATAR_START_INDEX = 0;
const INVITE_AVATAR_END_INDEX = 1;
const MISSING_INVITED_PERSON_INDEX = -1;

type InvitedPerson = { email: string; access: CollaborationLinkAccess };

type CollaborationMenuProps = Pick<
  TopNavBarProps,
  | "collaborationOwner"
  | "collaborationPeerCount"
  | "collaborationInviteAction"
  | "collaborationSharingEnabled"
  | "collaborationStatus"
  | "onEmailCollaborationLink"
  | "onResetCollaborationLink"
  | "onSetCollaborationSharingEnabled"
> & {
  onCreateCollaborationLink: NonNullable<TopNavBarProps["onCreateCollaborationLink"]>;
};

const getCurrentShareUrl = (): string =>
  typeof window === "undefined" ? SHARE_SCOPE_FALLBACK_URL : window.location.href;

const getShareBaseUrl = (teamSharing: TeamSharingStatus): string => {
  if (teamSharing.available && teamSharing.enabled && teamSharing.teamUrl) {
    return teamSharing.teamUrl;
  }
  return getCurrentShareUrl();
};

const getShareDescription = (teamSharing: TeamSharingStatus): string => {
  if (!teamSharing.available) {
    return "Localhost links only work on this computer. Restart Studio to enable network links for Wi-Fi or Tailnet.";
  }
  return teamSharing.enabled && teamSharing.teamUrl
    ? "Network link is on. This link works for devices on the same Wi-Fi or Tailnet."
    : "Localhost links only work on this computer. Turn on network link for Wi-Fi or Tailnet sharing.";
};

export function CollaborationMenu({
  collaborationOwner,
  collaborationPeerCount,
  collaborationInviteAction,
  collaborationSharingEnabled = true,
  collaborationStatus,
  onCreateCollaborationLink,
  onEmailCollaborationLink,
  onResetCollaborationLink,
  onSetCollaborationSharingEnabled,
}: CollaborationMenuProps) {
  const [emailTarget, setEmailTarget] = useState("");
  const [teamSharing, setTeamSharing] = useState<TeamSharingStatus>(
    TEAM_SHARING_UNAVAILABLE_STATUS,
  );
  const [teamSharingUpdating, setTeamSharingUpdating] = useState(false);
  const [teamSharingError, setTeamSharingError] = useState("");
  const [linkAccess, setLinkAccess] = useState<CollaborationLinkAccess>("viewer");
  const [invitedPeople, setInvitedPeople] = useState<InvitedPerson[]>([]);

  useEffect(() => {
    let mounted = true;
    void fetchTeamSharingStatus().then((status) => {
      if (mounted) setTeamSharing(status);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const canRotateLink = Boolean(collaborationOwner && onResetCollaborationLink);
  const connectedPeerCount =
    collaborationPeerCount ??
    (collaborationStatus === "connected"
      ? OWNER_PEER_COUNT
      : EMPTY_PEER_COUNT);
  const hasPeers = connectedPeerCount > EMPTY_PEER_COUNT;
  const isInviteActionInFlight = Boolean(collaborationInviteAction);
  const shareBaseUrl = getShareBaseUrl(teamSharing);
  const shareScope = resolveCollaborationShareScope(shareBaseUrl);
  const trimmedEmailTarget = emailTarget.trim();
  const linkSharingAvailable = Boolean(teamSharing.available && teamSharing.teamUrl);
  const networkLinkEnabled = Boolean(
    teamSharing.available && teamSharing.enabled && teamSharing.teamUrl,
  );
  const sessionSharingEnabled = collaborationSharingEnabled !== false;
  const linkSharingEnabled = Boolean(networkLinkEnabled && sessionSharingEnabled);
  const canPauseSessionSharing = Boolean(collaborationOwner && onSetCollaborationSharingEnabled);
  const canChangeLinkSharing = Boolean(
    linkSharingAvailable &&
      !teamSharingUpdating &&
      (!networkLinkEnabled || canPauseSessionSharing),
  );
  const canEmailLink = Boolean(
    linkSharingEnabled &&
      shareScope.canEmail &&
      onEmailCollaborationLink &&
      trimmedEmailTarget &&
      !isInviteActionInFlight,
  );
  const canCopyLink = Boolean(linkSharingEnabled && !isInviteActionInFlight);
  const linkSharingNote = !networkLinkEnabled
    ? getShareDescription(teamSharing)
    : sessionSharingEnabled
      ? "Network link is on. This link works for devices on the same Wi-Fi or Tailnet."
      : "Sharing is paused. Existing links stay reusable, but guests see that access is temporarily removed.";

  const handleToggleLinkSharing = () => {
    if (!canChangeLinkSharing) return;
    setTeamSharingUpdating(true);
    setTeamSharingError("");
    void (async () => {
      try {
        if (!networkLinkEnabled) {
          setTeamSharing(await setTeamSharingEnabled(true));
          if (!sessionSharingEnabled) {
            await onSetCollaborationSharingEnabled?.(true);
          }
          return;
        }
        await onSetCollaborationSharingEnabled?.(!sessionSharingEnabled);
      } catch (error) {
        setTeamSharingError(
          error instanceof Error ? error.message : "Failed to update collaboration sharing.",
        );
      } finally {
        setTeamSharingUpdating(false);
      }
    })();
  };

  const handleLinkAccessChange = (value: string) => {
    if (
      value === "viewer" ||
      value === "editor" ||
      value === "viewer_teleop" ||
      value === "editor_teleop"
    ) {
      setLinkAccess(value);
    }
  };

  const handleCopyLink = () => {
    if (!canCopyLink) return;
    onCreateCollaborationLink(shareBaseUrl, linkAccess);
  };

  const handleEmailSubmit = () => {
    if (!trimmedEmailTarget || !canEmailLink || !onEmailCollaborationLink) return;
    onEmailCollaborationLink(trimmedEmailTarget, shareBaseUrl, linkAccess);
    setInvitedPeople((currentPeople) => {
      const nextPerson = { email: trimmedEmailTarget, access: linkAccess };
      const existingPersonIndex = currentPeople.findIndex(
        (person) => person.email.toLowerCase() === trimmedEmailTarget.toLowerCase(),
      );
      if (existingPersonIndex === MISSING_INVITED_PERSON_INDEX) return [...currentPeople, nextPerson];
      return currentPeople.map((person, index) =>
        index === existingPersonIndex ? nextPerson : person,
      );
    });
    setEmailTarget("");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative inline-flex h-7 min-w-8 items-center justify-center rounded-full border border-border/70 bg-background/50 px-2 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted/40 hover:text-foreground",
            collaborationStatus === "error" && "border-red-400/55 text-red-200",
          )}
          aria-label="Share"
          title="Share"
        >
          <Users aria-hidden="true" className="h-3.5 w-3.5" />
          {hasPeers ? (
            <span className="ml-1.5 tabular-nums">{connectedPeerCount}</span>
          ) : null}
          {isInviteActionInFlight ? (
            <span
              aria-hidden="true"
              className="ml-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground"
            />
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={cn("w-[24rem] p-4", menuContentClass)}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[14px] font-semibold text-white">Share</div>
            <div className="mt-0.5 text-[11px] text-[#8f8f8f]">Manage who can open this Studio session.</div>
          </div>
          <div className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-[#b8b8b8]">
            {shareScope.badgeLabel}
          </div>
        </div>

        <section className="mt-4 space-y-2">
          <div className="text-[12px] font-semibold text-white">People with access</div>
          <div className="space-y-2 rounded-xl border border-border/70 bg-background/25 p-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#6f52c7] text-[12px] font-semibold text-white">
                  Y
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[12px] text-white">You</div>
                  <div className="text-[10px] text-[#8f8f8f]">Owner</div>
                </div>
              </div>
              <span className="text-[11px] text-[#d6d6d6]">Titular</span>
            </div>
            <div className={cn("flex items-center justify-between gap-3", !linkSharingEnabled && "opacity-45")}>
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted/50 text-[#b8b8b8]">
                  <Link aria-hidden="true" className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[12px] text-white">Anyone with view link</div>
                  <div className="text-[10px] text-[#8f8f8f]">
                    {linkSharingEnabled ? "Same Wi-Fi or Tailnet" : networkLinkEnabled ? "Temporarily unavailable" : "Link sharing is off"}
                  </div>
                </div>
              </div>
              <span className="text-[11px] text-[#d6d6d6]">
                {linkSharingEnabled ? "Can view" : networkLinkEnabled ? "Paused" : "Inactive"}
              </span>
            </div>
            <div className={cn("flex items-center justify-between gap-3", !linkSharingEnabled && "opacity-45")}>
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted/50 text-[#b8b8b8]">
                  <Link aria-hidden="true" className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[12px] text-white">Anyone with edit link</div>
                  <div className="text-[10px] text-[#8f8f8f]">
                    {linkSharingEnabled ? "Same Wi-Fi or Tailnet" : networkLinkEnabled ? "Temporarily unavailable" : "Link sharing is off"}
                  </div>
                </div>
              </div>
              <span className="text-[11px] text-[#d6d6d6]">
                {linkSharingEnabled ? "Can edit" : networkLinkEnabled ? "Paused" : "Inactive"}
              </span>
            </div>
            {connectedPeerCount > OWNER_PEER_COUNT ? (
              <div className="text-[10px] text-[#8f8f8f]">
                {connectedPeerCount - OWNER_PEER_COUNT} guest{connectedPeerCount === 2 ? "" : "s"} connected now.
              </div>
            ) : null}
            {invitedPeople.map((person) => (
              <div key={person.email} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted/50 text-[11px] font-semibold uppercase text-[#d6d6d6]">
                    {person.email.slice(INVITE_AVATAR_START_INDEX, INVITE_AVATAR_END_INDEX)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[12px] text-white">{person.email}</div>
                    <div className="text-[10px] text-[#8f8f8f]">Pending invite</div>
                  </div>
                </div>
                <span className="text-[11px] text-[#d6d6d6]">
                  {describeCollaborationLinkAccess(person.access)}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-4 space-y-2">
          <div className="text-[12px] font-semibold text-white">Link sharing</div>
          <div className="rounded-xl border border-border/70 bg-background/25 p-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 text-[11px] text-[#a8a8a8]">{linkSharingNote}</div>
              <button
                type="button"
                disabled={!canChangeLinkSharing}
                onClick={handleToggleLinkSharing}
                className="shrink-0 rounded-lg border border-border/70 bg-background/55 px-2.5 py-1.5 text-[11px] text-white transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:text-[#777]"
              >
                {linkSharingEnabled ? "Stop sharing" : "Reactivate sharing"}
              </button>
            </div>
            {teamSharingError ? (
              <div className="mt-1 text-[10px] text-red-200">{teamSharingError}</div>
            ) : null}
          </div>
        </section>

        <section className="mt-4 space-y-2">
          <div className="text-[12px] font-semibold text-white">Add more people</div>
          <div className="rounded-xl border border-border/70 bg-background/25 p-2.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-medium text-white">Level of access</div>
                <div className="text-[10px] text-[#8f8f8f]">Choose permissions for this invite.</div>
              </div>
              <select
                value={linkAccess}
                disabled={isInviteActionInFlight}
                onChange={(event) => handleLinkAccessChange(event.target.value)}
                className="w-40 shrink-0 rounded-md border border-border/70 bg-background/55 px-2 py-1 text-[11px] text-white outline-none disabled:text-[#777]"
              >
                <option value="viewer">Can view</option>
                <option value="editor">Can edit</option>
                <option value="viewer_teleop">Can view + teleop</option>
                <option value="editor_teleop">Can edit + teleop</option>
              </select>
            </div>
            <div className="mt-2 text-[10px] text-[#8f8f8f]">
              Teleop is for trusted operators only.
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/45 px-2 py-1.5">
            <UserPlus aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#9c9c9c]" />
            <input
              value={emailTarget}
              disabled={!linkSharingEnabled || !shareScope.canEmail}
              onChange={(event) => setEmailTarget(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleEmailSubmit();
                }
              }}
              placeholder={linkSharingEnabled ? "Add email" : "Reactivate sharing first"}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-white outline-none placeholder:text-[#777] disabled:text-[#777]"
            />
            <button
              type="button"
              disabled={!trimmedEmailTarget || !canEmailLink}
              onClick={handleEmailSubmit}
              className="rounded-md px-2 py-1 text-[11px] text-white transition-colors hover:bg-muted/60 disabled:pointer-events-none disabled:text-[#777]"
            >
              Send
            </button>
            <button
              type="button"
              disabled={!canCopyLink}
              onClick={handleCopyLink}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-black transition-colors hover:bg-[#dcdcdc] disabled:pointer-events-none disabled:bg-muted disabled:text-[#777]"
            >
              <Link aria-hidden="true" className="h-3.5 w-3.5" />
              Copy link
            </button>
          </div>
        </section>


        {canRotateLink ? (
          <div className="mt-4 flex justify-start">
            <button
              type="button"
              disabled={isInviteActionInFlight}
              onClick={onResetCollaborationLink}
              className="rounded-md px-2 py-1.5 text-[11px] text-[#a8a8a8] transition-colors hover:bg-muted/40 hover:text-white disabled:pointer-events-none disabled:text-[#777]"
            >
              Reset link
            </button>
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
