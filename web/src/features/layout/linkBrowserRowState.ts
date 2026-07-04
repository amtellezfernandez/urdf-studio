import type { LinkData } from "@/shared/lib/urdfBrowser";
import {
  canAddMeshCollisionForLink,
  resolveLinkStatusSummary,
} from "@/features/layout/linkBrowserViewHelpers";

type ResolveLinkBrowserRowStateArgs = {
  effectiveEndEffectorLink: string | null;
  linkData: LinkData | null | undefined;
  linkName: string;
  linksWithCollisionSet: ReadonlySet<string>;
  mergedLinkSet: ReadonlySet<string>;
  simplifiedLinkSet: ReadonlySet<string>;
  voxelDerivedInertialLinkSet: ReadonlySet<string>;
};

export type LinkBrowserRowState = {
  canAddMeshCollision: boolean;
  hasEeStatus: boolean;
  hasUrdfCollision: boolean;
  hasVoxelDerivedInertial: boolean;
  isCollisionMerged: boolean;
  isCollisionSimplified: boolean;
  statusSummary: {
    label: string;
    title: string;
  };
};

export const resolveLinkBrowserRowState = ({
  effectiveEndEffectorLink,
  linkData,
  linkName,
  linksWithCollisionSet,
  mergedLinkSet,
  simplifiedLinkSet,
  voxelDerivedInertialLinkSet,
}: ResolveLinkBrowserRowStateArgs): LinkBrowserRowState => {
  const hasUrdfCollision = linksWithCollisionSet.has(linkName);
  const isCollisionSimplified = hasUrdfCollision && simplifiedLinkSet.has(linkName);
  const isCollisionMerged = hasUrdfCollision && mergedLinkSet.has(linkName);
  const hasEeStatus = effectiveEndEffectorLink === linkName;
  const hasVoxelDerivedInertial = voxelDerivedInertialLinkSet.has(linkName);
  const canAddMeshCollision = canAddMeshCollisionForLink({
    hasUrdfCollision,
    linkData,
  });
  const statusSummary = resolveLinkStatusSummary({
    hasEeStatus,
    isCollisionMerged,
    isCollisionSimplified,
  });

  return {
    canAddMeshCollision,
    hasEeStatus,
    hasUrdfCollision,
    hasVoxelDerivedInertial,
    isCollisionMerged,
    isCollisionSimplified,
    statusSummary,
  };
};
