/** @vitest-environment jsdom */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildCanonicalSynthesisDraft } from "./canonicalSynthesisDraft";
import type { KinematicSynthesisPreview } from "./kinematicSynthesizer";

const SOURCE_URDF = `
<robot name="demo_robot">
  <link name="base_link" />
  <link name="arm_link" />
  <joint name="base_to_arm" type="fixed">
    <parent link="base_link" />
    <child link="arm_link" />
  </joint>
</robot>
`;

const SYNTHESIS_PREVIEW: KinematicSynthesisPreview = {
  robotName: "demo_robot",
  rootLinkName: "base_link",
  linkCount: 2,
  jointCount: 1,
  supportPlane: {
    success: true,
    inferredUpAxis: "z",
    inferredUpSign: 1,
    targetUpAxis: "z",
    targetUpSign: 1,
    confidence: 1,
    alignmentQuaternion: new THREE.Quaternion(),
    alignmentMatrix: new THREE.Matrix4(),
    candidates: [],
    evidence: "Likely +z up.",
  },
  links: [
    {
      linkName: "base_link",
      parentLinkName: null,
      localXyz: [0, 0, 0],
      localRpy: [0, 0, 0],
    },
    {
      linkName: "arm_link",
      parentLinkName: "base_link",
      localXyz: [1, 2, 3],
      localRpy: [0.1, 0.2, 0.3],
    },
  ],
  joints: [
    {
      jointName: "base_to_arm",
      jointType: "fixed",
      parentLinkName: "base_link",
      childLinkName: "arm_link",
      xyz: [1, 2, 3],
      rpy: [0.1, 0.2, 0.3],
    },
  ],
  sampleJoints: [
    {
      jointName: "base_to_arm",
      jointType: "fixed",
      parentLinkName: "base_link",
      childLinkName: "arm_link",
      xyz: [1, 2, 3],
      rpy: [0.1, 0.2, 0.3],
    },
  ],
};

describe("canonicalSynthesisDraft", () => {
  it("writes synthesized joint origins into a canonical draft URDF", () => {
    const result = buildCanonicalSynthesisDraft(SOURCE_URDF, SYNTHESIS_PREVIEW);

    expect(result).toContain('<origin xyz="1 2 3" rpy="0.1 0.2 0.3"/>');
  });

  it("returns null when the source URDF cannot be parsed", () => {
    expect(buildCanonicalSynthesisDraft("", SYNTHESIS_PREVIEW)).toBeNull();
  });
});
