import { describe, expect, it } from "vitest";
import { getJointColor } from "./jointColors";

const hexToRgb = (hex: string) => {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
};

const rgbDistance = (a: string, b: string) => {
  const ar = hexToRgb(a);
  const br = hexToRgb(b);
  const dr = ar.r - br.r;
  const dg = ar.g - br.g;
  const db = ar.b - br.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

describe("getJointColor", () => {
  it("assigns deterministic unique colors per joint set", () => {
    const joints = [
      "left_shoulder_joint",
      "left_elbow_joint",
      "left_wrist_joint",
      "right_shoulder_joint",
      "right_elbow_joint",
      "right_wrist_joint",
      "waist_yaw_joint",
      "base_joint",
    ];

    const colorsA = joints.map((joint) => getJointColor(joint, joints));
    const colorsB = joints.map((joint) => getJointColor(joint, [...joints].reverse()));

    expect(new Set(colorsA).size).toBe(joints.length);
    expect(colorsA).toEqual(colorsB);
  });

  it("keeps strong end-effector joints in drag-handle blue", () => {
    const joints = ["left_shoulder_joint", "left_elbow_joint", "tool0", "tcp"];
    const tool0Color = getJointColor("tool0", joints);
    const tcpColor = getJointColor("tcp", joints);
    const exactBlueCount = [tool0Color, tcpColor].filter((value) => value === "#4dabf7").length;
    expect(exactBlueCount).toBe(1);

    const tcp = hexToRgb(tcpColor);
    const tool0 = hexToRgb(tool0Color);
    expect(tcp.b).toBeGreaterThan(tcp.r);
    expect(tcp.b).toBeGreaterThan(tcp.g - 16);
    expect(tool0.b).toBeGreaterThan(tool0.r);
    expect(tool0.b).toBeGreaterThan(tool0.g - 16);
  });

  it("keeps semantic distinction between arm and leg families", () => {
    const joints = ["left_shoulder_joint", "left_elbow_joint", "left_hip_joint", "left_knee_joint"];
    const arm = hexToRgb(getJointColor("left_shoulder_joint", joints));
    const leg = hexToRgb(getJointColor("left_hip_joint", joints));

    // Arms are blue-family and legs are pink/red-family by design.
    expect(arm.b).toBeGreaterThan(arm.r);
    expect(leg.r).toBeGreaterThan(leg.g);
  });

  it("keeps arm-heavy sets visually separable", () => {
    const joints = [
      "left_arm_joint_1",
      "left_arm_joint_2",
      "left_arm_joint_3",
      "left_arm_joint_4",
      "left_arm_joint_5",
      "left_arm_joint_6",
      "left_arm_joint_7",
      "left_arm_joint_8",
    ];
    const colors = joints.map((joint) => getJointColor(joint, joints));
    let minDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < colors.length; i += 1) {
      for (let j = i + 1; j < colors.length; j += 1) {
        minDistance = Math.min(minDistance, rgbDistance(colors[i], colors[j]));
      }
    }
    expect(minDistance).toBeGreaterThan(24);
  });
});
