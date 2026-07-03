import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import {
  analyzeUrdf,
  type LinkData,
  type UrdfAnalysis,
} from "@/shared/lib/urdfCore";
import { validateInertiaTensor } from "@/features/viewer/inertialMath";

export type LinkInertial = {
  linkName: string;
  mass: number;
  origin: [number, number, number];
  rpy: [number, number, number];
  inertia: {
    ixx: number;
    ixy: number;
    ixz: number;
    iyy: number;
    iyz: number;
    izz: number;
  };
};

export type InertialStats = {
  totalMass: number;
  contributingLinks: number;
  totalLinks: number;
  missingInertialLinks: string[];
  invalidMassLinks: string[];
  invalidTensorLinks: string[];
};

const extractLinkInertialFromData = (
  linkName: string,
  data: LinkData
): LinkInertial | null => {
  const inertial = data.inertial;
  if (!inertial) return null;
  const mass = Number(inertial.mass ?? 0);
  if (!Number.isFinite(mass)) return null;
  return {
    linkName,
    mass,
    origin: inertial.origin.xyz,
    rpy: inertial.origin.rpy,
    inertia: {
      ixx: inertial.inertia.ixx,
      ixy: inertial.inertia.ixy,
      ixz: inertial.inertia.ixz,
      iyy: inertial.inertia.iyy,
      iyz: inertial.inertia.iyz,
      izz: inertial.inertia.izz,
    },
  };
};

export const extractLinkInertials = (
  urdfAnalysis: UrdfAnalysis | null,
  urdfContent: string
): LinkInertial[] => {
  const analysis = urdfAnalysis?.isValid ? urdfAnalysis : analyzeUrdf(urdfContent);
  return extractLinkInertialsFromLinkData(analysis.linkDataByName ?? {});
};

export const extractLinkInertialsFromLinkData = (
  linkDataByName: Record<string, LinkData>
): LinkInertial[] => {
  const linkNames = Object.keys(linkDataByName);
  const inertials: LinkInertial[] = [];

  linkNames.forEach((linkName) => {
    const data = linkDataByName[linkName];
    if (!data) return;
    const inertial = extractLinkInertialFromData(linkName, data);
    if (!inertial) return;
    if (inertial.mass <= 0) return;
    inertials.push(inertial);
  });

  return inertials;
};

export const computeInertialStats = (
  urdfAnalysis: UrdfAnalysis | null,
  urdfContent: string
): InertialStats => {
  const analysis = urdfAnalysis?.isValid ? urdfAnalysis : analyzeUrdf(urdfContent);
  const linkDataByName = analysis.linkDataByName ?? {};
  const allLinkNames = analysis.linkNames ?? Object.keys(linkDataByName);
  const linksRequiringInertia = new Set<string>();

  Object.entries(analysis.jointByChildLink ?? {}).forEach(([childLink, info]) => {
    const jointType = (info.type || "fixed").toLowerCase();
    if (jointType === "fixed") return;
    linksRequiringInertia.add(childLink);
    if (info.parentLink) {
      linksRequiringInertia.add(info.parentLink);
    }
  });

  if (linksRequiringInertia.size === 0) {
    Object.entries(linkDataByName).forEach(([linkName, data]) => {
      const hasRenderableGeometry =
        (data.visuals?.length ?? 0) > 0 || (data.collisions?.length ?? 0) > 0;
      if (hasRenderableGeometry) {
        linksRequiringInertia.add(linkName);
      }
    });
  }

  const requiredLinkNames = (linksRequiringInertia.size > 0
    ? Array.from(linksRequiringInertia)
    : allLinkNames
  ).filter((linkName) => !linkName.toLowerCase().endsWith("_sc"));

  const missingInertialLinks: string[] = [];
  const invalidMassLinks: string[] = [];
  const invalidTensorLinks: string[] = [];
  let totalMass = 0;
  let contributingLinks = 0;

  allLinkNames.forEach((linkName) => {
    const data = linkDataByName[linkName];
    if (!data || !data.inertial) return;
    const mass = Number(data.inertial.mass ?? 0);
    if (!Number.isFinite(mass) || mass <= 0) return;
    totalMass += mass;
  });

  requiredLinkNames.forEach((linkName) => {
    const data = linkDataByName[linkName];
    if (!data || !data.inertial) {
      missingInertialLinks.push(linkName);
      return;
    }
    const mass = Number(data.inertial.mass ?? 0);
    if (!Number.isFinite(mass) || mass <= 0) {
      invalidMassLinks.push(linkName);
      return;
    }
    const tensorCheck = validateInertiaTensor(data.inertial.inertia);
    if (!tensorCheck.valid) {
      invalidTensorLinks.push(linkName);
    }
    contributingLinks += 1;
  });

  return {
    totalMass,
    contributingLinks,
    totalLinks: requiredLinkNames.length,
    missingInertialLinks,
    invalidMassLinks,
    invalidTensorLinks,
  };
};

export const computeCenterOfMassWorld = (
  robot: URDFRobot | null,
  inertials: LinkInertial[]
): THREE.Vector3 | null => {
  if (!robot || inertials.length === 0) return null;

  robot.updateMatrixWorld(true);
  const sum = new THREE.Vector3();
  const temp = new THREE.Vector3();
  let totalMass = 0;

  for (const entry of inertials) {
    const link = robot.links?.[entry.linkName] ?? robot.getObjectByName?.(entry.linkName);
    if (!link) continue;
    temp.set(entry.origin[0], entry.origin[1], entry.origin[2]);
    link.updateMatrixWorld(true);
    link.localToWorld(temp);
    sum.addScaledVector(temp, entry.mass);
    totalMass += entry.mass;
  }

  if (totalMass <= 0) return null;
  return sum.multiplyScalar(1 / totalMass);
};
