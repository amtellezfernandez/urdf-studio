import * as THREE from "three";
import type { URDFLink, URDFRobot } from "urdf-loader";
import { parseUrdfDocument } from "@/shared/lib/urdfCore";
import { KINEMATIC_SYNTHESIS_PREVIEW_SAMPLE_LIMIT } from "./kinematicSynthesizerParams";
import {
  optimizeRobotSupportPlane,
  type SupportPlaneOptimizationResult,
} from "./supportPlaneOptimization";

export type SynthesizedUrdfJointFrame = {
  jointName: string;
  jointType: string;
  parentLinkName: string;
  childLinkName: string;
  xyz: [number, number, number];
  rpy: [number, number, number];
};

export type SynthesizedUrdfLinkFrame = {
  linkName: string;
  parentLinkName: string | null;
  localXyz: [number, number, number];
  localRpy: [number, number, number];
};

export type KinematicSynthesisPreview = {
  robotName: string | null;
  rootLinkName: string;
  linkCount: number;
  jointCount: number;
  supportPlane: SupportPlaneOptimizationResult;
  links: SynthesizedUrdfLinkFrame[];
  joints: SynthesizedUrdfJointFrame[];
  sampleJoints: SynthesizedUrdfJointFrame[];
};

export type CapturedKinematicLinkWorldPose = {
  linkName: string;
  matrixWorldElements: number[];
};

export type CapturedKinematicState = {
  robotName: string | null;
  supportPlane: SupportPlaneOptimizationResult;
  capturedLinkWorldPoses: CapturedKinematicLinkWorldPose[];
};

type ParsedJointTopology = {
  jointName: string;
  jointType: string;
  parentLinkName: string;
  childLinkName: string;
};

type ParsedRobotTopology = {
  robotName: string | null;
  rootLinkName: string;
  links: string[];
  joints: ParsedJointTopology[];
};

const FLOAT_PRECISION_DECIMALS = 6;

const toRoundedTuple = (vector: THREE.Vector3): [number, number, number] => [
  Number(vector.x.toFixed(FLOAT_PRECISION_DECIMALS)),
  Number(vector.y.toFixed(FLOAT_PRECISION_DECIMALS)),
  Number(vector.z.toFixed(FLOAT_PRECISION_DECIMALS)),
];

const decomposeMatrixToUrdfPose = (
  matrix: THREE.Matrix4
): { xyz: [number, number, number]; rpy: [number, number, number] } => {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  const euler = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");
  return {
    xyz: toRoundedTuple(position),
    rpy: toRoundedTuple(new THREE.Vector3(euler.x, euler.y, euler.z)),
  };
};

const parseRobotTopology = (urdfContent: string): ParsedRobotTopology | null => {
  const xmlDoc = parseUrdfDocument(urdfContent);
  const robotElement = xmlDoc?.querySelector("robot");
  if (!robotElement) {
    return null;
  }

  const links = Array.from(robotElement.querySelectorAll(":scope > link[name]"))
    .map((linkElement) => linkElement.getAttribute("name") ?? "")
    .filter(Boolean);
  const joints = Array.from(robotElement.querySelectorAll(":scope > joint[name]"))
    .map((jointElement) => {
      const jointName = jointElement.getAttribute("name") ?? "";
      const jointType = jointElement.getAttribute("type") ?? "fixed";
      const parentLinkName =
        jointElement.querySelector(":scope > parent")?.getAttribute("link") ?? "";
      const childLinkName =
        jointElement.querySelector(":scope > child")?.getAttribute("link") ?? "";
      if (!jointName || !parentLinkName || !childLinkName) {
        return null;
      }
      return {
        jointName,
        jointType,
        parentLinkName,
        childLinkName,
      };
    })
    .filter((joint): joint is ParsedJointTopology => Boolean(joint));

  const childLinkNames = new Set(joints.map((joint) => joint.childLinkName));
  const rootLinkName = links.find((linkName) => !childLinkNames.has(linkName));
  if (!rootLinkName) {
    return null;
  }

  return {
    robotName: robotElement.getAttribute("name"),
    rootLinkName,
    links,
    joints,
  };
};

const resolveRobotLinkObject = (
  robot: URDFRobot,
  linkName: string
): THREE.Object3D | null => {
  const directLink = robot.links?.[linkName] as URDFLink | undefined;
  if (directLink) {
    return directLink;
  }
  const fallback = robot.getObjectByName?.(linkName);
  return fallback ?? null;
};

