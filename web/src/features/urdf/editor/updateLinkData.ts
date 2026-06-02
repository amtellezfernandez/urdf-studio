import {
  addCollisionToLink as addCollisionToLinkInUrdf,
  addInertialToLink as addInertialToLinkInUrdf,
  removeCollisionFromLink as removeCollisionFromLinkInUrdf,
  removeInertialFromLink as removeInertialFromLinkInUrdf,
  removeVisualFromLink as removeVisualFromLinkInUrdf,
  updateCollisionInLink as updateCollisionInLinkInUrdf,
  updateInertialInLink as updateInertialInLinkInUrdf,
  updateVisualInLink as updateVisualInLinkInUrdf,
  type LinkGeometryParams,
  type LinkGeometryType,
  type LinkInertiaTensor,
  type LinkOrigin as CoreLinkOrigin,
} from "@/shared/lib/urdfCore";

type LinkOrigin = CoreLinkOrigin;
type GeometryType = LinkGeometryType;
type GeometryParams = LinkGeometryParams;

const DEFAULT_ORIGIN: LinkOrigin = { xyz: [0, 0, 0], rpy: [0, 0, 0] };

const toContent = (
  urdfContent: string,
  result: { success: boolean; content: string }
): string => (result.success ? result.content : urdfContent);

export function updateVisualInLink(
  urdfContent: string,
  linkName: string,
  visualIndex: number,
  geometryType: GeometryType,
  geometryParams: GeometryParams,
  origin: LinkOrigin,
  materialColor?: string
): string {
  return toContent(
    urdfContent,
    updateVisualInLinkInUrdf(
      urdfContent,
      linkName,
      visualIndex,
      geometryType,
      geometryParams,
      origin,
      materialColor
    )
  );
}

export function addCollisionToLink(
  urdfContent: string,
  linkName: string,
  geometryType: GeometryType,
  geometryParams: GeometryParams,
  origin: LinkOrigin = DEFAULT_ORIGIN
): string {
  return toContent(
    urdfContent,
    addCollisionToLinkInUrdf(urdfContent, linkName, geometryType, geometryParams, origin)
  );
}

export function updateCollisionInLink(
  urdfContent: string,
  linkName: string,
  collisionIndex: number,
  geometryType: GeometryType,
  geometryParams: GeometryParams,
  origin: LinkOrigin
): string {
  return toContent(
    urdfContent,
    updateCollisionInLinkInUrdf(
      urdfContent,
      linkName,
      collisionIndex,
      geometryType,
      geometryParams,
      origin
    )
  );
}

export function addInertialToLink(
  urdfContent: string,
  linkName: string,
  mass: number,
  inertia: LinkInertiaTensor,
  origin: LinkOrigin = DEFAULT_ORIGIN
): string {
  return toContent(
    urdfContent,
    addInertialToLinkInUrdf(urdfContent, linkName, mass, inertia, origin)
  );
}

export function updateInertialInLink(
  urdfContent: string,
  linkName: string,
  mass: number,
  inertia: LinkInertiaTensor,
  origin: LinkOrigin
): string {
  return toContent(
    urdfContent,
    updateInertialInLinkInUrdf(urdfContent, linkName, mass, inertia, origin)
  );
}

export function removeVisualFromLink(
  urdfContent: string,
  linkName: string,
  visualIndex: number
): string {
  return toContent(urdfContent, removeVisualFromLinkInUrdf(urdfContent, linkName, visualIndex));
}

export function removeCollisionFromLink(
  urdfContent: string,
  linkName: string,
  collisionIndex: number
): string {
  return toContent(
    urdfContent,
    removeCollisionFromLinkInUrdf(urdfContent, linkName, collisionIndex)
  );
}

export function removeInertialFromLink(urdfContent: string, linkName: string): string {
  return toContent(urdfContent, removeInertialFromLinkInUrdf(urdfContent, linkName));
}
