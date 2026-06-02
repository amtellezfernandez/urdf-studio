/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  convertURDFToMJCF as convertURDFToMJCFShared,
  convertURDFToXacro as convertURDFToXacroShared,
  convertURDFToMJCF,
  convertURDFToXacro,
} from "@/shared/lib/urdfCore";

const SAMPLE_URDF = `<?xml version="1.0"?>
<robot name="demo_robot">
  <link name="base_link">
    <visual>
      <geometry>
        <box size="1 1 1"/>
      </geometry>
    </visual>
  </link>
</robot>`;

describe("shared URDF converters", () => {
  it("re-exports MJCF converter from shared package", () => {
    expect(convertURDFToMJCF).toBe(convertURDFToMJCFShared);
    const result = convertURDFToMJCF(SAMPLE_URDF);
    expect(result.mjcfContent).toContain("<mujoco model=\"demo_robot\">");
    expect(result.mjcfContent).toContain("<worldbody>");
    expect(result.warnings).toHaveLength(0);
  });

  it("re-exports XACRO converter from shared package", () => {
    expect(convertURDFToXacro).toBe(convertURDFToXacroShared);
    const result = convertURDFToXacro(SAMPLE_URDF);
    expect(result.xacroContent).toContain("xmlns:xacro=");
    expect(result.xacroContent).toContain("<robot");
  });
});
