/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

import { parseJointEffortLimits } from "@/features/layout/jointEffortLimits";

describe("parseJointEffortLimits", () => {
  it("reads positive effort limits by joint name", () => {
    expect(
      parseJointEffortLimits(`
        <robot name="demo">
          <joint name="shoulder" type="revolute">
            <limit lower="-1" upper="1" effort="12.5" velocity="2"/>
          </joint>
          <joint name="slide" type="prismatic">
            <limit effort="3"/>
          </joint>
        </robot>
      `)
    ).toEqual({
      shoulder: 12.5,
      slide: 3,
    });
  });

  it("reports null for missing, zero, negative, and invalid efforts", () => {
    expect(
      parseJointEffortLimits(`
        <robot name="demo">
          <joint name="missing" type="fixed"/>
          <joint name="zero" type="revolute"><limit effort="0"/></joint>
          <joint name="negative" type="revolute"><limit effort="-1"/></joint>
          <joint name="invalid" type="revolute"><limit effort="bad"/></joint>
        </robot>
      `)
    ).toEqual({
      missing: null,
      zero: null,
      negative: null,
      invalid: null,
    });
  });

  it("returns an empty map for empty or invalid URDF", () => {
    expect(parseJointEffortLimits()).toEqual({});
    expect(parseJointEffortLimits("<robot><joint>")).toEqual({});
  });
});