const buildLinkWorldMatrices = (
  robot: URDFRobot,
  linkNames: string[]
): Map<string, THREE.Matrix4> => {
  robot.updateMatrixWorld(true);
  const worldMatrices = new Map<string, THREE.Matrix4>();
  linkNames.forEach((linkName) => {
    const linkObject = resolveRobotLinkObject(robot, linkName);
    if (!linkObject) {
      return;
    }
    linkObject.updateMatrixWorld(true);
    worldMatrices.set(linkName, linkObject.matrixWorld.clone());
  });
  return worldMatrices;
};

export const captureKinematicState = (
  robot: URDFRobot | null,
  urdfContent: string
): CapturedKinematicState | null => {
  if (!robot) {
    return null;
  }

  const topology = parseRobotTopology(urdfContent);
  if (!topology) {
    return null;
  }

  const linkWorldMatrices = buildLinkWorldMatrices(robot, topology.links);
  if (!linkWorldMatrices.has(topology.rootLinkName)) {
    return null;
  }

  return {
    robotName: topology.robotName ?? robot.robotName ?? null,
    supportPlane: optimizeRobotSupportPlane(robot),
    capturedLinkWorldPoses: topology.links
      .map((linkName) => {
        const matrix = linkWorldMatrices.get(linkName);
        if (!matrix) {
          return null;
        }
        return {
          linkName,
          matrixWorldElements: Array.from(matrix.elements),
        };
      })
      .filter((entry): entry is CapturedKinematicLinkWorldPose => Boolean(entry)),
  };
};

export const synthesizeKinematicPreviewFromCapturedState = ({
  urdfContent,
  capturedState,
}: {
  urdfContent: string;
  capturedState: CapturedKinematicState;
}): KinematicSynthesisPreview | null => {
  const topology = parseRobotTopology(urdfContent);
  if (!topology) {
    return null;
  }

  const linkWorldMatrices = new Map(
    capturedState.capturedLinkWorldPoses.map((entry) => [
      entry.linkName,
      new THREE.Matrix4().fromArray(entry.matrixWorldElements),
    ])
  );
  if (!linkWorldMatrices.has(topology.rootLinkName)) {
    return null;
  }

  const joints: SynthesizedUrdfJointFrame[] = topology.joints
    .map((joint) => {
      const parentWorld = linkWorldMatrices.get(joint.parentLinkName);
      const childWorld = linkWorldMatrices.get(joint.childLinkName);
      if (!parentWorld || !childWorld) {
        return null;
      }
      const localMatrix = parentWorld.clone().invert().multiply(childWorld);
      const pose = decomposeMatrixToUrdfPose(localMatrix);
      return {
        jointName: joint.jointName,
        jointType: joint.jointType,
        parentLinkName: joint.parentLinkName,
        childLinkName: joint.childLinkName,
        xyz: pose.xyz,
        rpy: pose.rpy,
      };
    })
    .filter((joint): joint is SynthesizedUrdfJointFrame => Boolean(joint));

  const childToParentLink = new Map<string, string>();
  joints.forEach((joint) => {
    childToParentLink.set(joint.childLinkName, joint.parentLinkName);
  });

  const links: SynthesizedUrdfLinkFrame[] = topology.links
    .map((linkName) => {
      if (linkName === topology.rootLinkName) {
        return {
          linkName,
          parentLinkName: null,
          localXyz: [0, 0, 0] as [number, number, number],
          localRpy: [0, 0, 0] as [number, number, number],
        };
      }
      const parentLinkName = childToParentLink.get(linkName) ?? null;
      const parentWorld = parentLinkName ? linkWorldMatrices.get(parentLinkName) : null;
      const childWorld = linkWorldMatrices.get(linkName);
      if (!parentLinkName || !parentWorld || !childWorld) {
        return null;
      }
      const localMatrix = parentWorld.clone().invert().multiply(childWorld);
      const pose = decomposeMatrixToUrdfPose(localMatrix);
      return {
        linkName,
        parentLinkName,
        localXyz: pose.xyz,
        localRpy: pose.rpy,
      };
    })
    .filter((link): link is SynthesizedUrdfLinkFrame => Boolean(link));

  return {
    robotName: topology.robotName ?? capturedState.robotName ?? null,
    rootLinkName: topology.rootLinkName,
    linkCount: links.length,
    jointCount: joints.length,
    supportPlane: capturedState.supportPlane,
    links,
    joints,
    sampleJoints: joints.slice(0, KINEMATIC_SYNTHESIS_PREVIEW_SAMPLE_LIMIT),
  };
};

export const synthesizeKinematicPreview = (
  robot: URDFRobot | null,
  urdfContent: string
): KinematicSynthesisPreview | null => {
  const capturedState = captureKinematicState(robot, urdfContent);
  if (!capturedState) {
    return null;
  }
  return synthesizeKinematicPreviewFromCapturedState({
    urdfContent,
    capturedState,
  });
};
