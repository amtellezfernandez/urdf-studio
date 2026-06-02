/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  computeStudioWheelDriveAuthority,
  inferStudioWheelSideFromLateralOffset,
  STUDIO_AUTO_DRIVE_HINT_CONTROL_NAME,
  STUDIO_WHEEL_AXIS_ALIGNMENT_WITH_UP_MAX,
  STUDIO_WHEEL_SIDE_INFERENCE_MIN_OFFSET_M,
  STUDIO_WHEEL_NAME_TOKEN_REGEX,
  STUDIO_WHEEL_REVOLUTE_SPAN_MIN_RAD,
  applyStudioDriveJointHintsToUrdf,
  extractStudioDriveJointHintsFromUrdf,
  getStudioWheelRoleLabel,
  isStudioWheelLikeLabel,
  persistStudioDriveJointHintsToUrdf,
  resolveStudioActiveDriveJointNames,
  shouldDetectStudioWheelJointByHintOrLabel,
  shouldIncludeStudioWheelJoint,
  toStudioWheelRoleDisplayEntries,
} from "./studioWheelDriveHeuristics";

describe("studioWheelDriveHeuristics", () => {
  it("includes continuous joints that are not aligned to world up", () => {
    expect(
      shouldIncludeStudioWheelJoint({
        axisAlignmentWithUp: STUDIO_WHEEL_AXIS_ALIGNMENT_WITH_UP_MAX * 0.5,
        jointType: "continuous",
      })
    ).toBe(true);
  });

  it("excludes wheel-like joints whose axis is too aligned with world up", () => {
    expect(
      shouldIncludeStudioWheelJoint({
        axisAlignmentWithUp: STUDIO_WHEEL_AXIS_ALIGNMENT_WITH_UP_MAX + 0.01,
        jointType: "continuous",
      })
    ).toBe(false);
  });

  it("excludes revolute joints with small finite angular span", () => {
    const lowerLimit = 0;
    const upperLimit = STUDIO_WHEEL_REVOLUTE_SPAN_MIN_RAD * 0.5;
    expect(
      shouldIncludeStudioWheelJoint({
        axisAlignmentWithUp: STUDIO_WHEEL_AXIS_ALIGNMENT_WITH_UP_MAX * 0.5,
        jointType: "revolute",
        lowerLimit,
        upperLimit,
      })
    ).toBe(false);
  });

  it("keeps revolute joints with large finite angular span", () => {
    const lowerLimit = -STUDIO_WHEEL_REVOLUTE_SPAN_MIN_RAD;
    const upperLimit = STUDIO_WHEEL_REVOLUTE_SPAN_MIN_RAD;
    expect(
      shouldIncludeStudioWheelJoint({
        axisAlignmentWithUp: STUDIO_WHEEL_AXIS_ALIGNMENT_WITH_UP_MAX * 0.5,
        jointType: "revolute",
        lowerLimit,
        upperLimit,
      })
    ).toBe(true);
  });

  it("renders unknown role as idle in the wheel role UI", () => {
    expect(getStudioWheelRoleLabel("unknown")).toBe("idle");
    expect(getStudioWheelRoleLabel("drive")).toBe("drive");
  });

  it("matches wheel-like labels across wheel/tire/rim/caster tokens", () => {
    expect(STUDIO_WHEEL_NAME_TOKEN_REGEX.test("front_wheel_joint")).toBe(true);
    expect(isStudioWheelLikeLabel("rear_tire_joint")).toBe(true);
    expect(isStudioWheelLikeLabel("left_rim_hinge")).toBe(true);
    expect(isStudioWheelLikeLabel("caster_swivel_joint")).toBe(true);
    expect(isStudioWheelLikeLabel("revolution_41")).toBe(false);
    expect(isStudioWheelLikeLabel("revolution_41 front_wheel_right_1")).toBe(true);
  });

  it("allows hinted drive joints even when names are not wheel-like", () => {
    expect(
      shouldDetectStudioWheelJointByHintOrLabel({
        jointName: "revolution_41",
        label: "revolution_41 child_link",
        driveJointHints: new Set(["revolution_41"]),
      })
    ).toBe(true);
    expect(
      shouldDetectStudioWheelJointByHintOrLabel({
        jointName: "arm_joint_1",
        label: "arm_joint_1 child_link",
        driveJointHints: new Set(["revolution_41"]),
      })
    ).toBe(false);
  });

  it("does not classify generic revolution joints as wheels without wheel-like child labels", () => {
    expect(
      shouldDetectStudioWheelJointByHintOrLabel({
        jointName: "revolution_21",
        label: "revolution_21 link3_1",
      })
    ).toBe(false);
    expect(
      shouldDetectStudioWheelJointByHintOrLabel({
        jointName: "revolution_41",
        label: "revolution_41 front_wheel_right_1",
      })
    ).toBe(true);
  });

  it("infers wheel side from lateral offset with deadzone", () => {
    expect(inferStudioWheelSideFromLateralOffset(0.2)).toBe("right");
    expect(inferStudioWheelSideFromLateralOffset(-0.2)).toBe("left");
    expect(
      inferStudioWheelSideFromLateralOffset(
        STUDIO_WHEEL_SIDE_INFERENCE_MIN_OFFSET_M * 0.5
      )
    ).toBe("unknown");
  });

  it("extracts drive joint hints from transmission and ros2_control blocks", () => {
    const urdf = `<?xml version="1.0"?>
<robot name="drive_hints">
  <transmission name="left_drive_trans">
    <joint name="left_wheel_joint" />
  </transmission>
  <ros2_control name="drive_controller" type="system">
    <joint name="right_wheel_joint" />
  </ros2_control>
</robot>`;
    const hints = extractStudioDriveJointHintsFromUrdf(urdf);
    expect(Array.from(hints).sort()).toEqual(["left_wheel_joint", "right_wheel_joint"]);
  });

  it("ignores non-wheel vendor transmission hints so arms do not join rover drive", () => {
    const urdf = `<?xml version="1.0"?>
<robot name="mixed_actuation">
  <transmission name="front_drive_trans">
    <joint name="front_wheel_joint" />
  </transmission>
  <transmission name="arm_axis_1_trans">
    <joint name="revolution_21" />
  </transmission>
  <ros2_control name="vendor_controller" type="system">
    <joint name="rear_wheel_joint" />
    <joint name="revolution_22" />
  </ros2_control>
</robot>`;
    const hints = extractStudioDriveJointHintsFromUrdf(urdf);
    expect(Array.from(hints).sort()).toEqual(["front_wheel_joint", "rear_wheel_joint"]);
  });

  it("prioritizes app-managed ros2_control hints when present", () => {
    const urdf = `<?xml version="1.0"?>
<robot name="drive_hints">
  <transmission name="other_drive_trans">
    <joint name="legacy_joint_a" />
  </transmission>
  <ros2_control name="${STUDIO_AUTO_DRIVE_HINT_CONTROL_NAME}" type="system">
    <joint name="front_left_joint" />
    <joint name="front_right_joint" />
  </ros2_control>
</robot>`;
    const hints = extractStudioDriveJointHintsFromUrdf(urdf);
    expect(Array.from(hints).sort()).toEqual(["front_left_joint", "front_right_joint"]);
  });

  it("applies auto drive joint hints to URDF when none are present", () => {
    const urdf = `<?xml version="1.0"?>
    <robot name="drive_hints">
  <link name="base_link" />
</robot>`;
    const result = applyStudioDriveJointHintsToUrdf(urdf, ["right_wheel_joint", "left_wheel_joint"]);
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected auto patch to apply");
    }
    expect(result.applied).toBe(true);
    if (!result.applied) {
      throw new Error("Expected auto patch to apply");
    }
    expect(result.driveJointNames).toEqual(["left_wheel_joint", "right_wheel_joint"]);
    expect(result.content).toContain(`<ros2_control name="${STUDIO_AUTO_DRIVE_HINT_CONTROL_NAME}"`);
    const hints = extractStudioDriveJointHintsFromUrdf(result.content);
    expect(Array.from(hints).sort()).toEqual(["left_wheel_joint", "right_wheel_joint"]);
  });

  it("does not apply auto drive joint hints when hints already exist", () => {
    const urdf = `<?xml version="1.0"?>
<robot name="drive_hints">
  <ros2_control name="existing" type="system">
    <joint name="left_wheel_joint" />
  </ros2_control>
</robot>`;
    const result = applyStudioDriveJointHintsToUrdf(urdf, ["right_wheel_joint"]);
    expect(result).toEqual({
      success: true,
      applied: false,
      content: urdf,
      reason: "hints-present",
    });
  });

  it("does not apply auto drive joint hints when no drive joints are provided", () => {
    const urdf = `<?xml version="1.0"?>
<robot name="drive_hints">
  <link name="base_link" />
</robot>`;
    const result = applyStudioDriveJointHintsToUrdf(urdf, []);
    expect(result).toEqual({
      success: true,
      applied: false,
      content: urdf,
      reason: "empty-joints",
    });
  });

  it("persists drive joint hints by replacing app-managed ros2_control block", () => {
    const urdf = `<?xml version="1.0"?>
<robot name="drive_hints">
  <ros2_control name="${STUDIO_AUTO_DRIVE_HINT_CONTROL_NAME}" type="system">
    <joint name="stale_joint" />
  </ros2_control>
  <ros2_control name="existing_controller" type="system">
    <joint name="legacy_joint" />
  </ros2_control>
</robot>`;
    const result = persistStudioDriveJointHintsToUrdf(urdf, ["rear_right_joint", "rear_left_joint"]);
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected auto hint persistence to succeed");
    }
    expect(result.driveJointNames).toEqual(["rear_left_joint", "rear_right_joint"]);
    expect(result.content).toContain(`name="${STUDIO_AUTO_DRIVE_HINT_CONTROL_NAME}"`);
    expect(result.content).toContain(`name="existing_controller"`);
    const hints = extractStudioDriveJointHintsFromUrdf(result.content);
    expect(Array.from(hints).sort()).toEqual(["rear_left_joint", "rear_right_joint"]);
  });

  it("removes app-managed ros2_control drive hints when persisting an empty set", () => {
    const urdf = `<?xml version="1.0"?>
<robot name="drive_hints">
  <ros2_control name="${STUDIO_AUTO_DRIVE_HINT_CONTROL_NAME}" type="system">
    <joint name="stale_joint" />
  </ros2_control>
</robot>`;
    const result = persistStudioDriveJointHintsToUrdf(urdf, []);
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected auto hint persistence to succeed");
    }
    expect(result.driveJointNames).toEqual([]);
    expect(result.content).not.toContain(`name="${STUDIO_AUTO_DRIVE_HINT_CONTROL_NAME}"`);
  });

  it("resolves active drive joints using overrides", () => {
    const active = resolveStudioActiveDriveJointNames(
      ["front_left", "front_right", "rear_left", "rear_right"],
      ["front_left", "front_right"],
      {
        front_left: false,
        rear_left: true,
      }
    );
    expect(Array.from(active).sort()).toEqual(["front_right", "rear_left"]);
  });

  it("allows explicit overrides to disable all candidates", () => {
    const active = resolveStudioActiveDriveJointNames(
      ["front_left", "front_right"],
      ["front_left", "front_right"],
      {
        front_left: false,
        front_right: false,
      }
    );
    expect(Array.from(active).sort()).toEqual([]);
  });

  it("falls back to defaults when no explicit overrides are present", () => {
    const active = resolveStudioActiveDriveJointNames(
      ["front_left", "front_right"],
      ["front_left", "front_right"],
      {}
    );
    expect(Array.from(active).sort()).toEqual(["front_left", "front_right"]);
  });

  it("builds wheel display entries only for currently available joints", () => {
    const DRIVE_ACTIVITY_MPS = 0.2;
    const FOLLOWER_ACTIVITY_MPS = 0.1;
    const AVAILABLE_JOINT_NAMES = new Set(["front_left", "rear_right"]);
    const displayEntries = toStudioWheelRoleDisplayEntries(
      [
        {
          jointName: "front_left",
          side: "left" as const,
          role: "drive" as const,
          activityMps: DRIVE_ACTIVITY_MPS,
          driveEnabled: true,
        },
        {
          jointName: "front_right",
          side: "right" as const,
          role: "drive" as const,
          activityMps: DRIVE_ACTIVITY_MPS,
          driveEnabled: true,
        },
        {
          jointName: "rear_right",
          side: "right" as const,
          role: "follower" as const,
          activityMps: FOLLOWER_ACTIVITY_MPS,
          driveEnabled: false,
        },
      ],
      AVAILABLE_JOINT_NAMES
    );
    expect(displayEntries).toEqual([
      {
        jointName: "front_left",
        side: "left",
        role: "drive",
        activityMps: DRIVE_ACTIVITY_MPS,
        driveEnabled: true,
        wheelNumber: 1,
      },
      {
        jointName: "rear_right",
        side: "right",
        role: "follower",
        activityMps: FOLLOWER_ACTIVITY_MPS,
        driveEnabled: false,
        wheelNumber: 2,
      },
    ]);
  });

  it("computes 2x4 authority as half linear and half angular when left and right drive exist", () => {
    const authority = computeStudioWheelDriveAuthority(
      [
        { jointName: "front_left", side: "left" },
        { jointName: "rear_left", side: "left" },
        { jointName: "front_right", side: "right" },
        { jointName: "rear_right", side: "right" },
      ],
      new Set(["front_left", "front_right"])
    );
    expect(authority).toEqual({
      linearScale: 0.5,
      angularScale: 0.5,
      activeDriveCount: 2,
      totalWheelCount: 4,
      hasLeftDrive: true,
      hasRightDrive: true,
    });
  });

  it("sets angular authority to zero when all active drive wheels are on one side", () => {
    const authority = computeStudioWheelDriveAuthority(
      [
        { jointName: "front_left", side: "left" },
        { jointName: "rear_left", side: "left" },
        { jointName: "front_right", side: "right" },
        { jointName: "rear_right", side: "right" },
      ],
      new Set(["front_left", "rear_left"])
    );
    expect(authority).toEqual({
      linearScale: 0.5,
      angularScale: 0,
      activeDriveCount: 2,
      totalWheelCount: 4,
      hasLeftDrive: true,
      hasRightDrive: false,
    });
  });
});
