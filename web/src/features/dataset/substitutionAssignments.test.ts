import { describe, expect, it } from "vitest";

import {
  assignSubstitutionTarget,
  clearSubstitutionTarget,
  createEmptySubstitutionAssignments,
  pruneSubstitutionAssignments,
} from "@/features/dataset/substitutionAssignments";

describe("substitutionAssignments", () => {
  it("starts with empty host and element assignments", () => {
    expect(createEmptySubstitutionAssignments()).toEqual({
      host: null,
      element: null,
    });
  });

  it("keeps host and element unique when the same robot is reassigned", () => {
    const withHost = assignSubstitutionTarget(createEmptySubstitutionAssignments(), "host", "robot-a");
    expect(withHost).toEqual({
      host: "robot-a",
      element: null,
    });

    expect(assignSubstitutionTarget(withHost, "element", "robot-a")).toEqual({
      host: null,
      element: "robot-a",
    });
  });

  it("clears only the requested target", () => {
    const assigned = {
      host: "robot-a",
      element: "robot-b",
    };

    expect(clearSubstitutionTarget(assigned, "host")).toEqual({
      host: null,
      element: "robot-b",
    });
  });

  it("prunes assignments when queued robots disappear", () => {
    expect(
      pruneSubstitutionAssignments(
        {
          host: "robot-a",
          element: "robot-b",
        },
        new Set(["robot-b", "robot-c"])
      )
    ).toEqual({
      host: null,
      element: "robot-b",
    });
  });
});
