import type { URDFJoint, URDFRobot } from "urdf-loader";

export const resolveRobotRootLinkName = (
  robot: URDFRobot | null,
  preferredRootLinkNames?: readonly string[] | null
): string | null => {
  if (!robot) {
    return null;
  }

  const preferredRootLinkName =
    preferredRootLinkNames?.find((name) => typeof name === "string" && name.length > 0) ?? null;
  if (preferredRootLinkName) {
    return preferredRootLinkName;
  }

  const links = (robot as URDFRobot & { links?: Record<string, object> }).links ?? {};
  const linkNames = Object.keys(links);
  if (linkNames.length === 0) {
    return null;
  }

  const childLinks = new Set<string>();
  Object.values(robot.joints ?? {}).forEach((joint) => {
    const childLink = (joint as URDFJoint & { childLink?: string }).childLink;
    if (typeof childLink === "string" && childLink.length > 0) {
      childLinks.add(childLink);
    }
  });

  return linkNames.find((name) => !childLinks.has(name)) ?? linkNames[0] ?? null;
};
