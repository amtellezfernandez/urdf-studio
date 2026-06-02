import {
  getUrdfElementByName,
  parseUrdfDocument,
  serializeUrdfDocument,
} from "./urdfDocument";

const getOrCreateLimitElement = (xmlDoc: XMLDocument, joint: Element): Element => {
  const existingLimit = joint.querySelector("limit");
  if (existingLimit) return existingLimit;

  const limitElement = xmlDoc.createElement("limit");
  const insertAfter =
    joint.querySelector("axis") ??
    joint.querySelector("child") ??
    joint.querySelector("origin");

  if (insertAfter?.nextSibling) {
    joint.insertBefore(limitElement, insertAfter.nextSibling);
    return limitElement;
  }
  if (insertAfter) {
    joint.appendChild(limitElement);
    return limitElement;
  }
  joint.appendChild(limitElement);
  return limitElement;
};

export function updateJointEffortInURDF(
  urdfContent: string,
  jointName: string,
  effort: number | null
): string {
  if (!urdfContent.trim()) return urdfContent;

  const xmlDoc = parseUrdfDocument(urdfContent);
  if (!xmlDoc) return urdfContent;

  const joint = getUrdfElementByName(xmlDoc, "joint", jointName, {
    label: "joint",
    onMissing: () => {},
  });
  if (!joint) return urdfContent;

  const shouldClearEffort = effort === null || !Number.isFinite(effort) || effort <= 0;
  const existingLimit = joint.querySelector("limit");
  if (shouldClearEffort) {
    if (!existingLimit) return urdfContent;
    existingLimit.removeAttribute("effort");
    if (existingLimit.attributes.length === 0) {
      existingLimit.remove();
    }
    return serializeUrdfDocument(xmlDoc);
  }

  const limitElement = getOrCreateLimitElement(xmlDoc, joint);
  limitElement.setAttribute("effort", String(effort));
  return serializeUrdfDocument(xmlDoc);
}
