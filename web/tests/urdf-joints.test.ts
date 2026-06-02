import { describe, expect, it, vi } from "vitest";
import type { URDFRobot } from "urdf-loader";
import { applyJointValues } from "@/shared/lib/urdf-joints";

describe("applyJointValues", () => {
  it("filters non-finite values before applying", () => {
    const setJointValues = vi.fn();
    const robot = { setJointValues } as unknown as URDFRobot;

    applyJointValues(robot, { joint_a: 1, joint_b: Number.NaN, joint_c: Infinity, joint_d: -2 });

    expect(setJointValues).toHaveBeenCalledTimes(1);
    expect(setJointValues).toHaveBeenCalledWith({ joint_a: 1, joint_d: -2 });
  });

  it("falls back to setJointValue when setJointValues is missing", () => {
    const setJointValue = vi.fn();
    const robot = { setJointValue } as unknown as URDFRobot;

    applyJointValues(robot, { joint_a: 0.5, joint_b: Number.NaN, joint_c: 1.25 });

    expect(setJointValue).toHaveBeenCalledWith("joint_a", 0.5);
    expect(setJointValue).toHaveBeenCalledWith("joint_c", 1.25);
    expect(setJointValue).toHaveBeenCalledTimes(2);
  });
});
