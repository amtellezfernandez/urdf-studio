import { describe, expect, it } from "vitest";
import { resolveEffectiveEndEffectorLink } from "@/features/layout/endEffectorSelection";

const LINKS = ["base_link", "arm_link", "gripper_link"];

describe("resolveEffectiveEndEffectorLink", () => {
  it("prefers explicit end-effector when present and available", () => {
    const resolved = resolveEffectiveEndEffectorLink({
      explicitEndEffectorLink: "gripper_link",
      endEffectorCandidates: ["arm_link"],
      availableLinks: LINKS,
    });
    expect(resolved).toBe("gripper_link");
  });

  it("falls back to first available candidate when explicit is missing", () => {
    const resolved = resolveEffectiveEndEffectorLink({
      explicitEndEffectorLink: null,
      endEffectorCandidates: ["arm_link", "gripper_link"],
      availableLinks: LINKS,
    });
    expect(resolved).toBe("arm_link");
  });

  it("ignores unknown candidates and picks the first known one", () => {
    const resolved = resolveEffectiveEndEffectorLink({
      explicitEndEffectorLink: null,
      endEffectorCandidates: ["unknown_link", "gripper_link"],
      availableLinks: LINKS,
    });
    expect(resolved).toBe("gripper_link");
  });

  it("returns null when no explicit or candidate end-effector exists", () => {
    const resolved = resolveEffectiveEndEffectorLink({
      explicitEndEffectorLink: "",
      endEffectorCandidates: [],
      availableLinks: LINKS,
    });
    expect(resolved).toBeNull();
  });
});
