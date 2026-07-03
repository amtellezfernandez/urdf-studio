import jointColors from "@/shared/joint_colors.json";
import type { JointLimits } from "@/shared/lib/urdfBrowser";

const JOINT_TYPE_ORDER = [
  "revolute",
  "continuous",
  "prismatic",
  "fixed",
  "planar",
  "floating",
  "mimic",
] as const;

export type JointTypeEntry = {
  color: string;
  count: number;
  isFixed: boolean;
  isSelected: boolean;
  label: string;
  type: string;
};

export function buildJointTypeNamesByType(jointLimits?: JointLimits): Record<string, string[]> {
  const namesByType: Record<string, string[]> = {};
  Object.entries(jointLimits ?? {}).forEach(([name, info]) => {
    const type = info?.type || "continuous";
    const existing = namesByType[type];
    if (existing) {
      existing.push(name);
    } else {
      namesByType[type] = [name];
    }
  });
  return namesByType;
}

export function getJointTypeLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function buildJointTypeEntries({
  jointLimits,
  selectedJoint,
}: {
  jointLimits?: JointLimits;
  selectedJoint?: string | null;
}): JointTypeEntry[] {
  const namesByType = buildJointTypeNamesByType(jointLimits);
  return Object.keys(namesByType)
    .sort((a, b) => {
      const aIndex = JOINT_TYPE_ORDER.indexOf(a as (typeof JOINT_TYPE_ORDER)[number]);
      const bIndex = JOINT_TYPE_ORDER.indexOf(b as (typeof JOINT_TYPE_ORDER)[number]);
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    })
    .map((type) => {
      const typeJoints = namesByType[type] ?? [];
      const color = (jointColors as Record<string, string>)[type] || jointColors.light_gray;
      return {
        color,
        count: typeJoints.length,
        isFixed: type === "fixed",
        isSelected: Boolean(selectedJoint && typeJoints.includes(selectedJoint)),
        label: getJointTypeLabel(type),
        type,
      };
    });
}
