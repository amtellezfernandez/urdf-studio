import type { URDFRobot } from "urdf-loader";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import type { ManipulatorPartition, MotionPartitions } from "./types";

const WHEEL_JOINT_PATTERN = /(wheel|tire|caster|drive)/i;
const GRIPPER_JOINT_PATTERN = /(gripper|finger|claw|jaw)/i;
const MAX_CHAIN_DEPTH = 256;

const uniqueStrings = (values: string[]): string[] => Array.from(new Set(values));

const buildChildToJointNameMap = (urdfAnalysis: UrdfAnalysis | null): Map<string, string> => {
  const childToJointName = new Map<string, string>();
  urdfAnalysis?.jointHierarchy?.orderedJoints?.forEach((joint) => {
    if (!joint?.childLink || !joint?.jointName) return;
    childToJointName.set(joint.childLink, joint.jointName);
  });
  return childToJointName;
};

const buildJointChainToRoot = (
  urdfAnalysis: UrdfAnalysis | null,
  childToJointName: Map<string, string>,
  endEffectorLink: string
): string[] => {
  if (!urdfAnalysis?.jointByChildLink) return [];
  const chain: string[] = [];
  let cursor: string | undefined = endEffectorLink;
  let depth = 0;
  while (cursor && depth < MAX_CHAIN_DEPTH) {
    const jointInfo = urdfAnalysis.jointByChildLink[cursor];
    if (!jointInfo) break;
    const jointName = childToJointName.get(cursor);
    if (jointName) {
      chain.push(jointName);
    }
    cursor = jointInfo.parentLink;
    depth += 1;
  }
  return uniqueStrings(chain);
};

const partitionManipulators = (
  chains: Array<{ endEffectorLink: string; jointNames: string[] }>
): ManipulatorPartition[] => {
  const jointUseCount = new Map<string, number>();
  chains.forEach(({ jointNames }) => {
    jointNames.forEach((jointName) => {
      jointUseCount.set(jointName, (jointUseCount.get(jointName) ?? 0) + 1);
    });
  });

  return chains.map(({ endEffectorLink, jointNames }) => {
    const sharedJointNames = jointNames
      .filter((jointName) => (jointUseCount.get(jointName) ?? 0) > 1)
      .sort((a, b) => a.localeCompare(b));
    let ownedJointNames = jointNames
      .filter((jointName) => (jointUseCount.get(jointName) ?? 0) <= 1)
      .sort((a, b) => a.localeCompare(b));
    if (ownedJointNames.length === 0) {
      ownedJointNames = [...jointNames].sort((a, b) => a.localeCompare(b));
    }
    return {
      id: `arm:${endEffectorLink}`,
      endEffectorLink,
      ownedJointNames,
      sharedJointNames,
    };
  });
};

type BuildMotionPartitionsParams = {
  robot: URDFRobot | null;
  urdfAnalysis: UrdfAnalysis | null;
  endEffectorLinks: string[];
};

export const buildMotionPartitions = ({
  robot,
  urdfAnalysis,
  endEffectorLinks,
}: BuildMotionPartitionsParams): MotionPartitions => {
  const allJointNames = uniqueStrings(Object.keys(robot?.joints ?? {})).sort((a, b) =>
    a.localeCompare(b)
  );
  const baseJointNames = allJointNames.filter((jointName) =>
    WHEEL_JOINT_PATTERN.test(jointName)
  );
  const gripperJointNames = allJointNames.filter((jointName) =>
    GRIPPER_JOINT_PATTERN.test(jointName)
  );
  const childToJointName = buildChildToJointNameMap(urdfAnalysis);
  const normalizedEeLinks = uniqueStrings(
    endEffectorLinks.map((link) => link.trim()).filter(Boolean)
  );

  const chains = normalizedEeLinks
    .map((endEffectorLink) => {
      const rawChain = buildJointChainToRoot(urdfAnalysis, childToJointName, endEffectorLink);
      const filteredChain = rawChain.filter(
        (jointName) => !WHEEL_JOINT_PATTERN.test(jointName) && allJointNames.includes(jointName)
      );
      return {
        endEffectorLink,
        jointNames: filteredChain,
      };
    })
    .filter((entry) => entry.jointNames.length > 0);

  const manipulators = partitionManipulators(chains);
  const manipulatorByEndEffector: Record<string, string> = {};
  const manipulatorJointOwners: Record<string, string> = {};
  manipulators.forEach((partition) => {
    manipulatorByEndEffector[partition.endEffectorLink] = partition.id;
    partition.ownedJointNames.forEach((jointName) => {
      if (!manipulatorJointOwners[jointName]) {
        manipulatorJointOwners[jointName] = partition.id;
      }
    });
  });

  baseJointNames.forEach((jointName) => {
    if (!manipulatorJointOwners[jointName]) {
      manipulatorJointOwners[jointName] = "base:wheel-drive";
    }
  });
  gripperJointNames.forEach((jointName) => {
    if (!manipulatorJointOwners[jointName]) {
      manipulatorJointOwners[jointName] = "gripper:aux";
    }
  });

  const unownedJointNames = allJointNames.filter((jointName) => !manipulatorJointOwners[jointName]);

  return {
    manipulatorByEndEffector,
    manipulatorJointOwners,
    manipulators,
    baseJointNames,
    gripperJointNames,
    unownedJointNames,
  };
};
