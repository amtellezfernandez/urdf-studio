import { describe, expect, it } from "vitest";
import { parseUrdfStructureCommentHints } from "./urdfStructureCommentHints";

const COMMENT_HINT_URDF = `<?xml version="1.0"?>
<robot name="comment_hints">
  <!-- urdf-studio:group arm1 -->
  <joint name="left_shoulder_joint" type="revolute">
    <parent link="base_link" />
    <child link="left_arm_link" />
  </joint>
  <!-- urdf-studio:group label=arm2 joint=right_shoulder_joint -->
  <joint name="right_shoulder_joint" type="revolute">
    <parent link="base_link" />
    <child link="right_arm_link" />
  </joint>
  <!-- urdf-studio:group=base -->
  <link name="base_link" />
</robot>`;

describe("parseUrdfStructureCommentHints", () => {
  it("parses pending and explicit comment directives", () => {
    const hints = parseUrdfStructureCommentHints(COMMENT_HINT_URDF);

    expect(hints.jointLabelByName.left_shoulder_joint).toBe("arm1");
    expect(hints.jointLabelByName.right_shoulder_joint).toBe("arm2");
    expect(hints.linkLabelByName.base_link).toBe("base");
  });
});

