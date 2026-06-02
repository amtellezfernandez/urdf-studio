import { parseUrdfDocument, serializeUrdfDocument } from "@/shared/lib/urdfCore";
import type { KinematicSynthesisPreview } from "./kinematicSynthesizer";

const FLOAT_PRECISION_DECIMALS = 6;

const toAttributeTriplet = (values: [number, number, number]): string =>
  values.map((value) => Number(value.toFixed(FLOAT_PRECISION_DECIMALS)).toString()).join(" ");

const ensureOriginElement = (xmlDoc: XMLDocument, jointElement: Element): Element => {
  const existingOrigin = jointElement.querySelector(":scope > origin");
  if (existingOrigin) {
    return existingOrigin;
  }
  const originElement = xmlDoc.createElement("origin");
  const insertBeforeTarget = jointElement.querySelector(":scope > parent");
  if (insertBeforeTarget) {
    jointElement.insertBefore(originElement, insertBeforeTarget);
    return originElement;
  }
  jointElement.insertBefore(originElement, jointElement.firstChild);
  return originElement;
};

export const buildCanonicalSynthesisDraft = (
  urdfContent: string,
  preview: KinematicSynthesisPreview
): string | null => {
  const xmlDoc = parseUrdfDocument(urdfContent);
  const robotElement = xmlDoc?.querySelector("robot");
  if (!xmlDoc || !robotElement) {
    return null;
  }

  const synthesizedJointMap = new Map(
    preview.joints.map((joint) => [joint.jointName, joint] as const)
  );

  Array.from(robotElement.querySelectorAll(":scope > joint[name]")).forEach((jointElement) => {
    const jointName = jointElement.getAttribute("name");
    if (!jointName) {
      return;
    }
    const synthesizedJoint = synthesizedJointMap.get(jointName);
    if (!synthesizedJoint) {
      return;
    }
    const originElement = ensureOriginElement(xmlDoc, jointElement);
    originElement.setAttribute("xyz", toAttributeTriplet(synthesizedJoint.xyz));
    originElement.setAttribute("rpy", toAttributeTriplet(synthesizedJoint.rpy));
  });

  return serializeUrdfDocument(xmlDoc);
};
