export type UrdfJointTopology = {
  childLinkName: string;
  jointElement: Element;
  jointName: string;
  jointType: string;
  parentLinkName: string;
};

export const readUrdfJointTopology = (robotElement: Element): UrdfJointTopology[] =>
  Array.from(robotElement.querySelectorAll(":scope > joint[name]"))
    .map((jointElement) => {
      const jointName = jointElement.getAttribute("name") ?? "";
      const parentLinkName =
        jointElement.querySelector(":scope > parent")?.getAttribute("link") ?? "";
      const childLinkName =
        jointElement.querySelector(":scope > child")?.getAttribute("link") ?? "";
      if (!jointName || !parentLinkName || !childLinkName) {
        return null;
      }
      return {
        childLinkName,
        jointElement,
        jointName,
        jointType: jointElement.getAttribute("type")?.trim() || "fixed",
        parentLinkName,
      };
    })
    .filter((joint): joint is UrdfJointTopology => joint !== null);
