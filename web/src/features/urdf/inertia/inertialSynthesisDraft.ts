import { parseUrdfDocument, serializeUrdfDocument } from "@/shared/lib/urdfCore";
import type { InertialSynthesisResult } from "./inertialSynthesis";
import {
  INERTIAL_SYNTHESIS_INERTIA_PRECISION_DECIMALS,
  INERTIAL_SYNTHESIS_MASS_PRECISION_DECIMALS,
  INERTIAL_SYNTHESIS_ORIGIN_PRECISION_DECIMALS,
} from "./inertialSynthesisParams";

const toTripletAttribute = (values: [number, number, number], decimals: number): string =>
  values
    .map((value) => Number(value.toFixed(decimals)).toString())
    .join(" ");

const toScalarAttribute = (value: number, decimals: number): string =>
  Number(value.toFixed(decimals)).toString();

const ensureChildElement = (
  xmlDoc: XMLDocument,
  parent: Element,
  tagName: string
): Element => {
  const existing = parent.querySelector(`:scope > ${tagName}`);
  if (existing) {
    return existing;
  }
  const element = xmlDoc.createElement(tagName);
  parent.appendChild(element);
  return element;
};

const ensureInertialElement = (xmlDoc: XMLDocument, linkElement: Element): Element => {
  const existing = linkElement.querySelector(":scope > inertial");
  if (existing) {
    return existing;
  }
  const inertialElement = xmlDoc.createElement("inertial");
  linkElement.appendChild(inertialElement);
  return inertialElement;
};

export const buildInertialSynthesisDraft = (
  urdfContent: string,
  synthesisResult: InertialSynthesisResult
): string | null => {
  const xmlDoc = parseUrdfDocument(urdfContent);
  const robotElement = xmlDoc?.querySelector("robot");
  if (!xmlDoc || !robotElement) {
    return null;
  }

  const synthesizedByLink = new Map(
    synthesisResult.results
      .filter((result) => result.status === "synthesized" && result.mass && result.origin && result.inertia)
      .map((result) => [result.linkName, result] as const)
  );

  Array.from(robotElement.querySelectorAll(":scope > link[name]")).forEach((linkElement) => {
    const linkName = linkElement.getAttribute("name");
    if (!linkName) {
      return;
    }
    const synthesized = synthesizedByLink.get(linkName);
    if (!synthesized || !synthesized.mass || !synthesized.origin || !synthesized.inertia) {
      return;
    }

    const inertialElement = ensureInertialElement(xmlDoc, linkElement);
    const originElement = ensureChildElement(xmlDoc, inertialElement, "origin");
    originElement.setAttribute(
      "xyz",
      toTripletAttribute(synthesized.origin.xyz, INERTIAL_SYNTHESIS_ORIGIN_PRECISION_DECIMALS)
    );
    originElement.setAttribute(
      "rpy",
      toTripletAttribute(synthesized.origin.rpy, INERTIAL_SYNTHESIS_ORIGIN_PRECISION_DECIMALS)
    );

    const massElement = ensureChildElement(xmlDoc, inertialElement, "mass");
    massElement.setAttribute(
      "value",
      toScalarAttribute(synthesized.mass, INERTIAL_SYNTHESIS_MASS_PRECISION_DECIMALS)
    );

    const inertiaElement = ensureChildElement(xmlDoc, inertialElement, "inertia");
    inertiaElement.setAttribute(
      "ixx",
      toScalarAttribute(synthesized.inertia.ixx, INERTIAL_SYNTHESIS_INERTIA_PRECISION_DECIMALS)
    );
    inertiaElement.setAttribute(
      "ixy",
      toScalarAttribute(synthesized.inertia.ixy, INERTIAL_SYNTHESIS_INERTIA_PRECISION_DECIMALS)
    );
    inertiaElement.setAttribute(
      "ixz",
      toScalarAttribute(synthesized.inertia.ixz, INERTIAL_SYNTHESIS_INERTIA_PRECISION_DECIMALS)
    );
    inertiaElement.setAttribute(
      "iyy",
      toScalarAttribute(synthesized.inertia.iyy, INERTIAL_SYNTHESIS_INERTIA_PRECISION_DECIMALS)
    );
    inertiaElement.setAttribute(
      "iyz",
      toScalarAttribute(synthesized.inertia.iyz, INERTIAL_SYNTHESIS_INERTIA_PRECISION_DECIMALS)
    );
    inertiaElement.setAttribute(
      "izz",
      toScalarAttribute(synthesized.inertia.izz, INERTIAL_SYNTHESIS_INERTIA_PRECISION_DECIMALS)
    );
  });

  return serializeUrdfDocument(xmlDoc);
};
